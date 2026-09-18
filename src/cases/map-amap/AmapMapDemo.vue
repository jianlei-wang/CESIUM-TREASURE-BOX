<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useMapProviderScene } from '../../lib/use-map-provider-scene'
import { AMapImageryProvider, type AMapStyle } from '../../lib/map-providers'

type Plan = { id: string; label: string; styles: AMapStyle[]; desc: string }
const PLANS: Plan[] = [
  {
    id: 'elec',
    label: '方案一·电子地图',
    styles: ['elec'],
    desc: '原样例：高德电子地图（style=elec，web 电子图）'
  },
  {
    id: 'img-cva',
    label: '方案二·影像+注记',
    styles: ['img', 'cva'],
    desc: '新增方案：卫星影像图层上叠加中文注记图层'
  }
]

const CRS_OPTIONS = [
  { label: 'GCJ02（国内坐标）', value: 'GCJ02' },
  { label: 'WGS84（全球坐标）', value: 'WGS84' }
]

const statusMessage = ref('')
const planId = ref(PLANS[0].id)
const crs = ref<'GCJ02' | 'WGS84'>('GCJ02')
const scene = useMapProviderScene({
  onStatus: (message) => {
    statusMessage.value = message
  }
})

function apply(): void {
  const plan = PLANS.find((p) => p.id === planId.value)
  if (!plan) return
  const providers = plan.styles.map(
    (style) => new AMapImageryProvider({ style, crs: crs.value })
  )
  scene.applyProviders(providers)
  statusMessage.value = ''
  scene.flyToLonLat(116.391, 39.907, 30000)
}

onMounted(() => {
  scene.mount()
  apply()
})

onBeforeUnmount(() => {
  scene.teardown()
})
</script>

<template>
  <div class="map-shell">
    <div :ref="scene.container" class="map-container"></div>

    <div class="control-panel">
      <div class="panel-title">高德地图底图</div>
      <div class="hint">高德瓦片服务，自动子域轮询，支持国内坐标与全球坐标切换。</div>

      <div class="section-title">方案切换</div>
      <div class="plan-list">
        <button
          v-for="p in PLANS"
          :key="p.id"
          class="plan-btn"
          :class="{ active: planId === p.id }"
          @click="planId = p.id; apply()"
        >
          {{ p.label }}
        </button>
      </div>
      <p class="plan-desc">{{ PLANS.find((p) => p.id === planId)?.desc }}</p>

      <div class="section-title">坐标系</div>
      <div class="control-row">
        <span class="row-label">坐标系</span>
        <select v-model="crs" class="select-input" @change="apply">
          <option v-for="c in CRS_OPTIONS" :key="c.value" :value="c.value">{{ c.label }}</option>
        </select>
      </div>

      <p v-if="statusMessage" class="status-tip">{{ statusMessage }}</p>
    </div>
  </div>
</template>

<style scoped>
.map-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.map-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 248px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.84); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 6px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.select-input { width: 150px; height: 24px; padding: 0 4px; border-radius: 5px; border: 1px solid rgba(157, 188, 224, 0.24); background: rgba(8, 21, 40, 0.55); color: #e6eef9; font-size: 11px; }
.plan-list { display: flex; flex-direction: column; gap: 4px; }
.plan-btn { width: 100%; height: 26px; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 5px; cursor: pointer; font-size: 11px; background: rgba(8, 21, 40, 0.55); color: #c3d5e8; text-align: left; padding: 0 8px; }
.plan-btn.active { background: #2f80ed; color: #eef4ff; border-color: #2f80ed; }
.plan-desc { margin: 6px 0 0; font-size: 10px; color: #6d84a3; line-height: 1.5; }
.hint { margin: 0 0 2px; font-size: 10px; color: #6d84a3; line-height: 1.5; }
.status-tip { margin: 8px 0 0; font-size: 10px; color: #ffd08a; line-height: 1.5; }
</style>
