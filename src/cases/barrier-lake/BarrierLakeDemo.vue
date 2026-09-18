<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { BARRIER_LAKE_KNOWLEDGE } from '../geo-hazard-lib/knowledge'
import { BarrierLakeScene, STEP_COUNT, STEP_META } from './BarrierLakeScene'

const canvasHost = ref<HTMLElement | null>(null)
const flashEl = ref<HTMLElement | null>(null)

const cur = ref(0)
const playing = ref(false)
const labelOn = ref(true)
const spin = ref(false)
const rainManual = ref(false)
const infoOpen = ref(false)

const knowledge = BARRIER_LAKE_KNOWLEDGE
const steps = STEP_META
const nowStep = computed(() => steps[cur.value])
const progress = computed(() => `${((cur.value + 1) / STEP_COUNT) * 100}%`)

let scene: BarrierLakeScene | null = null

function onStepChange(index: number): void {
  cur.value = index
  playing.value = scene?.isPlaying() ?? false
}

function toStep(index: number): void {
  scene?.setPlaying(false)
  playing.value = false
  scene?.gotoStep(index)
}

function prevStep(): void {
  scene?.setPlaying(false)
  playing.value = false
  scene?.prevStep()
}

function nextStep(): void {
  scene?.setPlaying(false)
  playing.value = false
  scene?.nextStep()
}

function togglePlay(): void {
  const next = !playing.value
  playing.value = next
  scene?.setPlaying(next)
}

function reset(): void {
  playing.value = false
  rainManual.value = false
  scene?.setRainManual(false)
  scene?.reset()
}

function toggleLabels(): void {
  labelOn.value = !labelOn.value
  scene?.setLabels(labelOn.value)
}

function toggleSpin(): void {
  spin.value = !spin.value
  scene?.setSpin(spin.value)
}

function toggleRain(): void {
  rainManual.value = !rainManual.value
  scene?.setRainManual(rainManual.value)
}

function setViewPreset(id: number): void {
  scene?.setViewPreset(id)
}

onMounted(() => {
  if (!canvasHost.value) return
  scene = new BarrierLakeScene(canvasHost.value, { onStepChange }, flashEl.value)
})

onBeforeUnmount(() => {
  scene?.dispose()
  scene = null
})

const legend = [
  { color: '#3f7fa8', label: '河水 / 湖水' },
  { color: '#c8a468', label: '堰塞坝（松散堆积体）' },
  { color: '#8a7d6b', label: '滑坡岩块' },
  { color: '#7b5b3a', label: '失稳坡体 / 滑动面' },
  { color: '#a8613f', label: '溃口与洪流' }
]
</script>

<template>
  <div class="fy-shell">
    <div ref="canvasHost" class="scene-canvas"></div>
    <div ref="flashEl" class="quake-flash"></div>

    <div class="control-panel">
      <div class="panel-title-row">
        <span class="panel-title">堰塞湖形成与溃决 3D 演示</span>
        <button class="route-info-btn" title="查看科普知识" @click="infoOpen = true">科普知识</button>
      </div>

      <div class="section-title">阶段演化</div>
      <div class="step-grid">
        <button
          v-for="(s, i) in steps"
          :key="s.name"
          class="step-button"
          :class="{ active: i === cur, done: i < cur }"
          @click="toStep(i)"
        >
          <span class="step-n">{{ i + 1 }}</span>
          <span class="step-t">{{ s.name }}</span>
        </button>
      </div>

      <div class="section-title">播放控制</div>
      <div class="button-row">
        <button class="action-button accent" @click="prevStep">上一步</button>
        <button class="action-button accent" @click="nextStep">下一步</button>
      </div>
      <div class="button-row">
        <button class="action-button primary" @click="togglePlay">{{ playing ? '暂停' : '自动播放' }}</button>
        <button class="action-button danger" @click="reset">重置</button>
      </div>
      <div class="progress-bar"><i :style="{ width: progress }"></i></div>

      <div class="section-title">显示开关</div>
      <div class="mode-row">
        <button class="mode-button" :class="{ active: labelOn }" @click="toggleLabels">标注</button>
        <button class="mode-button" :class="{ active: spin }" @click="toggleSpin">自动旋转</button>
        <button class="mode-button" :class="{ active: rainManual }" @click="toggleRain">叠加降雨</button>
      </div>

      <div class="section-title">视角</div>
      <div class="button-row">
        <button class="action-button accent" @click="setViewPreset(1)">俯视</button>
        <button class="action-button accent" @click="setViewPreset(2)">河谷</button>
      </div>
      <div class="button-row">
        <button class="action-button accent" @click="setViewPreset(3)">坝前</button>
        <button class="action-button accent" @click="setViewPreset(4)">顺河</button>
      </div>

      <div class="hint">左键拖动旋转 · 滚轮缩放 · 右键平移 · ← → 切换阶段</div>
    </div>

    <div class="step-info">
      <div class="step-info-head">
        <span class="step-info-index">STEP {{ cur + 1 }} / {{ STEP_COUNT }}</span>
        <span class="step-info-name">{{ nowStep.name }}</span>
      </div>
      <p class="stage-sub">{{ nowStep.sub }}</p>
      <p class="stage-txt">{{ nowStep.txt }}</p>
      <div class="kv-row">
        <span v-for="v in nowStep.kv" :key="v" class="kv-chip">{{ v }}</span>
      </div>
    </div>

    <div class="stage-bar">
      <button
        v-for="(s, i) in steps"
        :key="s.name"
        class="stage-seg"
        :class="{ active: i === cur, done: i < cur }"
        :title="s.name"
        @click="toStep(i)"
      >
        {{ i + 1 }}
      </button>
    </div>

    <div class="legend">
      <b>图例</b>
      <div v-for="item in legend" :key="item.label" class="legend-item">
        <i class="sw" :style="{ background: item.color }"></i>{{ item.label }}
      </div>
    </div>

    <div v-if="infoOpen" class="route-overlay" @click.self="infoOpen = false">
      <div class="route-modal">
        <div class="route-head">
          <span class="route-title">堰塞湖科普知识</span>
          <button class="help-close route-close" title="关闭" @click="infoOpen = false">×</button>
        </div>
        <div class="route-body">
          <div v-for="sec in knowledge" :key="sec.title" class="route-layer">
            <div class="route-layer-title">{{ sec.title }}</div>
            <template v-for="(blk, bi) in sec.blocks" :key="bi">
              <p v-if="blk.type === 'p'" class="route-text">{{ blk.text }}</p>
              <div v-else-if="blk.type === 'sub'" class="kb-sub">
                <div class="kb-sub-title">{{ blk.title }}</div>
                <p v-for="(para, pi) in blk.paras" :key="pi" class="route-text">{{ para }}</p>
              </div>
              <table v-else-if="blk.type === 'table'" class="kb-table">
                <tbody>
                  <tr>
                    <th v-for="h in blk.head" :key="h">{{ h }}</th>
                  </tr>
                  <tr v-for="(row, ri) in blk.rows" :key="ri">
                    <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
                  </tr>
                </tbody>
              </table>
            </template>
          </div>
          <p class="route-intro">
            数据与表述参考：滑坡堰塞坝形成与溃决机理相关研究、唐家山与白格堰塞湖应急处置公开资料、《中国国家地理》相关报道等。
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fy-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
.scene-canvas { display: block; width: 100%; height: 100%; }
.quake-flash { position: absolute; inset: 0; z-index: 8; pointer-events: none; opacity: 0; box-shadow: inset 0 0 120px 20px rgba(224, 100, 74, 0.55); }

.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 5px; width: 300px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; box-sizing: border-box; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 26, 44, 0.92); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 11px; }
.panel-title { font-size: 12px; font-weight: 700; margin-bottom: 2px; }
.panel-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.route-info-btn { flex: 0 0 auto; min-height: 22px; padding: 0 9px; border: 1px solid rgba(255, 199, 92, 0.55); border-radius: 11px; background: rgba(255, 199, 92, 0.16); color: #ffd666; cursor: pointer; font-size: 10px; line-height: 1; }
.route-info-btn:hover { background: rgba(255, 199, 92, 0.32); }

.step-info { position: absolute; top: 12px; left: 12px; z-index: 10; display: flex; flex-direction: column; gap: 3px; width: 322px; max-height: calc(100% - 140px); overflow-y: auto; padding: 11px 13px; box-sizing: border-box; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 26, 44, 0.92); backdrop-filter: blur(6px); color: #ddf2f8; }
.step-info-head { display: flex; align-items: baseline; gap: 8px; padding-bottom: 5px; border-bottom: 1px solid rgba(137, 210, 233, 0.16); }
.step-info-index { flex: 0 0 auto; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; color: #7fd0e6; }
.step-info-name { font-size: 13px; font-weight: 700; color: #eaf6fb; }

.section-title { margin-top: 7px; margin-bottom: 2px; padding-bottom: 2px; border-bottom: 1px solid rgba(137, 210, 233, 0.16); font-size: 11px; font-weight: 700; color: #7fd0e6; }

.step-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.step-button { display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 5px 2px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 5px; background: rgba(21, 48, 78, 0.55); color: #b9d6e4; cursor: pointer; font-family: inherit; }
.step-button .step-n { font-size: 10px; color: #7f9dbb; }
.step-button .step-t { font-size: 10px; font-weight: 600; white-space: nowrap; }
.step-button:hover { border-color: rgba(137, 210, 233, 0.6); color: #eaf6fb; }
.step-button.active { border-color: rgba(79, 179, 217, 0.95); background: rgba(47, 128, 237, 0.28); color: #fff; }
.step-button.active .step-n { color: #9fdcf5; }
.step-button.done { border-color: rgba(98, 177, 131, 0.7); color: #a6dcc0; }

.button-row { display: flex; gap: 6px; }
.action-button { flex: 1; min-height: 28px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; color: #edfaff; }
.action-button.primary { background: #257f9e; }
.action-button.accent { background: #8a6d1a; color: #fff3d6; }
.action-button.danger { background: #4a5a72; color: #ffd6d6; }
.action-button:disabled { cursor: default; opacity: 0.5; }

.progress-bar { position: relative; height: 3px; margin: 3px 0 2px; overflow: hidden; border-radius: 3px; background: #1e2d3a; }
.progress-bar i { display: block; height: 100%; background: linear-gradient(90deg, #4fb3d9, #d8a24a); transition: width 0.3s; }

.mode-row { display: flex; gap: 4px; }
.mode-button { flex: 1; min-height: 24px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 5px; background: rgba(21, 48, 78, 0.55); color: #b9d6e4; cursor: pointer; font-size: 11px; }
.mode-button.active { border-color: rgba(47, 128, 237, 0.9); background: rgba(47, 128, 237, 0.28); color: #fff; }

.stage-sub { margin: 2px 0 0; font-size: 10px; color: #9fd6ef; }
.stage-txt { margin: 4px 0 0; font-size: 11px; line-height: 1.75; color: #c7dce8; }
.kv-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.kv-chip { padding: 1px 8px; border: 1px solid rgba(137, 210, 233, 0.25); border-radius: 20px; background: rgba(28, 43, 57, 0.75); font-size: 10px; color: #9fb8d4; }

.hint { margin-top: 8px; padding-top: 6px; border-top: 1px solid rgba(137, 210, 233, 0.16); font-size: 10px; line-height: 1.7; color: #7f97ad; }

.stage-bar { position: absolute; bottom: 12px; left: 50%; z-index: 9; display: flex; gap: 4px; transform: translateX(-50%); padding: 5px 8px; border: 1px solid rgba(137, 210, 233, 0.25); border-radius: 6px; background: rgba(8, 26, 44, 0.85); }
.stage-seg { width: 26px; height: 22px; border: 1px solid rgba(137, 210, 233, 0.25); border-radius: 4px; background: rgba(21, 48, 78, 0.5); color: #9fb8d4; cursor: pointer; font-size: 10px; }
.stage-seg.done { border-color: rgba(98, 177, 131, 0.6); color: #a6dcc0; }
.stage-seg.active { border-color: rgba(79, 179, 217, 0.95); background: rgba(47, 128, 237, 0.32); color: #fff; }

.legend { position: absolute; bottom: 74px; left: 12px; z-index: 9; display: flex; flex-direction: column; gap: 4px; padding: 8px 11px; border: 1px solid rgba(137, 210, 233, 0.25); border-radius: 6px; background: rgba(8, 26, 44, 0.85); color: #bcd7e4; font-size: 10px; }
.legend b { margin-bottom: 2px; font-size: 11px; color: #e6f4fa; }
.legend-item { display: flex; align-items: center; gap: 6px; }
.sw { flex: 0 0 auto; width: 13px; height: 9px; border-radius: 2px; }

.route-overlay { position: absolute; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 26px; box-sizing: border-box; background: rgba(4, 13, 26, 0.6); backdrop-filter: blur(2px); }
.route-modal { display: flex; flex-direction: column; width: min(620px, 92%); max-height: 88%; padding: 14px 16px; box-sizing: border-box; border: 1px solid rgba(255, 199, 92, 0.5); border-radius: 10px; background: rgba(10, 28, 48, 0.97); box-shadow: 0 10px 36px rgba(0, 0, 0, 0.45); color: #e3f2f8; }
.route-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid rgba(255, 199, 92, 0.28); }
.route-title { font-size: 13px; font-weight: 700; color: #ffd666; }
.help-close { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: 1px solid rgba(255, 199, 92, 0.5); border-radius: 50%; background: rgba(255, 199, 92, 0.14); color: #ffd666; cursor: pointer; font-size: 15px; line-height: 1; transition: background 0.15s ease, color 0.15s ease; }
.help-close:hover { background: rgba(255, 199, 92, 0.3); color: #fff7e0; }
.route-body { display: flex; flex-direction: column; gap: 9px; overflow-y: auto; padding: 10px 2px 2px; }
.route-intro { margin: 0; font-size: 10.5px; line-height: 1.7; color: #93a9bd; }
.route-layer { padding: 8px 10px; border: 1px solid rgba(137, 210, 233, 0.16); border-radius: 7px; background: rgba(21, 48, 78, 0.35); }
.route-layer-title { margin-bottom: 5px; font-size: 11.5px; font-weight: 700; color: #7fd0e6; }
.route-text { margin: 0 0 6px; font-size: 11px; line-height: 1.75; color: #c7dce8; }
.route-text:last-child { margin-bottom: 0; }
.kb-sub { margin: 4px 0 7px; padding: 6px 9px; border-left: 2px solid rgba(79, 179, 217, 0.7); border-radius: 0 6px 6px 0; background: rgba(16, 38, 62, 0.55); }
.kb-sub-title { margin-bottom: 3px; font-size: 11px; font-weight: 600; color: #cfe0ec; }
.kb-sub .route-text { margin-bottom: 4px; color: #bccbd7; }
.kb-table { width: 100%; margin: 4px 0 7px; border-collapse: collapse; font-size: 10.5px; }
.kb-table th, .kb-table td { padding: 4px 6px; border: 1px solid rgba(137, 210, 233, 0.2); text-align: left; vertical-align: top; color: #c7dce8; }
.kb-table th { background: rgba(28, 53, 82, 0.7); color: #e6f4fa; font-weight: 600; white-space: nowrap; }

@media (max-width: 1100px) {
  .control-panel { width: 262px; }
}
</style>
