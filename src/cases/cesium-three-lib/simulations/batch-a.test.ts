import assert from 'node:assert/strict'
import test from 'node:test'
import { createS01Model } from './s01.model'
import { createS05Model } from './s05.model'
import { createS07Model, S07_ROUTE } from './s07.model'
import { createS08Model } from './s08.model'
import { createS16Model } from './s16.model'

test('S01 analytic fall time and energy bounds', () => {
  const model = createS01Model({ kind: 'ball', count: 1, height: 40, radius: 2, gravity: 9.81, restitution: 0.5, spin: 1 })
  for (let index = 0; index < 1200; index += 1) model.fixedStep(1 / 60)
  const rows = model.calibration()
  assert.ok(rows.every((row) => row.pass))
  assert.ok(model.state.time > 19)
  assert.ok(model.state.bounces >= 1)
  assert.ok(model.state.impactPeak > 0)
})

test('S01 deterministic reset with fixed seed', () => {
  const model = createS01Model({ kind: 'ball', count: 4, height: 30, radius: 1, gravity: 9.81, restitution: 0.4, spin: 1 })
  for (let index = 0; index < 120; index += 1) model.fixedStep(1 / 60)
  const first = JSON.stringify(model.serialize())
  model.reset()
  for (let index = 0; index < 120; index += 1) model.fixedStep(1 / 60)
  assert.equal(JSON.stringify(model.serialize()), first)
})

test('S05 reaches target speed without collision at low traffic', () => {
  const model = createS05Model({ targetSpeed: 16, friction: 0.8, slope: 0, traffic: 0, mode: 'auto' })
  for (let index = 0; index < 1800; index += 1) model.fixedStep(1 / 60)
  assert.ok(Math.abs(model.state.speed - 16) < 2)
  assert.equal(model.state.collisions, 0)
  assert.ok(model.calibration().every((row) => row.pass))
})

test('S05 respects a leading vehicle gap', () => {
  const model = createS05Model({ targetSpeed: 24, friction: 0.7, slope: 0, traffic: 4, mode: 'auto' })
  for (let index = 0; index < 3000; index += 1) model.fixedStep(1 / 60)
  assert.ok(Number.isFinite(model.state.minGap))
  assert.ok(model.state.minGap > 0)
})

test('S07 jump apex matches ballistic reference', () => {
  const model = createS07Model({ moveSpeed: 3, run: false, jumpForce: 5, gravity: 10 })
  model.jump()
  let apex = 0
  for (let index = 0; index < 120; index += 1) {
    model.fixedStep(1 / 60)
    apex = Math.max(apex, model.state.jumpY)
  }
  assert.ok(apex <= 1.26)
  assert.ok(apex > 1.1)
  assert.equal(model.state.grounded, true)
})

test('S07 follows the route and resets', () => {
  const model = createS07Model({ moveSpeed: 2, run: false, jumpForce: 4.8, gravity: 12 })
  for (let index = 0; index < 3000; index += 1) model.fixedStep(1 / 60)
  assert.ok(model.state.distance > 0)
  model.reset()
  assert.equal(model.state.distance, 0)
  assert.deepEqual(model.state.position, S07_ROUTE[0])
})

test('S08 pendulum period and tension', () => {
  const model = createS08Model({ loadMass: 6, cableLength: 30, slewSpeed: 0, hoistSpeed: 1.5, wind: 0, damping: 0.02 })
  model.state.swingX = 1
  for (let index = 0; index < 600; index += 1) model.fixedStep(1 / 60)
  assert.ok(model.state.tension > 0)
  assert.ok(model.state.swingPeak > 0)
  assert.ok(model.calibration().some((row) => row.metric === '单摆周期'))
})

test('S08 steady removes swing energy', () => {
  const model = createS08Model({ loadMass: 3, cableLength: 20, slewSpeed: 0.5, hoistSpeed: 2, wind: 5, damping: 0.3 })
  for (let index = 0; index < 300; index += 1) model.fixedStep(1 / 60)
  model.steady()
  assert.equal(model.state.swingX, 0)
  assert.equal(model.state.swingVX, 0)
  model.reset()
  assert.equal(model.state.time, 0)
})

test('S16 A* route avoids obstacle bounds', () => {
  const obstacles = [{ x: 40, z: 0, width: 30, depth: 30 }]
  const model = createS16Model({ speed: 2, waypoints: 4, robotType: 'wheeled', scanRange: 25, avoidance: true, obstacles })
  assert.ok(model.state.path.length > 2)
  for (const point of model.plannedPath()) {
    assert.ok(Math.abs(point.x - 40) > 15 || Math.abs(point.z) > 15)
  }
  for (let index = 0; index < 1200; index += 1) model.fixedStep(1 / 60)
  assert.ok(model.state.battery < 100)
  assert.ok(model.calibration().some((row) => row.metric === '路径长度'))
})

test('S16 reset restores battery', () => {
  const model = createS16Model({ speed: 2, waypoints: 4, robotType: 'wheeled', scanRange: 20, avoidance: true, obstacles: [] })
  for (let index = 0; index < 600; index += 1) model.fixedStep(1 / 60)
  model.reset()
  assert.equal(model.state.battery, 100)
  assert.equal(model.state.waypointIndex, 0)
})
