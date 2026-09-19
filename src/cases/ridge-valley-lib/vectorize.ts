import type { Point } from './hydrology'

const NB_ROW = [-1, -1, 0, 1, 1, 1, 0, -1]
const NB_COL = [0, 1, 1, 1, 0, -1, -1, -1]

const SEQ = new Array<number>(8)

function transitions(p2: number, p3: number, p4: number, p5: number, p6: number, p7: number, p8: number, p9: number): number {
  SEQ[0] = p2
  SEQ[1] = p3
  SEQ[2] = p4
  SEQ[3] = p5
  SEQ[4] = p6
  SEQ[5] = p7
  SEQ[6] = p8
  SEQ[7] = p9
  let count = 0
  for (let i = 0; i < 8; i += 1) {
    if (SEQ[i] === 0 && SEQ[(i + 1) % 8] === 1) count += 1
  }
  return count
}

export function thinMask(source: Uint8Array, width: number, height: number, maxIterations = 80): Uint8Array {
  const img = Uint8Array.from(source)
  if (width < 3 || height < 3) return img
  const marker = new Uint8Array(width * height)
  const w = width
  let changed = true
  let iter = 0

  while (changed && iter < maxIterations) {
    changed = false
    for (let step = 0; step < 2; step += 1) {
      marker.fill(0)
      for (let r = 1; r < height - 1; r += 1) {
        for (let c = 1; c < width - 1; c += 1) {
          const i = r * w + c
          if (img[i] !== 1) continue
          const p2 = img[i - w]
          const p3 = img[i - w + 1]
          const p4 = img[i + 1]
          const p5 = img[i + w + 1]
          const p6 = img[i + w]
          const p7 = img[i + w - 1]
          const p8 = img[i - 1]
          const p9 = img[i - w - 1]
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (b < 2 || b > 6) continue
          const a = transitions(p2, p3, p4, p5, p6, p7, p8, p9)
          if (a !== 1) continue
          if (step === 0) {
            if (p2 * p4 * p6 !== 0) continue
            if (p4 * p6 * p8 !== 0) continue
          } else {
            if (p2 * p4 * p8 !== 0) continue
            if (p2 * p6 * p8 !== 0) continue
          }
          marker[i] = 1
        }
      }
      let stepChanged = false
      for (let i = 0; i < marker.length; i += 1) {
        if (marker[i] === 1) {
          img[i] = 0
          stepChanged = true
        }
      }
      if (stepChanged) changed = true
    }
    iter += 1
  }
  return img
}

export function traceSkeleton(skel: Uint8Array, width: number, height: number): Point[][] {
  const n = width * height
  const degree = new Uint8Array(n)
  for (let r = 0; r < height; r += 1) {
    for (let c = 0; c < width; c += 1) {
      const i = r * width + c
      if (skel[i] !== 1) continue
      let d = 0
      for (let k = 0; k < 8; k += 1) {
        const nr = r + NB_ROW[k]
        const nc = c + NB_COL[k]
        if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue
        if (skel[nr * width + nc] === 1) d += 1
      }
      degree[i] = d
    }
  }

  const used = new Uint8Array(n)
  const lines: number[][] = []

  const walk = (start: number): void => {
    let cur = start
    used[cur] = 1
    const line = [cur]
    while (true) {
      const r = (cur / width) | 0
      const c = cur - r * width
      let next = -1
      for (let k = 0; k < 8; k += 1) {
        const nr = r + NB_ROW[k]
        const nc = c + NB_COL[k]
        if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue
        const j = nr * width + nc
        if (skel[j] === 1 && used[j] === 0) {
          next = j
          break
        }
      }
      if (next < 0) break
      used[next] = 1
      line.push(next)
      cur = next
      if (degree[cur] !== 2) break
    }
    if (line.length >= 2) lines.push(line)
  }

  for (let i = 0; i < n; i += 1) {
    if (skel[i] === 1 && degree[i] === 1) walk(i)
  }
  for (let i = 0; i < n; i += 1) {
    if (skel[i] === 1 && used[i] === 0) walk(i)
  }

  return lines.map((line) => {
    const pts: Point[] = []
    for (let i = 0; i < line.length; i += 1) {
      const idx = line[i]
      const r = (idx / width) | 0
      pts.push([idx - r * width, r])
    }
    return pts
  })
}

function perpendicularSq(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const denominator = dx * dx + dy * dy
  if (denominator === 0) {
    const ex = p[0] - a[0]
    const ey = p[1] - a[1]
    return ex * ex + ey * ey
  }
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / denominator
  const tc = t < 0 ? 0 : t > 1 ? 1 : t
  const px = a[0] + tc * dx
  const py = a[1] + tc * dy
  const ex = p[0] - px
  const ey = p[1] - py
  return ex * ex + ey * ey
}

export function simplifyLine(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2 || tolerance <= 0) return points
  const tolSq = tolerance * tolerance
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: number[][] = [[0, points.length - 1]]
  while (stack.length > 0) {
    const range = stack.pop() as number[]
    const first = range[0]
    const last = range[1]
    let maxSq = 0
    let index = -1
    for (let i = first + 1; i < last; i += 1) {
      const d = perpendicularSq(points[i], points[first], points[last])
      if (d > maxSq) {
        maxSq = d
        index = i
      }
    }
    if (index >= 0 && maxSq > tolSq) {
      keep[index] = 1
      stack.push([first, index])
      stack.push([index, last])
    }
  }
  const out: Point[] = []
  for (let i = 0; i < points.length; i += 1) {
    if (keep[i] === 1) out.push(points[i])
  }
  return out
}

export function linePixelLength(points: Point[]): number {
  let len = 0
  for (let i = 1; i < points.length; i += 1) {
    len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  }
  return len
}

export function vectorizeMasks(
  ridgeMask: Uint8Array,
  valleyMask: Uint8Array,
  width: number,
  height: number,
  minLineLength: number,
  simplifyTolerance: number
): { ridgeSkeleton: Uint8Array; valleySkeleton: Uint8Array; ridgeLines: Point[][]; valleyLines: Point[][] } {
  const ridgeSkeleton = thinMask(ridgeMask, width, height)
  const valleySkeleton = thinMask(valleyMask, width, height)

  const process = (skeleton: Uint8Array): Point[][] => {
    const traced = traceSkeleton(skeleton, width, height)
    const out: Point[][] = []
    for (let i = 0; i < traced.length; i += 1) {
      const simplified = simplifyLine(traced[i], simplifyTolerance)
      if (simplified.length >= 2 && linePixelLength(simplified) >= minLineLength) out.push(simplified)
    }
    return out
  }

  return {
    ridgeSkeleton,
    valleySkeleton,
    ridgeLines: process(ridgeSkeleton),
    valleyLines: process(valleySkeleton)
  }
}
