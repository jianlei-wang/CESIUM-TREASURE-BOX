<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian3,
  Color,
  CustomShader,
  Matrix4,
  MetadataComponentType,
  MetadataType,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Transforms,
  UniformType,
  VoxelContent,
  VoxelPrimitive,
  VoxelShapeType,
  Math as CesiumMath,
  type Cartesian2,
  type Viewer,
  type VoxelProvider
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const show = ref(true)

const gridX = ref(8)
const gridY = ref(8)
const gridZ = ref(25)
const sandDepth = ref(10)
const clayDepth = ref(30)
const scaleXY = ref(1000)
const scaleZ = ref(200)
const stepSize = ref(0.5)

const pickedInfo = ref<{ name: string; depth: number; z: number } | null>(null)

const LITHOLOGY_TABLE: Record<number, { name: string; color: string; alpha: number }> = {
  1: { name: '砂土层', color: '#D2B48C', alpha: 0.8 },
  2: { name: '粘土层', color: '#8FBC8F', alpha: 0.7 },
  3: { name: '基岩层', color: '#696969', alpha: 0.9 }
}

let viewer: Viewer | undefined
let voxelPrimitive: VoxelPrimitive | undefined
let handler: ScreenSpaceEventHandler | undefined

const strataShader = new CustomShader({
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

function buildProvider(): VoxelProvider {
  const gx = gridX.value
  const gy = gridY.value
  const gz = gridZ.value
  const provider = {
    shape: VoxelShapeType.BOX,
    dimensions: new Cartesian3(gx, gy, gz),
    names: ['color'],
    types: [MetadataType.VEC4],
    componentTypes: [MetadataComponentType.FLOAT32],
    availableLevels: 1,
    globalTransform: Matrix4.IDENTITY,
    shapeTransform: Matrix4.IDENTITY,
    requestData: (options: { tileLevel?: number }): Promise<VoxelContent> => {
      const { tileLevel = 0 } = options
      if (tileLevel >= 1) return Promise.reject(new Error('No tiles beyond level 0'))
      const count = gx * gy * gz
      const dataColor = new Float32Array(count * 4)
      for (let z = 0; z < gz; z++) {
        const globalZ = 1.0 - z / (gz - 1)
        const depth = globalZ * scaleZ.value
        let litho: { color: string; alpha: number }
        if (depth < sandDepth.value) litho = LITHOLOGY_TABLE[1]
        else if (depth < clayDepth.value) litho = LITHOLOGY_TABLE[2]
        else litho = LITHOLOGY_TABLE[3]
        const color = Color.fromCssColorString(litho.color)
        for (let y = 0; y < gy; y++) {
          for (let x = 0; x < gx; x++) {
            const index = z * gy * gx + y * gx + x
            const idx4 = index * 4
            dataColor[idx4] = color.red
            dataColor[idx4 + 1] = color.green
            dataColor[idx4 + 2] = color.blue
            dataColor[idx4 + 3] = litho.alpha
          }
        }
      }
      return Promise.resolve(VoxelContent.fromMetadataArray([dataColor]))
    }
  }
  return provider as unknown as VoxelProvider
}

function createStrataTransform(lon: number, lat: number, height: number, sx: number, sy: number, sz: number): Matrix4 {
  const center = Cartesian3.fromDegrees(lon, lat, height)
  const transform = Transforms.eastNorthUpToFixedFrame(center)
  const scale = Matrix4.fromScale(new Cartesian3(sx, sy, sz), new Matrix4())
  return Matrix4.multiply(transform, scale, new Matrix4())
}

function rebuild(): void {
  if (!viewer || viewer.isDestroyed()) return
  try {
    if (voxelPrimitive) {
      viewer.scene.primitives.remove(voxelPrimitive)
      voxelPrimitive = undefined
    }
    pickedInfo.value = null
    const provider = buildProvider()
    const modelMatrix = createStrataTransform(116.39, 39.91, 500, scaleXY.value, scaleXY.value, scaleZ.value)
    const primitive = new VoxelPrimitive({ provider, customShader: strataShader, modelMatrix })
    primitive.nearestSampling = true
    primitive.stepSize = stepSize.value
    primitive.show = show.value
    viewer.scene.primitives.add(primitive)
    voxelPrimitive = primitive
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
}

function onStepSizeChange(): void {
  if (voxelPrimitive) voxelPrimitive.stepSize = stepSize.value
}

function onShowChange(value: boolean): void {
  if (voxelPrimitive) voxelPrimitive.show = value
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
      destination: Cartesian3.fromDegrees(116.39, 39.91, 2800),
      orientation: { heading: 0, pitch: CesiumMath.toRadians(-38), roll: 0 }
    })
    rebuild()
    handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((movement: { endPosition: Cartesian2 }) => {
      if (!voxelPrimitive || !viewer || viewer.isDestroyed()) return
      const picked = viewer.scene.pickVoxel(movement.endPosition)
      if (!picked || picked.primitive !== voxelPrimitive) {
        strataShader.uniforms.u_selectedTile.value = -1
        strataShader.uniforms.u_selectedSample.value = -1
        pickedInfo.value = null
        return
      }
      strataShader.uniforms.u_selectedTile.value = picked.tileIndex
      strataShader.uniforms.u_selectedSample.value = picked.sampleIndex
      const nxy = gridX.value * gridY.value
      const z = Math.floor((picked.sampleIndex % (nxy * gridZ.value)) / nxy)
      const depth = (1.0 - z / (gridZ.value - 1)) * scaleZ.value
      let name: string
      if (depth < sandDepth.value) name = LITHOLOGY_TABLE[1].name
      else if (depth < clayDepth.value) name = LITHOLOGY_TABLE[2].name
      else name = LITHOLOGY_TABLE[3].name
      pickedInfo.value = { name, depth: Number(depth.toFixed(1)), z }
    }, ScreenSpaceEventType.MOUSE_MOVE)
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
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
  <div class="vs-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">地层体素数据</div>
      <div class="row">
        <span class="row-label">显示体素</span>
        <button class="toggle" :class="{ on: show }" :aria-label="show ? '隐藏体素' : '显示体素'" @click="show = !show; onShowChange(show)"><i></i></button>
      </div>

      <div class="slider-row">
        <label>水平网格 X <em>{{ gridX }}</em></label>
        <input type="range" min="4" max="16" step="2" v-model.number="gridX" @change="rebuild" />
      </div>
      <div class="slider-row">
        <label>水平网格 Y <em>{{ gridY }}</em></label>
        <input type="range" min="4" max="16" step="2" v-model.number="gridY" @change="rebuild" />
      </div>
      <div class="slider-row">
        <label>垂直层数 <em>{{ gridZ }}</em></label>
        <input type="range" min="8" max="40" step="1" v-model.number="gridZ" @change="rebuild" />
      </div>
      <div class="slider-row">
        <label>砂土厚度(m) <em>{{ sandDepth }}</em></label>
        <input type="range" min="1" max="25" step="1" v-model.number="sandDepth" @change="rebuild" />
      </div>
      <div class="slider-row">
        <label>粘土深度(m) <em>{{ clayDepth }}</em></label>
        <input type="range" min="10" max="60" step="1" v-model.number="clayDepth" @change="rebuild" />
      </div>
      <div class="slider-row">
        <label>水平范围(m) <em>{{ scaleXY }}</em></label>
        <input type="range" min="200" max="3000" step="100" v-model.number="scaleXY" @change="rebuild" />
      </div>
      <div class="slider-row">
        <label>垂直厚度(m) <em>{{ scaleZ }}</em></label>
        <input type="range" min="100" max="800" step="50" v-model.number="scaleZ" @change="rebuild" />
      </div>
      <div class="slider-row">
        <label>步长 <em>{{ stepSize }}</em></label>
        <input type="range" min="0.2" max="2" step="0.1" v-model.number="stepSize" @change="onStepSizeChange" />
      </div>
      <p class="hint">
        规则体素网格模拟地层：顶面砂土棕褐、中间粘土灰绿、底部基岩深灰。鼠标悬停体块查询岩性与深度；调整参数后自动重建体素网格，垂直厚度同时决定分层位置。
      </p>
    </div>

    <div v-if="pickedInfo" class="pick-panel">
      <div class="pick-title">地层信息</div>
      <div class="pick-row"><span>岩性</span><b>{{ pickedInfo.name }}</b></div>
      <div class="pick-row"><span>深度</span><b>{{ pickedInfo.depth }} m</b></div>
      <div class="pick-row"><span>层号</span><b>第 {{ pickedInfo.z }} 层</b></div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.vs-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 264px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.88); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
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
.pick-panel { position: absolute; top: 12px; left: 12px; z-index: 10; width: 168px; padding: 9px 11px; border: 1px solid rgba(101, 211, 235, 0.4); border-radius: 8px; background: rgba(8, 24, 48, 0.9); backdrop-filter: blur(6px); font-size: 11px; color: #dce8f5; box-sizing: border-box; }
.pick-title { font-size: 12px; font-weight: 700; color: #65d3eb; letter-spacing: 0.04em; }
.pick-row { display: flex; justify-content: space-between; align-items: center; margin-top: 5px; }
.pick-row span { color: #c3d5e8; }
.pick-row b { color: #ffffff; font-weight: 700; }
.hint { margin: 10px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.55; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
