<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { Cartesian2, Cartesian3, Color, type Viewer } from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import LayerTreePanel from '../layer-tree-lib/LayerTreePanel.vue'
import { LayerType, type LayerAddPreset, type LayerConfig, type LayerTreeControl, type LayerTreeOptions } from '../layer-tree-lib'

const TILESET_URL = '/dayanta/tileset.json'
const MODEL_URL = '/data/model/launchvehicle/launchvehicle.gltf'

const container = ref<HTMLElement | null>(null)
const viewer = shallowRef<Viewer | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')

let readyDone = false
let addSeq = 0

const options: LayerTreeOptions = {
  theme: 'dark',
  position: 'top-right',
  enableSearch: true,
  enableDragDrop: true,
  enableContextMenu: true,
  enableRename: true,
  enableDelete: true,
  enableOpacity: true,
  enableAddButton: true,
  confirmOnDelete: true,
  syncImageryOrder: true,
  terrainExclusive: true
}

function nextName(base: string): string {
  addSeq += 1
  return `${base} ${addSeq}`
}

function sampleGeoJson(): Record<string, unknown> {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: '示例行政区域', level: 'demo' },
        geometry: {
          type: 'Polygon',
          coordinates: [[[116.33, 39.93], [116.46, 39.93], [116.46, 39.87], [116.33, 39.87], [116.33, 39.93]]]
        }
      }
    ]
  }
}

const presets: LayerAddPreset[] = [
  {
    label: 'OSM 街道',
    hint: 'IMAGERY',
    config: () => ({
      name: nextName('OSM 街道'),
      type: LayerType.IMAGERY,
      imagery: { providerType: 'OSM', options: { url: 'https://tile.openstreetmap.org/' } }
    })
  },
  {
    label: '网格参考',
    hint: 'IMAGERY',
    config: () => ({
      name: nextName('网格参考'),
      type: LayerType.IMAGERY,
      imagery: { providerType: 'Grid', options: {} }
    })
  },
  {
    label: '全球地形',
    hint: 'TERRAIN',
    config: () => ({
      name: nextName('全球地形'),
      type: LayerType.TERRAIN,
      terrain: { providerType: 'world', options: { requestVertexNormals: true } }
    })
  },
  {
    label: '大雁塔 3D Tiles',
    hint: 'TILESET',
    config: () => ({
      name: nextName('大雁塔'),
      type: LayerType.TILESET,
      tileset: { url: TILESET_URL, options: { maximumScreenSpaceError: 16 } }
    })
  },
  {
    label: '运载火箭模型',
    hint: 'MODEL',
    config: () => ({
      name: nextName('运载火箭'),
      type: LayerType.MODEL,
      model: {
        url: MODEL_URL,
        options: { lon: 116.4208, lat: 39.9152, height: 40, heading: 30, scale: 1, minimumPixelSize: 128 }
      }
    })
  },
  {
    label: '城市标签',
    hint: 'LABEL',
    config: () => ({
      name: nextName('城市标签'),
      type: LayerType.PRIMITIVE,
      primitive: {
        primitiveType: 'label',
        options: {
          lon: 116.3974,
          lat: 39.9093,
          altitude: 260,
          text: '北京',
          color: '#ffd166',
          font: '700 22px sans-serif'
        }
      }
    })
  },
  {
    label: '粒子喷泉',
    hint: 'PARTICLE',
    config: () => ({
      name: nextName('粒子喷泉'),
      type: LayerType.PARTICLE,
      particle: {
        options: {
          lon: 116.3974,
          lat: 39.9093,
          height: 120,
          startColor: '#ffe08a',
          endColor: '#ff6b3d',
          rate: 80,
          minimumSpeed: 20,
          maximumSpeed: 60
        }
      }
    })
  },
  {
    label: '示例区域面',
    hint: 'GEOJSON',
    config: () => ({
      name: nextName('示例区域'),
      type: LayerType.DATASOURCE,
      datasource: { format: 'geojson', data: sampleGeoJson() }
    })
  }
]

const INITIAL_LAYERS: LayerConfig[] = [
  {
    name: '底图与影像',
    type: LayerType.GROUP,
    visible: true,
    expanded: true,
    children: [
      {
        name: 'OSM 街道',
        type: LayerType.IMAGERY,
        imagery: { providerType: 'OSM', options: { url: 'https://tile.openstreetmap.org/' } },
        opacity: 0.85
      },
      {
        name: '网格参考',
        type: LayerType.IMAGERY,
        imagery: { providerType: 'Grid', options: {} },
        visible: false
      }
    ]
  },
  {
    name: '三维数据',
    type: LayerType.GROUP,
    visible: true,
    expanded: true,
    children: [
      {
        name: '大雁塔 3D Tiles',
        type: LayerType.TILESET,
        tileset: { url: TILESET_URL, options: { maximumScreenSpaceError: 16 } }
      },
      {
        name: '运载火箭模型',
        type: LayerType.MODEL,
        model: {
          url: MODEL_URL,
          options: { lon: 116.4208, lat: 39.9152, height: 40, heading: 30, scale: 1, minimumPixelSize: 128 }
        }
      }
    ]
  },
  {
    name: '矢量与标注',
    type: LayerType.GROUP,
    visible: true,
    expanded: true,
    children: [
      {
        name: '天安门标注',
        type: LayerType.ENTITY,
        entity: {
          name: '天安门',
          position: Cartesian3.fromDegrees(116.3974, 39.9093, 40),
          point: {
            pixelSize: 10,
            color: Color.fromCssColorString('#ffd166'),
            outlineColor: Color.WHITE,
            outlineWidth: 2
          },
          label: {
            text: '天安门',
            font: '600 15px sans-serif',
            fillColor: Color.WHITE,
            outlineColor: Color.BLACK,
            outlineWidth: 3,
            pixelOffset: new Cartesian2(0, -22)
          }
        }
      },
      {
        name: '示例区域',
        type: LayerType.DATASOURCE,
        datasource: { format: 'geojson', data: sampleGeoJson() }
      },
      {
        name: '城市标签',
        type: LayerType.PRIMITIVE,
        primitive: {
          primitiveType: 'label',
          options: {
            lon: 116.3974,
            lat: 39.9093,
            altitude: 260,
            text: '北京',
            color: '#ffd166',
            font: '700 22px sans-serif'
          }
        }
      }
    ]
  },
  {
    name: '全球地形',
    type: LayerType.TERRAIN,
    visible: true,
    terrain: { providerType: 'world', options: { requestVertexNormals: true } }
  }
]

const callbacks: SceneCallbacks = {
  onStatus: (message) => {
    statusMessage.value = message
  },
  onBasemapReady: (name) => {
    statusMessage.value = `${name} 加载完成，可在地图中操作图层树`
    window.setTimeout(() => {
      statusMessage.value = ''
    }, 2600)
  }
}

async function onReady(control: LayerTreeControl): Promise<void> {
  if (readyDone) return
  readyDone = true
  try {
    await control.addLayers(INITIAL_LAYERS)
    control.expandAll()
  } catch (error) {
    console.error('[layer-tree] 初始化图层失败', error)
  }
}

onMounted(() => {
  if (!container.value) return
  const instance = createMapScene(container.value, callbacks)
  viewer.value = instance
  loadBingImagery(instance, callbacks)
})

onUnmounted(() => {
  destroyScene(viewer.value ?? undefined)
  viewer.value = null
})
</script>

<template>
  <div class="lt-page">
    <div ref="container" class="lt-viewer"></div>

    <div class="lt-panel-slot">
      <LayerTreePanel
        :viewer="viewer"
        title="场景图层"
        :options="options"
        :presets="presets"
        @ready="onReady"
      />
    </div>

    <div class="lt-legend">
      <b>标准图层树控件</b>
      <span>单击选择，双击重命名，空格显隐，Enter 定位</span>
      <span>支持拖拽排序、Ctrl/Shift 多选、右键菜单与配置导出</span>
    </div>

    <div v-if="statusMessage" class="lt-status">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.lt-page {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  overflow: hidden;
  border-radius: 8px;
  background: #152b4c;
}
.lt-viewer {
  width: 100%;
  height: 100%;
}
.lt-panel-slot {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  display: flex;
  max-height: calc(100% - 24px);
}
.lt-legend {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 9;
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-width: 320px;
  padding: 10px 12px;
  border: 1px solid rgba(157, 188, 224, 0.28);
  border-radius: 9px;
  background: rgba(10, 26, 52, 0.82);
  backdrop-filter: blur(6px);
  color: #c3d5e8;
  font-size: 11px;
  line-height: 1.55;
  pointer-events: none;
}
.lt-legend b {
  color: #dce8f5;
  font-size: 12px;
}
.lt-status {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9;
  width: max-content;
  max-width: 380px;
  padding: 8px 14px;
  border: 1px solid rgba(137, 210, 233, 0.4);
  border-radius: 7px;
  background: rgba(8, 21, 40, 0.88);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35);
  color: #e8f4fa;
  font-size: 12px;
  text-align: center;
  line-height: 1.5;
  pointer-events: none;
}
</style>
