import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  ClockRange,
  ClockStep,
  Color,
  CustomDataSource,
  JulianDate,
  LagrangePolynomialApproximation,
  LabelStyle,
  Math as CesiumMath,
  PolylineGlowMaterialProperty,
  SampledPositionProperty,
  type Model,
  type Viewer
} from 'cesium'
import { createDroneModel, droneModelMatrix } from './drone'
import type { RoutePlan, Waypoint } from './types'
import { bearing, haversine } from './util'

export type FlightHud = {
  lon: number
  lat: number
  alt: number
  speed: number
  heading: number
  remaining: number
  progress: number
  phase: string
}

const DRONE_SCALE = 1.4

function routeJulianRange(route: RoutePlan): { start: JulianDate; stop: JulianDate } {
  const start = JulianDate.fromDate(new Date())
  const stop = JulianDate.addSeconds(start, Math.max(20, route.duration), new JulianDate())
  return { start, stop }
}

function pointAt(points: Waypoint[], t: number): Waypoint {
  if (points.length === 1) return points[0]
  const total = points.length - 1
  const scaled = Math.min(0.9999, Math.max(0, t)) * total
  const index = Math.floor(scaled)
  const frac = scaled - index
  const a = points[index]
  const b = points[Math.min(points.length - 1, index + 1)]
  return {
    lon: a.lon + (b.lon - a.lon) * frac,
    lat: a.lat + (b.lat - a.lat) * frac,
    alt: a.alt + (b.alt - a.alt) * frac
  }
}

/** 规划航线三维模拟飞行：Clock 时间轴 + 采样位置 + 姿态 + 航迹拖尾 + HUD。 */
export class SimulationFlight {
  private readonly viewer: Viewer
  private readonly dataSource: CustomDataSource
  private route: RoutePlan | null = null
  private property: SampledPositionProperty | null = null
  private droneModel: Model | null = null
  private droneLoading = false
  private start = new JulianDate()
  private stop = new JulianDate()
  private tickHandler: (() => void) | null = null
  private hudListener: ((hud: FlightHud) => void) | null = null
  private currentHud: FlightHud = {
    lon: 0,
    lat: 0,
    alt: 0,
    speed: 0,
    heading: 0,
    remaining: 0,
    progress: 0,
    phase: '待起飞'
  }

  constructor(viewer: Viewer) {
    this.viewer = viewer
    this.dataSource = new CustomDataSource('uav-flight')
    void viewer.dataSources.add(this.dataSource)
  }

  onHud(listener: (hud: FlightHud) => void): void {
    this.hudListener = listener
  }

  getHud(): FlightHud {
    return this.currentHud
  }

  /** 装载航线并复位时间轴。 */
  load(route: RoutePlan): void {
    this.route = route
    this.dataSource.entities.removeAll()
    const points = route.points.filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat))
    if (points.length < 2) {
      this.property = null
      return
    }
    const range = routeJulianRange(route)
    this.start = range.start
    this.stop = range.stop
    const property = new SampledPositionProperty()
    property.setInterpolationOptions({
      interpolationDegree: 1,
      interpolationAlgorithm: LagrangePolynomialApproximation
    })
    const total = points.length - 1
    for (let i = 0; i <= total; i += 1) {
      const t = JulianDate.addSeconds(
        this.start,
        (route.duration * i) / Math.max(1, total),
        new JulianDate()
      )
      property.addSample(
        t,
        Cartesian3.fromDegrees(points[i].lon, points[i].lat, Math.max(10, points[i].alt))
      )
    }
    this.property = property
    const entity = this.dataSource.entities.add({
      id: 'uav-sim',
      name: route.name,
      position: property,
      viewFrom: new Cartesian3(-40, -80, 50),
      path: {
        resolution: 2,
        width: 4,
        leadTime: 0,
        trailTime: Math.max(10, route.duration * 0.3),
        material: new PolylineGlowMaterialProperty({
          glowPower: 0.25,
          taperPower: 0.6,
          color: Color.fromCssColorString('#22d3ee')
        })
      },
      point: {
        pixelSize: 1,
        color: Color.TRANSPARENT
      },
      label: {
        text: route.name,
        font: '11px sans-serif',
        fillColor: Color.fromCssColorString('#e0f2fe'),
        outlineColor: Color.fromCssColorString('#0b1d30'),
        outlineWidth: 2,
        style: LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cartesian2(0, -34),
        scale: 0.9,
        showBackground: true,
        backgroundColor: Color.fromCssColorString('#0b1d30').withAlpha(0.6)
      }
    })
    void entity
    this.applyClock(range.start, range.stop)
    this.seek(0)
    void this.loadDroneModel()
    this.bindTick()
  }

  /** 加载无人机静态模型，跟随航线时间轴更新位姿。 */
  private async loadDroneModel(): Promise<void> {
    this.removeDroneModel()
    const position = this.property?.getValue(this.start)
    if (!position || !this.route) return
    const heading =
      this.route.points.length > 1 ? bearing(this.route.points[0], this.route.points[1]) : 0
    try {
      const model = await createDroneModel({
        position,
        heading,
        scale: DRONE_SCALE,
        minimumPixelSize: 40
      })
      if (!this.route || !this.property || this.viewer.isDestroyed()) {
        model.destroy()
        return
      }
      this.viewer.scene.primitives.add(model)
      this.droneModel = model
      this.refreshHud()
    } catch {
      this.droneModel = null
    }
  }

  private removeDroneModel(): void {
    if (this.droneModel) {
      if (!this.viewer.isDestroyed()) this.viewer.scene.primitives.remove(this.droneModel)
      this.droneModel = null
    }
  }

  private applyClock(start: JulianDate, stop: JulianDate): void {    const clock = this.viewer.clock
    clock.startTime = start.clone()
    clock.stopTime = stop.clone()
    clock.currentTime = start.clone()
    clock.clockRange = ClockRange.LOOP_STOP
    clock.clockStep = ClockStep.SYSTEM_CLOCK_MULTIPLIER
    clock.multiplier = 8
  }

  private bindTick(): void {
    if (this.tickHandler) {
      this.viewer.clock.onTick.removeEventListener(this.tickHandler)
    }
    this.tickHandler = () => this.refreshHud()
    this.viewer.clock.onTick.addEventListener(this.tickHandler)
  }

  play(): void {
    this.viewer.clock.shouldAnimate = true
    this.refreshHud()
  }

  pause(): void {
    this.viewer.clock.shouldAnimate = false
    this.refreshHud()
  }

  setSpeed(multiplier: number): void {
    this.viewer.clock.multiplier = multiplier
  }

  /** 跳转到进度 0~1。 */
  seek(progress: number): void {
    if (!this.property) return
    const p = Math.min(1, Math.max(0, progress))
    const total = JulianDate.secondsDifference(this.stop, this.start)
    const target = JulianDate.addSeconds(this.start, total * p, new JulianDate())
    this.viewer.clock.currentTime = target
    this.refreshHud()
  }

  getProgress(): number {
    if (!this.property) return 0
    const total = JulianDate.secondsDifference(this.stop, this.start)
    if (total <= 0) return 0
    return Math.min(1, Math.max(0, JulianDate.secondsDifference(this.viewer.clock.currentTime, this.start) / total))
  }

  follow(): void {
    this.viewer.trackedEntity = this.dataSource.entities.getById('uav-sim')
  }

  unfollow(): void {
    this.viewer.trackedEntity = undefined
  }

  private refreshHud(): void {
    if (!this.property || !this.route) return
    const time = this.viewer.clock.currentTime
    const position = this.property.getValue(time)
    if (!position) return
    const lonLat = this.toLonLat(position)
    const progress = this.getProgress()
    const remaining = Math.max(0, this.route.length * (1 - progress))
    let speed = 0
    let heading = 0
    if (this.route.points.length > 1) {
      const idx = Math.min(this.route.points.length - 2, Math.floor(progress * (this.route.points.length - 1)))
      const a = this.route.points[idx]
      const b = this.route.points[idx + 1]
      heading = bearing(a, b)
      speed = haversine(a, b) / Math.max(0.001, this.route.duration / (this.route.points.length - 1))
    }
    const phase = progress <= 0.001 ? '起飞爬升' : progress >= 0.999 ? '任务完成' : '巡航中'
    if (this.droneModel) this.droneModel.modelMatrix = droneModelMatrix(position, heading)
    this.currentHud = {
      lon: lonLat.lon,
      lat: lonLat.lat,
      alt: lonLat.alt,
      speed: Math.round(speed * 3.6),
      heading: Math.round(heading),
      remaining,
      progress,
      phase
    }
    this.hudListener?.(this.currentHud)
  }

  private toLonLat(position: Cartesian3): { lon: number; lat: number; alt: number } {
    const carto = Cartographic.fromCartesian(position)
    if (!carto) return { lon: 0, lat: 0, alt: 0 }
    return {
      lon: CesiumMath.toDegrees(carto.longitude),
      lat: CesiumMath.toDegrees(carto.latitude),
      alt: carto.height
    }
  }

  dispose(): void {
    if (this.tickHandler) {
      this.viewer.clock.onTick.removeEventListener(this.tickHandler)
      this.tickHandler = null
    }
    this.viewer.clock.shouldAnimate = false
    this.removeDroneModel()
    if (!this.viewer.isDestroyed()) {
      this.viewer.trackedEntity = undefined
      void this.viewer.dataSources.remove(this.dataSource, true)
    }
    this.property = null
    this.route = null
  }
}
