import { reactive } from 'vue'
import type { FieldStats, MonitoringStation, SimulationComputeMode, StudyArea } from '@rt/types/model'

export type ParticleStyle = 'star' | 'arrow' | 'diamond' | 'ring'
export type RedTideRenderMode = 'volume' | 'iso' | 'hybrid'
export type SectionAxis = 'x' | 'y'

export interface RedTideMetricPoint {
  time: number
  max: number
  mean: number
  areaKm2: number
  volumeKm3: number
  depthM: number
}

const studyArea: StudyArea = {
  id: 'RT-DEMO-001',
  name: '东部近岸赤潮模拟示范海域',
  center: { longitude: 122.15, latitude: 30.95, height: 0 },
  sizeX: 120_000,
  sizeY: 95_000,
  minDepth: 1_800,
  maxHeight: 20,
}

const grid = {
  nx: 64,
  ny: 52,
  nz: 24,
  sizeX: studyArea.sizeX,
  sizeY: studyArea.sizeY,
  depth: studyArea.minDepth,
  surfaceHeight: studyArea.maxHeight,
  cellX: studyArea.sizeX / 63,
  cellY: studyArea.sizeY / 51,
  cellZ: studyArea.minDepth / 23,
}

const stations: MonitoringStation[] = [
  { id: 'S01', name: '一号浮标', longitude: 121.82, latitude: 30.83, depth: 4, chlA: 31.2, temperature: 25.1, salinity: 31.4, dissolvedOxygen: 7.5, concentration: 0.66 },
  { id: 'S02', name: '二号浮标', longitude: 121.96, latitude: 30.89, depth: 5, chlA: 24.8, temperature: 24.7, salinity: 31.7, dissolvedOxygen: 7.1, concentration: 0.51 },
  { id: 'S03', name: '三号浮标', longitude: 122.13, latitude: 30.94, depth: 8, chlA: 48.6, temperature: 24.5, salinity: 31.2, dissolvedOxygen: 6.8, concentration: 0.88 },
  { id: 'S04', name: '四号浮标', longitude: 122.28, latitude: 31.02, depth: 6, chlA: 42.3, temperature: 24.3, salinity: 30.9, dissolvedOxygen: 6.9, concentration: 0.80 },
  { id: 'S05', name: '五号浮标', longitude: 122.46, latitude: 31.08, depth: 12, chlA: 18.5, temperature: 23.9, salinity: 32.0, dissolvedOxygen: 7.9, concentration: 0.33 },
  { id: 'S06', name: '六号浮标', longitude: 122.05, latitude: 31.12, depth: 10, chlA: 34.7, temperature: 24.0, salinity: 31.3, dissolvedOxygen: 7.3, concentration: 0.61 },
  { id: 'S07', name: '七号浮标', longitude: 122.36, latitude: 30.88, depth: 9, chlA: 28.4, temperature: 24.8, salinity: 31.5, dissolvedOxygen: 7.2, concentration: 0.54 },
]

const emptyStats: FieldStats = {
  min: 0,
  max: 0,
  mean: 0,
  affectedAreaKm2: 0,
  affectedVolumeKm3: 0,
  affectedDepthM: 0,
  surfaceMax: 0,
}

function createRedTideStore() {
  return reactive({
    playing: false,
    speed: 1,
    elapsedSeconds: 0,
    thresholdLow: 0.08,
    thresholdHigh: 0.42,
    density: 1.72,
    surfaceOpacity: 0.32,
    globeOpacity: 1,
    flowOpacity: 0.74,
    diffusion: 0.012,
    growthRate: 0.000012,
    decayRate: 0.000004,
    nutrient: 0.78,
    light: 0.88,
    temperature: 24.2,
    renderMode: 'hybrid' as RedTideRenderMode,
    isoValue: 0.58,
    isoThickness: 0.028,
    clipEnabled: false,
    clipDepth: 900,
    showSection: false,
    sectionAxis: 'x' as SectionAxis,
    sectionX: 0,
    depthOcclusionSupported: false,
    renderPipeline: '初始化中',
    terrainMode: 'ellipsoid',
    renderGpuMs: 0,
    showVolume: true,
    showSurface: true,
    showFlow: true,
    particleStyle: 'star' as ParticleStyle,
    selectedStation: null as MonitoringStation | null,
    stats: { ...emptyStats } as FieldStats,
    metricsHistory: [] as RedTideMetricPoint[],
    simulationComputeMs: 0,
    simulationComputeMode: 'transferable' as SimulationComputeMode,
    studyArea,
    grid,
    stations,
    get displayHours(): number {
      return this.elapsedSeconds / 3600
    },
    setStats(value: FieldStats): void {
      this.stats = value
      const time = this.elapsedSeconds
      const last = this.metricsHistory[this.metricsHistory.length - 1]
      if (last && time < last.time) this.metricsHistory.splice(0, this.metricsHistory.length)
      if (!last || time < last.time || Math.abs(last.time - time) >= 1) {
        this.metricsHistory.push({
          time,
          max: value.max,
          mean: value.mean,
          areaKm2: value.affectedAreaKm2,
          volumeKm3: value.affectedVolumeKm3,
          depthM: value.affectedDepthM,
        })
        if (this.metricsHistory.length > 96) this.metricsHistory.splice(0, this.metricsHistory.length - 96)
      }
    },
    setDepthPipelineStatus(supported: boolean, pipeline: string, terrain?: string): void {
      this.depthOcclusionSupported = supported
      this.renderPipeline = pipeline
      if (terrain) this.terrainMode = terrain
    },
    setRenderMetrics(gpuMs: number): void {
      this.renderGpuMs = gpuMs
    },
    setSimulationMetrics(computeMs: number, mode: SimulationComputeMode): void {
      this.simulationComputeMs = computeMs
      this.simulationComputeMode = mode
    },
  })
}

export type RedTideStore = ReturnType<typeof createRedTideStore>

let singleton: RedTideStore | undefined

export function useRedTideStore(): RedTideStore {
  if (!singleton) singleton = createRedTideStore()
  return singleton
}
