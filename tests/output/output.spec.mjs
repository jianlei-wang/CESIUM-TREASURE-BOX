import { expect, test } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import JSZip from 'jszip'

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/fixtures/output-harness.html')
  await page.waitForFunction(() => window.__outputHarness?.ready === true)
})

test('overlay composition matches the chromium golden image', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'golden baseline is maintained for chromium')
  await page.evaluate(async () => {
    await document.fonts.ready
    window.__outputHarness.renderOverlay(1280, 720, 0.5)
  })
  await expect(page.locator('#overlay-canvas')).toHaveScreenshot('overlay-1280x720.png')
})

test('frame sequence keeps deterministic hashes and metadata', async ({ page }, testInfo) => {
  const first = await page.evaluate(() => window.__outputHarness.renderFrames({ totalSeconds: 1, fps: 6 }))
  const second = await page.evaluate(() => window.__outputHarness.renderFrames({ totalSeconds: 1, fps: 6 }))
  expect(first.diagnostics.renderedFrames).toBe(6)
  expect(first.diagnostics.totalFrames).toBe(6)
  expect(second.diagnostics.renderedFrames).toBe(6)

  const zip = await JSZip.loadAsync(Buffer.from(first.base64, 'base64'))
  const frameNames = Object.keys(zip.files)
    .filter((name) => /^frames\/frame_\d{6}\.png$/.test(name))
    .sort()
  expect(frameNames).toHaveLength(6)

  const hashes = []
  const dimensions = []
  for (const name of frameNames) {
    const buffer = await zip.file(name).async('nodebuffer')
    expect(buffer.subarray(1, 4).toString('ascii')).toBe('PNG')
    dimensions.push({ width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) })
    hashes.push(createHash('sha256').update(buffer).digest('hex'))
  }
  expect(dimensions.every((item) => item.width === 480 && item.height === 270)).toBe(true)
  expect(new Set(hashes).size).toBe(6)

  const secondZip = await JSZip.loadAsync(Buffer.from(second.base64, 'base64'))
  const secondHashes = []
  for (const name of frameNames) {
    const buffer = await secondZip.file(name).async('nodebuffer')
    secondHashes.push(createHash('sha256').update(buffer).digest('hex'))
  }
  expect(secondHashes).toEqual(hashes)

  const manifest = JSON.parse(await zip.file('manifest.json').async('string'))
  expect(manifest.totalFrames).toBe(6)
  expect(manifest.durationSeconds).toBeCloseTo(1, 5)
  expect(await zip.file('subtitles.srt').async('string')).toContain('OUTPUT CHECK')

  await testInfo.attach('frame-hashes.json', {
    body: JSON.stringify({ project: testInfo.project.name, hashes, manifest }, null, 2),
    contentType: 'application/json'
  })
})

test('realtime export decodes completely', async ({ page }, testInfo) => {
  const supported = await page.evaluate(() => window.__outputHarness.mediaSupported())
  test.skip(!supported, 'MediaRecorder video encoding is unavailable in this browser')

  const ffmpeg = findFfmpeg()
  test.skip(!ffmpeg, 'ffmpeg/ffprobe is not installed')

  const result = await page.evaluate(() => window.__outputHarness.recordClip(1))
  expect(result.diagnostics.renderedFrames).toBeGreaterThan(5)
  const buffer = Buffer.from(result.base64, 'base64')
  expect(buffer.byteLength).toBeGreaterThan(2_000)

  const target = testInfo.outputPath(`clip.${result.extension}`)
  await writeFile(target, buffer)
  const media = probeMedia(ffmpeg, target)
  expect(media.decoded, media.detail).toBe(true)
  expect([undefined, 480]).toContain(media.width)
  expect([undefined, 270]).toContain(media.height)
  expect(media.frames).toBeGreaterThan(5)
  if (Number.isFinite(media.duration)) {
    expect(media.duration).toBeGreaterThan(0.4)
    expect(media.duration).toBeLessThan(5)
  }

  await testInfo.attach(`clip.${result.extension}`, {
    path: target,
    contentType: result.mime
  })
  await testInfo.attach('media-probe.json', {
    body: JSON.stringify({ project: testInfo.project.name, media }, null, 2),
    contentType: 'application/json'
  })
})

function which(binary) {
  const result = spawnSync('which', [binary], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}

function findFfmpeg() {
  if (process.env.FFMPEG_BIN && existsSync(process.env.FFMPEG_BIN)) return process.env.FFMPEG_BIN
  return which('ffmpeg')
}

function run(binary, args) {
  return spawnSync(binary, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 })
}

function probeMedia(ffmpeg, file) {
  const decode = run(ffmpeg, ['-v', 'error', '-i', file, '-f', 'null', '-'])
  const detail = `${decode.stderr || ''}`.trim()
  if (decode.status !== 0) return { decoded: false, detail: detail || 'ffmpeg decode failed' }

  const progress = run(ffmpeg, [
    '-v',
    'error',
    '-i',
    file,
    '-map',
    '0:v:0',
    '-f',
    'null',
    '-',
    '-progress',
    'pipe:2',
    '-nostats'
  ])
  let frames = 0
  for (const match of progress.stderr.matchAll(/frame=(\d+)/g)) frames = Math.max(frames, Number(match[1]))

  const info = run(ffmpeg, ['-hide_banner', '-i', file])
  const duration = parseDuration(info.stderr)
  const videoLine = info.stderr.split('\n').find((line) => line.includes('Video:')) ?? ''
  let size = videoLine.match(/(\d{2,5})x(\d{2,5})/)
  const ffprobe = which('ffprobe') || (process.env.FFPROBE_BIN ?? '')
  let codec = videoLine.match(/Video:\s*([a-z0-9]+)/i)?.[1]

  if (ffprobe && existsSync(ffprobe)) {
    const result = run(ffprobe, [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-count_frames',
      '-show_entries',
      'stream=codec_name,width,height,nb_read_frames',
      '-show_entries',
      'format=duration',
      '-of',
      'json',
      file
    ])
    if (result.status === 0) {
      try {
        const parsed = JSON.parse(result.stdout)
        const stream = parsed.streams?.[0]
        if (stream) {
          codec = stream.codec_name ?? codec
          size = null
          return {
            decoded: true,
            detail,
            codec,
            width: stream.width,
            height: stream.height,
            frames: Number(stream.nb_read_frames ?? frames),
            duration: Number(parsed.format?.duration ?? duration)
          }
        }
      } catch {
        /* fall back to ffmpeg parsed values */
      }
    }
  }

  return {
    decoded: true,
    detail,
    codec,
    width: size ? Number(size[1]) : undefined,
    height: size ? Number(size[2]) : undefined,
    frames,
    duration
  }
}

function parseDuration(text) {
  const match = text.match(/Duration:\s*(\d+):(\d+):([\d.]+)/)
  if (!match) return Number.NaN
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

test('app exposes boot timing and diagnostics', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => typeof window.__STUDIO_BOOT_MS__ === 'number', null, { timeout: 30_000 })
  const state = await page.evaluate(() => ({
    boot: window.__STUDIO_BOOT_MS__,
    diagnostics: Array.isArray(window.__STUDIO_DIAGNOSTICS__),
    longTasks: Array.isArray(window.__STUDIO_LONG_TASKS__)
  }))
  expect(state.diagnostics).toBe(true)
  expect(state.longTasks).toBe(true)
  expect(state.boot).toBeGreaterThanOrEqual(0)
})
