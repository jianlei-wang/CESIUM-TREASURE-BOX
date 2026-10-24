export interface AabbProxy {
  min: [number, number, number]
  max: [number, number, number]
}

export interface OcclusionProxy {
  id: string
  box: AabbProxy
  kind: 'building' | 'terrain' | 'structure'
}

export interface SegmentHit {
  proxy: OcclusionProxy
  t: number
}

function slab(origin: number, direction: number, min: number, max: number, near: number, far: number): [number, number] {
  if (Math.abs(direction) < 1e-9) {
    if (origin < min || origin > max) return [1, -1]
    return [near, far]
  }
  const inv = 1 / direction
  let t0 = (min - origin) * inv
  let t1 = (max - origin) * inv
  if (t0 > t1) [t0, t1] = [t1, t0]
  return [Math.max(near, t0), Math.min(far, t1)]
}

export function raySegmentBox(
  origin: [number, number, number],
  target: [number, number, number],
  box: AabbProxy
): number | null {
  const direction: [number, number, number] = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]]
  const length = Math.hypot(direction[0], direction[1], direction[2])
  if (length < 1e-6) return null
  const [nearX, farX] = slab(origin[0], direction[0], box.min[0], box.max[0], 0, 1)
  const [nearY, farY] = slab(origin[1], direction[1], box.min[1], box.max[1], nearX, farX)
  if (nearY > farY) return null
  const [nearZ, farZ] = slab(origin[2], direction[2], box.min[2], box.max[2], nearY, farY)
  if (nearZ > farZ || farZ < 0 || nearZ > 1) return null
  return nearZ
}

export class OcclusionProxySet {
  private proxies: OcclusionProxy[] = []

  add(proxy: OcclusionProxy): void {
    this.proxies.push(proxy)
  }

  clear(): void {
    this.proxies = []
  }

  firstHit(origin: [number, number, number], target: [number, number, number]): SegmentHit | null {
    let result: SegmentHit | null = null
    for (const proxy of this.proxies) {
      const t = raySegmentBox(origin, target, proxy.box)
      if (t !== null && (!result || t < result.t)) result = { proxy, t }
    }
    return result
  }

  occluded(origin: [number, number, number], target: [number, number, number], epsilon = 0.02): boolean {
    const hit = this.firstHit(origin, target)
    return hit !== null && hit.t < 1 - epsilon
  }

  count(): number {
    return this.proxies.length
  }
}
