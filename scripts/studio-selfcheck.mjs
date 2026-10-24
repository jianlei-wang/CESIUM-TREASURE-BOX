import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'

const entry = `
export * from './src/cases/presentation-studio-lib/core/schema.ts'
export { createSampleProject } from './src/cases/presentation-studio-lib/core/defaults.ts'
export { applyActionEasing, buildTimeline, evaluateFrame, totalFrames } from './src/cases/presentation-studio-lib/core/timeline.ts'
export { DEFAULT_CURVES, sampleCurve } from './src/cases/presentation-studio-lib/core/easing.ts'
export { packStudioPackage, packPlayerPackage, packageFileName, unpackStudioPackage } from './src/cases/presentation-studio-lib/core/project-package.ts'
export { default as JSZip } from 'jszip'
export { buildTrackLanes, snapFrame, trackFrameRange, trackKindForAction, trackSnapPoints, trimmedFrames } from './src/cases/presentation-studio-lib/core/tracks.ts'
export { clearDiagnostics, diagnosticsSnapshot, onDiagnostic, recordDiagnostic } from './src/cases/presentation-studio-lib/core/diagnostics.ts'
export { STUDIO_SDK_VERSION, STUDIO_SUPPORTED_SCHEMAS, registerStudioPlugin, listStudioPlugins, runProjectOpenHooks, runProjectSaveHooks, runBeforeExportHooks, clearStudioPlugins } from './src/cases/presentation-studio-lib/core/sdk.ts'
`

const result = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), sourcefile: 'studio-selfcheck.ts', loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  target: 'node20',
  logLevel: 'silent'
})

const code = result.outputFiles[0].text
const bundlePath = join(tmpdir(), `studio-selfcheck-${process.pid}.mjs`)
await writeFile(bundlePath, code)
const mod = await import(bundlePath)

const checks = []
function check(name, run) {
  run()
  checks.push(name)
}

check('v2 document roundtrip keeps all scenes and steps', () => {
  const sample = mod.createSampleProject()
  const document = mod.runtimeToDocument(sample)
  assert.equal(document.format, 'cesium.studio')
  assert.equal(document.schemaVersion, 2)
  assert.equal(document.scenes.length, 1)
  assert.equal(document.presentations[0].steps.length, sample.steps.length)
  const runtime = mod.documentToRuntime(document)
  assert.deepEqual(JSON.parse(JSON.stringify(mod.runtimeToDocument(runtime))), JSON.parse(JSON.stringify(document)))
})

check('custom layers survive roundtrip', () => {
  const sample = mod.createSampleProject()
  sample.customLayers.push({
    id: 'layer_test',
    name: '测试 GeoJSON',
    kind: 'geojson',
    uri: 'data/test.geojson',
    visible: false,
    locked: true,
    opacity: 0.5
  })
  const document = mod.runtimeToDocument(sample)
  assert.equal(document.scenes[0].customLayers.length, 1)
  const runtime = mod.documentToRuntime(document)
  assert.deepEqual(runtime.customLayers[0], sample.customLayers[0])
  assert.equal(mod.validateStudioDocument(document).length, 0)
})

check('parseProjectDocument accepts v2 and reports source', () => {
  const document = mod.runtimeToDocument(mod.createSampleProject())
  const parsed = mod.parseProjectDocument(JSON.parse(mod.serializeDocument(document)))
  assert.equal(parsed.source, 'studio-v2')
  assert.equal(parsed.project.steps.length, document.presentations[0].steps.length)
})

check('invalid document reports field path', () => {
  const document = mod.runtimeToDocument(mod.createSampleProject())
  const broken = {
    ...document,
    scenes: [{ ...document.scenes[0], camera: { ...document.scenes[0].camera, latitude: 120 } }]
  }
  const errors = mod.validateStudioDocument(broken)
  assert.ok(errors.some((error) => error.includes('scenes[0].camera.latitude')))
  assert.throws(() => mod.parseProjectDocument(broken), /工程文档校验失败/)
})

check('future schema version is rejected instead of overwritten', () => {
  const document = mod.runtimeToDocument(mod.createSampleProject())
  assert.throws(() => mod.parseProjectDocument({ ...document, schemaVersion: 99 }), /schemaVersion/)
})

check('legacy editor project migrates to v2', () => {
  const legacy = {
    type: 'cesium-presentation',
    schemaVersion: 1,
    name: 'legacy fixture',
    initialCamera: { longitude: 108.96, latitude: 34.21, height: 900 },
    steps: [
      {
        stepId: 'legacy_step',
        stepName: '旧版步骤',
        duration: 3,
        actions: [
          {
            actionId: 'legacy_fly',
            actionType: 'flyTo',
            enable: true,
            duration: 2,
            cameraParam: { longitude: 108.97, latitude: 34.22, height: 800 }
          }
        ]
      }
    ]
  }
  const parsed = mod.parseProjectDocument(legacy)
  assert.equal(parsed.source, 'legacy-editor')
  assert.equal(parsed.project.steps.length, 1)
  assert.equal(parsed.project.steps[0].actions.length, 1)
  assert.equal(parsed.project.steps[0].actions[0].actionType, 'flyTo')
})

check('frame evaluation is deterministic and frame aligned', () => {
  const sample = mod.createSampleProject()
  const timeline = mod.buildTimeline ? mod.buildTimeline(sample) : null
  if (!timeline) return
  const first = mod.evaluateFrame(timeline, 17, sample.initial, 30)
  const second = mod.evaluateFrame(timeline, 17, sample.initial, 30)
  assert.deepEqual(first, second)
  assert.equal(typeof mod.totalFrames(timeline, 30), 'number')
  assert.ok(mod.totalFrames(timeline, 30) >= 1)
})

check('step actions project onto standard tracks', () => {
  const sample = mod.createSampleProject()
  const timeline = mod.buildTimeline(sample)
  const lanes = mod.buildTrackLanes(timeline, 30)
  assert.equal(lanes.length, 5)
  const camera = lanes.find((lane) => lane.id === 'camera')
  assert.ok(camera.clips.length > 0)
  const clip = camera.clips[0]
  assert.ok(clip.startFrame >= 0)
  assert.ok(clip.durationFrames >= 1)
  assert.ok(mod.trackFrameRange(lanes) >= clip.startFrame + clip.durationFrames)
  assert.equal(mod.trackKindForAction('flyTo'), 'camera')
  assert.equal(mod.trackKindForAction('subtitle'), 'overlay')
})

check('track trimming snaps to neighbouring boundaries', () => {
  assert.equal(mod.snapFrame(63, [60, 90]), 60)
  assert.equal(mod.snapFrame(84, [60, 90], 5), 84)
  assert.equal(mod.snapFrame(88, [60, 90], 5), 90)
  assert.equal(mod.trimmedFrames(30, 30, 300), 1)
  assert.equal(mod.trimmedFrames(30, 90, 300), 60)
  assert.equal(mod.trimmedFrames(30, 420, 300), 270)
  const sample = mod.createSampleProject()
  const lanes = mod.buildTrackLanes(mod.buildTimeline(sample), 30)
  const clip = lanes[0].clips[0]
  const points = mod.trackSnapPoints(lanes, clip.id)
  assert.ok(points.includes(0))
  assert.ok(
    !points.includes(clip.startFrame + clip.durationFrames) ||
      lanes.some((lane) =>
        lane.clips.some(
          (item) =>
            item.id !== clip.id &&
            (item.startFrame === clip.startFrame + clip.durationFrames ||
              item.startFrame + item.durationFrames === clip.startFrame + clip.durationFrames)
        )
      )
  )
})

check('explicit action starts create and preserve timeline gaps', () => {
  const sample = mod.createSampleProject()
  const step = sample.steps[0]
  const second = step.actions[1]
  assert.ok(second)
  second.start = 7
  const timeline = mod.buildTimeline(sample)
  const timing = timeline.steps[0].actions.find((item) => item.action.actionId === second.actionId)
  assert.equal(timing.start, 7)
  assert.ok(timing.start > timeline.steps[0].actions[0].end)
  const lane = mod
    .buildTrackLanes(timeline, 30)
    .find((item) => item.clips.some((clip) => clip.actionId === second.actionId))
  assert.equal(lane.clips.find((clip) => clip.actionId === second.actionId).startFrame, 210)
  const document = mod.runtimeToDocument(sample)
  const clip = document.presentations[0].steps[0].clips.find((item) => item.id === second.actionId)
  assert.equal(clip.startFrame, 210)
  const restored = mod.documentToRuntime(document)
  assert.equal(restored.steps[0].actions.find((item) => item.actionId === second.actionId).start, 7)
})

check('custom easing curves persist and drive interpolation', () => {
  const curve = { x1: 0.1, y1: 0.9, x2: 0.2, y2: 1 }
  assert.ok(Math.abs(mod.sampleCurve(mod.DEFAULT_CURVES.linear, 0.25) - 0.25) < 0.0001)
  assert.equal(mod.sampleCurve({ x1: 0.33, y1: 0.5, x2: 0.66, y2: 0.5 }, 0), 0)
  assert.ok(mod.sampleCurve({ x1: 0.1, y1: 1, x2: 0.2, y2: 1 }, 0.35) > 0.5)
  assert.equal(mod.applyActionEasing({ curve }, 1), 1)
  assert.ok(mod.applyActionEasing({ curve }, 0.3) > 0.3)
  const sample = mod.createSampleProject()
  const action = sample.steps.flatMap((step) => step.actions).find((item) => item.actionType === 'flyTo')
  assert.ok(action)
  action.curve = curve
  const document = mod.runtimeToDocument(sample)
  const clip = document.presentations[0].steps.flatMap((step) => step.clips).find((item) => item.id === action.actionId)
  assert.deepEqual(clip.payload.curve, curve)
  const runtime = mod.documentToRuntime(document)
  const restored = runtime.steps.flatMap((step) => step.actions).find((item) => item.actionId === action.actionId)
  assert.deepEqual(restored.curve, curve)
})

check('locked actions persist and project as locked clips', () => {
  const sample = mod.createSampleProject()
  const action = sample.steps[0].actions[0]
  action.locked = true
  const document = mod.runtimeToDocument(sample)
  const clip = document.presentations[0].steps[0].clips.find((item) => item.id === action.actionId)
  assert.equal(clip.payload.locked, true)
  const restored = mod.documentToRuntime(document)
  assert.equal(restored.steps[0].actions[0].locked, true)
  const lanes = mod.buildTrackLanes(mod.buildTimeline(sample), 30)
  assert.equal(lanes.flatMap((lane) => lane.clips).find((item) => item.actionId === action.actionId).locked, true)
})

{
  const sample = mod.createSampleProject()
  sample.name = '工程包自检'
  sample.customLayers.push({
    id: 'layer_pkg',
    name: '自检 GeoJSON',
    kind: 'geojson',
    uri: 'data/selfcheck.geojson',
    visible: true
  })
  const body = JSON.stringify({ type: 'FeatureCollection', features: [] })
  const packed = await mod.packStudioPackage(sample, [
    {
      entry: {
        id: 'asset_layer_pkg',
        name: '自检 GeoJSON',
        kind: 'geojson',
        uri: 'data/selfcheck.geojson',
        required: true
      },
      blob: new Blob([body])
    }
  ])
  assert.ok(packed.assetCount >= 1)
  assert.equal(packed.document.scenes[0].customLayers[0].uri, 'assets/data/selfcheck.geojson')
  assert.equal(
    packed.document.assets.find((item) => item.id === 'asset_layer_pkg').uri,
    'assets/data/selfcheck.geojson'
  )
  assert.equal(mod.packageFileName(sample), '工程包自检.studio.zip')
  const unpacked = await mod.unpackStudioPackage(await packed.blob.arrayBuffer())
  assert.equal(unpacked.parsed.source, 'studio-v2')
  assert.deepEqual(unpacked.missingAssets, [])
  assert.deepEqual(unpacked.checksumFailures, [])
  assert.equal(unpacked.parsed.project.customLayers[0].uri, 'assets/data/selfcheck.geojson')
  assert.ok(Object.keys(unpacked.assets).includes('assets/data/selfcheck.geojson'))

  const missing = await mod.packStudioPackage(sample, [])
  assert.ok(missing.warnings.some((warning) => warning.includes('自检 GeoJSON')))
  const missingUnpacked = await mod.unpackStudioPackage(await missing.blob.arrayBuffer())
  assert.ok(missingUnpacked.missingAssets.includes('自检 GeoJSON'))
  checks.push('project package rewrites and reports required assets')
}

{
  const sample = mod.createSampleProject()
  sample.name = '播放器自检'
  sample.customLayers.push({
    id: 'layer_player',
    name: '播放器自检数据',
    kind: 'geojson',
    uri: 'data/player.geojson',
    visible: true
  })
  const packed = await mod.packPlayerPackage(sample, 'https://example.com/app/', [
    {
      entry: {
        id: 'asset_layer_player',
        name: '播放器自检数据',
        kind: 'geojson',
        uri: 'data/player.geojson',
        required: true
      },
      blob: new Blob(['{}'])
    }
  ])
  const zip = await mod.JSZip.loadAsync(await packed.blob.arrayBuffer())
  assert.ok(zip.file('player.html'))
  assert.ok(zip.file('PLAYER.txt'))
  const html = await zip.file('player.html').async('string')
  assert.ok(html.includes('https://example.com/app/'))
  assert.ok(html.includes("searchParams.set('player', '1')"))
  assert.ok(html.includes("new URL('./', location.href)"))

  const unpacked = await mod.unpackStudioPackage(await packed.blob.arrayBuffer())
  assert.deepEqual(unpacked.missingAssets, [])
  assert.equal(unpacked.parsed.project.customLayers[0].uri, 'assets/data/player.geojson')
  assert.ok(Object.keys(unpacked.assets).includes('assets/data/player.geojson'))
  checks.push('player package embeds launcher and asset blobs')
}

check('plugin registry enforces semver and runs lifecycle hooks', () => {
  mod.clearStudioPlugins()
  const seen = []
  const dispose = mod.registerStudioPlugin({
    id: 'selfcheck.plugin',
    version: '1.0.0',
    minSdkVersion: mod.STUDIO_SDK_VERSION,
    onProjectOpen: (project) => seen.push(`open:${project.id}`),
    onProjectSave: (document) => seen.push(`save:${document.format}`),
    onBeforeExport: (profile) => seen.push(`export:${profile.width}`)
  })
  assert.equal(mod.STUDIO_SDK_VERSION, '1.0.0')
  assert.deepEqual(mod.STUDIO_SUPPORTED_SCHEMAS, [2])
  assert.deepEqual(mod.listStudioPlugins(), [{ id: 'selfcheck.plugin', version: '1.0.0' }])
  assert.throws(() => mod.registerStudioPlugin({ id: 'selfcheck.plugin', version: '1.0.0' }), /已注册/)
  assert.throws(
    () => mod.registerStudioPlugin({ id: 'future.plugin', version: '1.0.0', minSdkVersion: '99.0.0' }),
    /需要 SDK/
  )
  assert.throws(
    () => mod.registerStudioPlugin({ id: 'schema.plugin', version: '1.0.0', schemas: [1] }),
    /不支持当前工程 schema/
  )
  const sample = mod.createSampleProject()
  mod.runProjectOpenHooks(sample)
  mod.runProjectSaveHooks(mod.runtimeToDocument(sample))
  mod.runBeforeExportHooks({ width: 1920 })
  assert.deepEqual(seen, [`open:${sample.id}`, 'save:cesium.studio', 'export:1920'])
  dispose()
  assert.equal(mod.listStudioPlugins().length, 0)
  mod.registerStudioPlugin({
    id: 'selfcheck.failing',
    version: '1.0.0',
    onProjectOpen: () => {
      throw new Error('boom')
    }
  })
  const failures = mod.runProjectOpenHooks(sample)
  assert.equal(failures.length, 1)
  assert.equal(failures[0].plugin, 'selfcheck.failing')
  assert.equal(failures[0].hook, 'onProjectOpen')
  mod.clearStudioPlugins()
})

check('diagnostics ring buffer keeps the most recent events', () => {
  mod.clearDiagnostics()
  const seen = []
  const stop = mod.onDiagnostic((event) => seen.push(event.name))
  for (let index = 0; index < 205; index += 1) {
    mod.recordDiagnostic('export', 'frame', 'info', { index })
  }
  stop()
  const snapshot = mod.diagnosticsSnapshot()
  assert.equal(snapshot.length, 200)
  assert.equal(snapshot[0].detail.index, 5)
  assert.equal(snapshot[199].detail.index, 204)
  assert.equal(seen.length, 205)
  mod.clearDiagnostics()
})

console.log(`studio self-check passed: ${checks.length} groups`)
for (const name of checks) console.log(`  - ${name}`)
