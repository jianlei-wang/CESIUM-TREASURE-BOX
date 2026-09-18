<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian3,
  Color,
  ConstantProperty,
  GeoJsonDataSource,
  Math as CesiumMath,
  type DataSource,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { FlowLineMaterialProperty, registerFlowMaterials } from '../flow-lines-lib/materials'
import trailUrl from './trail.png'
import roadJson from './road.json'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')

const lineWidth = ref(3)
const flowSpeed = ref(30)
const brightness = ref(1.6)
const tintId = ref<'none' | 'red' | 'green' | 'blue'>('none')

const TINT_COLORS: Record<string, Color | null> = {
  none: null,
  red: new Color(1.0, 0.25, 0.25, 0.95),
  green: new Color(0.3, 1.0, 0.55, 0.95),
  blue: new Color(0.35, 0.65, 1.0, 0.95)
}

let viewer: Viewer | undefined
let disposed = false
let dataSource: DataSource | undefined
let materials: Array<FlowLineMaterialProperty> = []

function currentColor(): Color {
  const tint = TINT_COLORS[tintId.value]
  if (tint) return Color.clone(tint)
  const b = Math.max(0.2, brightness.value)
  return new Color(b, b, b, 0.92)
}

function styleRoads(): void {
  if (!viewer || viewer.isDestroyed() || !dataSource) return
  const color = currentColor()
  const entities = dataSource.entities.values
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    const line = entity.polyline
    if (!line) continue
    line.width = new ConstantProperty(lineWidth.value)
    if (line.material instanceof FlowLineMaterialProperty) {
      line.material.color = color
      line.material.speed = flowSpeed.value
    }
  }
}

function onStyleChange(): void {
  styleRoads()
}

onMounted(async () => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    registerFlowMaterials()
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(119.465, 35.368, 9000),
      orientation: { heading: CesiumMath.toRadians(-18), pitch: CesiumMath.toRadians(-62), roll: 0 }
    })

    const ds = await GeoJsonDataSource.load(roadJson as never)
    if (disposed || !viewer || viewer.isDestroyed()) return
    dataSource = ds
    await viewer.dataSources.add(ds)
    const color = currentColor()
    const entities = ds.entities.values
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      const line = entity.polyline
      if (!line) continue
      line.width = new ConstantProperty(lineWidth.value)
      const material = new FlowLineMaterialProperty(color, flowSpeed.value, trailUrl)
      line.material = material
      materials.push(material)
    }
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  materials = []
  if (viewer && !viewer.isDestroyed() && dataSource) {
    viewer.dataSources.remove(dataSource)
  }
  destroyScene(viewer)
  viewer = undefined
  dataSource = undefined
})
</script>

<template>
  <div class="shuttle-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="shuttle-panel">
      <div class="panel-title">穿梭流光道路线</div>
      <div class="row">
        <span class="row-label">线宽</span>
        <input v-model.number="lineWidth" class="slider" type="range" min="1" max="10" step="0.5" @change="onStyleChange" />
        <b class="value">{{ lineWidth }}px</b>
      </div>
      <div class="row">
        <span class="row-label">流光速度</span>
        <input v-model.number="flowSpeed" class="slider" type="range" min="5" max="200" step="1" @change="onStyleChange" />
        <b class="value">{{ flowSpeed }}</b>
      </div>
      <div class="row">
        <span class="row-label">亮度/白度</span>
        <input v-model.number="brightness" class="slider" type="range" min="0.3" max="3" step="0.1" :disabled="tintId !== 'none'" @change="onStyleChange" />
        <b class="value">{{ brightness.toFixed(1) }}</b>
      </div>
      <div class="row">
        <span class="row-label">流光色彩</span>
        <select v-model="tintId" class="select" @change="onStyleChange">
          <option value="none">原色</option>
          <option value="red">红色</option>
          <option value="green">绿色</option>
          <option value="blue">蓝色</option>
        </select>
      </div>
      <div class="hint">基于 GeoJSON 路网加载穿梭流光材质，箭头般的亮带沿道路方向持续流动；宽度、速度、亮度与色调均可调整。</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.shuttle-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  overflow: hidden;
  border-radius: 8px;
  background: #152b4c;
}
.cesium-container {
  width: 100%;
  height: 100%;
}
.shuttle-panel {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  width: 256px;
  padding: 11px;
  border: 1px solid rgba(157, 188, 224, 0.22);
  border-radius: 9px;
  background: rgba(10, 26, 52, 0.86);
  backdrop-filter: blur(6px);
  color: #dce8f5;
  font-size: 12px;
}
.panel-title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #8ec8ff;
  margin-bottom: 6px;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 7px 0;
}
.row-label {
  flex: 0 0 70px;
  color: #c3d5e8;
  font-size: 11px;
}
.slider {
  flex: 1;
  min-width: 0;
  accent-color: #2f80ed;
}
.slider:disabled {
  opacity: 0.45;
}
.value {
  flex: 0 0 38px;
  color: #9fc2cf;
  font-size: 10px;
  text-align: right;
}
.select {
  background: rgba(20, 42, 80, 0.7);
  border: 1px solid rgba(120, 180, 255, 0.35);
  color: #eaf3ff;
  border-radius: 4px;
  font-size: 12px;
  padding: 2px 4px;
}
.hint {
  margin-top: 8px;
  border-top: 1px solid rgba(157, 188, 224, 0.2);
  padding-top: 6px;
  color: #6d84a3;
  font-size: 10px;
  line-height: 1.6;
}
.status-mask {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: 380px;
  padding: 8px 14px;
  border: 1px solid rgba(137, 210, 233, 0.4);
  border-radius: 7px;
  color: #e8f4fa;
  background: rgba(8, 21, 40, 0.88);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35);
  font-size: 12px;
  pointer-events: none;
  text-align: center;
  line-height: 1.5;
}
</style>
