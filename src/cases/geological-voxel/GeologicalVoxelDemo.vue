<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  CustomShader,
  Color,
  LabelStyle,
  Matrix4,
  MetadataComponentType,
  MetadataType,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Transforms,
  UniformType,
  VerticalOrigin,
  VoxelContent,
  VoxelPrimitive,
  VoxelShapeType,
  Math as CesiumMath,
  type Entity,
  type VoxelCell,
  type VoxelProvider,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, type SceneCallbacks } from '../../lib/cesium-scene'

const CONFIG = {
  longitude: 110.0,
  latitude: 35.0,
  height: 1200,
  width: 5000,
  depth: 4000,
  heightZ: 3000,
  nx: 24,
  ny: 24,
  nz: 24
}

type LithoPalette = { name: string; r: number; g: number; b: number }

const PALETTE: Record<number, LithoPalette> = {
  1: { name: '表土层', r: 139 / 255, g: 69 / 255, b: 19 / 255 },
  2: { name: '砂岩', r: 210 / 255, g: 180 / 255, b: 140 / 255 },
  3: { name: '页岩', r: 192 / 255, g: 192 / 255, b: 192 / 255 },
  4: { name: '石灰岩', r: 128 / 255, g: 128 / 255, b: 128 / 255 },
  5: { name: '花岗岩', r: 105 / 255, g: 105 / 255, b: 105 / 255 },
  6: { name: '基岩', r: 75 / 255, g: 0 / 255, b: 130 / 255 }
}

const LAYERS = [
  { name: '① 表土层', color: '#8B4513' },
  { name: '② 砂岩', color: '#D2B48C' },
  { name: '③ 页岩', color: '#C0C0C0' },
  { name: '④ 石灰岩', color: '#808080' },
  { name: '⑤ 花岗岩', color: '#696969' },
  { name: '⑥ 基岩', color: '#4B0082' }
]

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在初始化…')
const layerVisible = ref<boolean[]>(LAYERS.map(() => true))
const opacity = ref(0.85)
const stepSize = ref(1)
const sse = ref(16)
const clip = reactive({ bottom: 0, top: 100, x: 0, y: 0 })
const rotating = ref(false)
const pickCode = ref<number | null>(null)
const pickName = ref('')
const pickStatus = ref('')
const pickX = ref(0)
const pickY = ref(0)
const pickZ = ref(0)
const showBoreholes = ref(true)

type PrecisionKey = 'low' | 'medium' | 'high'

const PRECISION_PRESETS: Record<PrecisionKey, { label: string; stepSize: number; sse: number }> = {
  low: { label: '低', stepSize: 2, sse: 28 },
  medium: { label: '中', stepSize: 1, sse: 16 },
  high: { label: '高', stepSize: 0.5, sse: 8 }
}

const PRECISION_OPTIONS = (Object.keys(PRECISION_PRESETS) as PrecisionKey[]).map((key) => ({
  key,
  ...PRECISION_PRESETS[key]
}))

const activePrecision = computed<PrecisionKey | undefined>(() =>
  PRECISION_OPTIONS.find(
    (option) => option.stepSize === stepSize.value && option.sse === sse.value
  )?.key
)

let viewer: Viewer | undefined
let voxelPrimitive: VoxelPrimitive | undefined
let handler: ScreenSpaceEventHandler | undefined
let removeTick: (() => void) | undefined
let boreholeEntities: Entity[] = []

function codeAt(x: number, y: number, z: number): number {
  const z01 = z / (CONFIG.nz - 1)
  const undulation = 0.08 * Math.sin(x * 0.55) * Math.cos(y * 0.45)
  const h = z01 + undulation

  let code: number
  if (h < 0.16) code = 1
  else if (h < 0.31) code = 2
  else if (h < 0.47) code = 3
  else if (h < 0.63) code = 4
  else if (h < 0.8) code = 5
  else code = 6

  if (x > CONFIG.nx * 0.65 && x < CONFIG.nx * 0.78 && z > CONFIG.nz * 0.35) code = 4
  if (y > CONFIG.ny * 0.6 && y < CONFIG.ny * 0.72 && z > CONFIG.nz * 0.55) code = 5
  return code
}

function buildContent(): Float32Array {
  const nx = CONFIG.nx
  const ny = CONFIG.ny
  const nz = CONFIG.nz
  const total = nx * ny * nz
  const data = new Float32Array(total * 4)
  const visible = layerVisible.value

  let out = 0
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const code = codeAt(x, y, z)
        const pal = PALETTE[code]
        data[out++] = pal.r
        data[out++] = pal.g
        data[out++] = pal.b
        data[out++] = visible[code - 1] ? 1 : 0
      }
    }
  }
  return data
}

const geologicalShader = new CustomShader({
  uniforms: {
    uOpacity: {
      type: UniformType.FLOAT,
      value: 0.85
    }
  },
  fragmentShaderText: `
    void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
      vec4 color = fsInput.metadata.color;
      float lighting = dot(normalize(fsInput.attributes.normalEC), normalize(vec3(0.25, 0.45, 0.85)));
      lighting = 0.65 + 0.35 * max(lighting, 0.0);
      material.diffuse = color.rgb * lighting;
      material.alpha = color.a * uOpacity;
    }
  `
})

function buildPrimitive(): void {
  if (!viewer || viewer.isDestroyed()) return

  if (voxelPrimitive) {
    viewer.scene.primitives.remove(voxelPrimitive)
    voxelPrimitive = undefined
  }

  const provider = {
    shape: VoxelShapeType.BOX,
    dimensions: new Cartesian3(CONFIG.nx, CONFIG.ny, CONFIG.nz),
    paddingBefore: Cartesian3.ZERO,
    paddingAfter: Cartesian3.ZERO,
    shapeTransform: Matrix4.IDENTITY,
    globalTransform: Matrix4.IDENTITY,
    minBounds: new Cartesian3(-CONFIG.width / 2, -CONFIG.depth / 2, 0),
    maxBounds: new Cartesian3(CONFIG.width / 2, CONFIG.depth / 2, CONFIG.heightZ),
    names: ['color'],
    types: [MetadataType.VEC4],
    componentTypes: [MetadataComponentType.FLOAT32],
    maximumTileCount: 1,
    availableLevels: 1,
    requestData: (): Promise<VoxelContent> =>
      Promise.resolve(VoxelContent.fromMetadataArray([buildContent()]))
  } as unknown as VoxelProvider

  const center = Cartesian3.fromDegrees(CONFIG.longitude, CONFIG.latitude, CONFIG.height)
  const modelMatrix = Transforms.eastNorthUpToFixedFrame(center)

  const primitive = new VoxelPrimitive({
    provider,
    modelMatrix,
    customShader: geologicalShader,
    calculateStatistics: false
  })
  primitive.screenSpaceError = sse.value
  primitive.stepSize = stepSize.value
  primitive.nearestSampling = true
  primitive.show = true
  primitive.minBounds = new Cartesian3(-CONFIG.width / 2, -CONFIG.depth / 2, 0)
  primitive.maxBounds = new Cartesian3(CONFIG.width / 2, CONFIG.depth / 2, CONFIG.heightZ)
  viewer.scene.primitives.add(primitive)
  voxelPrimitive = primitive

  applyClip()
  voxelPrimitive.initialTilesLoaded.addEventListener(() => {
    statusMessage.value =
      '✓ 地质体加载完成 · 24×24×24 · 六层岩性体渲染 · Ray Step：' + primitive.stepSize
  })
  voxelPrimitive.allTilesLoaded.addEventListener(() => {
    statusMessage.value =
      '✓ 所有 Voxel Tile 已加载 · Metadata：RGBA 颜色 · Ray Step：' + primitive.stepSize
  })
}

function applyClip(): void {
  if (!voxelPrimitive || !viewer || viewer.isDestroyed()) return
  if (clip.bottom >= clip.top) return

  const minX = -CONFIG.width / 2 + CONFIG.width * (clip.x / 100)
  const minY = -CONFIG.depth / 2 + CONFIG.depth * (clip.y / 100)
  const minZ = CONFIG.heightZ * (clip.bottom / 100)
  const maxZ = CONFIG.heightZ * (clip.top / 100)

  voxelPrimitive.minClippingBounds = new Cartesian3(minX, minY, minZ)
  voxelPrimitive.maxClippingBounds = new Cartesian3(CONFIG.width / 2, CONFIG.depth / 2, maxZ)
  viewer.scene.requestRender()
}

function resetCamera(duration: number): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(CONFIG.longitude, CONFIG.latitude - 0.015, 4200),
    orientation: {
      heading: CesiumMath.toRadians(0),
      pitch: CesiumMath.toRadians(-22),
      roll: 0
    },
    duration
  })
}

function localToWorld(x: number, y: number, z: number): Cartesian3 {
  const center = Cartesian3.fromDegrees(CONFIG.longitude, CONFIG.latitude, CONFIG.height)
  const modelMatrix = Transforms.eastNorthUpToFixedFrame(center)
  return Matrix4.multiplyByPoint(modelMatrix, new Cartesian3(x, y, z), new Cartesian3())
}

const BOREHOLES = [
  { name: 'ZK-01', x: -1400, y: -900 },
  { name: 'ZK-02', x: 0, y: -700 },
  { name: 'ZK-03', x: 1300, y: 500 },
  { name: 'ZK-04', x: -900, y: 1000 }
]

function addBoreholes(): void {
  if (!viewer || viewer.isDestroyed()) return
  BOREHOLES.forEach((bh) => {
    const top = localToWorld(bh.x, bh.y, CONFIG.heightZ)
    const bottom = localToWorld(bh.x, bh.y, 0)
    const entity = viewer?.entities.add({
      name: bh.name,
      polyline: {
        positions: [top, bottom],
        width: 5,
        material: Color.YELLOW
      },
      label: {
        text: bh.name,
        font: '14px sans-serif',
        fillColor: Color.YELLOW,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(8, -8)
      }
    })
    if (entity) boreholeEntities.push(entity)
  })
  setBoreholesVisible(showBoreholes.value)
}

function setBoreholesVisible(shown: boolean): void {
  boreholeEntities.forEach((entity) => {
    entity.show = shown
  })
}

function applyPrecision(key: PrecisionKey): void {
  const preset = PRECISION_PRESETS[key]
  stepSize.value = preset.stepSize
  sse.value = preset.sse
}

function handlePick(position: Cartesian2): void {
  try {
    if (!voxelPrimitive || !voxelPrimitive.ready || !viewer || viewer.isDestroyed()) {
      pickCode.value = null
      pickName.value = ''
      pickStatus.value = 'Voxel 尚未加载完成'
      return
    }
    const cell: VoxelCell | undefined = viewer.scene.pickVoxel(position)
    if (!cell || cell.primitive !== voxelPrimitive) {
      pickCode.value = null
      pickName.value = ''
      pickStatus.value = '没有拾取到地质体'
      return
    }
    const index = cell.sampleIndex
    const nx = CONFIG.nx
    const ny = CONFIG.ny
    const z = Math.floor(index / (nx * ny))
    const rest = index % (nx * ny)
    const y = Math.floor(rest / nx)
    const x = rest % nx
    const code = codeAt(x, y, z)
    const hidden = !layerVisible.value[code - 1]
    pickCode.value = code
    pickName.value = PALETTE[code].name
    pickX.value = x
    pickY.value = y
    pickZ.value = z
    pickStatus.value = hidden ? '当前点击的岩层已被隐藏，请先在上方开启该层' : ''
  } catch (error) {
    console.error('pickVoxel error:', error)
    pickCode.value = null
    pickName.value = ''
    pickStatus.value = 'Voxel 查询失败'
  }
}

function clearPick(): void {
  pickCode.value = null
  pickName.value = ''
  pickStatus.value = ''
}

function showAll(): void {
  layerVisible.value = LAYERS.map(() => true)
}

function hideAll(): void {
  layerVisible.value = LAYERS.map(() => false)
}

function toggleRotate(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (removeTick) {
    removeTick()
    removeTick = undefined
    rotating.value = false
    return
  }
  rotating.value = true
  removeTick = viewer.clock.onTick.addEventListener(() => {
    viewer?.camera.rotate(Cartesian3.UNIT_Z, 0.0015)
  })
}

onMounted(() => {
  if (!container.value) return

  const webgl2 = (() => {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') || canvas.getContext('experimental-webgl2'))
  })()
  if (!webgl2) {
    statusMessage.value = '当前浏览器/显卡没有可用的 WebGL2，Cesium VoxelPrimitive 需要 WebGL2'
    return
  }

  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    if (!viewer || viewer.isDestroyed()) return

    const scene = viewer.scene
    scene.fog.enabled = false
    scene.postProcessStages.fxaa.enabled = false
    scene.msaaSamples = 1
    scene.requestRenderMode = false
    scene.maximumRenderTimeChange = Infinity

    resetCamera(0)
    buildPrimitive()
    addBoreholes()

    handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction(
      (movement: { position: Cartesian2 }) => handlePick(movement.position),
      ScreenSpaceEventType.LEFT_CLICK
    )

    scene.renderError.addEventListener((error: unknown) => {
      console.error('Cesium Render Error:', error)
      statusMessage.value = '✕ Cesium GPU 渲染异常，请检查浏览器 WebGL/D3D11'
    })

    statusMessage.value = '正在加载地质体…'
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

watch(layerVisible, buildPrimitive, { deep: true })
watch(opacity, (value) => {
  if (!viewer || viewer.isDestroyed()) return
  geologicalShader.setUniform('uOpacity', value)
  viewer.scene.requestRender()
})
watch(stepSize, (value) => {
  if (voxelPrimitive) voxelPrimitive.stepSize = value
})
watch(sse, (value) => {
  if (voxelPrimitive) voxelPrimitive.screenSpaceError = value
})
watch(() => [clip.bottom, clip.top, clip.x, clip.y], applyClip)
watch(showBoreholes, (shown) => {
  setBoreholesVisible(shown)
  viewer?.scene.requestRender()
})

onBeforeUnmount(() => {
  if (removeTick) {
    removeTick()
    removeTick = undefined
  }
  if (handler && !handler.isDestroyed()) handler.destroy()
  handler = undefined
  if (voxelPrimitive) {
    viewer?.scene.primitives.remove(voxelPrimitive)
    voxelPrimitive = undefined
  }
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="gv-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-head">
        <h2>三维标准地质体</h2>
        <p
          class="status"
          :class="{
            ok: statusMessage.startsWith('✓'),
            warn: statusMessage.startsWith('正在'),
            danger: statusMessage.startsWith('✕') || statusMessage.includes('失败')
          }"
        >
          {{ statusMessage }}
        </p>
      </div>

      <div class="section">
        <h3>地层控制</h3>
        <div v-for="(layer, i) in LAYERS" :key="layer.name" class="layer">
          <input :id="`gvLayer${i}`" v-model="layerVisible[i]" type="checkbox" />
          <span class="swatch" :style="{ background: layer.color }"></span>
          <label :for="`gvLayer${i}`">{{ layer.name }}</label>
        </div>
      </div>

      <div class="section">
        <h3>辅助标注</h3>
        <div class="layer">
          <input id="gvBoreholeToggle" v-model="showBoreholes" type="checkbox" />
          <span class="swatch" style="background: #ffd700"></span>
          <label for="gvBoreholeToggle">钻孔标注（黄线 ZK-01 ~ ZK-04）</label>
        </div>
      </div>

      <div class="section">
        <h3>体渲染</h3>
        <div class="row">
          <label>地质体精度</label>
          <div class="seg">
            <button
              v-for="option in PRECISION_OPTIONS"
              :key="option.key"
              type="button"
              class="seg-btn"
              :class="{ active: activePrecision === option.key }"
              @click="applyPrecision(option.key)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
        <div class="row">
          <label>透明度</label>
          <input v-model.number="opacity" type="range" min="0.1" max="1" step="0.05" />
          <span class="value">{{ opacity.toFixed(2) }}</span>
        </div>
        <div class="row">
          <label>Ray Step</label>
          <input v-model.number="stepSize" type="range" min="0.5" max="4" step="0.5" />
          <span class="value">{{ stepSize }}</span>
        </div>
        <div class="row">
          <label>屏幕误差</label>
          <input v-model.number="sse" type="range" min="8" max="32" step="2" />
          <span class="value">{{ sse }}</span>
        </div>
      </div>

      <div class="section">
        <h3>剖切</h3>
        <div class="row">
          <label>Z 底部</label>
          <input v-model.number="clip.bottom" type="range" min="0" max="100" step="1" />
          <span class="value">{{ clip.bottom }}%</span>
        </div>
        <div class="row">
          <label>Z 顶部</label>
          <input v-model.number="clip.top" type="range" min="0" max="100" step="1" />
          <span class="value">{{ clip.top }}%</span>
        </div>
        <div class="row">
          <label>X 左侧</label>
          <input v-model.number="clip.x" type="range" min="0" max="100" step="1" />
          <span class="value">{{ clip.x }}%</span>
        </div>
        <div class="row">
          <label>Y 前侧</label>
          <input v-model.number="clip.y" type="range" min="0" max="100" step="1" />
          <span class="value">{{ clip.y }}%</span>
        </div>
      </div>

      <div class="section actions">
        <button @click="resetCamera(1)">恢复视图</button>
        <button @click="toggleRotate">{{ rotating ? '停止旋转' : '自动旋转' }}</button>
        <button @click="showAll">显示全部</button>
        <button @click="hideAll">隐藏全部</button>
      </div>
    </div>

    <div class="gv-float">
      <div v-if="pickName" class="pick-card">
        <div class="pick-card-head">
          <h4>地质体属性</h4>
          <button class="pick-close" type="button" aria-label="关闭" @click="clearPick">×</button>
        </div>
        <div v-if="pickStatus" class="pick-warn">{{ pickStatus }}</div>
        <div class="pick-row"><span>岩性编码</span><b>{{ pickCode }}</b></div>
        <div class="pick-row"><span>岩性名称</span><b>{{ pickName }}</b></div>
        <div class="pick-row">
          <span>体素网格</span><b>{{ pickX }}, {{ pickY }}, {{ pickZ }}</b>
        </div>
      </div>
      <div v-else class="pick-hint" :class="{ warn: pickStatus }">
        {{ pickStatus || '点击地质体查看岩性属性' }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.gv-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  overflow: hidden;
  border-radius: 8px;
  background: #152b4c;
  color: #fff;
}
.cesium-container {
  width: 100%;
  height: 100%;
}
.control-panel {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 10;
  width: 260px;
  max-height: calc(100% - 24px);
  overflow-y: auto;
  padding: 12px 13px;
  box-sizing: border-box;
  border: 1px solid rgba(157, 188, 224, 0.28);
  border-radius: 9px;
  background: rgba(10, 26, 52, 0.9);
  backdrop-filter: blur(6px);
  font-size: 12px;
}
.control-panel h2 {
  margin: 0;
  font-size: 14px;
  letter-spacing: 0.03em;
}
.status {
  margin: 5px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: #9fd8ff;
}
.status.ok { color: #66ff99; }
.status.warn { color: #ffcc66; }
.status.danger { color: #ff7777; }
.section {
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  padding-top: 8px;
  margin-top: 8px;
}
.section h3 {
  margin: 0 0 6px;
  font-size: 12px;
  color: #66ccff;
}
.layer {
  display: flex;
  align-items: center;
  padding: 3px 4px;
  border-radius: 4px;
}
.layer:hover {
  background: rgba(255, 255, 255, 0.06);
}
.layer input {
  margin-right: 6px;
  accent-color: #2f80ed;
}
.swatch {
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  border-radius: 3px;
  margin-right: 7px;
  border: 1px solid rgba(255, 255, 255, 0.3);
}
.layer label {
  color: #dce8f5;
  font-size: 11px;
}
.row {
  display: flex;
  align-items: center;
  margin: 4px 0;
}
.row label {
  flex: 1;
  font-size: 11px;
  color: #c3d5e8;
}
.row input[type="range"] {
  width: 96px;
  accent-color: #2f80ed;
  margin: 0 4px;
}
.value {
  width: 38px;
  text-align: right;
  font-size: 11px;
  color: #65d3eb;
}
.actions button {
  border: none;
  border-radius: 4px;
  padding: 5px 8px;
  margin: 2px 3px 2px 0;
  cursor: pointer;
  background: #2878b8;
  color: #fff;
  font-size: 11px;
}
.actions button:hover {
  background: #3498db;
}
.seg {
  display: flex;
  gap: 4px;
}
.seg-btn {
  flex: 1;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  padding: 3px 0;
  background: rgba(255, 255, 255, 0.06);
  color: #b9d2ea;
  font-size: 11px;
  cursor: pointer;
}
.seg-btn:hover {
  border-color: #5eacf5;
  color: #fff;
}
.seg-btn.active {
  border-color: #2f80ed;
  background: #2f80ed;
  color: #fff;
  font-weight: 600;
}
.gv-float {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  max-width: 232px;
  box-sizing: border-box;
}
.pick-hint {
  padding: 7px 12px;
  border: 1px solid rgba(101, 211, 235, 0.32);
  border-radius: 8px;
  background: rgba(8, 24, 48, 0.88);
  backdrop-filter: blur(6px);
  color: #9fc8e8;
  font-size: 12px;
  line-height: 1.5;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
}
.pick-hint.warn {
  border-color: rgba(255, 170, 90, 0.45);
  color: #ffcc99;
}
.pick-card {
  padding: 10px 12px 12px;
  border: 1px solid rgba(101, 211, 235, 0.45);
  border-radius: 9px;
  background: rgba(8, 24, 48, 0.92);
  backdrop-filter: blur(8px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  font-size: 12px;
  min-width: 190px;
}
.pick-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.pick-card-head h4 {
  margin: 0;
  font-size: 13px;
  color: #65d3eb;
  letter-spacing: 0.03em;
}
.pick-close {
  border: none;
  background: transparent;
  color: #9db6d0;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
}
.pick-close:hover {
  color: #fff;
}
.pick-warn {
  margin-bottom: 6px;
  padding: 5px 8px;
  border-radius: 5px;
  background: rgba(255, 160, 60, 0.14);
  color: #ffcc99;
  font-size: 11px;
  line-height: 1.5;
}
.pick-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 5px;
}
.pick-row span {
  color: #c3d5e8;
}
.pick-row b {
  color: #65d3eb;
  font-variant-numeric: tabular-nums;
}
</style>
