<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian3,
  Cesium3DTileColorBlendMode,
  Cesium3DTileset,
  Cesium3DTileStyle,
  CustomShader,
  UniformType,
  type Viewer
} from 'cesium'
import { WGS84_HEIGHT_GLSL } from '../../lib/white-model-glsl'
import {
  LOD_OPTIONS,
  useWhiteModelTileset,
  type OnTilesetReady
} from '../../lib/use-white-model-tileset'

interface PaletteStop {
  min: number
  color: string
}

const PALETTES: Array<{ label: string; stops: PaletteStop[] }> = [
  {
    label: '地形暖色',
    stops: [
      { min: 5000, color: 'rgb(84, 39, 9)' },
      { min: 2000, color: 'rgb(140, 72, 12)' },
      { min: 800, color: 'rgb(204, 124, 33)' },
      { min: 300, color: 'rgb(240, 175, 82)' },
      { min: 100, color: 'rgb(250, 214, 150)' },
      { min: 30, color: 'rgb(244, 235, 200)' },
      { min: 0, color: 'rgb(230, 224, 210)' }
    ]
  },
  {
    label: '冷色蓝',
    stops: [
      { min: 5000, color: 'rgb(13, 37, 96)' },
      { min: 2000, color: 'rgb(24, 77, 146)' },
      { min: 800, color: 'rgb(48, 120, 190)' },
      { min: 300, color: 'rgb(90, 165, 214)' },
      { min: 100, color: 'rgb(150, 210, 232)' },
      { min: 30, color: 'rgb(205, 235, 245)' },
      { min: 0, color: 'rgb(232, 244, 250)' }
    ]
  },
  {
    label: 'Turbo 热力',
    stops: [
      { min: 5000, color: 'rgb(76, 0, 112)' },
      { min: 2000, color: 'rgb(60, 60, 205)' },
      { min: 800, color: 'rgb(0, 160, 190)' },
      { min: 300, color: 'rgb(0, 200, 120)' },
      { min: 100, color: 'rgb(150, 215, 20)' },
      { min: 30, color: 'rgb(245, 190, 0)' },
      { min: 0, color: 'rgb(165, 40, 30)' }
    ]
  },
  {
    label: '森林绿',
    stops: [
      { min: 5000, color: 'rgb(10, 52, 20)' },
      { min: 2000, color: 'rgb(22, 82, 34)' },
      { min: 800, color: 'rgb(44, 116, 52)' },
      { min: 300, color: 'rgb(78, 148, 78)' },
      { min: 100, color: 'rgb(130, 185, 120)' },
      { min: 30, color: 'rgb(185, 215, 170)' },
      { min: 0, color: 'rgb(220, 235, 210)' }
    ]
  },
  {
    label: '单色银',
    stops: [
      { min: 5000, color: 'rgb(255, 255, 255)' },
      { min: 2000, color: 'rgb(226, 230, 236)' },
      { min: 800, color: 'rgb(198, 204, 212)' },
      { min: 300, color: 'rgb(170, 177, 187)' },
      { min: 100, color: 'rgb(142, 150, 161)' },
      { min: 30, color: 'rgb(116, 124, 136)' },
      { min: 0, color: 'rgb(92, 100, 112)' }
    ]
  }
]
const RIM_COLORS: Array<{ label: string; value: [number, number, number] }> = [
  { label: '白光', value: [1, 1, 1] },
  { label: '暖金', value: [1, 0.82, 0.4] },
  { label: '青色', value: [0.35, 0.95, 1] },
  { label: '粉色', value: [1, 0.55, 0.7] },
  { label: '绿色', value: [0.4, 1, 0.5] }
]

function parseRgb(color: string): [number, number, number] {
  const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  return m ? [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255] : [1, 1, 1]
}

const base = useWhiteModelTileset()

const paletteIndex = ref(0)
const alphaValue = ref(100)
const rimStrength = ref(0.7)
const rimColorIndex = ref(0)
const brightness = ref(1.15)
const gradStrength = ref(0.5)

const buildingVolume = ref<number | null>(null)
const buildingArea = ref<number | null>(null)
const buildingYear = ref<number | null>(null)

let shader: CustomShader | undefined
let inspected = false

const SHADER_FRAGMENT = `${WGS84_HEIGHT_GLSL}
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  vec3 N = normalize(fsInput.attributes.normalEC);
  vec3 V = normalize(-fsInput.attributes.positionEC);
  float rim = pow(max(1.0 - max(dot(N, V), 0.0), 0.0), 2.5);
  vec3 c = material.diffuse;
  float h = dc_approxEllipsoidHeight(fsInput.attributes.positionWC);
  float nh = clamp((h - u_gradMin) / max(u_gradMax - u_gradMin, 1.0), 0.0, 1.0);
  c = mix(c * (1.0 - 0.3 * u_gradStrength), c * (1.0 + 0.8 * u_gradStrength * nh), 1.0);
  c = c * u_brightness;
  c += rim * u_rimColor * u_rimStrength;
  material.diffuse = c;
  material.specular = vec3(0.0);
}
`

function applyStyle(): void {
  const ts = base.tileset.value
  if (!ts) return
  const alpha = Math.max(0, Math.min(1, alphaValue.value / 100))
  const stops = PALETTES[paletteIndex.value].stops
  const conditions: string[][] = stops.map((s) => [
    `\${b3_volume_lod22} >= ${s.min}`,
    toRgba(s.color, alpha)
  ])
  conditions.push(['true', toRgba(stops[stops.length - 1].color, alpha)])
  ts.style = new Cesium3DTileStyle({
    color: { conditions }
  })
  ts.colorBlendMode = Cesium3DTileColorBlendMode.REPLACE
  base.viewer.value?.scene.requestRender()
}

function toRgba(color: string, alpha: number): string {
  const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (!m) return `rgba(255, 255, 255, ${alpha})`
  return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`
}

function applyCustomization(viewer: Viewer, tileset: Cesium3DTileset): void {
  applyStyle()
  shader = new CustomShader({
    uniforms: {
      u_rimColor: { type: UniformType.VEC3, value: new Cartesian3(1, 1, 1) },
      u_rimStrength: { type: UniformType.FLOAT, value: 0.7 },
      u_brightness: { type: UniformType.FLOAT, value: 1.15 },
      u_gradStrength: { type: UniformType.FLOAT, value: 0.5 },
      u_gradMin: { type: UniformType.FLOAT, value: 0 },
      u_gradMax: { type: UniformType.FLOAT, value: 60 }
    },
    fragmentShaderText: SHADER_FRAGMENT
  })
  tileset.customShader = shader
  applyUniforms()
  if (!inspected) {
    tileset.tileVisible.addEventListener(inspectFeature)
  }
  viewer.scene.requestRender()
}

function applyUniforms(): void {
  if (!shader) return
  const rc = RIM_COLORS[rimColorIndex.value].value
  shader.setUniform('u_rimColor', new Cartesian3(rc[0], rc[1], rc[2]))
  shader.setUniform('u_rimStrength', rimStrength.value)
  shader.setUniform('u_brightness', brightness.value)
  shader.setUniform('u_gradStrength', gradStrength.value)
  base.viewer.value?.scene.requestRender()
}

function inspectFeature(tile: { content: { getFeature: (i: number) => unknown } }): void {
  if (inspected) return
  try {
    const feature = tile.content.getFeature(0) as {
      getProperty: (name: string) => unknown
    }
    const volume = feature.getProperty('b3_volume_lod22')
    const area = feature.getProperty('b3_opp_grond')
    const year = feature.getProperty('oorspronkelijkbouwjaar')
    if (typeof volume === 'number' && Number.isFinite(volume)) {
      buildingVolume.value = Math.round(volume)
      buildingArea.value = typeof area === 'number' ? Math.round(area) : null
      buildingYear.value = typeof year === 'number' ? Math.round(year) : null
      inspected = true
    }
  } catch {
    /* ignore inspection failures */
  }
}

const onTilesetReady: OnTilesetReady = (viewer, tileset) => {
  applyCustomization(viewer, tileset)
}

onMounted(async () => {
  await base.mount(onTilesetReady)
})

onBeforeUnmount(() => {
  base.teardown()
  shader = undefined
})
</script>

<template>
  <div class="city-shell">
    <div :ref="base.container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">城市白模样式 + 着色器</div>

      <div class="section-title">数据层级</div>
      <div class="control-row">
        <span class="row-label">LOD 精度</span>
        <select v-model.number="base.lodIndex.value" class="select-input" @change="base.switchLod(onTilesetReady)">
          <option v-for="(o, i) in LOD_OPTIONS" :key="o.suffix" :value="i">{{ o.label }}</option>
        </select>
      </div>

      <div class="section-title">样式参数</div>
      <div class="control-row">
        <span class="row-label">色带方案</span>
        <select v-model.number="paletteIndex" class="select-input" @change="applyStyle">
          <option v-for="(p, i) in PALETTES" :key="p.label" :value="i">{{ p.label }}</option>
        </select>
      </div>
      <div class="control-row">
        <span class="row-label">透明度</span>
        <input v-model.number="alphaValue" type="range" min="10" max="100" step="5" @input="applyStyle" />
        <span class="row-value">{{ alphaValue }}%</span>
      </div>

      <div class="section-title">着色器参数</div>
      <div class="control-row">
        <span class="row-label">边缘光强度</span>
        <input v-model.number="rimStrength" type="range" min="0" max="2" step="0.05" @input="applyUniforms" />
        <span class="row-value">{{ rimStrength.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">边缘光颜色</span>
        <select v-model.number="rimColorIndex" class="select-input" @change="applyUniforms">
          <option v-for="(c, i) in RIM_COLORS" :key="c.label" :value="i">{{ c.label }}</option>
        </select>
      </div>
      <div class="control-row">
        <span class="row-label">整体亮度</span>
        <input v-model.number="brightness" type="range" min="0.5" max="2" step="0.05" @input="applyUniforms" />
        <span class="row-value">{{ brightness.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">高度渐变</span>
        <input v-model.number="gradStrength" type="range" min="0" max="1" step="0.05" @input="applyUniforms" />
        <span class="row-value">{{ gradStrength.toFixed(2) }}</span>
      </div>

      <div class="section-title">建筑属性</div>
      <div class="attr-box">
        <div v-if="buildingVolume !== null" class="attr-row">
          <span>建筑体积</span><em>{{ buildingVolume.toLocaleString() }} m³</em>
        </div>
        <div v-if="buildingArea !== null" class="attr-row">
          <span>占地参考</span><em>{{ buildingArea.toLocaleString() }} m²</em>
        </div>
        <div v-if="buildingYear !== null" class="attr-row">
          <span>建造年份</span><em>{{ buildingYear }}</em>
        </div>
        <div v-if="buildingVolume === null" class="attr-row"><span>建筑属性读取中…</span></div>
      </div>

      <div class="section-title">实时性能</div>
      <div class="perf-grid">
        <div class="perf-item"><span class="perf-key">帧率</span><em class="perf-val">{{ base.perfFps.value }} FPS</em></div>
        <div class="perf-item"><span class="perf-key">已加载瓦片</span><em class="perf-val">{{ base.perfTiles.value }}</em></div>
        <div class="perf-item"><span class="perf-key">三角面数</span><em class="perf-val">{{ base.perfTriangles.value.toLocaleString() }}</em></div>
        <div class="perf-item"><span class="perf-key">GPU 内存</span><em class="perf-val">{{ base.perfMemory.value }} MB</em></div>
        <div class="perf-item"><span class="perf-key">排队瓦片</span><em class="perf-val">{{ base.perfQueue.value }}</em></div>
      </div>

      <div class="btn-row">
        <button class="action-btn" :disabled="!base.tileset.value" @click="base.flyToCity()">定位阿姆斯特丹</button>
        <button class="action-btn" :disabled="base.loading.value" @click="base.reset(onTilesetReady)">重置</button>
      </div>
      <div v-if="base.loading.value" class="loading-tip">模型加载中…</div>
      <p class="hint">Cesium3DTileStyle 依据 3DBAG 建筑属性 b3_volume_lod22（建筑体量）分级设色，再叠加 CustomShader 边缘光与高度渐变亮度，色带、透明度、光照参数均可实时调节。</p>
    </div>

    <div v-if="base.statusMessage.value" class="status-mask">{{ base.statusMessage.value }}</div>
  </div>
</template>

<style scoped>
.city-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 248px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.84); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 44px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.select-input { width: 108px; height: 24px; padding: 0 4px; border-radius: 5px; border: 1px solid rgba(157, 188, 224, 0.24); background: rgba(8, 21, 40, 0.55); color: #e6eef9; font-size: 11px; }
.attr-box { display: flex; flex-direction: column; gap: 3px; padding: 6px; border-radius: 5px; background: rgba(8, 21, 40, 0.55); }
.attr-row { display: flex; justify-content: space-between; font-size: 10px; color: #8ea5c2; }
.attr-row em { font-style: normal; color: #8be0b2; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.perf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; }
.perf-item { display: flex; flex-direction: column; padding: 4px 6px; border-radius: 5px; background: rgba(8, 21, 40, 0.55); }
.perf-key { font-size: 10px; color: #8ea5c2; }
.perf-val { font-style: normal; font-size: 11px; color: #8be0b2; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.btn-row { display: flex; gap: 6px; margin-top: 8px; }
.action-btn { flex: 1; height: 26px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; background: #2f80ed; color: #eef4ff; }
.action-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.loading-tip { margin-top: 6px; font-size: 10px; color: #8ea5c2; }
.hint { margin: 8px 0 0; font-size: 10px; color: #6d84a3; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
