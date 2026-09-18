<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, computed } from 'vue'
import {
  UAV_CAT_ORDER,
  UAV_SUBJECTS,
  UavTestFieldScene,
  type UavHudState,
  type UavSubjectState,
  type VerdictKind
} from './UavTestFieldScene'

const canvasHost = ref<HTMLElement | null>(null)

const hud = ref<UavHudState>({ craft: '无人机', status: '自动巡航', alt: 0, manual: false })
const subject = ref<UavSubjectState | null>(null)
const metrics = ref('')
const verdict = ref<{ text: string; kind: VerdictKind }>({ text: '测试中', kind: 'run' })

const showPilot = computed(() => subject.value === null)

const groups = computed(() =>
  UAV_CAT_ORDER.map((cat) => ({ cat, items: UAV_SUBJECTS.filter((s) => s.cat === cat) })).filter((g) => g.items.length > 0)
)

let scene: UavTestFieldScene | null = null

function noLabel(no?: number, free?: boolean): string {
  if (free) return '总'
  return String(no ?? '')
}

function onSubjectItem(id: string, free?: boolean): void {
  if (free) {
    scene?.exitTest()
  } else {
    scene?.enterSubject(id)
  }
}

function toggleManual(): void {
  scene?.toggleManual()
}

function retest(): void {
  scene?.retest()
}

function exitTest(): void {
  scene?.exitTest()
}

/* --------------------------- 虚拟摇杆 --------------------------- */
const joyKnob = ref<{ left: { x: number; y: number }; right: { x: number; y: number } }>({
  left: { x: 0, y: 0 },
  right: { x: 0, y: 0 }
})
const joyOn = ref<{ left: boolean; right: boolean }>({ left: false, right: false })
const R = 32

function joyStart(side: 'left' | 'right', e: PointerEvent): void {
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  joyOn.value[side] = true
  joyMove(side, e)
}

function joyMove(side: 'left' | 'right', e: PointerEvent): void {
  if (!joyOn.value[side]) return
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  let dx = e.clientX - (r.left + r.width / 2)
  let dy = e.clientY - (r.top + r.height / 2)
  const d = Math.hypot(dx, dy)
  if (d > R) {
    dx *= R / d
    dy *= R / d
  }
  joyKnob.value[side] = { x: dx, y: dy }
  scene?.setJoystick(side, dx / R, dy / R)
}

function joyEnd(side: 'left' | 'right', e: PointerEvent): void {
  if (!joyOn.value[side]) return
  joyOn.value[side] = false
  joyKnob.value[side] = { x: 0, y: 0 }
  scene?.setJoystick(side, 0, 0)
  void e
}

onMounted(() => {
  if (!canvasHost.value) return
  scene = new UavTestFieldScene(canvasHost.value, {
    onHud: (s) => {
      hud.value = s
    },
    onSubject: (s) => {
      subject.value = s
    },
    onMetrics: (html) => {
      metrics.value = html
    },
    onVerdict: (text, kind) => {
      verdict.value = { text, kind }
    }
  })
})

onBeforeUnmount(() => {
  scene?.dispose()
  scene = null
})
</script>

<template>
  <div class="ut-shell">
    <div ref="canvasHost" class="ut-canvas"></div>

    <div class="ut-title">
      <h1>无人机试飞场</h1>
      <p>Drone Test Flight Field — Three.js Real-time Visualization</p>
    </div>

    <div class="ut-right">
      <div class="ut-hud">
        <div class="row"><span class="label">机型</span><span class="val">{{ hud.craft }}</span></div>
        <div class="row"><span class="label">飞行状态</span><span class="val status">{{ hud.status }}</span></div>
        <div class="row"><span class="label">飞行高度</span><span class="val">{{ hud.alt.toFixed(1) }} m</span></div>
        <div class="row"><span class="label">巡航速度</span><span class="val">≈ 18 m/s</span></div>
        <button class="mode-btn" :class="{ manual: hud.manual }" :disabled="!showPilot" @click="toggleManual">
          {{ hud.manual ? '切换为自动巡航' : '切换为手动操控' }}
        </button>
      </div>

      <div v-if="subject" class="ut-subj">
        <div class="sp-head">
          <span class="sp-name">{{ subject.name }}</span>
          <span v-if="subject.clause" class="sp-clause">{{ subject.clause }}</span>
        </div>
        <div class="sp-desc">{{ subject.desc }}</div>
        <div class="sp-mt">实时测试数据</div>
        <div class="sp-metrics" v-html="metrics"></div>
        <div class="verdict" :class="verdict.kind">{{ verdict.text }}</div>
        <button class="re-btn" @click="retest">重新测试</button>
        <button class="exit-btn" @click="exitTest">返回自由飞行</button>
      </div>
    </div>

    <div class="ut-sidebar">
      <div class="sb-head">GB 42590-2023 测试系统</div>
      <div class="sb-sub">民用无人机系统 · 17 项强制安全测试</div>
      <div class="sb-list">
        <template v-for="g in groups" :key="g.cat">
          <div class="sb-cat">{{ g.cat }}</div>
          <div
            v-for="s in g.items"
            :key="s.id"
            class="sb-item"
            :class="{ active: (subject && subject.id === s.id) || (!subject && s.free), free: s.free }"
            @click="onSubjectItem(s.id, s.free)"
          >
            <span class="no">{{ noLabel(s.no, s.free) }}</span>
            <span class="nm">{{ s.name }}</span>
            <span v-if="s.clause" class="cl">{{ s.clause }}</span>
          </div>
        </template>
      </div>
    </div>

    <div v-if="showPilot" class="ut-tip">
      鼠标拖拽旋转视角 · 滚轮缩放<br />手动模式：左摇杆移动 / 右摇杆升降 + 转向
    </div>

    <div
      v-if="showPilot"
      class="ut-joy left"
      :class="{ active: joyOn.left }"
      @pointerdown="joyStart('left', $event)"
      @pointermove="joyMove('left', $event)"
      @pointerup="joyEnd('left', $event)"
      @pointercancel="joyEnd('left', $event)"
    >
      <div class="knob" :style="{ transform: `translate(${joyKnob.left.x}px, ${joyKnob.left.y}px)` }"></div>
      <div class="cap">移动 · WASD</div>
    </div>
    <div
      v-if="showPilot"
      class="ut-joy right"
      :class="{ active: joyOn.right }"
      @pointerdown="joyStart('right', $event)"
      @pointermove="joyMove('right', $event)"
      @pointerup="joyEnd('right', $event)"
      @pointercancel="joyEnd('right', $event)"
    >
      <div class="knob" :style="{ transform: `translate(${joyKnob.right.x}px, ${joyKnob.right.y}px)` }"></div>
      <div class="cap">升降/转向 · QE/方向键</div>
    </div>
  </div>
</template>

<style scoped>
.ut-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  overflow: hidden;
  border-radius: 8px;
  background: #0b0e14;
  font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
.ut-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.ut-title {
  position: absolute;
  top: 14px;
  left: 18px;
  z-index: 10;
  color: #fff;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
  pointer-events: none;
}
.ut-title h1 {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 1px;
  margin: 0;
}
.ut-title p {
  font-size: 11px;
  opacity: 0.8;
  margin: 4px 0 0;
}

.ut-right {
  position: absolute;
  top: 14px;
  right: 16px;
  bottom: 150px;
  z-index: 11;
  width: 276px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  pointer-events: none;
}
.ut-right > * {
  pointer-events: auto;
}

.ut-hud {
  align-self: flex-end;
  flex: 0 0 auto;
  min-width: 200px;
  padding: 11px 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  background: rgba(16, 20, 28, 0.55);
  backdrop-filter: blur(8px);
  color: #e8eef6;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
}
.ut-hud .row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 4px 0;
  font-size: 12px;
}
.ut-hud .label {
  opacity: 0.65;
}
.ut-hud .val {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.ut-hud .status {
  color: #ffd23f;
}
.mode-btn {
  width: 100%;
  margin-top: 9px;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: rgba(31, 111, 235, 0.85);
  color: #fff;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  transition: background 0.2s;
}
.mode-btn:hover:not(:disabled) {
  background: rgba(31, 111, 235, 1);
}
.mode-btn.manual {
  background: rgba(255, 140, 40, 0.92);
}
.mode-btn.manual:hover:not(:disabled) {
  background: rgba(255, 140, 40, 1);
}
.mode-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ut-sidebar {
  position: absolute;
  top: 66px;
  left: 14px;
  bottom: 150px;
  width: 244px;
  z-index: 11;
  display: flex;
  flex-direction: column;
  padding: 12px 11px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  background: rgba(16, 20, 28, 0.62);
  backdrop-filter: blur(10px);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
}
.sb-head {
  font-size: 14px;
  font-weight: 700;
  color: #fff;
}
.sb-sub {
  font-size: 10.5px;
  color: #9fb3c8;
  margin: 3px 0 6px;
}
.sb-list {
  flex: 1;
  overflow-y: auto;
  padding-right: 4px;
}
.sb-list::-webkit-scrollbar {
  width: 6px;
}
.sb-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}
.sb-cat {
  font-size: 10.5px;
  color: #7f93a8;
  margin: 10px 2px 4px;
  letter-spacing: 1px;
}
.sb-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  margin: 3px 0;
  border: 1px solid transparent;
  border-radius: 9px;
  cursor: pointer;
  color: #dfe7f0;
  font-size: 12.5px;
  transition: background 0.15s, border-color 0.15s;
}
.sb-item:hover {
  background: rgba(255, 255, 255, 0.08);
}
.sb-item.active {
  background: rgba(31, 111, 235, 0.35);
  border-color: rgba(120, 180, 255, 0.6);
  color: #fff;
}
.sb-item .no {
  min-width: 18px;
  padding: 1px 5px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.14);
  color: #cfe0f5;
  font-size: 10px;
  text-align: center;
}
.sb-item.free .no {
  background: rgba(46, 204, 113, 0.32);
  color: #d6ffe6;
}
.sb-item .nm {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sb-item .cl {
  margin-left: auto;
  color: #8aa0b8;
  font-size: 10px;
}

.ut-subj {
  width: 100%;
  min-height: 0;
  flex: 1 1 auto;
  overflow: auto;
  padding: 13px 13px 11px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  background: rgba(16, 20, 28, 0.66);
  backdrop-filter: blur(10px);
  color: #e8eef6;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
}
.sp-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.sp-name {
  font-size: 15px;
  font-weight: 700;
}
.sp-clause {
  padding: 1px 7px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.12);
  color: #cfe0f5;
  font-size: 10.5px;
}
.sp-desc {
  margin: 8px 0 10px;
  color: #bcccdb;
  font-size: 11.5px;
  line-height: 1.75;
}
.sp-mt {
  margin-bottom: 6px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  color: #7f93a8;
  font-size: 10.5px;
  letter-spacing: 1px;
}
.sp-metrics {
  color: #dfe7f0;
  font-size: 12px;
  line-height: 1.95;
}
.sp-metrics :deep(b) {
  color: #fff;
}
.verdict {
  margin: 10px 0 4px;
  padding: 7px 10px;
  border-radius: 9px;
  font-size: 12.5px;
  font-weight: 600;
  text-align: center;
}
.verdict.run {
  background: rgba(120, 180, 255, 0.2);
  color: #bcd8ff;
}
.verdict.pass {
  background: rgba(46, 204, 113, 0.25);
  color: #7dffb0;
}
.verdict.warn {
  background: rgba(255, 210, 63, 0.22);
  color: #ffe08a;
}
.verdict.fail {
  background: rgba(255, 59, 48, 0.25);
  color: #ff9b94;
}
.ut-subj button {
  width: 100%;
  margin-top: 8px;
  padding: 8px;
  border: none;
  border-radius: 8px;
  color: #fff;
  cursor: pointer;
  font-size: 12.5px;
  font-weight: 600;
}
.re-btn {
  background: rgba(31, 111, 235, 0.85);
}
.re-btn:hover {
  background: rgba(31, 111, 235, 1);
}
.exit-btn {
  background: rgba(90, 100, 112, 0.85);
}
.exit-btn:hover {
  background: rgba(90, 100, 112, 1);
}

.ut-tip {
  position: absolute;
  bottom: 130px;
  left: 50%;
  z-index: 10;
  transform: translateX(-50%);
  color: #cfd8e3;
  font-size: 11.5px;
  line-height: 1.7;
  text-align: center;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
  opacity: 0.9;
  pointer-events: none;
}

.ut-joy {
  position: absolute;
  bottom: 22px;
  z-index: 12;
  width: 118px;
  height: 118px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 50%;
  background: rgba(16, 20, 28, 0.5);
  backdrop-filter: blur(6px);
  touch-action: none;
}
.ut-joy.left {
  left: 24px;
}
.ut-joy.right {
  right: 24px;
}
.ut-joy.active {
  border-color: rgba(120, 180, 255, 0.95);
  box-shadow: 0 0 14px rgba(120, 180, 255, 0.4);
}
.ut-joy .knob {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 50px;
  height: 50px;
  margin: -25px 0 0 -25px;
  border-radius: 50%;
  background: rgba(120, 180, 255, 0.85);
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.45);
  pointer-events: none;
}
.ut-joy .cap {
  position: absolute;
  bottom: -20px;
  width: 100%;
  color: #aab8c8;
  font-size: 10.5px;
  text-align: center;
  pointer-events: none;
}

@media (max-width: 1100px) {
  .ut-sidebar {
    width: 210px;
  }
  .ut-right {
    width: 240px;
  }
}
</style>
