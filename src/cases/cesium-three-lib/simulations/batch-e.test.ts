import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildRegion, createS26Model, type S26Config } from './s26.model'
import {
  countKinds,
  gridPoints,
  pointInPolygon,
  polygonArea,
  rectangleOutline,
  regionAreaHa,
  sampleForestRegion,
  scatterVegetation,
  terrainHeight
} from './vegetation'

const BASE: S26Config = {
  source: 'forest',
  seed: 12,
  treePreset: 'mixed',
  tree: true,
  grass: true,
  flower: true,
  rock: true,
  treeDensity: 120,
  grassDensity: 3200,
  flowerDensity: 900,
  rockDensity: 40,
  treeScale: 0.58,
  grassScale: 1,
  clampToTerrain: true,
  terrain: true,
  shapeRotation: 24,
  shapeSize: 96,
  gridRows: 18,
  gridCols: 18,
  gridInterval: 8,
  windStrength: 1.1,
  windFrequency: 0.8,
  maximumLeafDistance: 320,
  maximumGrassDistance: 150,
  maximumRockDistance: 200,
  cleared: false
}

const run = (model: { fixedStep: (dt: number) => void }, seconds: number, dt = 1 / 60): void => {
  const steps = Math.round(seconds / dt)
  for (let i = 0; i < steps; i += 1) model.fixedStep(dt)
}

test('polygon area and hole subtraction drive hectares', () => {
  const square = rectangleOutline(100, 100, 0)
  assert.ok(Math.abs(polygonArea(square) - 10000) < 1e-6)
  const region = sampleForestRegion()
  const withHole = regionAreaHa(region)
  const withoutHole = regionAreaHa({ ...region, holes: [] })
  assert.ok(withHole > 0)
  assert.ok(withHole < withoutHole, 'hole should reduce usable area')
  const [hx, hz] = region.holes[0][0]
  assert.ok(pointInPolygon(hx, hz, region.outer), 'hole vertex lies inside outer ring')
  const holeArea = polygonArea(region.holes[0])
  assert.ok(Math.abs(withoutHole - withHole - holeArea / 10000) < 1e-6)
})

test('grid point generation matches rows x cols', () => {
  const points = gridPoints(12, 9, 7, [4, -2])
  assert.equal(points.length, 12 * 9)
  const first = points[0]
  assert.ok(Math.abs(first[0] - (4 - (8 / 2) * 7)) < 1e-6)
})

test('scatter respects densities, kinds and terrain', () => {
  const region = buildRegion(BASE)
  const config = {
    seed: 12,
    treeDensity: 120,
    grassDensity: 3200,
    flowerDensity: 900,
    rockDensity: 40,
    treeScale: 0.58,
    grassScale: 1,
    enabled: { tree: true, grass: true, flower: true, rock: true },
    clampToTerrain: true,
    terrain: true
  }
  const instances = scatterVegetation(region, config)
  const counts = countKinds(instances)
  assert.ok(counts.tree > 0 && counts.grass > counts.tree)
  assert.equal(counts.tree + counts.grass + counts.flower + counts.rock, instances.length)
  for (const instance of instances) {
    assert.ok(Number.isFinite(instance.position[1]))
    assert.ok(instance.scale > 0)
    const expected = terrainHeight(instance.position[0], instance.position[2])
    assert.ok(Math.abs(instance.position[1] - expected) < 1e-6)
  }

  const treesOff = scatterVegetation(region, { ...config, enabled: { ...config.enabled, tree: false } })
  assert.equal(countKinds(treesOff).tree, 0)
})

test('disabling terrain flattens instance heights', () => {
  const region = buildRegion({ ...BASE, terrain: false })
  const instances = scatterVegetation(region, {
    seed: 5,
    treeDensity: 60,
    grassDensity: 0,
    flowerDensity: 0,
    rockDensity: 0,
    treeScale: 1,
    grassScale: 1,
    enabled: { tree: true, grass: false, flower: false, rock: false },
    clampToTerrain: true,
    terrain: false
  })
  assert.ok(instances.length > 0)
  for (const instance of instances) assert.equal(instance.position[1], 0)
})

test('source switching rebuilds region and point sets', () => {
  const model = createS26Model(BASE)
  const forestTrees = model.state.counts.tree
  assert.ok(forestTrees > 0)
  assert.ok(model.state.areaHa > 0)

  model.configure({ source: 'grid', gridRows: 6, gridCols: 8 })
  assert.equal(model.state.region.points.length, 48)
  assert.equal(model.state.areaHa, 0)

  model.configure({ source: 'circle', shapeSize: 60 })
  assert.ok(model.state.region.outer.length > 8)
  assert.ok(model.state.areaHa > 0)
  assert.ok(model.state.counts.tree > 0)
})

test('clear empties instances and regenerate restores them', () => {
  const model = createS26Model(BASE)
  assert.ok(model.state.instances.length > 0)
  model.clear()
  assert.equal(model.state.instances.length, 0)
  assert.equal(model.state.counts.tree, 0)
  model.restart()
  assert.ok(model.state.instances.length > 0)
})

test('switching source after clear restores vegetation', () => {
  const model = createS26Model(BASE)
  model.clear()
  assert.equal(model.state.instances.length, 0)
  model.configure({ source: 'circle' })
  assert.ok(model.state.instances.length > 0)
  assert.equal(model.state.instances.length, model.state.counts.tree + model.state.counts.grass + model.state.counts.flower + model.state.counts.rock)
})

test('density scaling raises instance counts', () => {
  const model = createS26Model(BASE)
  const baseline = model.state.counts.tree
  model.configure({ treeDensity: BASE.treeDensity * 2 })
  assert.ok(model.state.counts.tree > baseline)
  model.configure({ tree: false })
  assert.equal(model.state.counts.tree, 0)
})

test('visibility distances trim far instances', () => {
  const model = createS26Model(BASE)
  const before = model.state.visible.tree
  model.configure({ maximumLeafDistance: 80 })
  assert.ok(model.state.visible.tree <= before)
  model.configure({ maximumGrassDistance: 40 })
  assert.ok(model.state.visible.grass < model.state.counts.grass)
})

test('wind phase advances and stays bounded', () => {
  const model = createS26Model(BASE)
  run(model, 4)
  assert.ok(model.state.time > 3.9)
  assert.ok(model.state.windPhase >= 0 && model.state.windPhase <= Math.PI * 2)
  const transport = model.transport()
  assert.equal(transport.length, 4)
  for (const row of transport) {
    assert.ok(row.visible <= row.count)
    assert.ok(row.distance > 0)
  }
})

test('calibration passes for every source', () => {
  const model = createS26Model(BASE)
  for (const source of ['forest', 'rectangle', 'circle', 'roadside', 'grid'] as const) {
    model.configure({ source })
    const rows = model.calibration()
    assert.ok(rows.every((row) => row.pass), `calibration failed for ${source}`)
  }
})
