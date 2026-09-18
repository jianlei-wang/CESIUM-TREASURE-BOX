<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  CustomShader,
  CylinderGeometry,
  GeometryInstance,
  Matrix4,
  MetadataComponentType,
  MetadataType,
  PerInstanceColorAppearance,
  Primitive,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Transforms,
  UniformType,
  VerticalOrigin,
  HorizontalOrigin,
  VoxelContent,
  VoxelPrimitive,
  VoxelShapeType,
  Math as CesiumMath,
  type Entity,
  type Viewer,
  type VoxelProvider
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const showAll = ref(true)
const showBores = ref(true)
const spacing = ref(2)
const stepSize = ref(1.5)

const LAYERS = [
  { name: '砂土层', color: '#D2B48C' },
  { name: '粉质粘土层', color: '#B8860B' },
  { name: '粉砂层', color: '#D3D3A4' },
  { name: '中砂层', color: '#CD853F' },
  { name: '密实砾石与基岩', color: '#7A6B5A' }
] as const
const layerShow = ref(LAYERS.map(() => true))

const pickedInfo = ref<{ name: string; depth: number; layer: number } | null>(null)

const SCALE_XY = 500
const SCALE_Z = 80
const LIFT = 25
const BORE_COLS = 5
const BORE_ROWS = 4

const CENTER_LON = 116.39
const CENTER_LAT = 39.91
const CENTER_HEIGHT = 500

type Borehole = { u: number; v: number; depths: number[] }
type Grid = { gx: number; gy: number; gz: number }

const layerShaders = LAYERS.map(
  () =>
    new CustomShader({
      fragmentShaderText: `
    void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
      vec3 voxelNormal = fsInput.attributes.normalEC;
      float diffuse = max(0.0, dot(voxelNormal, czm_lightDirectionEC));
      float lighting = 0.5 + 0.5 * diffuse;
      vec4 baseColor = fsInput.metadata.color;
      vec3 finalColor = baseColor.rgb * lighting;
      if (fsInput.voxel.tileIndex == u_selectedTile && fsInput.voxel.sampleIndex == u_selectedSample) {
        finalColor = mix(finalColor, vec3(1.0, 1.0, 0.5), 0.6);
      }
      material.diffuse = finalColor;
      material.alpha = baseColor.a;
    }
  `,
      uniforms: {
        u_selectedTile: { type: UniformType.INT, value: -1 },
        u_selectedSample: { type: UniformType.INT, value: -1 }
      }
    })
)

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let boreholeEntities: Entity[] = []
let layerPrimitives: VoxelPrimitive[] = []
let corePrimitive: Primitive | undefined
let boreholes: Borehole[] = []
let centerTransform = Matrix4.IDENTITY
let grid: Grid = { gx: 12, gy: 12, gz: 16 }
let layerMap: Int32Array = new Int32Array(0)
let extent = { uMin: 0, uMax: 1, vMin: 0, vMax: 1, cU: 0.5, cV: 0.5 }
let onCanvasLeave = () => {}

let seed = 20260830
function rand(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}

function makeBoreholes(): Borehole[] {
  const holes: Borehole[] = []
  const base = [10, 20, 36, 52, 68]
  for (let r = 0; r < BORE_ROWS; r++) {
    for (let c = 0; c < BORE_COLS; c++) {
      if (r === 1 && c === 2) continue
      const u = 0.1 + ((c + 0.5) / BORE_COLS) * 0.8 + (rand() - 0.5) * 0.06
      const v = 0.1 + ((r + 0.5) / BORE_ROWS) * 0.8 + (rand() - 0.5) * 0.06
      const depths: number[] = []
      let prev = 0
      for (let k = 0; k < base.length; k++) {
        const wave = Math.sin(u * 9 + k * 1.7) * Math.cos(v * 7 + k * 0.9) * 3
        let d = base[k] + wave + (rand() - 0.5) * 6
        if (d < prev + 4) d = prev + 4
        depths.push(d)
        prev = d
      }
      holes.push({ u, v, depths })
    }
  }
  return holes
}

function idwDepth(u: number, v: number, layerIdx: number): number {
  const p = 3
  let wsum = 0
  let dsum = 0
  for (let i = 0; i < boreholes.length; i++) {
    const b = boreholes[i]
    const dx = u - b.u
    const dy = v - b.v
    const d2 = dx * dx + dy * dy
    const w = 1 / Math.pow(d2 + 1e-5, p / 2)
    wsum += w
    dsum += w * b.depths[layerIdx]
  }
  return dsum / wsum
}

function computeExtent(): void {
  let uMin = Infinity
  let uMax = -Infinity
  let vMin = Infinity
  let vMax = -Infinity
  for (const b of boreholes) {
    uMin = Math.min(uMin, b.u)
    uMax = Math.max(uMax, b.u)
    vMin = Math.min(vMin, b.v)
    vMax = Math.max(vMax, b.v)
  }
  const spanU = uMax - uMin
  const spanV = vMax - vMin
  const uMin2 = uMin - spanU * 0.1
  const uMax2 = uMax + spanU * 0.1
  const vMin2 = vMin - spanV * 0.1
  const vMax2 = vMax + spanV * 0.1
  extent = { uMin: uMin2, uMax: uMax2, vMin: vMin2, vMax: vMax2, cU: (uMin2 + uMax2) / 2, cV: (vMin2 + vMax2) / 2 }
}

function bodyWidth(): number {
  return (extent.uMax - extent.uMin) * SCALE_XY
}

function bodyDepth(): number {
  return (extent.vMax - extent.vMin) * SCALE_XY
}

function buildLayerMap(g: Grid): Int32Array {
  const { gx, gy, gz } = g
  const map = new Int32Array(gx * gy * gz)
  const surfaces = new Float32Array(4 * gx * gy)
  for (let y = 0; y < gy; y++) {
    for (let x = 0; x < gx; x++) {
      const u = extent.uMin + ((x + 0.5) / gx) * (extent.uMax - extent.uMin)
      const v = extent.vMin + ((y + 0.5) / gy) * (extent.vMax - extent.vMin)
      for (let k = 0; k < 4; k++) {
        surfaces[k * gx * gy + y * gx + x] = idwDepth(u, v, k)
      }
    }
  }
  for (let z = 0; z < gz; z++) {
    const depth = ((z + 0.5) / gz) * SCALE_Z
    for (let y = 0; y < gy; y++) {
      for (let x = 0; x < gx; x++) {
        const base = y * gx + x
        let layer = LAYERS.length - 1
        for (let k = 0; k < 4; k++) {
          if (depth < surfaces[k * gx * gy + base]) {
            layer = k
            break
          }
        }
        map[z * gy * gx + base] = layer
      }
    }
  }
  return map
}

function gridForStep(s: number): Grid {
  if (s <= 0.75) return { gx: 24, gy: 24, gz: 32 }
  if (s <= 1.25) return { gx: 16, gy: 16, gz: 24 }
  return { gx: 12, gy: 12, gz: 16 }
}

function buildTransform(offsetZ: number): Matrix4 {
  const center = Cartesian3.fromDegrees(CENTER_LON, CENTER_LAT, CENTER_HEIGHT)
  const enu = Transforms.eastNorthUpToFixedFrame(center)
  if (offsetZ === 0) return enu
  const translate = Matrix4.fromTranslation(new Cartesian3(0, 0, offsetZ), new Matrix4())
  return Matrix4.multiply(enu, translate, new Matrix4())
}

function buildShapeTransform(): Matrix4 {
  const h = SCALE_Z
  const translate = Matrix4.fromTranslation(new Cartesian3(0, 0, LIFT - h / 2), new Matrix4())
  const scale = Matrix4.fromScale(new Cartesian3(bodyWidth(), bodyDepth(), h), new Matrix4())
  return Matrix4.multiply(translate, scale, new Matrix4())
}

function buildProvider(layerIdx: number, shapeTransform: Matrix4): VoxelProvider {
  const { gx, gy, gz } = grid
  const provider = {
    shape: VoxelShapeType.BOX,
    dimensions: new Cartesian3(gx, gy, gz),
    names: ['color'],
    types: [MetadataType.VEC4],
    componentTypes: [MetadataComponentType.FLOAT32],
    availableLevels: 1,
    globalTransform: Matrix4.IDENTITY,
    shapeTransform,
    requestData: (options: { tileLevel?: number }): Promise<VoxelContent> => {
      const { tileLevel = 0 } = options
      if (tileLevel >= 1) return Promise.reject(new Error('No tiles beyond level 0'))
      const count = gx * gy * gz
      const dataColor = new Float32Array(count * 4)
      const color = Color.fromCssColorString(LAYERS[layerIdx].color)
      for (let zi = 0; zi < gz; zi++) {
        const mapZ = gz - 1 - zi
        for (let y = 0; y < gy; y++) {
          for (let x = 0; x < gx; x++) {
            const index = zi * gy * gx + y * gx + x
            const idx4 = index * 4
            if (layerMap[mapZ * gy * gx + y * gx + x] === layerIdx) {
              dataColor[idx4] = color.red
              dataColor[idx4 + 1] = color.green
              dataColor[idx4 + 2] = color.blue
              dataColor[idx4 + 3] = 1
            } else {
              dataColor[idx4] = 0
              dataColor[idx4 + 1] = 0
              dataColor[idx4 + 2] = 0
              dataColor[idx4 + 3] = 0
            }
          }
        }
      }
      return Promise.resolve(VoxelContent.fromMetadataArray([dataColor]))
    }
  }
  return provider as unknown as VoxelProvider
}

function rebuildLayers(): void {
  if (!viewer) return
  for (const p of layerPrimitives) viewer.scene.primitives.remove(p)
  layerPrimitives = []
  layerMap = buildLayerMap(grid)
  const shapeTransform = buildShapeTransform()
  for (let i = 0; i < LAYERS.length; i++) {
    const provider = buildProvider(i, shapeTransform)
    const primitive = new VoxelPrimitive({
      provider,
      customShader: layerShaders[i],
      modelMatrix: buildTransform(i * spacing.value)
    })
    primitive.nearestSampling = true
    primitive.stepSize = stepSize.value
    primitive.show = showAll.value && layerShow.value[i]
    viewer.scene.primitives.add(primitive)
    layerPrimitives.push(primitive)
  }
  clearPicked()
}

function buildCores(): void {
  if (!viewer) return
  if (corePrimitive) viewer.scene.primitives.remove(corePrimitive)
  const instances: GeometryInstance[] = []
  for (let i = 0; i < boreholes.length; i++) {
    const b = boreholes[i]
    const cx = (b.u - extent.cU) * SCALE_XY
    const cy = (b.v - extent.cV) * SCALE_XY
    for (let k = 0; k < b.depths.length; k++) {
      const top = k === 0 ? 0 : b.depths[k - 1]
      const bot = b.depths[k]
      const cylGeo = new CylinderGeometry({ length: bot - top, topRadius: 2, bottomRadius: 2 })
      const cz = LIFT - (top + bot) / 2
      instances.push(
        new GeometryInstance({
          geometry: cylGeo,
          modelMatrix: Matrix4.fromTranslation(new Cartesian3(cx, cy, cz), new Matrix4()),
          attributes: {
            color: ColorGeometryInstanceAttribute.fromColor(
              Color.fromCssColorString(LAYERS[k].color).withAlpha(0.85)
            )
          }
        })
      )
    }
  }
  corePrimitive = new Primitive({
    geometryInstances: instances,
    appearance: new PerInstanceColorAppearance({ flat: false, translucent: true }),
    modelMatrix: centerTransform,
    asynchronous: false,
    show: showBores.value
  })
  viewer.scene.primitives.add(corePrimitive)
}

function addBoreholeMarkers(): void {
  if (!viewer) return
  centerTransform = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(CENTER_LON, CENTER_LAT, CENTER_HEIGHT))
  for (let i = 0; i < boreholes.length; i++) {
    const b = boreholes[i]
    const local = new Cartesian3((b.u - extent.cU) * SCALE_XY, (b.v - extent.cV) * SCALE_XY, 0)
    const position = Matrix4.multiplyByPoint(centerTransform, local, new Cartesian3())
    const entity = viewer.entities.add({
      position,
      point: { pixelSize: 6, color: Color.fromCssColorString('#f5c542'), outlineColor: Color.BLACK, outlineWidth: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: {
        text: `ZK${String(i + 1).padStart(2, '0')}`,
        font: '11px sans-serif',
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        verticalOrigin: VerticalOrigin.BOTTOM,
        horizontalOrigin: HorizontalOrigin.CENTER,
        pixelOffset: new Cartesian2(0, -10),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })
    boreholeEntities.push(entity)
  }
}

function updateTransforms(): void {
  for (let i = 0; i < layerPrimitives.length; i++) {
    ;(layerPrimitives[i] as unknown as { modelMatrix: Matrix4 }).modelMatrix = buildTransform(i * spacing.value)
  }
}

function updateVisibility(): void {
  for (let i = 0; i < layerPrimitives.length; i++) {
    layerPrimitives[i].show = showAll.value && layerShow.value[i]
  }
  if (corePrimitive) corePrimitive.show = showBores.value
  for (const entity of boreholeEntities) entity.show = showBores.value
}

function clearPicked(): void {
  for (const s of layerShaders) {
    s.uniforms.u_selectedTile.value = -1
    s.uniforms.u_selectedSample.value = -1
  }
  pickedInfo.value = null
}

function onStepSizeChange(): void {
  grid = gridForStep(stepSize.value)
  rebuildLayers()
}

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    if (!viewer || viewer.isDestroyed()) return
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(CENTER_LON + 0.0009, CENTER_LAT - 0.0081, CENTER_HEIGHT + 1072),
      orientation: { heading: 0, pitch: CesiumMath.toRadians(-50), roll: 0 }
    })
    viewer.scene.globe.depthTestAgainstTerrain = false

    boreholes = makeBoreholes()
    computeExtent()
    grid = gridForStep(stepSize.value)
    rebuildLayers()
    addBoreholeMarkers()
    buildCores()

    handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((movement: { endPosition: Cartesian2 }) => {
      if (!viewer || viewer.isDestroyed()) return
      const picked = viewer.scene.pickVoxel(movement.endPosition)
      if (!picked || !picked.primitive) {
        clearPicked()
        return
      }
      const idx = layerPrimitives.indexOf(picked.primitive)
      if (idx < 0) {
        clearPicked()
        return
      }
      for (let k = 0; k < layerShaders.length; k++) {
        const on = k === idx
        layerShaders[k].uniforms.u_selectedTile.value = on ? picked.tileIndex : -1
        layerShaders[k].uniforms.u_selectedSample.value = on ? picked.sampleIndex : -1
      }
      const { gx, gy, gz } = grid
      const tz = Math.floor((picked.sampleIndex % (gx * gy * gz)) / (gx * gy))
      const depth = Number(((((gz - 1 - tz) + 0.5) / gz) * SCALE_Z).toFixed(1))
      pickedInfo.value = { name: LAYERS[idx].name, depth, layer: idx + 1 }
    }, ScreenSpaceEventType.MOUSE_MOVE)
    onCanvasLeave = () => clearPicked()
    viewer.scene.canvas.addEventListener('mouseleave', onCanvasLeave)
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

watch(spacing, () => updateTransforms())
watch(showAll, () => updateVisibility())
watch(showBores, () => updateVisibility())
watch(layerShow, () => updateVisibility(), { deep: true })

onBeforeUnmount(() => {
  if (handler && !handler.isDestroyed()) handler.destroy()
  handler = undefined
  viewer?.scene.canvas.removeEventListener('mouseleave', onCanvasLeave)
  for (const p of layerPrimitives) viewer?.scene.primitives.remove(p)
  layerPrimitives = []
  if (corePrimitive) viewer?.scene.primitives.remove(corePrimitive)
  corePrimitive = undefined
  if (viewer && !viewer.isDestroyed()) {
    for (const entity of boreholeEntities) viewer.entities.remove(entity)
  }
  boreholeEntities = []
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="ds-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">钻孔地层建模</div>
      <div class="row">
        <span class="row-label">显示整体地层</span>
        <button class="toggle" :class="{ on: showAll }" :aria-label="showAll ? '隐藏地层' : '显示地层'" @click="showAll = !showAll"><i></i></button>
      </div>
      <div class="row">
        <span class="row-label">钻孔岩芯（显隐）</span>
        <button class="toggle" :class="{ on: showBores }" :aria-label="showBores ? '隐藏钻孔岩芯' : '显示钻孔岩芯'" @click="showBores = !showBores"><i></i></button>
      </div>

      <div class="slider-row">
        <label>展开间距(m) <em>{{ spacing }}</em></label>
        <input type="range" min="0" max="10" step="0.1" v-model.number="spacing" />
      </div>
      <div class="slider-row">
        <label>步长（网格密度）<em>{{ stepSize }}</em></label>
        <input type="range" min="0.5" max="2" step="0.1" v-model.number="stepSize" @change="onStepSizeChange" />
      </div>

      <div class="layer-title">地层分层（点击显隐）</div>
      <div class="layer-list">
        <div v-for="(layer, idx) in LAYERS" :key="idx" class="layer-item" :class="{ off: !layerShow[idx] }" @click="layerShow[idx] = !layerShow[idx]">
          <span class="layer-dot" :style="{ background: layer.color }"></span>
          <span class="layer-name">{{ layer.name }}</span>
          <span class="layer-state">{{ layerShow[idx] ? '显示' : '隐藏' }}</span>
        </div>
      </div>

      <p class="hint">
        <b>建模范围：</b>地层范围取 19 处钻孔覆盖的最小外接矩形并四周外扩十分之一。<br />
        <b>垂向展示：</b>地层自地表上方 25m 起向下深探 80m，顶部凸出地表以便观察分层剖面。<br />
        <b>步长含义：</b>控制地层体素的网格细化程度。步长越小网格越密（最大 24×24×32），地层起伏细节越精细、渲染开销越高；步长越大网格越疏（最小 12×12×16）、渲染越快。<br />
        <b>展开间距：</b>层间垂直错开的距离（米），0 为原始位置，0.1 步进微调。<br />
        地层以 5 个体素立方体光线步进渲染（每层一个，IDW 反距离加权插值定层归属），逐像素采样体素颜色，替代几何网格离散显示。<br />
        钻孔岩芯（ZK01~ZK19）为各孔实测分层柱状体，支持整体显隐；鼠标移动到地层上会高亮拾取体素并显示岩性与深度。
      </p>
    </div>

    <div v-if="pickedInfo" class="pick-panel">
      <div class="pick-title">钻孔地层信息</div>
      <div class="pick-row"><span>岩性</span><b>{{ pickedInfo.name }}</b></div>
      <div class="pick-row"><span>深度</span><b>{{ pickedInfo.depth }} m</b></div>
      <div class="pick-row"><span>层位</span><b>第 {{ pickedInfo.layer }} 层</b></div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.ds-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 272px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.88); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; max-height: calc(100% - 24px); overflow-y: auto; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.row { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
.row-label { color: #c3d5e8; font-size: 11px; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(157, 188, 224, 0.35); cursor: pointer; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e7f5f8; transition: transform 0.2s; }
.toggle.on { background: #2f80ed; }
.toggle.on i { transform: translateX(18px); }
.slider-row { margin-top: 9px; }
.slider-row label { display: flex; justify-content: space-between; align-items: center; color: #c3d5e8; font-size: 11px; }
.slider-row label em { font-style: normal; color: #65d3eb; font-weight: 700; }
.slider-row input[type="range"] { width: 100%; margin: 3px 0 0; accent-color: #2f80ed; background: transparent; }
.layer-title { margin-top: 12px; font-size: 11px; font-weight: 700; color: #c3d5e8; }
.layer-list { margin-top: 6px; }
.layer-item { display: flex; align-items: center; gap: 8px; padding: 5px 8px; margin-top: 4px; border: 1px solid rgba(157, 188, 224, 0.22); border-radius: 6px; background: rgba(24, 52, 92, 0.5); cursor: pointer; transition: opacity 0.2s; }
.layer-item.off { opacity: 0.45; }
.layer-dot { width: 10px; height: 10px; border-radius: 50%; flex: 0 0 auto; }
.layer-name { flex: 1; font-size: 11px; color: #dce8f5; }
.layer-state { font-size: 10px; color: #65d3eb; }
.pick-panel { position: absolute; top: 12px; left: 12px; z-index: 10; width: 168px; padding: 9px 11px; border: 1px solid rgba(101, 211, 235, 0.4); border-radius: 8px; background: rgba(8, 24, 48, 0.9); backdrop-filter: blur(6px); font-size: 11px; color: #dce8f5; box-sizing: border-box; }
.pick-title { font-size: 12px; font-weight: 700; color: #65d3eb; letter-spacing: 0.04em; }
.pick-row { display: flex; justify-content: space-between; align-items: center; margin-top: 5px; }
.pick-row span { color: #c3d5e8; }
.pick-row b { color: #ffffff; font-weight: 700; }
.hint { margin: 12px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.55; }
.hint b { color: #9fb3cc; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
