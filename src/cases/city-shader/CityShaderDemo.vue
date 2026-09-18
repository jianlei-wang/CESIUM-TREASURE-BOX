<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian3,
  Cesium3DTileColorBlendMode,
  Cesium3DTileset,
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

const SCAN_COLORS: Array<{ label: string; value: [number, number, number] }> = [
  { label: '青色', value: [0, 0.9, 1] },
  { label: '绿色', value: [0.3, 1, 0.53] },
  { label: '橙色', value: [1, 0.62, 0.18] },
  { label: '紫色', value: [0.7, 0.48, 1] },
  { label: '红色', value: [1, 0.36, 0.36] }
]
const BASE_COLORS: Array<{ label: string; value: [number, number, number] }> = [
  { label: '白色', value: [1, 1, 1] },
  { label: '银灰', value: [0.78, 0.81, 0.85] },
  { label: '天蓝', value: [0.62, 0.78, 1] },
  { label: '暖白', value: [1, 0.85, 0.62] }
]

const base = useWhiteModelTileset()

const scanEnabled = ref(true)
const scanColorIndex = ref(0)
const scanPeriod = ref(2)
const scanWidth = ref(14)
const scanRange = ref(90)
const baseColorIndex = ref(0)
const useGradient = ref(true)
const gradMax = ref(60)

let shader: CustomShader | undefined

const SHADER_FRAGMENT = `${WGS84_HEIGHT_GLSL}
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  vec3 positionWC = fsInput.attributes.positionWC;
  float h = dc_approxEllipsoidHeight(positionWC);
  float nh = clamp(h / max(u_gradMax, 1.0), 0.0, 1.0);
  vec3 color = u_baseColor;
  if (u_useGradient > 0.5) {
    color = mix(color * 0.28, color * 1.9, nh);
  }
  if (u_scanEnabled > 0.5) {
    float periodFrames = u_scanPeriod * 60.0;
    float cycle = fract(czm_frameNumber / max(periodFrames, 1.0));
    float bandPos = cycle * u_scanRange;
    float dist = abs(h - bandPos);
    float band = 1.0 - smoothstep(0.0, max(u_scanWidth, 0.1), dist);
    color += u_scanColor * band;
  }
  material.diffuse = color;
  material.specular = vec3(0.0);
}
`

function applyCustomization(viewer: Viewer, tileset: Cesium3DTileset): void {
  tileset.style = undefined
  tileset.colorBlendMode = Cesium3DTileColorBlendMode.REPLACE
  shader = new CustomShader({
    uniforms: {
      u_scanColor: { type: UniformType.VEC3, value: new Cartesian3(0, 0.9, 1) },
      u_scanEnabled: { type: UniformType.FLOAT, value: 1 },
      u_scanPeriod: { type: UniformType.FLOAT, value: 2 },
      u_scanWidth: { type: UniformType.FLOAT, value: 14 },
      u_scanRange: { type: UniformType.FLOAT, value: 90 },
      u_baseColor: { type: UniformType.VEC3, value: new Cartesian3(1, 1, 1) },
      u_useGradient: { type: UniformType.FLOAT, value: 1 },
      u_gradMax: { type: UniformType.FLOAT, value: 60 }
    },
    fragmentShaderText: SHADER_FRAGMENT
  })
  tileset.customShader = shader
  applyUniforms()
  viewer.scene.requestRender()
}

function applyUniforms(): void {
  if (!shader) return
  const sc = SCAN_COLORS[scanColorIndex.value].value
  shader.setUniform('u_scanColor', new Cartesian3(sc[0], sc[1], sc[2]))
  shader.setUniform('u_scanEnabled', scanEnabled.value ? 1 : 0)
  shader.setUniform('u_scanPeriod', scanPeriod.value)
  shader.setUniform('u_scanWidth', scanWidth.value)
  shader.setUniform('u_scanRange', scanRange.value)
  const bc = BASE_COLORS[baseColorIndex.value].value
  shader.setUniform('u_baseColor', new Cartesian3(bc[0], bc[1], bc[2]))
  shader.setUniform('u_useGradient', useGradient.value ? 1 : 0)
  shader.setUniform('u_gradMax', gradMax.value)
  base.viewer.value?.scene.requestRender()
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
      <div class="panel-title">城市白模自定义着色器</div>

      <div class="section-title">数据层级</div>
      <div class="control-row">
        <span class="row-label">LOD 精度</span>
        <select v-model.number="base.lodIndex.value" class="select-input" @change="base.switchLod(onTilesetReady)">
          <option v-for="(o, i) in LOD_OPTIONS" :key="o.suffix" :value="i">{{ o.label }}</option>
        </select>
      </div>

      <div class="section-title">着色器参数</div>
      <div class="control-row">
        <span class="row-label">动态扫描</span>
        <button class="toggle" :class="{ on: scanEnabled }" :aria-label="scanEnabled ? '关闭动态扫描' : '开启动态扫描'" @click="scanEnabled = !scanEnabled; applyUniforms()"><i></i></button>
      </div>
      <div class="control-row">
        <span class="row-label">扫描颜色</span>
        <select v-model.number="scanColorIndex" class="select-input" @change="applyUniforms">
          <option v-for="(c, i) in SCAN_COLORS" :key="c.label" :value="i">{{ c.label }}</option>
        </select>
      </div>
      <div class="control-row">
        <span class="row-label">扫描周期</span>
        <input v-model.number="scanPeriod" type="range" min="0.5" max="8" step="0.1" @input="applyUniforms" />
        <span class="row-value">{{ scanPeriod.toFixed(1) }}s</span>
      </div>
      <div class="control-row">
        <span class="row-label">扫描带宽</span>
        <input v-model.number="scanWidth" type="range" min="2" max="40" step="1" @input="applyUniforms" />
        <span class="row-value">{{ scanWidth }}m</span>
      </div>
      <div class="control-row">
        <span class="row-label">扫描范围</span>
        <input v-model.number="scanRange" type="range" min="30" max="200" step="5" @input="applyUniforms" />
        <span class="row-value">{{ scanRange }}m</span>
      </div>
      <div class="control-row">
        <span class="row-label">基础颜色</span>
        <select v-model.number="baseColorIndex" class="select-input" @change="applyUniforms">
          <option v-for="(c, i) in BASE_COLORS" :key="c.label" :value="i">{{ c.label }}</option>
        </select>
      </div>
      <div class="control-row">
        <span class="row-label">高度渐变</span>
        <button class="toggle" :class="{ on: useGradient }" :aria-label="useGradient ? '关闭高度渐变' : '开启高度渐变'" @click="useGradient = !useGradient; applyUniforms()"><i></i></button>
      </div>
      <div class="control-row">
        <span class="row-label">渐变上限</span>
        <input v-model.number="gradMax" type="range" min="20" max="150" step="5" @input="applyUniforms" />
        <span class="row-value">{{ gradMax }}m</span>
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
      <p class="hint">通过 CustomShader 片元着色器实现建筑高度渐变与动态扫描光带效果，扫描周期、带宽、范围与配色均可实时调节。</p>
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
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(157, 188, 224, 0.35); cursor: pointer; flex: 0 0 auto; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e7f5f8; transition: transform 0.2s; }
.toggle.on { background: #2f80ed; }
.toggle.on i { transform: translateX(18px); }
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
