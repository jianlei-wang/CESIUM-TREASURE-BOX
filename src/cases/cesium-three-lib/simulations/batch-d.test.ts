import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createS21Model } from './s21.model'
import { createS22Model } from './s22.model'
import { createS23Model } from './s23.model'
import { createS24Model } from './s24.model'
import { createS25Model } from './s25.model'

const run = (model: { fixedStep: (dt: number) => void }, seconds: number, dt = 1 / 60): void => {
  const steps = Math.round(seconds / dt)
  for (let i = 0; i < steps; i += 1) model.fixedStep(dt)
}

const allFinite = (values: Float32Array | number[]): boolean => {
  for (const value of values) if (!Number.isFinite(value)) return false
  return true
}

test('S21 vehicle drives into the wall and scatters bricks', () => {
  const model = createS21Model({
    driveForce: 6200,
    steering: 0,
    friction: 0.03,
    mass: 1400,
    suspension: 34,
    damping: 4800,
    wallRows: 4
  })
  run(model, 14)
  assert.ok(model.state.speed > 2, `speed=${model.state.speed}`)
  assert.ok(model.state.collisionCount > 0, 'vehicle should reach the wall')
  assert.ok(model.state.wall.some((block) => block.active), 'wall should be hit')
  assert.ok(model.state.wall.every((block) => Number.isFinite(block.position[0])))
  assert.ok(model.calibration().length > 0)
  const suspension = model.calibration().find((row) => row.metric === '静态悬架压缩')
  assert.ok(suspension?.pass, `suspension calibration should match, error=${suspension?.error}`)
  model.restart()
  assert.equal(model.state.collisionCount, 0)
  assert.ok(model.state.wall.every((block) => !block.active))
})

test('S21 vehicle leaves the ramp and flies before landing', () => {
  const model = createS21Model({
    driveForce: 6200,
    steering: 0,
    friction: 0.035,
    mass: 1400,
    suspension: 34,
    damping: 4800,
    wallRows: 6
  })
  let launchX = Number.NaN
  let landX = Number.NaN
  for (let i = 0; i < Math.round(10 / (1 / 60)); i += 1) {
    const wasGrounded = model.state.grounded
    model.fixedStep(1 / 60)
    if (wasGrounded && !model.state.grounded) launchX = model.state.position[0]
    if (!wasGrounded && model.state.grounded && Number.isNaN(landX)) landX = model.state.position[0]
    if (model.state.collisionCount > 0) break
  }
  assert.ok(Number.isFinite(launchX), 'vehicle should leave the ramp crest')
  assert.ok(model.state.peakAltitude > 2, `peak altitude=${model.state.peakAltitude}`)
  assert.ok(model.state.airTime > 0.8, `air time=${model.state.airTime}`)
  assert.ok(Number.isFinite(landX), 'vehicle should land again')
  assert.ok(landX - launchX > 15, `jump distance=${landX - launchX}`)
})

test('S21 vehicle holds a straight heading without steering input', () => {  const model = createS21Model({
    driveForce: 6200,
    steering: 0,
    friction: 0.03,
    mass: 1400,
    suspension: 34,
    damping: 4800,
    wallRows: 4
  })
  run(model, 8)
  assert.equal(model.state.heading, 0, 'heading should stay at zero')
  assert.equal(model.state.position[2], 0, 'vehicle should not drift laterally')
})

test('S21 wall never leaves unsupported bricks hanging in mid air', () => {
  const model = createS21Model({
    driveForce: 6200,
    steering: 0,
    friction: 0.03,
    mass: 1400,
    suspension: 34,
    damping: 4800,
    wallRows: 6
  })
  run(model, 18)
  const size = 0.75
  const wall = model.state.wall
  const hanging = wall.filter((brick) => {
    if (brick.position[1] <= size * 0.55) return false
    if (Math.hypot(...brick.velocity) > 0.25) return false
    return !wall.some((other) => {
      if (other === brick) return false
      const dy = brick.position[1] - other.position[1]
      if (dy <= size * 0.3 || dy > size * 1.4) return false
      if (Math.abs(other.position[0] - brick.position[0]) > size * 0.9) return false
      if (Math.abs(other.position[2] - brick.position[2]) > size * 0.9) return false
      return other.position[1] <= brick.position[1]
    })
  })
  assert.equal(hanging.length, 0, `hanging bricks=${hanging.length}`)
})

test('S22 rotating cloth stays bounded and sweeps the wall', () => {
  const model = createS22Model({
    rpm: 34,
    armLength: 12,
    clothWidth: 3.8,
    clothHeight: 3.2,
    stiffness: 0.7,
    segments: 14,
    gravity: 9.81,
    damping: 0.35,
    wallRows: 6
  })
  run(model, 4)
  assert.ok(allFinite(model.state.cloth), 'cloth positions should stay finite')
  assert.ok(model.state.flutter > 0.05, `flutter=${model.state.flutter}`)
  assert.ok(model.state.wall.length === 6 * 9)
  assert.ok(model.state.armAngle >= 0)
  assert.ok(model.calibration().length > 0)
})

test('S23 rotating rope keeps the ball attached and finite', () => {
  const model = createS23Model({
    rpm: 30,
    armLength: 8,
    ropeLength: 4.2,
    segments: 10,
    ballMass: 1.2,
    ballRadius: 0.62,
    gravity: 9.81,
    damping: 0.3,
    wallRows: 6
  })
  run(model, 4)
  assert.ok(allFinite(model.state.rope), 'rope positions should stay finite')
  assert.ok(Number.isFinite(model.state.swing))
  assert.ok(model.state.tension >= 0)
  const anchorX = model.state.rope[0]
  const anchorY = model.state.rope[1]
  const anchorZ = model.state.rope[2]
  const bx = model.state.ballPosition[0] - anchorX
  const by = model.state.ballPosition[1] - anchorY
  const bz = model.state.ballPosition[2] - anchorZ
  const span = Math.hypot(bx, by, bz)
  assert.ok(span > 2 && span < 8, `rope span=${span}`)
  assert.equal(model.state.wall.length, 6 * 9)
})

test('S24 soft volume falls, compresses and settles on the ground', () => {
  const model = createS24Model({
    shape: 'sphere',
    dropHeight: 12,
    softness: 0.55,
    mass: 15,
    gravity: 9.81,
    damping: 0.35,
    resolution: 5,
    restitution: 0.18
  })
  run(model, 4)
  assert.ok(allFinite(model.state.positions), 'soft body positions should stay finite')
  assert.ok(model.state.count > 8)
  assert.ok(model.state.landed, 'soft body should reach the ground')
  assert.ok(model.state.maxSquash > 0, `maxSquash=${model.state.maxSquash}`)
  assert.ok(model.state.edges.length > model.state.count)
  model.drop()
  assert.ok(!model.state.landed)
})

test('S25 projectile fractures the tower locally', () => {
  const model = createS25Model({
    preset: 'tower',
    speed: 30,
    projectileMass: 80,
    projectileRadius: 0.6,
    fractureRadius: 3.2,
    gravity: 9.81,
    restitution: 0.22,
    damping: 0.35
  })
  run(model, 3)
  assert.ok(model.state.impactSpeed > 0, 'projectile should hit the structure')
  assert.ok(model.state.destroyed > 0, 'impact should break chunks')
  assert.ok(model.state.chunks.every((chunk) => Number.isFinite(chunk.position[0])))
  assert.ok(model.calibration().length > 0)
  model.fire()
  assert.equal(model.state.destroyed, 0)
})

const unsupportedChunks = (chunks: { id: number; position: number[]; size: number[] }[]): number[] => {
  const maxCantilever = 1.7
  const supported = new Set<number>()
  const reach = new Map<number, number>()
  const queue: number[] = []
  for (const chunk of chunks) {
    if (chunk.position[1] <= chunk.size[1] * 0.5 + 0.08) {
      supported.add(chunk.id)
      reach.set(chunk.id, 0)
      queue.push(chunk.id)
    }
  }
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]))
  while (queue.length > 0) {
    const source = byId.get(queue.pop() as number)
    if (!source) continue
    const sourceReach = reach.get(source.id) ?? 0
    for (const target of chunks) {
      if (supported.has(target.id)) continue
      const rise = target.position[1] - source.position[1]
      if (rise < -0.02) continue
      const gapX = Math.abs(source.position[0] - target.position[0]) - (source.size[0] + target.size[0]) * 0.5
      const gapY = Math.abs(rise) - (source.size[1] + target.size[1]) * 0.5
      const gapZ = Math.abs(source.position[2] - target.position[2]) - (source.size[2] + target.size[2]) * 0.5
      if (gapX > 0.14 || gapY > 0.14 || gapZ > 0.14) continue
      const span = Math.hypot(
        target.position[0] - source.position[0],
        target.position[2] - source.position[2]
      )
      const nextReach = rise > 0.02 ? 0 : sourceReach + span
      if (nextReach > maxCantilever) continue
      supported.add(target.id)
      reach.set(target.id, nextReach)
      queue.push(target.id)
    }
  }
  return chunks.filter((chunk) => !supported.has(chunk.id)).map((chunk) => chunk.id)
}

for (const preset of ['tower', 'bridge', 'stone', 'mountain'] as const) {
  test(`S25 ${preset} settles without hovering intact chunks`, () => {
    const model = createS25Model({
      preset,
      speed: 22,
      projectileMass: 60,
      projectileRadius: 0.55,
      fractureRadius: 3.2,
      gravity: 9.81,
      restitution: 0.22,
      damping: 0.35
    })
    run(model, 25)
    const floating = model.state.chunks.filter(
      (chunk) => chunk.active && chunk.position[1] > chunk.size[1] * 0.5 + 0.15
    )
    assert.equal(floating.length, 0, `airborne chunks=${floating.length}`)
    const unsupported = unsupportedChunks(model.state.chunks.filter((chunk) => !chunk.active))
    assert.equal(unsupported.length, 0, `unsupported intact chunks=${unsupported.length}`)
  })
}
