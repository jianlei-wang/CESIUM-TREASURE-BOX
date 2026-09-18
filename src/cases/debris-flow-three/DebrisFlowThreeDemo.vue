<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { DURATION, DEBRIS_STAGES } from '../geo-hazard-lib/model'
import { DEBRIS_KNOWLEDGE } from '../geo-hazard-lib/knowledge'
import { DebrisFlowThreeScene } from './DebrisFlowThreeScene'

const canvasHost = ref<HTMLElement | null>(null)

const p = ref(0)
const cur = ref(0)
const playing = ref(false)
const labelOn = ref(true)
const engOn = ref(false)
const spin = ref(false)
const rainOn = ref(false)
const infoOpen = ref(false)
const speed = ref(1)

let scene: DebrisFlowThreeScene | null = null

const steps = DEBRIS_STAGES
const speeds = [0.5, 1, 2, 4]
const knowledge = DEBRIS_KNOWLEDGE
const progress = computed(() => `${(p.value * 100).toFixed(1)}%`)
const timeText = computed(() => {
  const sec = p.value * DURATION
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`
})

const stageSub = ['暴雨汇流', '启动掺混', '阵流下泄', '出沟堆积']
const stageTxt = [
  '暴雨在沟谷上游形成区汇集，坡面产流汇入沟道，清水冲刷沟床并把松散碎屑带走，沟道开始下切。',
  '水流冲刷加剧，沟床与岸坡的松散固体物质大量加入，水体由清转浑，容重迅速增大，泥石流开始启动掺混。',
  '泥浆裹挟石块呈阵性下泄，龙头在前端翻滚推进，沿途不断裹入沟床物质并冲刷边岸，破坏力达到峰值。',
  '泥石流出沟后地形骤缓、水分下渗，石块泥沙就地停积形成堆积扇，扇体逐渐扩展并威胁沟口村庄。'
]

function onProgress(np: number, isPlaying: boolean, stage: number): void {
  p.value = np
  playing.value = isPlaying
  cur.value = stage
}

function togglePlay(): void {
  scene?.setPlaying(!playing.value)
}

function seek(ev: Event): void {
  scene?.setPlaying(false)
  scene?.setProgress(Number((ev.target as HTMLInputElement).value) / 1000)
}

function toStage(i: number): void {
  scene?.gotoStage(i)
}

function reset(): void {
  scene?.setPlaying(false)
  scene?.setEngineering(false)
  scene?.setRain(false)
  engOn.value = false
  rainOn.value = false
  scene?.setProgress(0)
  scene?.setViewPreset(3)
}

function setSpeed(v: number): void {
  scene?.setSpeed(v)
  speed.value = v
}

function toggleLabels(): void {
  labelOn.value = !labelOn.value
  scene?.setLabels(labelOn.value)
}

function toggleEng(): void {
  engOn.value = !engOn.value
  scene?.setEngineering(engOn.value)
}

function toggleSpin(): void {
  spin.value = !spin.value
  scene?.setSpin(spin.value)
}

function toggleRain(): void {
  rainOn.value = !rainOn.value
  scene?.setRain(rainOn.value)
}

function setViewPreset(id: number): void {
  scene?.setViewPreset(id)
}

onMounted(() => {
  if (!canvasHost.value) return
  scene = new DebrisFlowThreeScene(canvasHost.value, { onProgress })
})

onBeforeUnmount(() => {
  scene?.dispose()
  scene = null
})

const legend = [
  { color: '#7fa650', label: '稳定山体 / 植被坡面' },
  { color: '#9a8256', label: '形成区松散物源' },
  { color: '#6b5334', label: '沟道泥沙 / 沟床' },
  { color: '#5fa8d8', label: '清水汇流' },
  { color: '#4a3620', label: '泥浆（高含沙流体）' },
  { color: '#3b2a19', label: '龙头 / 阵流前锋' },
  { color: '#b3a07e', label: '堆积扇 / 漂砾堆积' },
  { color: '#9aa3ab', label: '防治工程构筑物' }
]
</script>

<template>
  <div class="fy-shell">
    <div ref="canvasHost" class="scene-canvas"></div>

    <div class="control-panel">
      <div class="panel-title-row">
        <span class="panel-title">泥石流形成与运动 3D 演示</span>
        <button class="route-info-btn" title="查看科普知识" @click="infoOpen = true">科普知识</button>
      </div>

      <div class="section-title">阶段演化</div>
      <div class="step-grid">
        <button
          v-for="(s, i) in steps"
          :key="s.name"
          class="step-button"
          :class="{ active: i === cur, done: i < cur }"
          @click="toStage(i)"
        >
          <span class="step-n">{{ i + 1 }}</span>
          <span class="step-t">{{ stageSub[i] }}</span>
        </button>
      </div>

      <div class="section-title">播放控制</div>
      <div class="button-row">
        <button class="action-button primary" @click="togglePlay">{{ playing ? '暂停' : '自动播放' }}</button>
        <button class="action-button danger" @click="reset">重置</button>
      </div>
      <input
        class="hz-range"
        type="range"
        min="0"
        max="1000"
        :value="Math.round(p * 1000)"
        @input="seek"
      />
      <div class="hz-time">进度 {{ progress }} · {{ timeText }}</div>
      <div class="mode-row" style="margin-top: 4px">
        <button
          v-for="s in speeds"
          :key="s"
          class="mode-button"
          :class="{ active: speed === s }"
          @click="setSpeed(s)"
        >
          {{ s }}×
        </button>
      </div>

      <div class="section-title">显示开关</div>
      <div class="mode-row">
        <button class="mode-button" :class="{ active: labelOn }" @click="toggleLabels">标注</button>
        <button class="mode-button" :class="{ active: engOn }" @click="toggleEng">防治工程</button>
      </div>
      <div class="mode-row" style="margin-top: 4px">
        <button class="mode-button" :class="{ active: spin }" @click="toggleSpin">自动旋转</button>
        <button class="mode-button" :class="{ active: rainOn }" @click="toggleRain">叠加降雨</button>
      </div>

      <div class="section-title">视角</div>
      <div class="button-row">
        <button class="action-button accent" @click="setViewPreset(1)">俯视</button>
        <button class="action-button accent" @click="setViewPreset(2)">正视</button>
      </div>
      <div class="button-row">
        <button class="action-button accent" @click="setViewPreset(3)">斜视</button>
        <button class="action-button accent" @click="setViewPreset(4)">侧剖面</button>
      </div>

      <div class="hint">左键拖动旋转 · 滚轮缩放 · 右键平移 · 空格播放/暂停 · ← → 微调进度 · 点击标注查看解释</div>
    </div>

    <div class="step-info">
      <div class="step-info-head">
        <span class="step-info-index">STAGE {{ cur + 1 }} / {{ steps.length }}</span>
        <span class="step-info-name">{{ steps[cur].name }}</span>
      </div>
      <p class="stage-sub">{{ stageSub[cur] }}</p>
      <p class="stage-txt">{{ stageTxt[cur] }}</p>
    </div>

    <div class="stage-bar">
      <button
        v-for="(s, i) in steps"
        :key="s.name"
        class="stage-seg"
        :class="{ active: i === cur, done: i < cur }"
        :title="s.name"
        @click="toStage(i)"
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
          <span class="route-title">泥石流科普知识</span>
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
            数据与表述参考：普通地质学、地貌学与工程地质学通行教材，地质灾害防治相关规范与公开通报。
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fy-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
.scene-canvas { display: block; width: 100%; height: 100%; }

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
.hint { margin-top: 8px; padding-top: 6px; border-top: 1px solid rgba(137, 210, 233, 0.16); font-size: 10px; line-height: 1.7; color: #7f97ad; }

.mode-row { display: flex; gap: 4px; }
.mode-button { flex: 1; min-height: 24px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 5px; background: rgba(21, 48, 78, 0.55); color: #b9d6e4; cursor: pointer; font-size: 11px; }
.mode-button.active { border-color: rgba(47, 128, 237, 0.9); background: rgba(47, 128, 237, 0.28); color: #fff; }

.stage-sub { margin: 2px 0 0; font-size: 10px; color: #9fd6ef; }
.stage-txt { margin: 4px 0 0; font-size: 11px; line-height: 1.75; color: #c7dce8; }

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

.hz-range { width: 100%; height: 4px; margin: 8px 0 3px; -webkit-appearance: none; appearance: none; border-radius: 3px; background: #1e2d3a; outline: none; cursor: pointer; }
.hz-range::-webkit-slider-thumb { -webkit-appearance: none; width: 13px; height: 13px; border: 2px solid #0d2233; border-radius: 50%; background: #4fb3d9; cursor: pointer; }
.hz-range::-moz-range-thumb { width: 11px; height: 11px; border: 2px solid #0d2233; border-radius: 50%; background: #4fb3d9; cursor: pointer; }
.hz-time { font-size: 10px; color: #9fb8d4; font-variant-numeric: tabular-nums; }

@media (max-width: 1100px) {
  .control-panel { width: 262px; }
}
</style>
