import { Cartesian3, Ellipsoid, Math as CesiumMath, type Viewer } from 'cesium'
import * as echarts from 'echarts'

type GLMapApi = {
  getZr(): { viewer?: unknown }
  getWidth(): number
  getHeight(): number
}

type GLMapSeriesModel = {
  get(name: string): unknown
  coordinateSystem?: GLMapCoordSys
}

type GLMapEcModel = {
  eachSeries(callback: (model: GLMapSeriesModel) => void): void
}

let layerSeq = 0

function toViewer(value: unknown): Viewer {
  return value as Viewer
}

/**
 * GLMap 坐标系：把经纬度实时投影到 Cesium 画布屏幕坐标，
 * 供 ECharts series 以 coordinateSystem: 'GLMap' 绑定地图渲染。
 */
class GLMapCoordSys {
  static readonly dimensions = ['lng', 'lat']
  readonly dimensions = ['lng', 'lat']
  private _api: GLMapApi
  private _viewer: Viewer
  private _mapOffset: [number, number] = [0, 0]

  constructor(api: GLMapApi) {
    this._api = api
    this._viewer = toViewer(api.getZr().viewer)
  }

  setMapOffset(mapOffset: [number, number]): this {
    this._mapOffset = mapOffset
    return this
  }

  dataToPoint(data: [number, number]): number[] {
    const cartesian3 = Cartesian3.fromDegrees(data[0], data[1])
    if (!cartesian3) return []
    const up = Ellipsoid.WGS84.geodeticSurfaceNormal(cartesian3, new Cartesian3())
    const cameraDirection = this._viewer.camera.direction
    if (Cartesian3.dot(up, cameraDirection) >= 0) return []
    const coords = this._viewer.scene.cartesianToCanvasCoordinates(cartesian3)
    if (!coords) return []
    return [coords.x - this._mapOffset[0], coords.y - this._mapOffset[1]]
  }

  pointToData(point: number[]): number[] {
    const ellipsoid = this._viewer.scene.globe.ellipsoid
    const cartesian3 = new Cartesian3(
      point[0] + this._mapOffset[0],
      point[1] + this._mapOffset[1],
      0
    )
    const cartographic = ellipsoid.cartesianToCartographic(cartesian3)
    return [
      CesiumMath.toDegrees(cartographic.longitude),
      CesiumMath.toDegrees(cartographic.latitude)
    ]
  }

  getViewRect(): echarts.graphic.BoundingRect {
    const api = this._api
    return new echarts.graphic.BoundingRect(0, 0, api.getWidth(), api.getHeight())
  }

  getRoamTransform(): number[] {
    return echarts.matrix.create()
  }

  static create(ecModel: GLMapEcModel, api: GLMapApi): GLMapCoordSys[] {
    let coordinateSys: GLMapCoordSys | undefined
    ecModel.eachSeries((model) => {
      if (model.get('coordinateSystem') === 'GLMap') {
        if (!coordinateSys) coordinateSys = new GLMapCoordSys(api)
        model.coordinateSystem = coordinateSys
      }
    })
    return coordinateSys ? [coordinateSys] : []
  }
}

echarts.registerCoordinateSystem(
  'GLMap',
  GLMapCoordSys as unknown as Parameters<typeof echarts.registerCoordinateSystem>[1]
)

echarts.registerAction(
  { type: 'GLMapRoam', event: 'GLMapRoam', update: 'updateLayout' },
  () => {}
)

/**
 * ChartLayer：Cesium + ECharts 桥接层。
 * 创建一个覆盖 Cesium 画布的透明 div，ECharts 在其上渲染；
 * 数据点通过 GLMap 坐标系实时投影到地图位置，相机变化时自动重绘跟随。
 */
export class ChartLayer {
  readonly id: string
  private _viewer: Viewer
  private _chartEl: HTMLDivElement
  private _chart: echarts.EChartsType
  private _show = true
  private _onCameraChanged: () => void

  constructor(id: string, viewer: Viewer) {
    this.id = id
    this._viewer = viewer
    viewer.canvas.setAttribute('tabIndex', '0')
    this._chartEl = this.createChartElement()
    this._chart = echarts.init(this._chartEl)
    const zr = this._chart.getZr() as unknown as { viewer?: unknown }
    zr.viewer = viewer
    this._onCameraChanged = () => this.resize()
    viewer.camera.changed.addEventListener(this._onCameraChanged)
  }

  get show(): boolean {
    return this._show
  }

  set show(value: boolean) {
    this._show = value
    this._chartEl.style.visibility = value ? 'visible' : 'hidden'
  }

  setOption(option: Record<string, unknown>): this {
    this._chart.setOption({ ...option, animation: false } as never)
    return this
  }

  clear(): this {
    this._chart.clear()
    return this
  }

  resize(): this {
    const canvas = this._viewer.scene.canvas
    this._chartEl.style.width = `${canvas.clientWidth}px`
    this._chartEl.style.height = `${canvas.clientHeight}px`
    if (!this._chart.isDisposed()) {
      this._chart.resize()
    }
    return this
  }

  destroy(): void {
    this._viewer.camera.changed.removeEventListener(this._onCameraChanged)
    if (!this._chart.isDisposed()) {
      this._chart.dispose()
    }
    this._chartEl.remove()
  }

  private createChartElement(): HTMLDivElement {
    const canvas = this._viewer.scene.canvas
    layerSeq += 1
    const el = document.createElement('div')
    el.setAttribute('id', `${this.id}-${layerSeq}`)
    el.style.cssText = `position:absolute; top:0; left:0; width:${canvas.clientWidth}px; height:${canvas.clientHeight}px; pointer-events:none;`
    this._viewer.container.appendChild(el)
    return el
  }
}
