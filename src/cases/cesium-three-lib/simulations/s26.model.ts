import { calibrationRow, clamp, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'
import {
  circleOutline,
  countKinds,
  gridPoints,
  polygonCentroid,
  rectangleOutline,
  regionAreaHa,
  sampleForestRegion,
  sampleRoadsidePoints,
  scatterVegetation,
  TREE_PROFILES,
  terrainHeight,
  type Region,
  type ScatterConfig,
  type TreePreset,
  type VegetationInstance,
  type VegetationKind
} from './vegetation'

export type RegionSource = 'forest' | 'rectangle' | 'circle' | 'roadside' | 'grid'

export interface S26Config {
  source: RegionSource
  seed: number
  treePreset: TreePreset
  tree: boolean
  grass: boolean
  flower: boolean
  rock: boolean
  treeDensity: number
  grassDensity: number
  flowerDensity: number
  rockDensity: number
  treeScale: number
  grassScale: number
  clampToTerrain: boolean
  terrain: boolean
  shapeRotation: number
  shapeSize: number
  gridRows: number
  gridCols: number
  gridInterval: number
  windStrength: number
  windFrequency: number
  maximumLeafDistance: number
  maximumGrassDistance: number
  maximumRockDistance: number
  cleared: boolean
}

export interface S26State {
  time: number
  region: Region
  instances: VegetationInstance[]
  counts: Record<VegetationKind, number>
  areaHa: number
  visible: Record<VegetationKind, number>
  windPhase: number
  source: RegionSource
  derived: ScatterConfig
}

export interface TransportRow {
  kind: VegetationKind
  count: number
  visible: number
  distance: number
}

const LIMIT_TREES = 2400

const KIND_LABEL: Record<VegetationKind, string> = {
  tree: '树木',
  grass: '草本',
  flower: '花朵',
  rock: '岩石'
}

function emptyRegion(source: RegionSource): Region {
  return { outer: [], holes: [], points: [], label: source }
}

export function buildRegion(cfg: S26Config): Region {
  if (cfg.cleared) {
    const region = emptyRegion(cfg.source)
    region.label = '已清除'
    return region
  }
  const size = clamp(cfg.shapeSize, 12, 180)
  switch (cfg.source) {
    case 'rectangle': {
      const outline = rectangleOutline(size, size * 0.66, cfg.shapeRotation)
      return { outer: outline, holes: [], points: [], label: '手绘矩形区域' }
    }
    case 'circle': {
      return { outer: circleOutline(size * 0.5), holes: [], points: [], label: '手绘圆形区域' }
    }
    case 'roadside': {
      return { outer: [], holes: [], points: sampleRoadsidePoints(), label: '沿路散点（点要素）' }
    }
    case 'grid': {
      const centre = polygonCentroid(sampleForestRegion().outer)
      return {
        outer: [],
        holes: [],
        points: gridPoints(cfg.gridRows, cfg.gridCols, cfg.gridInterval, centre),
        label: '等间距网格点位'
      }
    }
    default: {
      const region = sampleForestRegion()
      region.label = '林地面状区域（含采伐孔洞）'
      return region
    }
  }
}

export function createS26Model(config: S26Config): ScenarioSimulation & {
  state: S26State
  configure(next: Partial<S26Config>): void
  restart(): void
  clear(): void
  transport: () => TransportRow[]
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  const state: S26State = {
    time: 0,
    region: emptyRegion('forest'),
    instances: [],
    counts: { tree: 0, grass: 0, flower: 0, rock: 0 },
    areaHa: 0,
    visible: { tree: 0, grass: 0, flower: 0, rock: 0 },
    windPhase: 0,
    source: 'forest',
    derived: {
      seed: cfg.seed,
      treeDensity: cfg.treeDensity,
      grassDensity: cfg.grassDensity,
      flowerDensity: cfg.flowerDensity,
      rockDensity: cfg.rockDensity,
      treeScale: cfg.treeScale,
      grassScale: cfg.grassScale,
      enabled: { tree: true, grass: true, flower: true, rock: true },
      clampToTerrain: cfg.clampToTerrain,
      terrain: cfg.terrain
    }
  }

  const scatterConfig = (): ScatterConfig => ({
    seed: cfg.seed,
    treeDensity: cfg.treeDensity,
    grassDensity: cfg.grassDensity,
    flowerDensity: cfg.flowerDensity,
    rockDensity: cfg.rockDensity,
    treeScale: cfg.treeScale,
    grassScale: cfg.grassScale,
    enabled: { tree: cfg.tree, grass: cfg.grass, flower: cfg.flower, rock: cfg.rock },
    clampToTerrain: cfg.clampToTerrain,
    terrain: cfg.terrain
  })

  const maxDistance = (kind: VegetationKind): number =>
    kind === 'grass' ? cfg.maximumGrassDistance : kind === 'rock' ? cfg.maximumRockDistance : cfg.maximumLeafDistance

  const measureVisibility = (): void => {
    const centre = polygonCentroid(state.region.outer.length >= 3 ? state.region.outer : state.region.points)
    const visible: Record<VegetationKind, number> = { tree: 0, grass: 0, flower: 0, rock: 0 }
    for (const instance of state.instances) {
      const distance = Math.hypot(instance.position[0] - centre[0], instance.position[2] - centre[1])
      if (distance <= maxDistance(instance.kind)) visible[instance.kind] += 1
    }
    state.visible = visible
  }

  const rebuild = (): void => {
    state.region = buildRegion(cfg)
    state.source = cfg.source
    state.areaHa = regionAreaHa(state.region)
    const derived = scatterConfig()
    state.derived = derived
    state.instances = scatterVegetation(state.region, derived)
    state.counts = countKinds(state.instances)
    state.time = 0
    state.windPhase = 0
    measureVisibility()
  }

  const fixedStep = (dt: number): void => {
    const step = clamp(dt, 1 / 240, 1 / 30)
    state.time += step
    state.windPhase = (state.windPhase + step * Math.max(0.05, cfg.windFrequency) * 1.6) % (Math.PI * 2)
  }

  const structureKey = (): string =>
    [
      cfg.source,
      Math.round(cfg.seed),
      cfg.treePreset,
      cfg.tree ? 1 : 0,
      cfg.grass ? 1 : 0,
      cfg.flower ? 1 : 0,
      cfg.rock ? 1 : 0,
      cfg.treeDensity.toFixed(2),
      cfg.grassDensity.toFixed(1),
      cfg.flowerDensity.toFixed(1),
      cfg.rockDensity.toFixed(2),
      cfg.treeScale.toFixed(2),
      cfg.grassScale.toFixed(2),
      cfg.clampToTerrain ? 1 : 0,
      cfg.terrain ? 1 : 0,
      cfg.shapeRotation.toFixed(1),
      cfg.shapeSize.toFixed(1),
      Math.round(cfg.gridRows),
      Math.round(cfg.gridCols),
      cfg.gridInterval.toFixed(1),
      cfg.cleared ? 1 : 0
    ].join('|')

  const configure = (next: Partial<S26Config>): void => {
    const previous = structureKey()
    if (next.source !== undefined && next.source !== cfg.source) cfg.cleared = false
    cfg = { ...cfg, ...next }
    if (structureKey() !== previous) rebuild()
    else measureVisibility()
  }

  const calibration = (): CalibrationRow[] => {
    const config = state.derived
    const areaHa = state.areaHa
    const expectedTrees = Math.max(0, areaHa * (config.enabled.tree ? config.treeDensity : 0))
    const counts = state.counts
    const summed = counts.tree + counts.grass + counts.flower + counts.rock
    const terrainOk = state.instances.every((instance) =>
      Math.abs(instance.position[1] - (config.clampToTerrain && config.terrain ? terrainHeight(instance.position[0], instance.position[2]) : 0)) < 1e-6
    )
    const pointTrees = state.region.points.length
    return [
      calibrationRow('实例总数归并', summed, state.instances.length, '株', 0),
      calibrationRow('林木株数上限', Math.min(counts.tree, LIMIT_TREES), counts.tree, '株', 0),
      calibrationRow('树木密度偏差', Math.min(counts.tree, LIMIT_TREES), Math.round(expectedTrees + pointTrees), '株', Math.max(3, (expectedTrees + pointTrees) * 0.45)),
      calibrationRow('贴地高度一致', terrainOk ? 1 : 0, 1, '', 0)
    ]
  }

  const transport = (): TransportRow[] => {
    const kinds: VegetationKind[] = ['tree', 'grass', 'flower', 'rock']
    const centre = polygonCentroid(state.region.outer.length >= 3 ? state.region.outer : state.region.points)
    return kinds.map((kind) => {
      const max = maxDistance(kind)
      return {
        kind,
        count: state.counts[kind],
        visible: state.visible[kind],
        distance: Math.round(max)
      }
    })
  }

  rebuild()

  return {
    state,
    transport,
    get mode() {
      return mode
    },
    setMode(next) {
      mode = next
    },
    configure,
    restart: () => {
      cfg = { ...cfg, cleared: false }
      rebuild()
    },
    clear: () => {
      cfg = { ...cfg, cleared: true }
      rebuild()
    },
    fixedStep,
    diagnostics: () => ({
      模式: mode,
      仿真时间s: Number(state.time.toFixed(2)),
      布设来源: state.region.label,
      区域面积ha: Number(state.areaHa.toFixed(3)),
      树木: state.counts.tree,
      草本: state.counts.grass,
      花朵: state.counts.flower,
      岩石: state.counts.rock,
      实例总数: state.instances.length,
      树种: TREE_PROFILES[cfg.treePreset]?.label ?? cfg.treePreset,
      视距内树木: state.visible.tree,
      风力相位: Number(state.windPhase.toFixed(3))
    }),
    calibration,
    serialize: () => ({
      time: state.time,
      source: state.source,
      areaHa: state.areaHa,
      counts: state.counts,
      instances: state.instances.map((instance) => ({
        kind: instance.kind,
        position: instance.position,
        scale: instance.scale
      }))
    }),
    reset: rebuild
  }
}

export function describeKind(kind: VegetationKind): string {
  return KIND_LABEL[kind]
}
