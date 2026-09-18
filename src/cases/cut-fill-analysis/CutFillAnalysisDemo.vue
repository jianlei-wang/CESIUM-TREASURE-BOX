<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  GridMaterialProperty,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  Primitive,
  sampleTerrainMostDetailed,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  loadWorldTerrain,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { pickPosition } from '../measure-lib/pick'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const designHeight = ref(0)
const precision = ref(256)
const precisionOptions = [256, 512, 1024, 2048]
const showDesignPlane = ref(true)
const planeOpacity = ref(0.45)
const showMode = ref<'all' | 'fill' | 'cut'>('all')
const isLoaded = ref(false)
const isAnalyzing = ref(false)
const drawing = ref(false)
const vertexCount = ref(0)
const effectiveDesignHeight = ref(0)

const result = ref({
  allArea: '',
  cutArea: '',
  cutVolume: '',
  fillArea: '',
  fillVolume: '',
  noArea: ''
})

const ORIGINAL_POSITIONS = [
  new Cartesian3(-2409728.6420393116, 4694838.793290997, 3570221.295666795),
  new Cartesian3(-2409788.2788523836, 4694808.716559992, 3570220.598452356),
  new Cartesian3(-2409813.389689466, 4694859.279606352, 3570137.7191554685),
  new Cartesian3(-2409755.7791936737, 4694886.737790491, 3570140.4776008143)
]

type Solid = { top: Cartesian3[]; type: 'fill' | 'cut' | 'none' }

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let manualPositions: Cartesian3[] = []
let previewEntity: { id?: string } | undefined
let volumePrimitive: Primitive | undefined
let lastSolids: Solid[] | undefined
let designPlaneEntity: { id?: string } | undefined

function triangleArea(cA: Cartographic, cB: Cartographic, cC: Cartographic): number {
  const pA = Cartesian3.fromRadians(cA.longitude, cA.latitude, 0)
  const pB = Cartesian3.fromRadians(cB.longitude, cB.latitude, 0)
  const pC = Cartesian3.fromRadians(cC.longitude, cC.latitude, 0)
  const a = Cartesian3.distance(pA, pB)
  const b = Cartesian3.distance(pB, pC)
  const c = Cartesian3.distance(pC, pA)
  const s = (a + b + c) / 2
  return Math.sqrt(s * (s - a) * (s - b) * (s - c))
}

function colorForType(type: 'fill' | 'cut' | 'none'): Color {
  if (type === 'fill') return Color.fromCssColorString('#37c870').withAlpha(0.55)
  if (type === 'cut') return Color.fromCssColorString('#ff8c2e').withAlpha(0.55)
  return Color.fromCssColorString('#8a9bb0').withAlpha(0.35)
}

function removeVolume(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (volumePrimitive) {
    viewer.scene.primitives.remove(volumePrimitive)
    volumePrimitive = undefined
  }
  viewer.entities.removeById('fillCutBoundary')
  viewer.entities.removeById('designPlane')
  designPlaneEntity = undefined
  lastSolids = undefined
}

function removePreview(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (previewEntity?.id) viewer.entities.removeById(previewEntity.id)
  previewEntity = undefined
}

function updatePreview(cursorPosition?: Cartesian3): void {
  if (!viewer || viewer.isDestroyed()) return
  removePreview()
  if (manualPositions.length === 0) return
  const positions = [...manualPositions]
  if (cursorPosition) positions.push(cursorPosition)
  if (positions.length >= 3) {
    previewEntity = viewer.entities.add({
      polygon: {
        hierarchy: new PolygonHierarchy(positions),
        material: Color.YELLOW.withAlpha(0.22),
        outline: true,
        outlineColor: Color.YELLOW.withAlpha(0.85),
        outlineWidth: 2,
        perPositionHeight: true
      }
    }) as unknown as { id?: string }
  } else {
    previewEntity = viewer.entities.add({
      polyline: {
        positions,
        width: 3,
        material: Color.YELLOW,
        clampToGround: true
      }
    }) as unknown as { id?: string }
  }
}

function buildVolumeVisual(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (volumePrimitive) {
    viewer.scene.primitives.remove(volumePrimitive)
    volumePrimitive = undefined
  }
  if (!lastSolids || lastSolids.length === 0) return
  const selected = showMode.value === 'all' ? lastSolids : lastSolids.filter((s) => s.type === showMode.value)
  if (selected.length === 0) return
  const instances = selected.map(
    (solid) =>
      new GeometryInstance({
        geometry: new PolygonGeometry({
          polygonHierarchy: new PolygonHierarchy(solid.top),
          perPositionHeight: true,
          extrudedHeight: effectiveDesignHeight.value,
          vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT
        }),
        attributes: {
          color: ColorGeometryInstanceAttribute.fromColor(colorForType(solid.type))
        }
      })
  )
  volumePrimitive = viewer.scene.primitives.add(
    new Primitive({
      geometryInstances: instances,
      appearance: new PerInstanceColorAppearance({ flat: true, translucent: true })
    })
  )
}

function syncDesignPlane(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (!designPlaneEntity?.id) return
  const entity = viewer.entities.getById(designPlaneEntity.id)
  if (!entity) return
  entity.show = showDesignPlane.value
  const material = entity.polygon?.material
  if (material instanceof GridMaterialProperty && material.color) {
    ;(material.color as unknown as { setValue: (value: Color) => void }).setValue(
      Color.fromCssColorString('#53d7ff').withAlpha(planeOpacity.value)
    )
  }
}

watch([showDesignPlane, planeOpacity], syncDesignPlane)
watch(showMode, buildVolumeVisual)

async function runAnalysis(): Promise<void> {
  if (!viewer || viewer.isDestroyed() || !isLoaded.value || isAnalyzing.value) return
  const positions = manualPositions.length >= 3 ? [...manualPositions] : ORIGINAL_POSITIONS
  isAnalyzing.value = true
  statusMessage.value = ''
  await new Promise((resolve) => setTimeout(resolve, 50))
  try {
    const granularity = Math.PI / Math.pow(2, 11) / precision.value
    const geometry = PolygonGeometry.fromPositions({
      positions,
      vertexFormat: PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
      granularity
    })
    const geom = PolygonGeometry.createGeometry(geometry)
    if (!geom) throw new Error('无法生成采样网格，请检查区域')

    const posAttr = geom.attributes.position
    if (!posAttr) throw new Error('采样网格缺少位置属性')
    const values = posAttr.values
    const indices = geom.indices
    if (!indices) throw new Error('采样网格索引无效')
    const cartos: Cartographic[] = []
    for (let i = 0; i < values.length; i += 3) {
      cartos.push(Cartographic.fromCartesian(new Cartesian3(values[i], values[i + 1], values[i + 2])))
    }

    const tris: Array<{ ia: number; ib: number; ic: number }> = []
    for (let i = 0; i < indices.length; i += 3) {
      tris.push({ ia: indices[i], ib: indices[i + 1], ic: indices[i + 2] })
    }
    if (tris.length === 0) throw new Error('采样网格为空，请适当降低精度')

    let heights: number[] = []
    const terrainProvider = viewer.terrainProvider as unknown as { _layers?: unknown[] } | undefined
    if (terrainProvider?._layers) {
      const sampled = await sampleTerrainMostDetailed(viewer.terrainProvider, cartos)
      heights = sampled.map((c) => c.height)
    } else {
      heights = cartos.map((c) => viewer!.scene.globe.getHeight(c) ?? 0)
    }

    const meanHeight = heights.reduce((sum, h) => sum + h, 0) / heights.length
    const design = designHeight.value > 0 ? designHeight.value : meanHeight
    effectiveDesignHeight.value = Number(design.toFixed(2))

    let cutArea = 0
    let cutVolume = 0
    let fillArea = 0
    let fillVolume = 0
    let noArea = 0

    const solids: Solid[] = []
    for (let i = 0; i < tris.length; i += 1) {
      const { ia, ib, ic } = tris[i]
      const ha = heights[ia]
      const hb = heights[ib]
      const hc = heights[ic]
      const cA = cartos[ia]
      const cB = cartos[ib]
      const cC = cartos[ic]
      const area = triangleArea(cA, cB, cC)
      const mean = (ha + hb + hc) / 3
      let type: 'fill' | 'cut' | 'none' = 'none'
      if (mean < design) {
        type = 'fill'
        fillArea += area
        fillVolume += area * (design - mean)
      } else if (mean > design) {
        type = 'cut'
        cutArea += area
        cutVolume += area * (mean - design)
      } else {
        noArea += area
      }
      solids.push({
        type,
        top: [
          Cartesian3.fromRadians(cA.longitude, cA.latitude, ha),
          Cartesian3.fromRadians(cB.longitude, cB.latitude, hb),
          Cartesian3.fromRadians(cC.longitude, cC.latitude, hc)
        ]
      })
    }

    const allArea = cutArea + fillArea + noArea
    result.value = {
      allArea: allArea.toFixed(2),
      cutArea: cutArea.toFixed(2),
      cutVolume: cutVolume.toFixed(2),
      fillArea: fillArea.toFixed(2),
      fillVolume: fillVolume.toFixed(2),
      noArea: noArea.toFixed(2)
    }

    lastSolids = solids
    buildVolumeVisual()

    viewer.entities.removeById('designPlane')
    designPlaneEntity = viewer.entities.add({
      id: 'designPlane',
      polygon: {
        hierarchy: new PolygonHierarchy(positions),
        height: design,
        material: new GridMaterialProperty({
          color: Color.fromCssColorString('#53d7ff').withAlpha(planeOpacity.value),
          cellAlpha: 0.3,
          lineCount: new Cartesian2(24, 24)
        }),
        outline: true,
        outlineColor: Color.WHITE.withAlpha(0.9),
        outlineWidth: 1
      }
    }) as unknown as { id?: string }

    viewer.entities.removeById('fillCutBoundary')
    viewer.entities.add({
      id: 'fillCutBoundary',
      polyline: {
        positions,
        width: 2,
        material: Color.CYAN,
        clampToGround: true
      }
    })
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    isAnalyzing.value = false
  }
}

function finishDrawing(): void {
  if (!drawing.value) return
  drawing.value = false
  if (manualPositions.length < 3) {
    manualPositions = []
    vertexCount.value = 0
    removePreview()
    statusMessage.value = '分析区域至少需要 3 个点'
    return
  }
  removePreview()
  statusMessage.value = ''
  void runAnalysis()
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !drawing.value || isAnalyzing.value) return
  const pos = pickPosition(viewer.scene, event.position)
  if (!pos) return
  manualPositions.push(pos)
  vertexCount.value = manualPositions.length
  updatePreview()
}

function onMouseMove(event: { endPosition: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !drawing.value || manualPositions.length === 0) return
  const pos = pickPosition(viewer.scene, event.endPosition)
  if (!pos) return
  updatePreview(pos)
}

function startDrawing(): void {
  if (!viewer || viewer.isDestroyed() || !isLoaded.value || isAnalyzing.value) return
  if (drawing.value) {
    finishDrawing()
    return
  }
  manualPositions = []
  vertexCount.value = 0
  drawing.value = true
  statusMessage.value = ''
}

function clearAnalysis(): void {
  if (!viewer || viewer.isDestroyed()) return
  removeVolume()
  result.value = {
    allArea: '',
    cutArea: '',
    cutVolume: '',
    fillArea: '',
    fillVolume: '',
    noArea: ''
  }
  effectiveDesignHeight.value = 0
}

onMounted(async () => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '正在加载地形…' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.scene.globe.maximumScreenSpaceError = 2
    statusMessage.value = '正在加载 Cesium World Terrain...'
    try {
      await loadWorldTerrain(viewer)
    } catch {
      statusMessage.value = '地形加载失败，已降级为全球椭球体。'
    }
    if (!viewer || viewer.isDestroyed()) return

    viewer.camera.setView({
      destination: ORIGINAL_POSITIONS[0].clone()
    })

    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((event: { position: Cartesian2 }) => onLeftClick(event), ScreenSpaceEventType.LEFT_CLICK)
    handler.setInputAction((event: { endPosition: Cartesian2 }) => onMouseMove(event), ScreenSpaceEventType.MOUSE_MOVE)
    handler.setInputAction(() => finishDrawing(), ScreenSpaceEventType.RIGHT_CLICK)
    handler.setInputAction(() => finishDrawing(), ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

    isLoaded.value = true
    void runAnalysis()
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  handler?.destroy()
  handler = undefined
  if (viewer && !viewer.isDestroyed()) {
    removePreview()
    removeVolume()
  }
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="cutfill-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">填挖方分析</div>

      <div class="section-title">分析参数</div>
      <div class="control-row">
        <span class="row-label">设计标高</span>
        <input v-model.number="designHeight" type="number" min="0" step="1" :disabled="!isLoaded" />
        <span class="row-unit">m</span>
      </div>
      <p class="row-note">填 0 时自动采用采样区域的平均地形高度</p>
      <div class="control-row">
        <span class="row-label">采样精度</span>
        <select v-model.number="precision" :disabled="!isLoaded">
          <option v-for="p in precisionOptions" :key="p" :value="p">{{ p }}</option>
        </select>
      </div>
      <p class="row-note">精度越高三角形网格越细，计算耗时越长</p>

      <button class="action-button primary" :disabled="!isLoaded || isAnalyzing" @click="runAnalysis">
        {{ isAnalyzing ? '分析中…' : '填挖分析' }}
      </button>
      <button
        class="action-button accent"
        :disabled="!isLoaded || isAnalyzing"
        @click="startDrawing"
      >
        {{ drawing ? '闭合区域' : '绘制分析区域' }}
      </button>
      <button class="action-button danger" :disabled="!isLoaded" @click="clearAnalysis">清除结果</button>

      <p v-if="drawing" class="result">
        {{ vertexCount === 0 ? '在地图上单击依次采集顶点，右键或双击闭合区域' : `已采集 ${vertexCount} 个顶点，右键或双击闭合` }}
      </p>

      <template v-if="result.allArea !== ''">
        <div class="section-title">分析结果（设计标高 {{ effectiveDesignHeight }} m）</div>
        <div class="result-grid">
          <div class="result-item"><span>总分析面积</span><b>{{ result.allArea }} ㎡</b></div>
          <div class="result-item fill"><span>填方面积</span><b>{{ result.fillArea }} ㎡</b></div>
          <div class="result-item fill"><span>填方体积</span><b>{{ result.fillVolume }} m³</b></div>
          <div class="result-item cut"><span>挖方面积</span><b>{{ result.cutArea }} ㎡</b></div>
          <div class="result-item cut"><span>挖方体积</span><b>{{ result.cutVolume }} m³</b></div>
          <div class="result-item"><span>无须填挖面积</span><b>{{ result.noArea }} ㎡</b></div>
        </div>

        <div class="section-title">结果视图</div>
        <div class="mode-row">
          <button
            v-for="m in (['all', 'fill', 'cut'] as const)"
            :key="m"
            class="mode-button"
            :class="{ active: showMode === m }"
            :disabled="!isLoaded"
            @click="showMode = m"
          >
            {{ m === 'all' ? '全部' : m === 'fill' ? '仅填方' : '仅挖方' }}
          </button>
        </div>
        <div class="control-row">
          <span class="row-label">标高线平面</span>
          <label class="switch-row">
            <input v-model="showDesignPlane" type="checkbox" :disabled="!isLoaded" />
            <span>显示</span>
          </label>
        </div>
        <div class="control-row">
          <span class="row-label">平面透明度</span>
          <input v-model.number="planeOpacity" type="range" min="0" max="1" step="0.05" :disabled="!isLoaded || !showDesignPlane" />
          <span class="row-value">{{ Math.round(planeOpacity * 100) }}%</span>
        </div>
      </template>

      <p class="hint">
        绘制多边形区域后，按精度采样生成三角网格（TIN），逐三角面比较地形高度与设计标高，累加填挖面积与体积。
      </p>
      <p class="hint2">
        绿色为填方体、橙色为挖方体，三棱柱底面为设计标高平面。默认使用演示区域，也可点击「绘制分析区域」自定义。
      </p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.cutfill-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 268px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-unit { flex: 0 0 14px; text-align: right; color: #9fb8d4; font-size: 10px; }
.row-value { flex: 0 0 38px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.row-note { margin: 0 0 6px; font-size: 10px; color: #7f96b3; line-height: 1.4; }
.control-row input[type="number"] { flex: 1; min-width: 0; width: 70px; height: 22px; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 4px; background: rgba(20, 43, 80, 0.7); color: #dce8f5; font-size: 11px; padding: 0 6px; box-sizing: border-box; }
.control-row select { flex: 1; min-width: 0; height: 22px; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 4px; background: rgba(20, 43, 80, 0.7); color: #dce8f5; font-size: 11px; padding: 0 4px; box-sizing: border-box; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.switch-row { display: flex; align-items: center; gap: 4px; color: #c3d5e8; font-size: 11px; cursor: pointer; }
.switch-row input { accent-color: #2f80ed; }
.action-button { width: 100%; height: 28px; margin-top: 10px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; background: #2f80ed; color: #eef4ff; }
.action-button.accent { margin-top: 6px; background: #8a6d1a; color: #fff3d6; }
.action-button.danger { margin-top: 6px; background: #4a5a72; color: #ffd6d6; }
.action-button:disabled { opacity: 0.5; cursor: not-allowed; }
.result { margin: 10px 0 0; padding: 6px 8px; border-radius: 4px; font-size: 12px; font-weight: 700; background: rgba(250, 173, 20, 0.18); color: #ffd666; text-align: center; }
.result-grid { margin-top: 4px; display: grid; gap: 4px; }
.result-item { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; border-radius: 4px; background: rgba(23, 48, 88, 0.55); font-size: 11px; }
.result-item span { color: #9fb8d4; }
.result-item b { color: #eaf3ff; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; }
.result-item.fill b { color: #5fe08a; }
.result-item.cut b { color: #ffab5e; }
.mode-row { display: flex; gap: 4px; margin-top: 4px; }
.mode-button { flex: 1; height: 24px; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 4px; background: rgba(20, 43, 80, 0.55); color: #9fb8d4; font-size: 11px; cursor: pointer; }
.mode-button.active { background: #2f80ed; color: #eef4ff; border-color: #2f80ed; }
.mode-button:disabled { opacity: 0.5; cursor: not-allowed; }
.hint { margin: 10px 0 0; font-size: 10px; color: #9fb8d4; line-height: 1.5; }
.hint2 { margin: 4px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
