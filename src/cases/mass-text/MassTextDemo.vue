<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  BillboardCollection,
  Cartesian3,
  Color,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const count = ref(100000)
const poolSize = ref(100)
const fontSize = ref(20)
const scale = ref(0.6)
const border = ref(false)
const colorMode = ref<'random' | 'single'>('random')
const singleColor = ref('#ffd54a')
const distribution = ref<'china' | 'world'>('china')
const generating = ref(false)
const progress = ref(0)
const elapsedMs = ref(0)
const renderedCount = ref(0)
const textPoolCount = ref(0)

const COUNT_OPTIONS = [10000, 50000, 100000, 500000, 1000000]
const POOL_OPTIONS = [10, 50, 100, 500, 1000]
const HANZI = '京沪津渝冀晋蒙辽吉黑苏浙皖闽赣鲁豫鄂湘粤桂琼川贵云藏陕甘青宁新港澳台'

let viewer: Viewer | undefined
let billboards: BillboardCollection | undefined
let generationToken = 0
const textImageCache = new Map<string, string>()

function nextFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function randomHanzi(count: number): string {
  let text = ''
  for (let i = 0; i < count; i += 1) {
    text += HANZI[Math.floor(Math.random() * HANZI.length)]
  }
  return text
}

function createCanvasText(): (options: { text: string; fontSize?: number; color?: string; border?: boolean }) => string {
  const maxWidth = 160
  const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2)

  const canvas = document.createElement('canvas')
  canvas.width = maxWidth * devicePixelRatio
  canvas.height = 48 * devicePixelRatio
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => ''

  return (parameters) => {
    const { text, color = '#ffffff', fontSize: fs = 20, border: useBorder = false } = parameters
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = color
    ctx.font = `${fs}px "Microsoft YaHei", "PingFang SC", sans-serif`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.shadowColor = 'rgba(0,0,0,0.65)'
    ctx.shadowBlur = 4
    if (useBorder) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 2
      ctx.strokeText(text, canvas.width / 2, canvas.height / 2)
    }
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)
    return canvas.toDataURL()
  }
}

function getTextImage(text: string, color: string): string {
  const key = `${text}|${fontSize.value}|${color}|${border.value}`
  const cached = textImageCache.get(key)
  if (cached) return cached
  const image = createCanvasText()({ text, fontSize: fontSize.value, color, border: border.value })
  textImageCache.set(key, image)
  return image
}

function resolveColor(index: number): Color {
  if (colorMode.value === 'single') {
    return Color.fromCssColorString(singleColor.value)
  }
  return Color.fromHsl(Math.random(), 0.8, 0.65)
}

function randomPosition(index: number, total: number): { longitude: number; latitude: number } {
  if (distribution.value === 'china') {
    return {
      longitude: 73 + Math.random() * 62,
      latitude: 18 + Math.random() * 36
    }
  }
  const goldenAngle = index * 2.399963229728653
  const radius = Math.sqrt(index / total)
  return {
    longitude: 180 * radius * Math.cos(goldenAngle),
    latitude: 90 * radius * Math.sin(goldenAngle)
  }
}

function removeCollection(): void {
  if (billboards && viewer && !viewer.isDestroyed()) {
    viewer.scene.primitives.remove(billboards)
  }
  billboards = undefined
}

async function regenerate(): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  const token = ++generationToken
  removeCollection()
  textImageCache.clear()
  generating.value = true
  progress.value = 0
  renderedCount.value = 0
  textPoolCount.value = 0
  const startedAt = performance.now()

  const total = count.value
  const pool = poolSize.value
  const texts: string[] = []
  for (let i = 0; i < pool; i += 1) {
    texts.push(i % 4 === 0 ? `城市${i + 1}` : randomHanzi(2))
  }

  billboards = new BillboardCollection()
  viewer.scene.primitives.add(billboards)

  const chunkSize = 20000
  for (let i = 0; i < total; i += chunkSize) {
    if (token !== generationToken) return
    const end = Math.min(i + chunkSize, total)
    for (let j = i; j < end; j++) {
      const text = texts[Math.floor(Math.random() * pool)]
      const image = getTextImage(text, '#ffffff')
      const { longitude, latitude } = randomPosition(j, total)
      billboards.add({
        position: Cartesian3.fromDegrees(longitude, latitude),
        image,
        color: resolveColor(j),
        scale: scale.value,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      })
    }
    progress.value = end / total
    renderedCount.value = end
    await nextFrame()
  }

  if (token !== generationToken) return
  textPoolCount.value = pool
  elapsedMs.value = Math.round(performance.now() - startedAt)
  generating.value = false
  progress.value = 1
  statusMessage.value = ''
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
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(105, 36, 8000000)
    })
    regenerate()
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  generationToken += 1
  removeCollection()
  textImageCache.clear()
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="mass-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">海量随机文字加载</div>

      <div class="section-title">数量</div>
      <div class="count-group">
        <button
          v-for="option in COUNT_OPTIONS"
          :key="option"
          class="count-button"
          :class="{ active: count === option }"
          :disabled="generating"
          @click="count = option"
        >
          {{ option >= 10000 ? `${option / 10000}万` : option }}
        </button>
      </div>

      <div class="section-title">文字池</div>
      <div class="count-group">
        <button
          v-for="option in POOL_OPTIONS"
          :key="option"
          class="count-button"
          :class="{ active: poolSize === option }"
          :disabled="generating"
          @click="poolSize = option"
        >
          {{ option }}
        </button>
      </div>

      <div class="section-title">生成参数</div>
      <div class="control-row">
        <span class="row-label">字号</span>
        <input v-model.number="fontSize" type="range" min="12" max="48" step="1" :disabled="generating" />
        <span class="row-value">{{ fontSize }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">缩放</span>
        <input v-model.number="scale" type="range" min="0.2" max="2" step="0.1" :disabled="generating" />
        <span class="row-value">{{ scale.toFixed(1) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">白边</span>
        <label class="switch">
          <input v-model="border" type="checkbox" :disabled="generating" />
          <span class="switch-slider"></span>
        </label>
      </div>
      <div class="control-row">
        <span class="row-label">分布</span>
        <div class="mode-group">
          <button class="mode-button" :class="{ active: distribution === 'china' }" :disabled="generating" @click="distribution = 'china'">中国</button>
          <button class="mode-button" :class="{ active: distribution === 'world' }" :disabled="generating" @click="distribution = 'world'">全球</button>
        </div>
      </div>

      <div class="section-title">颜色模式</div>
      <div class="mode-group">
        <button class="mode-button" :class="{ active: colorMode === 'random' }" :disabled="generating" @click="colorMode = 'random'">随机色</button>
        <button class="mode-button" :class="{ active: colorMode === 'single' }" :disabled="generating" @click="colorMode = 'single'">单色</button>
      </div>
      <div v-if="colorMode === 'single'" class="color-row">
        <label class="color-field">
          <span class="field-label">颜色</span>
          <input v-model="singleColor" type="color" :disabled="generating" />
        </label>
      </div>

      <button class="action-button primary" :disabled="generating" @click="regenerate">
        {{ generating ? `生成中 ${Math.round(progress * 100)}%…` : '重新生成' }}
      </button>

      <p class="hint">
        <template v-if="generating">正在生成 {{ count >= 10000 ? `${count / 10000}万` : count }} 个文字标记，请稍候…</template>
        <template v-else>当前已渲染 {{ renderedCount >= 10000 ? `${renderedCount / 10000}万` : renderedCount }} 个{{ textPoolCount ? `（${textPoolCount} 种文字贴图）` : '' }}{{ elapsedMs ? `，耗时 ${elapsedMs} ms` : '' }}</template>
      </p>
      <p class="warn">BillboardCollection 批量渲染；文字贴图按池去重缓存，十万级流畅，百万级生成与渲染耗时较长、内存占用高。</p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.mass-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 268px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.count-group { display: flex; flex-wrap: wrap; gap: 4px; }
.count-button { height: 22px; padding: 0 8px; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 4px; background: #2c3a52; color: #c3d5e8; font-size: 10px; cursor: pointer; }
.count-button.active { background: #2f80ed; color: #eef4ff; border-color: #2f80ed; }
.count-button:disabled, .mode-button:disabled, .action-button:disabled, input:disabled { opacity: 0.5; cursor: not-allowed; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 42px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.mode-group { display: flex; gap: 4px; flex: 1; }
.mode-button { flex: 1; height: 22px; padding: 0 4px; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 4px; background: #2c3a52; color: #c3d5e8; font-size: 10px; cursor: pointer; }
.mode-button.active { background: #2f80ed; color: #eef4ff; border-color: #2f80ed; }
.switch { position: relative; display: inline-block; width: 30px; height: 16px; flex: 0 0 auto; }
.switch input { opacity: 0; width: 0; height: 0; }
.switch-slider { position: absolute; inset: 0; border-radius: 8px; background: #2c3a52; transition: background 0.2s; }
.switch-slider::before { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #9fb8d4; transition: transform 0.2s; }
.switch input:checked + .switch-slider { background: #2f80ed; }
.switch input:checked + .switch-slider::before { transform: translateX(14px); background: #ffffff; }
.color-row { display: flex; gap: 8px; margin-top: 6px; }
.color-field { display: flex; align-items: center; gap: 5px; flex: 1; }
.field-label { color: #c3d5e8; font-size: 10px; }
.color-field input[type="color"] { width: 100%; height: 22px; padding: 0; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 4px; background: transparent; cursor: pointer; }
.action-button { width: 100%; height: 28px; margin-top: 10px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; background: #2f80ed; color: #eef4ff; }
.hint { margin: 8px 0 0; font-size: 10px; color: #9fb8d4; line-height: 1.5; }
.warn { margin: 4px 0 0; font-size: 10px; color: #c99a5a; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
