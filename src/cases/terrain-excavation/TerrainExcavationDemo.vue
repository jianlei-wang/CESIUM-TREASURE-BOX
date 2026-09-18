<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  ClippingPolygon,
  ClippingPolygonCollection,
  Color,
  ImageMaterialProperty,
  Math as CesiumMath,
  PolygonHierarchy,
  sampleTerrainMostDetailed,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer
} from 'cesium'
import terrainSideUrl from './terrain-side.jpg?url'
import terrainTopUrl from './terrain-top.jpg?url'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  loadWorldTerrain,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { pickPosition } from '../measure-lib/pick'

type ExcavateConfig = {
  positions: Cartesian3[]
  height: number
  bottom: string
  side: string
}

type LonLatZ = { x: number; y: number; z: number }

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const depth = ref(30)
const isExcavating = ref(false)
const isLoaded = ref(false)
const drawing = ref(false)
const vertexCount = ref(0)

const ORIGINAL_POSITIONS = [
  new Cartesian3(-2409728.6420393116, 4694838.793290997, 3570221.295666795),
  new Cartesian3(-2409788.2788523836, 4694808.716559992, 3570220.598452356),
  new Cartesian3(-2409813.389689466, 4694859.279606352, 3570137.7191554685),
  new Cartesian3(-2409755.7791936737, 4694886.737790491, 3570140.4776008143)
]

let viewer: Viewer | undefined
let bottomImage: HTMLImageElement | undefined
let sideImage: HTMLImageElement | undefined
let handler: ScreenSpaceEventHandler | undefined
let manualPositions: Cartesian3[] = []
let previewEntity: { id?: string } | undefined

function excavate(config: ExcavateConfig): void {
  if (!viewer || viewer.isDestroyed()) return
  const ellipsoid = viewer.scene.globe.ellipsoid

  const arr = config.positions
  const nArr: LonLatZ[] = []
  const nArr2: LonLatZ[] = []

  arr.forEach((element) => {
    const carto = Cartographic.fromCartesian(element)
    const height = Number(carto.height.toFixed(2))
    const lng = CesiumMath.toDegrees(carto.longitude)
    const lat = CesiumMath.toDegrees(carto.latitude)
    nArr.push({ x: lng, y: lat, z: height })
    nArr2.push({ x: lng, y: lat, z: height })
  })

  const first = arr[0]
  const firstCarto = Cartographic.fromCartesian(first)
  nArr2.push({ x: CesiumMath.toDegrees(firstCarto.longitude), y: CesiumMath.toDegrees(firstCarto.latitude), z: Number(firstCarto.height.toFixed(2)) })

  viewer.scene.globe.clippingPolygons = new ClippingPolygonCollection({
    polygons: [
      new ClippingPolygon({
        positions: config.positions
      })
    ]
  })

  viewer.entities.removeById('entityDM')
  viewer.entities.removeById('entityDMBJ')

  const hhh = nArr.map((element) => element.z).sort((a, b) => a - b)
  const minHeight = hhh[0] - config.height
  const nar = nArr.flatMap((element) => [element.x, element.y])

  viewer.entities.add({
    id: 'entityDM',
    polygon: {
      hierarchy: Cartesian3.fromDegreesArray(nar),
      material: new ImageMaterialProperty({
        image: bottomImage as unknown as string,
        color: Color.fromCssColorString('#cbc6c2'),
        repeat: new Cartesian2(30, 30)
      }),
      height: minHeight,
      outline: true,
      outlineColor: Color.OLIVE,
      outlineWidth: 1
    }
  })

  const maximumHeightsARR: number[] = []
  const minimumHeights: number[] = []
  const terrainSamplePositions: Cartographic[] = []
  const nar22: number[] = []
  const length = 2048

  nArr2.forEach((element, index) => {
    const next = index < nArr2.length - 1 ? nArr2[index + 1] : nArr2[0]
    const startLon = CesiumMath.toRadians(element.x)
    const endLon = CesiumMath.toRadians(next.x)
    const starty = CesiumMath.toRadians(element.y)
    const endy = CesiumMath.toRadians(next.y)
    for (let i = 0; i < length; i++) {
      const t = i / (length - 1)
      const x = CesiumMath.lerp(element.x, next.x, t)
      const y = CesiumMath.lerp(element.y, next.y, t)
      const lon = CesiumMath.lerp(startLon, endLon, t)
      const lat = CesiumMath.lerp(starty, endy, t)
      terrainSamplePositions.push(new Cartographic(lon, lat))
      nar22.push(x)
      nar22.push(y)
    }
  })

  const terrainProvider = viewer.terrainProvider as unknown as { _layers?: unknown[] }
  if (terrainProvider._layers) {
    Promise.all([sampleTerrainMostDetailed(viewer.terrainProvider, terrainSamplePositions)])
      .then((results) => {
        if (!viewer || viewer.isDestroyed()) return
        const samples = results[0]
        for (let index = 0; index < samples.length; index++) {
          maximumHeightsARR.push(samples[index].height)
          minimumHeights.push(minHeight)
        }
        viewer.entities.add({
          id: 'entityDMBJ',
          wall: {
            positions: Cartesian3.fromDegreesArray(nar22),
            maximumHeights: maximumHeightsARR,
            minimumHeights: minimumHeights,
            material: new ImageMaterialProperty({
              image: sideImage as unknown as string,
              repeat: new Cartesian2(30, 30)
            })
          }
        })
      })
  } else {
    for (let index = 0; index < terrainSamplePositions.length; index++) {
      maximumHeightsARR.push(0)
      minimumHeights.push(minHeight)
    }
    viewer.entities.add({
      id: 'entityDMBJ',
      wall: {
        positions: Cartesian3.fromDegreesArray(nar22),
        maximumHeights: maximumHeightsARR,
        minimumHeights: minimumHeights,
        material: new ImageMaterialProperty({
          image: sideImage as unknown as string,
          repeat: new Cartesian2(30, 30)
        })
      }
    })
  }
}

function clearExcavation(): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.entities.removeById('entityDM')
  viewer.entities.removeById('entityDMBJ')
  ;(viewer.scene.globe as unknown as { clippingPolygons?: ClippingPolygonCollection }).clippingPolygons = undefined
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
        clampToGround: false
      }
    }) as unknown as { id?: string }
  }
}

function finishDrawing(): void {
  if (!drawing.value) return
  drawing.value = false
  if (manualPositions.length < 3) {
    manualPositions = []
    vertexCount.value = 0
    removePreview()
    statusMessage.value = '开挖区域至少需要 3 个点'
    return
  }
  removePreview()
  statusMessage.value = ''
  runExcavation()
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !drawing.value) return
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
  if (!viewer || viewer.isDestroyed() || !isLoaded.value) return
  if (drawing.value) {
    finishDrawing()
    return
  }
  manualPositions = []
  vertexCount.value = 0
  drawing.value = true
  statusMessage.value = ''
}

function runExcavation(): void {
  if (!viewer || viewer.isDestroyed() || !isLoaded.value) return
  isExcavating.value = true
  const positions = manualPositions.length >= 3 ? [...manualPositions] : ORIGINAL_POSITIONS
  setTimeout(() => {
    if (!viewer || viewer.isDestroyed()) return
    excavate({
      positions,
      height: depth.value,
      bottom: terrainTopUrl,
      side: terrainSideUrl
    })
    isExcavating.value = false
    if (manualPositions.length < 3) statusMessage.value = ''
  }, 50)
}

async function loadImages(): Promise<void> {
  bottomImage = await loadImage(terrainTopUrl)
  sideImage = await loadImage(terrainSideUrl)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('纹理图片加载失败'))
    img.src = src
  })
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
    viewer.scene.globe.depthTestAgainstTerrain = true
    viewer.scene.globe.maximumScreenSpaceError = 2
    statusMessage.value = '正在加载 Cesium World Terrain...'
    try {
      await loadWorldTerrain(viewer)
    } catch {
      statusMessage.value = '地形加载失败，已降级为全球椭球体。'
    }
    if (!viewer || viewer.isDestroyed()) return

    await loadImages()
    viewer.camera.setView({
      destination: ORIGINAL_POSITIONS[0].clone()
    })

    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((event: { position: Cartesian2 }) => onLeftClick(event), ScreenSpaceEventType.LEFT_CLICK)
    handler.setInputAction((event: { endPosition: Cartesian2 }) => onMouseMove(event), ScreenSpaceEventType.MOUSE_MOVE)
    handler.setInputAction(() => finishDrawing(), ScreenSpaceEventType.RIGHT_CLICK)
    handler.setInputAction(() => finishDrawing(), ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

    isLoaded.value = true
    runExcavation()
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  handler?.destroy()
  handler = undefined
  if (viewer && !viewer.isDestroyed()) {
    removePreview()
    viewer.entities.removeById('entityDM')
    viewer.entities.removeById('entityDMBJ')
    ;(viewer.scene.globe as unknown as { clippingPolygons?: ClippingPolygonCollection }).clippingPolygons = undefined
  }
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="excavation-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">地形开挖</div>

      <div class="section-title">开挖参数</div>
      <div class="control-row">
        <span class="row-label">开挖深度</span>
        <input v-model.number="depth" type="range" min="5" max="100" step="5" :disabled="!isLoaded" />
        <span class="row-value">{{ depth }} m</span>
      </div>

      <button class="action-button primary" :disabled="!isLoaded || isExcavating" @click="runExcavation">
        {{ isExcavating ? '开挖中…' : '重新开挖' }}
      </button>
      <button
        class="action-button accent"
        :disabled="!isLoaded || isExcavating"
        @click="startDrawing"
      >
        {{ drawing ? '闭合区域' : '绘制开挖区域' }}
      </button>
      <button class="action-button danger" :disabled="!isLoaded" @click="clearExcavation">清除开挖</button>

      <p v-if="drawing" class="result">
        {{ vertexCount === 0 ? '在地图上单击依次采集顶点，右键或双击闭合区域' : `已采集 ${vertexCount} 个顶点，右键或双击闭合` }}
      </p>

      <p class="hint">
        采用 Globe ClippingPolygons 裁剪地形 + 底部 Polygon + 四壁 Wall 的开挖方案；深度可调，侧壁纹理采样真实地形高度。
      </p>
      <p class="hint2">
        默认使用演示区域，也可点击「绘制开挖区域」在地图上单击采集顶点、右键或双击闭合后自动开挖。
      </p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.excavation-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 268px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 42px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.action-button { width: 100%; height: 28px; margin-top: 10px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; background: #2f80ed; color: #eef4ff; }
.action-button.accent { margin-top: 6px; background: #8a6d1a; color: #fff3d6; }
.action-button.danger { margin-top: 6px; background: #4a5a72; color: #ffd6d6; }
.action-button:disabled { opacity: 0.5; cursor: not-allowed; }
.result { margin: 10px 0 0; padding: 6px 8px; border-radius: 4px; font-size: 12px; font-weight: 700; background: rgba(250, 173, 20, 0.18); color: #ffd666; text-align: center; }
.hint { margin: 8px 0 0; font-size: 10px; color: #9fb8d4; line-height: 1.5; }
.hint2 { margin: 4px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
