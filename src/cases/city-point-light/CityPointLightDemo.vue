<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Cesium3DTileColorBlendMode,
  Cesium3DTileset,
  Color,
  ConstantPositionProperty,
  CustomShader,
  Entity,
  UniformType,
  type Viewer
} from 'cesium'
import {
  LOD_OPTIONS,
  useWhiteModelTileset,
  type OnTilesetReady
} from '../../lib/use-white-model-tileset'

const LIGHT_COLORS: Array<{ label: string; value: [number, number, number] }> = [
  { label: '白光', value: [1, 1, 1] },
  { label: '暖黄', value: [1, 0.9, 0.55] },
  { label: '青色', value: [0.3, 0.9, 1] },
  { label: '紫罗兰', value: [0.7, 0.5, 1] },
  { label: '洋红', value: [1, 0.35, 0.7] }
]

const base = useWhiteModelTileset()

const lightLon = ref(4.9041)
const lightLat = ref(52.3676)
const lightHeight = ref(300)
const lightColorIndex = ref(0)
const lightIntensity = ref(3)
const lightRadius = ref(1500)
const attenuation = ref(2)
const ambient = ref(0.35)
const specular = ref(0.6)
const shininess = ref(32)

let shader: CustomShader | undefined
let lightEntity: Entity | undefined

const SHADER_FRAGMENT = `
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  vec3 P = fsInput.attributes.positionEC;
  vec3 N = normalize(fsInput.attributes.normalEC);
  vec3 lightPosEC = (czm_view * vec4(u_lightPosWC, 1.0)).xyz;
  vec3 L = lightPosEC - P;
  float dist = length(L);
  vec3 Ld = L / max(dist, 1e-3);
  vec3 V = normalize(-P);
  vec3 H = normalize(Ld + V);
  float atten = clamp(1.0 - dist / max(u_lightRadius, 1.0), 0.0, 1.0);
  atten = pow(atten, u_attenuation);
  float ndl = max(dot(N, Ld), 0.0);
  float spec = ndl > 0.0 ? pow(max(dot(N, H), 0.0), u_shininess) : 0.0;
  vec3 diffuse = u_lightColor * u_lightIntensity * ndl * atten;
  vec3 specular = u_lightColor * u_specular * spec * atten;
  vec3 base = material.diffuse;
  material.diffuse = base * u_ambient;
  material.emissive = base * diffuse + specular;
  material.specular = vec3(0.0);
}
`

function lightPosition(): Cartesian3 {
  return Cartesian3.fromDegrees(
    lightLon.value,
    lightLat.value,
    lightHeight.value
  )
}

function applyCustomization(viewer: Viewer, tileset: Cesium3DTileset): void {
  tileset.style = undefined
  tileset.colorBlendMode = Cesium3DTileColorBlendMode.REPLACE
  shader = new CustomShader({
    uniforms: {
      u_lightPosWC: { type: UniformType.VEC3, value: lightPosition() },
      u_lightColor: { type: UniformType.VEC3, value: new Cartesian3(1, 1, 1) },
      u_lightIntensity: { type: UniformType.FLOAT, value: 3 },
      u_lightRadius: { type: UniformType.FLOAT, value: 1500 },
      u_attenuation: { type: UniformType.FLOAT, value: 2 },
      u_ambient: { type: UniformType.FLOAT, value: 0.35 },
      u_specular: { type: UniformType.FLOAT, value: 0.6 },
      u_shininess: { type: UniformType.FLOAT, value: 32 }
    },
    fragmentShaderText: SHADER_FRAGMENT
  })
  tileset.customShader = shader
  applyUniforms()
  ensureLightMarker(viewer)
  viewer.scene.requestRender()
}

function ensureLightMarker(viewer: Viewer): void {
  if (lightEntity) {
    lightEntity.position = new ConstantPositionProperty(lightPosition())
    viewer.scene.requestRender()
    return
  }
  lightEntity = viewer.entities.add({
    position: new ConstantPositionProperty(lightPosition()),
    point: {
      pixelSize: 18,
      color: Color.fromCssColorString('#4de3ff').withAlpha(0.25),
      outlineColor: Color.WHITE,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    label: {
      text: '点光源',
      font: '11px sans-serif',
      pixelOffset: new Cartesian2(0, -22),
      fillColor: Color.WHITE,
      outlineColor: Color.fromCssColorString('#152b4c'),
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  })
  viewer.scene.requestRender()
}

function applyUniforms(): void {
  if (!shader) return
  shader.setUniform('u_lightPosWC', lightPosition())
  const lc = LIGHT_COLORS[lightColorIndex.value].value
  shader.setUniform('u_lightColor', new Cartesian3(lc[0], lc[1], lc[2]))
  shader.setUniform('u_lightIntensity', lightIntensity.value)
  shader.setUniform('u_lightRadius', lightRadius.value)
  shader.setUniform('u_attenuation', attenuation.value)
  shader.setUniform('u_ambient', ambient.value)
  shader.setUniform('u_specular', specular.value)
  shader.setUniform('u_shininess', shininess.value)
  const viewer = base.viewer.value
  if (lightEntity && viewer && !viewer.isDestroyed()) {
    lightEntity.position = new ConstantPositionProperty(lightPosition())
  }
  viewer?.scene.requestRender()
}

const onTilesetReady: OnTilesetReady = (viewer, tileset) => {
  applyCustomization(viewer, tileset)
}

onMounted(async () => {
  await base.mount(onTilesetReady)
})

onBeforeUnmount(() => {
  const viewer = base.viewer.value
  if (viewer && !viewer.isDestroyed() && lightEntity) {
    viewer.entities.remove(lightEntity)
  }
  lightEntity = undefined
  base.teardown()
  shader = undefined
})
</script>

<template>
  <div class="city-shell">
    <div :ref="base.container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">城市白模点光源效果</div>

      <div class="section-title">数据层级</div>
      <div class="control-row">
        <span class="row-label">LOD 精度</span>
        <select v-model.number="base.lodIndex.value" class="select-input" @change="base.switchLod(onTilesetReady)">
          <option v-for="(o, i) in LOD_OPTIONS" :key="o.suffix" :value="i">{{ o.label }}</option>
        </select>
      </div>

      <div class="section-title">光源位置</div>
      <div class="control-row">
        <span class="row-label">经度</span>
        <input v-model.number="lightLon" type="range" min="4.6" max="5.2" step="0.001" @input="applyUniforms" />
        <span class="row-value">{{ lightLon.toFixed(3) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">纬度</span>
        <input v-model.number="lightLat" type="range" min="52.2" max="52.6" step="0.001" @input="applyUniforms" />
        <span class="row-value">{{ lightLat.toFixed(3) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">高度</span>
        <input v-model.number="lightHeight" type="range" min="100" max="800" step="10" @input="applyUniforms" />
        <span class="row-value">{{ lightHeight }}m</span>
      </div>

      <div class="section-title">光照参数</div>
      <div class="control-row">
        <span class="row-label">光源颜色</span>
        <select v-model.number="lightColorIndex" class="select-input" @change="applyUniforms">
          <option v-for="(c, i) in LIGHT_COLORS" :key="c.label" :value="i">{{ c.label }}</option>
        </select>
      </div>
      <div class="control-row">
        <span class="row-label">光源强度</span>
        <input v-model.number="lightIntensity" type="range" min="0" max="6" step="0.1" @input="applyUniforms" />
        <span class="row-value">{{ lightIntensity.toFixed(1) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">衰减半径</span>
        <input v-model.number="lightRadius" type="range" min="200" max="3000" step="50" @input="applyUniforms" />
        <span class="row-value">{{ lightRadius }}m</span>
      </div>
      <div class="control-row">
        <span class="row-label">衰减指数</span>
        <input v-model.number="attenuation" type="range" min="0.5" max="4" step="0.1" @input="applyUniforms" />
        <span class="row-value">{{ attenuation.toFixed(1) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">环境光</span>
        <input v-model.number="ambient" type="range" min="0" max="1.5" step="0.05" @input="applyUniforms" />
        <span class="row-value">{{ ambient.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">高光强度</span>
        <input v-model.number="specular" type="range" min="0" max="2" step="0.05" @input="applyUniforms" />
        <span class="row-value">{{ specular.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">高光指数</span>
        <select v-model.number="shininess" class="select-input" @change="applyUniforms">
          <option :value="8">8</option>
          <option :value="16">16</option>
          <option :value="32">32</option>
          <option :value="64">64</option>
          <option :value="128">128</option>
        </select>
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
      <p class="hint">通过 CustomShader 实现 Blinn-Phong 点光源照明：光源位置、颜色、强度、衰减半径与指数、环境光与高光均可实时调节，场景中以发光点标记光源位置。</p>
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
