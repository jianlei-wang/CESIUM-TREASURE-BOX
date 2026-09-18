<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useMapProviderScene } from '../../lib/use-map-provider-scene'
import { TdtImageryProvider, type TdtStyle } from '../../lib/map-providers'

type Plan = { id: string; label: string; styles: TdtStyle[]; desc: string }
const PLANS: Plan[] = [
  {
    id: 'vec',
    label: '方案一·矢量地图',
    styles: ['vec'],
    desc: '原样例：天地图矢量底图（vec_w）'
  },
  {
    id: 'img-cia',
    label: '方案二·影像+注记',
    styles: ['img', 'cia'],
    desc: '新增方案：卫星影像叠加注记图层（img_w + cia_w）'
  }
]

const statusMessage = ref('')
const planId = ref(PLANS[0].id)
const apiKey = ref('')
const loaded = ref(false)
const scene = useMapProviderScene({
  onStatus: (message) => {
    statusMessage.value = message
  }
})

function apply(): void {
  const plan = PLANS.find((p) => p.id === planId.value)
  if (!plan) return
  const providers = plan.styles.map(
    (style) => new TdtImageryProvider({ style, key: apiKey.value.trim() })
  )
  scene.applyProviders(providers)
  loaded.value = true
  statusMessage.value = `已加载「${plan.label}」（Key 后 8 位 ${apiKey.value.trim().slice(-8) || '为空'}）`
  scene.flyToLonLat(116.391, 39.907, 30000)
}

function ensureLoaded(): void {
  if (!apiKey.value.trim()) {
    statusMessage.value = '请先输入天地图 Key（tk），再点击「加载底图」'
    loaded.value = false
    return
  }
  apply()
}

onMounted(() => {
  scene.mount()
  statusMessage.value = '天地图需要 Key（tk）。请先到 https://console.tianditu.gov.cn 申请，输入后点击「加载底图」'
})

onBeforeUnmount(() => {
  scene.teardown()
})
</script>

<template>
  <div class="map-shell">
    <div :ref="scene.container" class="map-container"></div>

    <div class="control-panel">
      <div class="panel-title">天地图底图</div>
      <div class="hint">天地图瓦片服务，Key 以参数形式手动输入后再加载场景。</div>

      <div class="section-title">Key 配置</div>
      <div class="control-row key-row">
        <input v-model="apiKey" class="key-input" type="password" placeholder="请输入天地图 Key（tk）" />
      </div>
      <button class="load-btn" @click="ensureLoaded">加载底图</button>

      <div class="section-title">方案切换</div>
      <div class="plan-list">
        <button
          v-for="p in PLANS"
          :key="p.id"
          class="plan-btn"
          :class="{ active: planId === p.id }"
          @click="planId = p.id; ensureLoaded()"
        >
          {{ p.label }}
        </button>
      </div>
      <p class="plan-desc">{{ PLANS.find((p) => p.id === planId)?.desc }}</p>

      <p class="status-tip" :class="{ warn: !loaded }">{{ statusMessage }}</p>
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
.key-row { display: block; }
.key-input { width: 100%; height: 26px; padding: 0 8px; border-radius: 5px; border: 1px solid rgba(157, 188, 224, 0.24); background: rgba(8, 21, 40, 0.55); color: #e6eef9; font-size: 11px; box-sizing: border-box; }
.load-btn { width: 100%; height: 28px; margin-top: 6px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; background: #2f80ed; color: #eef4ff; }
.plan-list { display: flex; flex-direction: column; gap: 4px; }
.plan-btn { width: 100%; height: 26px; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 5px; cursor: pointer; font-size: 11px; background: rgba(8, 21, 40, 0.55); color: #c3d5e8; text-align: left; padding: 0 8px; }
.plan-btn.active { background: #2f80ed; color: #eef4ff; border-color: #2f80ed; }
.plan-desc { margin: 6px 0 0; font-size: 10px; color: #6d84a3; line-height: 1.5; }
.hint { margin: 0 0 2px; font-size: 10px; color: #6d84a3; line-height: 1.5; }
.status-tip { margin: 8px 0 0; font-size: 10px; color: #8be0b2; line-height: 1.5; }
.status-tip.warn { color: #ffd08a; }
</style>
