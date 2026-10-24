import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createS10Model } from './s10.model'
import { createS11Model } from './s11.model'
import { createS12Model, S12_MAX_PARTICLES } from './s12.model'
import { createS13Model } from './s13.model'
import { createS14Model } from './s14.model'
import { createS15Model } from './s15.model'
import { createS17Model, S17_MAX_AGENTS } from './s17.model'
import { createS18Model } from './s18.model'
import { createS19Model, S19_MAX_PARTICLES, groundConcentration } from './s19.model'
import { createS20Model, S20_STATIONS } from './s20.model'

const run = (model: { fixedStep: (dt: number) => void }, seconds: number, dt = 1 / 60): void => {
  const steps = Math.round(seconds / dt)
  for (let i = 0; i < steps; i += 1) model.fixedStep(dt)
}

test('S10 cloth responds to wind and stays finite', () => {
  const model = createS10Model({ wind: 12, direction: 45, gust: 0.4, clothStiffness: 0.8, treeSway: 0.6 })
  const base = Array.from(model.state.cloth)
  run(model, 2)
  const now = Array.from(model.state.cloth)
  assert.ok(now.every(Number.isFinite))
  const drift = now.reduce((sum, value, index) => sum + Math.abs(value - base[index]), 0)
  assert.ok(drift > 1, `cloth should move, drift=${drift}`)
  assert.ok(model.state.time > 1.9)
})

test('S11 fire spreads and burns cells', () => {
  const model = createS11Model({ fuel: 0.7, spread: 0.8, humidity: 0.3, wind: 6, smoke: 0.5, rain: false })
  run(model, 12)
  assert.ok(model.state.burnedCells > 1)
  assert.ok(Number.isFinite(model.state.frontRadius))
  assert.ok(model.state.activeCells >= 0)
})

test('S12 rain accumulates and snow falls slower', () => {
  const rain = createS12Model({ kind: 'rain', intensity: 70, wind: 4, gravity: 9.81, growth: 0.5, temperature: 12 })
  run(rain, 10)
  assert.ok(rain.state.accumulatedMm > 0)
  assert.ok(rain.state.activeCount > 0 && rain.state.activeCount <= S12_MAX_PARTICLES)
  const snow = createS12Model({ kind: 'snow', intensity: 70, wind: 4, gravity: 9.81, growth: 0.5, temperature: -4 })
  run(snow, 10)
  assert.ok(snow.state.pondingDepth < rain.state.pondingDepth)
})

test('S13 wave field produces bounded ship motion', () => {
  const model = createS13Model({ waveHeight: 2.4, period: 7, direction: 20, wind: 9, draft: 4, buoys: 3 })
  run(model, 20)
  assert.ok(model.state.components.length > 10)
  assert.ok(Math.abs(model.state.roll) < 1)
  assert.ok(Math.abs(model.state.pitch) < 1)
  assert.ok(Number.isFinite(model.state.heave))
  assert.ok(model.state.displacementMass > 500000)
  assert.ok(Math.abs(model.state.equilibriumDraft - 4) < 1.2)
  assert.ok(model.state.waterline > 0)
  assert.ok(model.state.buoyancySamples >= 5)
})

test('S14 shear building amplifies roof displacement', () => {
  const model = createS14Model({ pga: 0.5, frequency: 1.6, duration: 12, damping: 0.05, floors: 8, mode: 1 })
  let peak = 0
  for (let i = 0; i < 600; i += 1) {
    model.fixedStep(1 / 60)
    peak = Math.max(peak, Math.abs(model.state.roofDisplacement))
  }
  assert.ok(peak > 0.02, `roof should move, peak=${peak}`)
  assert.ok(model.state.driftRatio >= 0)
  assert.ok(model.state.displacement.length === 8)
})

test('S15 excavator cycle produces payload', () => {
  const model = createS15Model({ boomAngle: 40, stickAngle: 55, bucketAngle: 35, swingSpeed: 0.8, soilDensity: 1.8, cycleTime: 22 })
  run(model, 200)
  assert.ok(model.state.cycle >= 2, `cycle=${model.state.cycle}`)
  assert.ok(model.state.production > 0)
  assert.ok(model.state.dumped > 0)
})

test('S17 crowd evacuates through exit', () => {
  const model = createS17Model({ crowdSize: 150, agentSpeed: 1.4, panic: 0.3, exitWidth: 2.4, wallCount: 2 })
  run(model, 90)
  assert.ok(model.state.evacuated > 0, `evacuated=${model.state.evacuated}`)
  assert.ok(model.state.agents.length <= S17_MAX_AGENTS)
  assert.ok(model.state.flowRate >= 0)
})

test('S18 TBM advances and installs rings', () => {
  const model = createS18Model({ advance: 1.4, rpm: 1.8, thrust: 24000, diameter: 6.4, spacing: 1.5, support: 0.32, water: true })
  run(model, 120)
  assert.ok(model.state.distance > 1)
  assert.ok(model.state.rings >= 1)
  assert.ok(model.state.torque > 0)
  assert.ok(model.state.facePressure > 0)
  assert.ok(model.state.advanceVelocity > 0)
  assert.ok(model.state.muckMass > 0)
  assert.ok(Math.abs(model.state.muckBalance) < 1e-6)
  assert.equal(model.state.rock, 'IV')
  const blocked = createS18Model({ advance: 1.4, rpm: 1.8, thrust: 1200, diameter: 6.4, spacing: 1.5, support: 0.32, water: true, rock: 'III' })
  run(blocked, 60)
  assert.ok(blocked.state.distance < 0.2, `blocked distance=${blocked.state.distance}`)
  assert.ok(blocked.state.netForce < 0)
})

test('S19 plume concentration decays with distance', () => {
  const cfg = { sources: 2, stackHeight: 30, emission: 0.9, windSpeed: 5, windDir: 20, stability: 'neutral' as const }
  const model = createS19Model(cfg)
  run(model, 30)
  assert.ok(model.state.active > 0)
  assert.ok(model.state.active <= S19_MAX_PARTICLES)
  assert.ok(groundConcentration(800, cfg) > groundConcentration(3000, cfg))
  assert.ok(Number.isFinite(model.state.maxConcentration))
})

test('S20 dispatch vehicles and drone reach incident', () => {
  const model = createS20Model({ severity: 0.6, teams: 2, speed: 28, altitude: 80, coordination: true })
  run(model, 40)
  assert.equal(model.state.trucks.length, S20_STATIONS.length)
  assert.ok(model.state.dispatched === 2)
  assert.ok(model.state.arrivedCount >= 1, `arrived=${model.state.arrivedCount}`)
  assert.ok(model.state.firstArrival > 0)
  assert.ok(model.state.droneEta >= 0)
  assert.ok(model.state.coverage > 0)
  const first = model.state.trucks[0]
  assert.ok(first.route.length >= 3)
  assert.ok(first.routeDistance > 0)
  assert.ok(model.state.events.some((event) => event.type === 'dispatch'))
  assert.ok(model.state.events.some((event) => event.type === 'arrive'))
  assert.ok(model.state.networkDistance > 0)
})
