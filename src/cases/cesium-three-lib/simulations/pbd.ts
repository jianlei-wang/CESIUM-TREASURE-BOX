export interface DistanceConstraint {
  a: number
  b: number
  rest: number
}

export interface PbdResult {
  residual: number
  iterations: number
}

export function solveDistanceConstraints(
  positions: Float32Array,
  constraints: readonly DistanceConstraint[],
  invMass: Float32Array,
  stiffness: number,
  iterations: number
): PbdResult {
  const k = stiffness < 0 ? 0 : stiffness > 1 ? 1 : stiffness
  let residual = 0
  for (let iter = 0; iter < iterations; iter += 1) {
    residual = 0
    for (const constraint of constraints) {
      const a3 = constraint.a * 3
      const b3 = constraint.b * 3
      const dx = positions[b3] - positions[a3]
      const dy = positions[b3 + 1] - positions[a3 + 1]
      const dz = positions[b3 + 2] - positions[a3 + 2]
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6
      const error = constraint.rest - distance
      const magnitude = Math.abs(error)
      if (magnitude > residual) residual = magnitude
      const wa = invMass[constraint.a]
      const wb = invMass[constraint.b]
      const total = wa + wb
      if (total <= 0) continue
      const scale = (error / distance) * k
      const ax = dx * scale * (wa / total)
      const ay = dy * scale * (wa / total)
      const az = dz * scale * (wa / total)
      const bx = dx * scale * (wb / total)
      const by = dy * scale * (wb / total)
      const bz = dz * scale * (wb / total)
      positions[a3] -= ax
      positions[a3 + 1] -= ay
      positions[a3 + 2] -= az
      positions[b3] += bx
      positions[b3 + 1] += by
      positions[b3 + 2] += bz
    }
  }
  return { residual, iterations }
}

export function buildConstraint(
  positions: ReadonlyArray<number> | Float32Array,
  a: number,
  b: number,
  target: DistanceConstraint[]
): void {
  const a3 = a * 3
  const b3 = b * 3
  const dx = positions[b3] - positions[a3]
  const dy = positions[b3 + 1] - positions[a3 + 1]
  const dz = positions[b3 + 2] - positions[a3 + 2]
  target.push({ a, b, rest: Math.sqrt(dx * dx + dy * dy + dz * dz) })
}
