/**
 * PM2.5 地面 footprint 图层 —— 把 Worker 返回的近地浓度栅格渲染为地面贴图。
 *
 * 支持两种着色模式：
 *   - concentration：连续浓度色带 + 分级边界描边，突出污染羽流形态；
 *   - class：按国标空气质量等级离散着色，便于叠加超标边界判断。
 * 所有栅格使用归一化体域坐标，贴图铺满体域底面，与三维浓度体严格对齐。
 */

import {
  Cartesian3,
  ConstantProperty,
  ImageMaterialProperty,
  Rectangle,
  RectangleGraphics,
  type Entity,
  type Texture,
  type Viewer
} from 'cesium'
import type { VolumeEngine } from '../../lib/volume-engine/VolumeEngine'
import { canvasToGroundTexture, createEmptyGroundTexture } from '../../lib/volume-engine/ground-texture'
import { PALETTES, lerpStops, pm25ClassColor, pm25ClassOf, type Stop } from '../../lib/volume-engine/palette'
import type { Pm25FootprintResult } from './pm25-types'

export type Pm25GroundMode = 'concentration' | 'class'

export type Pm25GroundLayer = {
  update: (result: Pm25FootprintResult, mode: Pm25GroundMode) => void
  setVisible: (visible: boolean) => void
  destroy: () => void
}

const PM25_STOPS: Stop[] = PALETTES.pm25.stops

function sampleRamp(value: number, max: number): Stop {
  const t = Math.max(0, Math.min(1, value / Math.max(1, max)))
  return lerpStops(PM25_STOPS, t)
}

/**
 * 把地面浓度栅格绘制为 canvas：
 *   - 连续模式：浓度色带，低值透明，分级断点处描白边；
 *   - 分级模式：国标等级色离散铺色，增强等级对比。
 */
export function renderFootprintCanvas(result: Pm25FootprintResult, mode: Pm25GroundMode): HTMLCanvasElement {
  const G = result.grid
  const canvas = document.createElement('canvas')
  canvas.width = G
  canvas.height = G
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const image = ctx.createImageData(G, G)
  const surface = result.surface
  const max = Math.max(1, result.max)
  const lowCut = Math.max(8, result.threshold * 0.25)
  const classField = new Uint8Array(G * G)
  for (let j = 0; j < G; j += 1) {
    for (let i = 0; i < G; i += 1) {
      const src = (G - 1 - j) * G + i
      const value = surface[src]
      classField[j * G + i] = pm25ClassOf(value).code
      const idx = (j * G + i) * 4
      if (value < lowCut) {
        image.data[idx + 3] = 0
        continue
      }
      const color = mode === 'class' ? pm25ClassColor(value) : sampleRamp(value, max)
      const t = Math.min(1, (value - lowCut) / Math.max(1, max - lowCut))
      image.data[idx] = color[0]
      image.data[idx + 1] = color[1]
      image.data[idx + 2] = color[2]
      image.data[idx + 3] = Math.round(30 + 200 * Math.pow(t, 0.75))
    }
  }
  // 分级边界：相邻单元等级不同处描出偏移到下一等级的一侧，形成等值线观感
  for (let j = 1; j < G - 1; j += 1) {
    for (let i = 1; i < G - 1; i += 1) {
      const c = classField[j * G + i]
      if (c === classField[j * G + i - 1] && c === classField[j * G + i + 1] && c === classField[(j - 1) * G + i] && c === classField[(j + 1) * G + i]) {
        continue
      }
      const idx = (j * G + i) * 4
      image.data[idx] = 235
      image.data[idx + 1] = 245
      image.data[idx + 2] = 255
      image.data[idx + 3] = 210
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

/** 在体域底面安装 footprint 图层，返回可更新 / 卸载的句柄 */
export function installPm25Ground(engine: VolumeEngine): Pm25GroundLayer {
  const viewer = engine.getViewer() as Viewer | undefined
  if (!viewer || viewer.isDestroyed()) {
    return { update: () => undefined, setVisible: () => undefined, destroy: () => undefined }
  }
  const activeViewer: Viewer = viewer
  const sw = engine.worldFromNormalized(0, 0, 0)
  const ne = engine.worldFromNormalized(1, 1, 0)
  const rect = Rectangle.fromCartesianArray([Cartesian3.clone(sw), Cartesian3.clone(ne)])
  const material = new ImageMaterialProperty({ transparent: true })
  let texture: Texture | undefined = createEmptyGroundTexture(viewer)
  if (texture) material.image = new ConstantProperty(texture)
  const entity: Entity = viewer.entities.add({
    rectangle: new RectangleGraphics({
      coordinates: rect,
      material,
      height: 4
    })
  })

  function update(result: Pm25FootprintResult, mode: Pm25GroundMode): void {
    // 同步建纹理并交给材质，避免 ImageMaterialProperty 的「下一帧才上传画布」造成一帧白闪
    const next = canvasToGroundTexture(activeViewer, renderFootprintCanvas(result, mode))
    if (!next) return
    texture = next
    material.image = new ConstantProperty(next)
    engine.requestRenderSettled()
  }

  function setVisible(next: boolean): void {
    entity.show = next
    engine.requestRender()
  }

  return {
    update,
    setVisible,
    destroy: () => {
      if (viewer.isDestroyed()) return
      viewer.entities.remove(entity)
      if (texture && !texture.isDestroyed()) texture.destroy()
      engine.requestRender()
    }
  }
}
