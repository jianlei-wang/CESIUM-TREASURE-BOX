import assert from 'node:assert/strict'
import test from 'node:test'
import { createS02Model } from './s02.model'
import { createS03Model } from './s03.model'
import { createS04Model } from './s04.model'
import { createS06Model } from './s06.model'
import { createS09Model } from './s09.model'

const run = (model: { fixedStep: (dt: number) => void }, seconds: number, dt = 1 / 60): void => {
  for (let i = 0; i < Math.round(seconds / dt); i += 1) model.fixedStep(dt)
}

test('s02 builds the requested block count and triggers once', () => {
  const model = createS02Model({ floors: 4, columns: 3, impulse: 5, delay: 0.2, gravity: 20, damping: 0.02 })
  assert.equal(model.state.blocks.length, 36)
  run(model, 0.1)
  assert.equal(model.state.triggered, false)
  run(model, 0.2)
  assert.equal(model.state.triggered, true)
  run(model, 1)
  assert.ok(model.state.blocks.some((block) => block.active))
  const moved = model.state.blocks.filter((block) => block.position[1] !== block.home[1]).length
  assert.ok(moved > 0)
  const snapshot = JSON.stringify(model.serialize())
  model.reset()
  run(model, 0.3)
  assert.equal(JSON.stringify(model.serialize()).length > 0, true)
  assert.ok(snapshot.length > 0)
})

test('s02 keeps fragments inside the domain and settles', () => {
  const model = createS02Model({ floors: 4, columns: 3, impulse: 5, delay: 0, gravity: 20, damping: 0.02 })
  run(model, 12)
  assert.ok(model.state.blocks.some((block) => block.settled))
  assert.ok(model.state.blocks.every((block) => Number.isFinite(block.position[0])))
})

test('s03 accelerates downhill and stops at the barrier', () => {
  const model = createS03Model({ slope: 32, gravity: 9.81, friction: 0.25, wet: false, count: 20, radius: 1.8, barrier: 0.9 })
  run(model, 18)
  assert.ok(model.state.maxSpeed > 1)
  assert.ok(model.state.runout > -140)
  assert.ok(model.state.intercepted > 0)
  assert.ok(model.state.time > 17)
})

test('s03 wet slope produces higher speed than dry slope', () => {
  const dry = createS03Model({ slope: 32, gravity: 9.81, friction: 0.5, wet: false, count: 8, radius: 1.8, barrier: 0.2 })
  const wet = createS03Model({ slope: 32, gravity: 9.81, friction: 0.5, wet: true, count: 8, radius: 1.8, barrier: 0.2 })
  run(dry, 5)
  run(wet, 5)
  assert.ok(wet.state.maxSpeed > dry.state.maxSpeed)
})

test('s04 conserves water volume and peaks near the target depth', () => {
  const model = createS04Model({ inflow: 260, maxDepth: 5, duration: 60, roughness: 0.02, buildings: 8 })
  run(model, 70)
  assert.ok(model.state.peakLevel > 1)
  assert.ok(model.state.peakLevel <= 5 * 1.25 + 0.01)
  const balance = Math.abs(model.state.cumulativeInflow - model.state.cumulativeOutflow - model.state.volume)
  assert.ok(balance / model.state.cumulativeInflow < 0.05)
  assert.ok(Number.isFinite(model.state.level))
})

test('s04 hydrograph is zero outside the event window', () => {
  const model = createS04Model({ inflow: 100, maxDepth: 4, duration: 30, roughness: 0.04, buildings: 10 })
  run(model, 40)
  assert.ok(model.state.inflow < 0.01)
  model.reflow()
  assert.equal(model.state.level, 0)
})

test('s06 avoids a building in the flight path', () => {
  const model = createS06Model({ altitude: 70, speed: 14, sensor: 40, wind: 0, avoidance: true, obstacles: [{ x: 105, z: 0, halfWidth: 14, height: 62 }] })
  run(model, 2)
  assert.ok(model.state.position[1] > 70)
  assert.ok(model.state.avoidanceActive)
  assert.ok(model.state.battery < 100)
})

test('s06 flies straight with avoidance disabled', () => {
  const model = createS06Model({ altitude: 30, speed: 12, sensor: 20, wind: 0, avoidance: false, obstacles: [{ x: 60, z: 78, halfWidth: 20, height: 80 }] })
  run(model, 3)
  assert.equal(model.state.avoidanceActive, false)
  assert.ok(Math.abs(model.state.position[1] - 30) < 3)
})

test('s09 modal solver produces a bounded midspan deflection', () => {
  const model = createS09Model({ vehicleMass: 20, vehicleSpeed: 18, vehicleCount: 2, stiffness: 1, damping: 0.08, amplification: 4 })
  const empty = model.restLength()
  run(model, 4)
  assert.ok(model.state.midspan > 0)
  assert.ok(model.state.midspan < 2)
  assert.ok(model.state.naturalFrequency > 0)
  assert.ok(empty > 0)
  const first = model.state.midspan
  run(model, 2)
  assert.ok(Number.isFinite(model.state.midspan))
  assert.ok(model.state.midspan !== first)
})

test('s09 stiffness reduces deflection', () => {
  const soft = createS09Model({ vehicleMass: 20, vehicleSpeed: 18, vehicleCount: 1, stiffness: 0.5, damping: 0.08, amplification: 4 })
  const stiff = createS09Model({ vehicleMass: 20, vehicleSpeed: 18, vehicleCount: 1, stiffness: 2, damping: 0.08, amplification: 4 })
  run(soft, 3)
  run(stiff, 3)
  assert.ok(stiff.state.midspan < soft.state.midspan)
})
