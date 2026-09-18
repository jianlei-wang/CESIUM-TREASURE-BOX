/**
 * 施工扬尘扩散模拟 — Cesium 三维渲染。
 *
 * 负责施工场地围挡、扬尘源、环境敏感点、风向指示与浓度场贴图热力面的
 * 创建、更新与销毁，坐标统一由场景中心局部 ENU 米坐标换算。
 */

import * as Cesium from 'cesium'
import type { CityModel } from '../sunshine-lib/city'
import { localToLonLat } from '../sunshine-lib/city'
import { windDownwindVector, type DustSource, type GridSpec, type SectionResult, type SensitiveResult, type VolumeResult } from './dust-model'
import type { SiteModel } from './dust-scene'

export interface SiteRenderModel {
  city: CityModel
  siteRect: SiteModel['siteRect']
}

function toPosition(city: CityModel, x: number, y: number, z: number): Cesium.Cartesian3 {
  const { lon, lat } = localToLonLat(city, x, y)
  return Cesium.Cartesian3.fromDegrees(lon, lat, z)
}

function removeEntity(viewer: Cesium.Viewer, entity: Cesium.Entity | undefined): void {
  if (entity) viewer.entities.remove(entity)
}

/** 扬尘浓度色带：蓝 → 青 → 绿 → 黄 → 红 */
const DUST_STOPS: [number, number, number][] = [
  [49, 54, 149],
  [69, 117, 180],
  [116, 196, 118],
  [254, 224, 144],
  [215, 48, 39]
]

export function dustColor(t: number): [number, number, number] {
  const c = Math.max(0, Math.min(1, t))
  const scaled = c * (DUST_STOPS.length - 1)
  const i = Math.min(DUST_STOPS.length - 2, Math.floor(scaled))
  const local = scaled - i
  const a = DUST_STOPS[i]
  const b = DUST_STOPS[i + 1]
  return [Math.round(a[0] + (b[0] - a[0]) * local), Math.round(a[1] + (b[1] - a[1]) * local), Math.round(a[2] + (b[2] - a[2]) * local)]
}

export function dustGradientCss(): string {
  return `linear-gradient(90deg, ${DUST_STOPS.map((rgb) => `rgb(${rgb.join(',')})`).join(', ')})`
}

/** 把浓度场绘制为与网格等像素的 canvas 贴图 */
export function fieldToCanvas(field: Float32Array, grid: GridSpec, maxValue: number, opacity = 1): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = grid.nx
  canvas.height = grid.ny
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const image = ctx.createImageData(grid.nx, grid.ny)
  const denom = Math.max(1e-6, maxValue)
  const alphaScale = Math.max(0, Math.min(1, opacity))
  for (let row = 0; row < grid.ny; row += 1) {
    const py = grid.ny - 1 - row
    for (let col = 0; col < grid.nx; col += 1) {
      const value = field[row * grid.nx + col]
      const t = Math.sqrt(Math.max(0, Math.min(1, value / denom)))
      const [r, g, b] = dustColor(t)
      const alpha = value <= 0 ? 0 : Math.round(Math.min(0.82, 0.05 + t * 0.9) * alphaScale * 255)
      const idx = (py * grid.nx + col) * 4
      image.data[idx] = r
      image.data[idx + 1] = g
      image.data[idx + 2] = b
      image.data[idx + 3] = alpha
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

export function fieldToDataUrl(field: Float32Array, grid: GridSpec, maxValue: number): string {
  return fieldToCanvas(field, grid, maxValue).toDataURL('image/png')
}

export class ConcentrationOverlay {
  private viewer: Cesium.Viewer
  private rect: Cesium.Rectangle
  private primitive: Cesium.Primitive | undefined
  private appearance: Cesium.EllipsoidSurfaceAppearance
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D | null
  private currentHeight = Number.NaN

  constructor(viewer: Cesium.Viewer, model: SiteRenderModel, grid: GridSpec, sliceHeight: number) {
    this.viewer = viewer
    const sw = localToLonLat(model.city, grid.minX, grid.minY)
    const ne = localToLonLat(model.city, grid.maxX, grid.maxY)
    this.rect = Cesium.Rectangle.fromDegrees(sw.lon, sw.lat, ne.lon, ne.lat)
    this.canvas = document.createElement('canvas')
    this.canvas.width = Math.max(1, grid.nx)
    this.canvas.height = Math.max(1, grid.ny)
    this.ctx = this.canvas.getContext('2d')
    this.appearance = new Cesium.EllipsoidSurfaceAppearance({
      material: Cesium.Material.fromType('Image', {
        image: this.canvas,
        repeat: new Cesium.Cartesian2(1, 1),
        color: Cesium.Color.WHITE
      }),
      aboveGround: true,
      flat: true
    })
    this.appearance.material.translucent = true
    this.currentHeight = sliceHeight
    this.rebuildPrimitive()
  }

  private rebuildPrimitive(): void {
    if (this.primitive) {
      this.viewer.scene.primitives.remove(this.primitive)
      this.primitive = undefined
    }
    const west = Cesium.Math.toDegrees(this.rect.west)
    const south = Cesium.Math.toDegrees(this.rect.south)
    const east = Cesium.Math.toDegrees(this.rect.east)
    const north = Cesium.Math.toDegrees(this.rect.north)
    this.primitive = this.viewer.scene.primitives.add(
      new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({
          geometry: new Cesium.PolygonGeometry({
            polygonHierarchy: new Cesium.PolygonHierarchy(
              Cesium.Cartesian3.fromDegreesArray([west, south, east, south, east, north, west, north])
            ),
            height: this.currentHeight,
            vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT
          })
        }),
        appearance: this.appearance,
        asynchronous: false,
        allowPicking: false
      })
    )
  }

  private blit(src: HTMLCanvasElement): void {
    if (!this.ctx) return
    if (this.canvas.width !== src.width || this.canvas.height !== src.height) {
      this.canvas.width = src.width
      this.canvas.height = src.height
    }
    this.ctx.globalCompositeOperation = 'copy'
    this.ctx.drawImage(src, 0, 0)
    const material = this.appearance.material as unknown as {
      uniforms: { image: HTMLCanvasElement }
      _textures?: Record<string, { width?: number; height?: number; copyFrom?: (options: { source: HTMLCanvasElement }) => void }>
    }
    const texture = material._textures?.image
    const ready =
      texture &&
      typeof texture.copyFrom === 'function' &&
      texture.width === this.canvas.width &&
      texture.height === this.canvas.height
    if (ready && texture?.copyFrom) texture.copyFrom({ source: this.canvas })
    else material.uniforms.image = this.canvas
  }

  /** 复用同一 GPU 纹理，原地拷贝像素，避免播放换贴图闪烁 */
  update(field: Float32Array, grid: GridSpec, maxValue: number, sliceHeight: number): void {
    const canvas = fieldToCanvas(field, grid, maxValue)
    this.blit(canvas)
    if (sliceHeight !== this.currentHeight) {
      this.currentHeight = sliceHeight
      this.rebuildPrimitive()
    }
  }

  /** 把预绘制帧拷进持久 canvas，用于时间轴回放 */
  setCanvas(canvas: HTMLCanvasElement, sliceHeight: number): void {
    this.blit(canvas)
    if (sliceHeight !== this.currentHeight) {
      this.currentHeight = sliceHeight
      this.rebuildPrimitive()
    }
  }

  clear(): void {
    if (!this.ctx) return
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    const material = this.appearance.material as unknown as {
      uniforms: { image: HTMLCanvasElement }
      _textures?: Record<string, { width?: number; height?: number; copyFrom?: (options: { source: HTMLCanvasElement }) => void }>
    }
    const texture = material._textures?.image
    const ready =
      texture &&
      typeof texture.copyFrom === 'function' &&
      texture.width === this.canvas.width &&
      texture.height === this.canvas.height
    if (ready && texture?.copyFrom) texture.copyFrom({ source: this.canvas })
    else material.uniforms.image = this.canvas
  }

  setVisible(visible: boolean): void {
    if (this.primitive) this.primitive.show = visible
  }

  destroy(): void {
    if (this.primitive) {
      this.viewer.scene.primitives.remove(this.primitive)
      this.primitive = undefined
    }
  }
}

export interface SourceRenderHandles {
  entities: Cesium.Entity[]
  mobileEntities: Cesium.Entity[]
  /** 依据总开关与逐源勾选状态刷新地图显隐 */
  refresh(globalVisible: boolean, enabled: Record<string, boolean>): void
  updateMobile(positions: { x: number; y: number; z: number }[]): void
  destroy(): void
}

export function renderSources(viewer: Cesium.Viewer, model: SiteRenderModel, sources: DustSource[]): SourceRenderHandles {
  const entities: Cesium.Entity[] = []
  const mobileEntities: Cesium.Entity[] = []
  const groups = new Map<string, Cesium.Entity[]>()
  const add = (sourceId: string, entity: Cesium.Entity, isMobile = false): Cesium.Entity => {
    entities.push(entity)
    if (isMobile) mobileEntities.push(entity)
    const list = groups.get(sourceId)
    if (list) list.push(entity)
    else groups.set(sourceId, [entity])
    return entity
  }
  const city = model.city
  for (const source of sources) {
    if (source.type === 'point' && source.position) {
      add(source.id, viewer.entities.add({
        id: `dust-source-${source.id}`,
        position: toPosition(city, source.position.x, source.position.y, source.height),
        point: { pixelSize: 11, color: Cesium.Color.fromCssColorString(source.color), outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
        label: {
          text: source.name,
          font: '12px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.fromCssColorString('#0b1c33'),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -20),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3000)
        }
      }))
    } else if (source.type === 'line' && source.path) {
      const positions = source.path.map((p) => toPosition(city, p.x, p.y, source.height))
      add(source.id, viewer.entities.add({
        id: `dust-source-${source.id}`,
        position: toPosition(city, source.path[1].x, source.path[1].y, source.height),
        polyline: { positions, width: 7, material: Cesium.Color.fromCssColorString(source.color).withAlpha(0.75), clampToGround: false },
        label: {
          text: source.name,
          font: '12px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.fromCssColorString('#0b1c33'),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -16),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3000)
        }
      }))
    } else if (source.type === 'area' && source.rect) {
      const corners = [
        { x: source.rect.minX, y: source.rect.minY },
        { x: source.rect.maxX, y: source.rect.minY },
        { x: source.rect.maxX, y: source.rect.maxY },
        { x: source.rect.minX, y: source.rect.maxY }
      ]
      const positions = corners.map((p) => toPosition(city, p.x, p.y, source.height))
      add(source.id, viewer.entities.add({
        id: `dust-source-${source.id}`,
        position: toPosition(city, (source.rect.minX + source.rect.maxX) / 2, (source.rect.minY + source.rect.maxY) / 2, source.height + 1),
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          material: Cesium.Color.fromCssColorString(source.color).withAlpha(0.3),
          height: 0.2,
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString(source.color)
        },
        label: {
          text: source.name,
          font: '12px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.fromCssColorString('#0b1c33'),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3000)
        }
      }))
    } else if (source.type === 'mobile' && source.path) {
      const path = source.path
      const positions = [toPosition(city, path[0].x, path[0].y, source.height), toPosition(city, path[1].x, path[1].y, source.height)]
      add(source.id, viewer.entities.add({
        id: `dust-source-${source.id}`,
        polyline: { positions, width: 2, material: Cesium.Color.fromCssColorString(source.color).withAlpha(0.6), clampToGround: false }
      }))
      for (let i = 0; i < 3; i += 1) {
        add(source.id, viewer.entities.add({
          id: `dust-mobile-${source.id}-${i}`,
          position: toPosition(city, path[0].x, path[0].y, source.height),
          point: { pixelSize: 9, color: Cesium.Color.fromCssColorString(source.color), outlineColor: Cesium.Color.WHITE, outlineWidth: 2 }
        }), true)
      }
    }
  }
  return {
    entities,
    mobileEntities,
    refresh(globalVisible, enabled) {
      for (const [id, list] of groups) {
        const visible = globalVisible && enabled[id] !== false
        for (const e of list) e.show = visible
      }
    },
    updateMobile(positions) {
      mobileEntities.forEach((entity, i) => {
        const p = positions[i]
        if (p) entity.position = new Cesium.ConstantPositionProperty(toPosition(city, p.x, p.y, p.z))
      })
    },
    destroy() {
      for (const e of entities) removeEntity(viewer, e)
    }
  }
}

export interface SensitiveRenderHandles {
  entities: Cesium.Entity[]
  update(results: SensitiveResult[]): void
  setVisible(visible: boolean): void
  destroy(): void
}

const SENSITIVE_COLORS: Record<string, string> = {
  school: '#409eff',
  hospital: '#f56c6c',
  residential: '#67c23a',
  park: '#909399',
  other: '#b37feb'
}

export function renderSensitivePoints(viewer: Cesium.Viewer, model: SiteRenderModel, results: SensitiveResult[]): SensitiveRenderHandles {
  const city = model.city
  const entities: Cesium.Entity[] = []
  const byId = new Map<string, Cesium.Entity>()
  results.forEach((result) => {
    const baseColor = SENSITIVE_COLORS[result.type] ?? '#b37feb'
    const entity = viewer.entities.add({
      id: `dust-sensitive-${result.id}`,
      position: toPosition(city, result.position.x, result.position.y, 3),
      point: { pixelSize: 10, color: Cesium.Color.fromCssColorString(baseColor), outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
      label: {
        text: result.name,
        font: '12px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#0b1c33'),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -18),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 4000)
      }
    })
    entities.push(entity)
    byId.set(result.id, entity)
  })
  return {
    entities,
    update(next: SensitiveResult[]) {
      for (const result of next) {
        const entity = byId.get(result.id)
        if (!entity?.point) continue
        const color = result.isExceeding ? '#ff4d4f' : '#52c41a'
        entity.point.color = new Cesium.ConstantProperty(Cesium.Color.fromCssColorString(color))
      }
    },
    setVisible(visible: boolean) {
      for (const e of entities) e.show = visible
    },
    destroy() {
      for (const e of entities) removeEntity(viewer, e)
    }
  }
}

export interface SiteRenderHandles {
  fence: Cesium.Entity
  outline: Cesium.Entity
  setVisible(visible: boolean): void
  destroy(): void
}

export function renderSiteBoundary(viewer: Cesium.Viewer, model: SiteRenderModel, barrierHeight: number): SiteRenderHandles {
  const city = model.city
  const rect = model.siteRect
  const corners = [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY }
  ]
  const positions = corners.map((p) => toPosition(city, p.x, p.y, 0))
  positions.push(positions[0])
  const fence = viewer.entities.add({
    wall: {
      positions,
      minimumHeights: new Cesium.ConstantProperty(positions.map(() => 0)),
      maximumHeights: new Cesium.ConstantProperty(positions.map(() => barrierHeight)),
      material: Cesium.Color.fromCssColorString('#2f80ed').withAlpha(0.35),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString('#9ecbff')
    }
  })
  const outline = viewer.entities.add({
    polyline: { positions, width: 2, material: Cesium.Color.fromCssColorString('#9ecbff'), clampToGround: true }
  })
  return {
    fence,
    outline,
    setVisible(visible: boolean) {
      fence.show = visible
      outline.show = visible
    },
    destroy() {
      removeEntity(viewer, fence)
      removeEntity(viewer, outline)
    }
  }
}

export function updateFenceHeight(handles: SiteRenderHandles, height: number, pointCount = 5): void {
  if (!handles.fence.wall) return
  handles.fence.wall.maximumHeights = new Cesium.ConstantProperty(Array.from({ length: pointCount }, () => height))
}

export interface WindArrowHandles {
  update(direction: number, speed: number): void
  destroy(): void
}

/** 风速色带：低速偏蓝、中速偏青绿、高速偏橙红 */
export function windSpeedColor(speed: number): string {
  const stops: [number, number, number][] = [
    [64, 158, 255],
    [54, 207, 201],
    [149, 222, 100],
    [250, 219, 20],
    [245, 108, 108]
  ]
  const t = Math.max(0, Math.min(1, (speed - 0.5) / 9.5))
  const scaled = t * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(scaled))
  const local = scaled - i
  const a = stops[i]
  const b = stops[i + 1]
  const r = Math.round(a[0] + (b[0] - a[0]) * local)
  const g = Math.round(a[1] + (b[1] - a[1]) * local)
  const bl = Math.round(a[2] + (b[2] - a[2]) * local)
  return `rgb(${r}, ${g}, ${bl})`
}

export function renderWindArrow(
  viewer: Cesium.Viewer,
  model: SiteRenderModel,
  windDirection: number,
  windSpeed: number,
  siteRect: SiteModel['siteRect']
): WindArrowHandles {
  const city = model.city
  const cx = (siteRect.minX + siteRect.maxX) / 2
  const cy = (siteRect.minY + siteRect.maxY) / 2
  const length = 118
  const headLength = 32
  const headWidth = 19
  const compute = (direction: number): Cesium.Cartesian3[][] => {
    const dir = windDownwindVector(direction)
    const perp = { x: -dir.y, y: dir.x }
    const tipX = cx + dir.x * length
    const tipY = cy + dir.y * length
    const tailX = cx - dir.x * length
    const tailY = cy - dir.y * length
    const baseX = tipX - dir.x * headLength
    const baseY = tipY - dir.y * headLength
    return [
      [toPosition(city, tailX, tailY, 90), toPosition(city, tipX, tipY, 90)],
      [toPosition(city, tipX, tipY, 90), toPosition(city, baseX + perp.x * headWidth, baseY + perp.y * headWidth, 90)],
      [toPosition(city, tipX, tipY, 90), toPosition(city, baseX - perp.x * headWidth, baseY - perp.y * headWidth, 90)]
    ]
  }
  const parts = [0, 1, 2].map((index) =>
    viewer.entities.add({
      polyline: {
        positions: compute(windDirection)[index],
        width: index === 0 ? 5 : 4,
        material: new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString(windSpeedColor(windSpeed))),
        clampToGround: false
      }
    })
  )
  return {
    update(direction: number, speed: number) {
      const geometry = compute(direction)
      const color = Cesium.Color.fromCssColorString(windSpeedColor(speed))
      parts.forEach((entity, index) => {
        if (!entity.polyline) return
        entity.polyline.positions = new Cesium.ConstantProperty(geometry[index])
        entity.polyline.material = new Cesium.ColorMaterialProperty(color)
      })
    },
    destroy() {
      for (const entity of parts) removeEntity(viewer, entity)
    }
  }
}

// ---------------------------------------------------------------------------
// 垂直剖面
// ---------------------------------------------------------------------------

export interface SectionRenderHandles {
  setVisible(visible: boolean): void
  update(section: SectionResult, maxValue: number, opacity?: number): void
  destroy(): void
}

function sectionToDataUrl(section: SectionResult, maxValue: number, opacity = 1): string {
  const canvas = document.createElement('canvas')
  canvas.width = section.samples
  canvas.height = section.layers
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const image = ctx.createImageData(section.samples, section.layers)
  const denom = Math.max(1e-6, maxValue)
  const alphaScale = Math.max(0, Math.min(1, opacity))
  for (let li = 0; li < section.layers; li += 1) {
    const py = section.layers - 1 - li
    for (let si = 0; si < section.samples; si += 1) {
      const value = section.values[li * section.samples + si]
      const t = Math.sqrt(Math.max(0, Math.min(1, value / denom)))
      const [r, g, b] = dustColor(t)
      const alpha = value <= 0 ? 0 : Math.round(Math.min(0.85, 0.06 + t * 0.9) * alphaScale * 255)
      const idx = (py * section.samples + si) * 4
      image.data[idx] = r
      image.data[idx + 1] = g
      image.data[idx + 2] = b
      image.data[idx + 3] = alpha
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

function sectionLine(section: SectionResult, city: CityModel): Cesium.Cartesian3[] {
  return [
    toPosition(city, section.cx - section.dir.x * section.halfLength, section.cy - section.dir.y * section.halfLength, 0),
    toPosition(city, section.cx + section.dir.x * section.halfLength, section.cy + section.dir.y * section.halfLength, 0)
  ]
}

export function renderVerticalSection(
  viewer: Cesium.Viewer,
  model: SiteRenderModel,
  section: SectionResult,
  maxValue: number,
  opacity = 1
): SectionRenderHandles {
  const material = new Cesium.ImageMaterialProperty({ image: sectionToDataUrl(section, maxValue, opacity), transparent: true })
  const entity = viewer.entities.add({
    id: 'dust-section-overlay',
    wall: {
      positions: sectionLine(section, model.city),
      minimumHeights: new Cesium.ConstantProperty([0, 0]),
      maximumHeights: new Cesium.ConstantProperty([section.maxHeight, section.maxHeight]),
      material
    }
  })
  return {
    update(next, max, nextOpacity = 1) {
      if (!entity.wall) return
      entity.wall.positions = new Cesium.ConstantProperty(sectionLine(next, model.city))
      entity.wall.minimumHeights = new Cesium.ConstantProperty([0, 0])
      entity.wall.maximumHeights = new Cesium.ConstantProperty([next.maxHeight, next.maxHeight])
      material.image = new Cesium.ConstantProperty(sectionToDataUrl(next, max, nextOpacity))
    },
    setVisible(visible) {
      entity.show = visible
    },
    destroy() {
      removeEntity(viewer, entity)
    }
  }
}

// ---------------------------------------------------------------------------
// 三维体渲染（VoxelPrimitive）
// ---------------------------------------------------------------------------

export interface VolumeRenderHandles {
  setVisible(visible: boolean): void
  update(volume: VolumeResult, maxValue: number, opacity?: number): void
  destroy(): void
}

function volumeToMetadata(volume: VolumeResult, maxValue: number, opacity = 1): Float32Array {
  const { nx, ny, nz, layers } = volume
  const data = new Float32Array(nx * ny * nz * 4)
  const denom = Math.max(1e-6, maxValue)
  const alphaScale = Math.max(0, Math.min(1, opacity))
  let out = 0
  for (let z = 0; z < nz; z += 1) {
    const field = layers[z]
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        const value = field[y * nx + x]
        const t = Math.sqrt(Math.max(0, Math.min(1, value / denom)))
        const [r, g, b] = dustColor(t)
        data[out++] = r / 255
        data[out++] = g / 255
        data[out++] = b / 255
        data[out++] = value <= 0 ? 0 : Math.min(0.6, 0.05 + t * 0.75) * alphaScale
      }
    }
  }
  return data
}

const volumeShader = new Cesium.CustomShader({
  fragmentShaderText: `
    void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
      vec4 color = fsInput.metadata.color;
      material.diffuse = color.rgb;
      material.alpha = color.a;
    }
  `
})

export function renderVolume(
  viewer: Cesium.Viewer,
  model: SiteRenderModel,
  volume: VolumeResult,
  maxValue: number,
  opacity = 1
): VolumeRenderHandles {
  let primitive: Cesium.VoxelPrimitive | undefined
  const center = Cesium.Cartesian3.fromDegrees(model.city.center.lon, model.city.center.lat, 0)
  const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(center)
  const build = (vol: VolumeResult, max: number, alpha: number): void => {
    if (primitive) {
      viewer.scene.primitives.remove(primitive)
      primitive = undefined
    }
    const top = vol.heights[vol.nz - 1]
    const metadata = volumeToMetadata(vol, max, alpha)
    const provider = {
      shape: Cesium.VoxelShapeType.BOX,
      dimensions: new Cesium.Cartesian3(vol.nx, vol.ny, vol.nz),
      paddingBefore: Cesium.Cartesian3.ZERO,
      paddingAfter: Cesium.Cartesian3.ZERO,
      shapeTransform: Cesium.Matrix4.IDENTITY,
      globalTransform: Cesium.Matrix4.IDENTITY,
      minBounds: new Cesium.Cartesian3(vol.minX, vol.minY, 0),
      maxBounds: new Cesium.Cartesian3(vol.maxX, vol.maxY, top),
      names: ['color'],
      types: [Cesium.MetadataType.VEC4],
      componentTypes: [Cesium.MetadataComponentType.FLOAT32],
      maximumTileCount: 1,
      availableLevels: 1,
      requestData: (): Promise<Cesium.VoxelContent> => Promise.resolve(Cesium.VoxelContent.fromMetadataArray([metadata]))
    } as unknown as Cesium.VoxelProvider
    const next = new Cesium.VoxelPrimitive({
      provider,
      modelMatrix,
      customShader: volumeShader,
      calculateStatistics: false
    })
    next.screenSpaceError = 6
    next.stepSize = 1
    next.nearestSampling = false
    next.minBounds = new Cesium.Cartesian3(vol.minX, vol.minY, 0)
    next.maxBounds = new Cesium.Cartesian3(vol.maxX, vol.maxY, top)
    viewer.scene.primitives.add(next)
    primitive = next
  }
  build(volume, maxValue, opacity)
  return {
    update(next, max, nextOpacity = 1) {
      build(next, max, nextOpacity)
    },
    setVisible(visible) {
      if (primitive) primitive.show = visible
    },
    destroy() {
      if (primitive) {
        viewer.scene.primitives.remove(primitive)
        primitive = undefined
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 粒子流场（辅助效果）
// ---------------------------------------------------------------------------

export interface ParticleFieldHandles {
  setVisible(visible: boolean): void
  setOpacity(opacity: number): void
  updateDirection(direction: number): void
  destroy(): void
}

function particleImage(): string {
  const size = 48
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,235,190,0.95)')
  g.addColorStop(0.4, 'rgba(247,176,74,0.55)')
  g.addColorStop(1, 'rgba(247,176,74,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  ctx.fill()
  return canvas.toDataURL('image/png')
}

interface DriftParticle {
  x: number
  y: number
  z: number
  life: number
  age: number
  speed: number
  rise: number
  scale: number
}

/**
 * 基于 BillboardCollection 的流场粒子（辅助效果）。
 * 不依赖 Cesium.ParticleSystem，在场地局部 ENU 坐标内沿下风向漂散并缓慢抬升。
 */
export function renderParticleField(
  viewer: Cesium.Viewer,
  model: SiteRenderModel,
  windDirection: number,
  options: { count?: number; opacity?: number; color?: string } = {}
): ParticleFieldHandles {
  const scene = viewer.scene
  const count = Math.max(20, Math.min(1200, Math.round(options.count ?? 260)))
  const baseColor = Cesium.Color.fromCssColorString(options.color ?? '#f7b04a')
  let opacity = options.opacity ?? 0.6
  let dir = windDownwindVector(windDirection)

  const center = Cesium.Cartesian3.fromDegrees(model.city.center.lon, model.city.center.lat, 20)
  const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(center)
  const collection = new Cesium.BillboardCollection({ scene, modelMatrix })
  const image = particleImage()

  const rect = model.siteRect
  const originX = (rect.minX + rect.maxX) / 2
  const originY = (rect.minY + rect.maxY) / 2
  const spanX = Math.max(80, rect.maxX - rect.minX)
  const spanY = Math.max(80, rect.maxY - rect.minY)

  const particles: DriftParticle[] = []
  const billboards: Cesium.Billboard[] = []

  const reseed = (p: DriftParticle): void => {
    p.x = originX + (Math.random() - 0.5) * spanX
    p.y = originY + (Math.random() - 0.5) * spanY
    p.z = Math.random() * 8
    p.age = 0
    p.life = 5 + Math.random() * 6
    p.speed = 0.6 + Math.random() * 1.2
    p.rise = 0.4 + Math.random() * 1.0
    p.scale = 0.6 + Math.random() * 0.8
  }

  for (let i = 0; i < count; i += 1) {
    const p: DriftParticle = { x: 0, y: 0, z: 0, life: 1, age: 0, speed: 1, rise: 0.6, scale: 1 }
    reseed(p)
    p.age = Math.random() * p.life
    particles.push(p)
    billboards.push(
      collection.add({
        image,
        position: new Cesium.Cartesian3(p.x, p.y, p.z),
        scale: p.scale,
        color: baseColor.withAlpha(0)
      })
    )
  }
  scene.primitives.add(collection)

  let last = performance.now()
  const onPreRender = (): void => {
    const now = performance.now()
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
    last = now
    if (!collection.show) return
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i]
      p.age += dt
      if (p.age >= p.life) reseed(p)
      p.x += dir.x * p.speed * 22 * dt
      p.y += dir.y * p.speed * 22 * dt
      p.z += p.rise * 3.2 * dt
      const ratio = Math.min(1, p.age / p.life)
      const fade = Math.sin(Math.PI * ratio)
      const billboard = billboards[i]
      billboard.position = new Cesium.Cartesian3(p.x, p.y, p.z)
      billboard.scale = p.scale + ratio * 2.4
      billboard.color = baseColor.withAlpha(Math.max(0, Math.min(1, opacity * 0.9 * fade)))
    }
  }
  const removeListener = scene.preRender.addEventListener(onPreRender)

  return {
    setVisible(visible) {
      collection.show = visible
    },
    setOpacity(value) {
      opacity = Math.max(0, Math.min(1, value))
    },
    updateDirection(direction) {
      dir = windDownwindVector(direction)
    },
    destroy() {
      removeListener()
      scene.primitives.remove(collection)
    }
  }
}
