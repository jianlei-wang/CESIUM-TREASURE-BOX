<template>
  <div class="d1-root" ref="rootRef">
    <div class="d1-stage" ref="stageRef">
      <div class="d1-header" :class="{ 'pure-out': !mode }">
        <svg class="d1-header-bg" viewBox="0 0 1920 82" preserveAspectRatio="none">
          <path d="M0,0 L1920,0 L1920,60 L1300,60 L1250,80 L670,80 L620,60 L0,60 Z" fill="rgb(255, 245, 232)" />
          <path d="M0,60 L620,60 L670,80 L1250,80 L1300,60 L1920,60" fill="none" stroke="rgb(234, 88, 12)" stroke-width="1" />
        </svg>
        <div class="d1-title">四川省智慧城市数据大脑</div>
      </div>

      <div class="d1-grid">
        <div class="d1-card anim-left" :class="{ 'pure-out': !mode }" style="grid-area: 1 / 1 / 3 / 2; animation-delay: 0.5s">
          <div class="d1-card-title">2025年规模指标分析<span>INDICATOR ANALYSIS</span></div>
          <EChartBox :option="chart1" />
        </div>
        <div class="d1-card anim-left" :class="{ 'pure-out': !mode }" style="grid-area: 3 / 1 / 5 / 2; animation-delay: 0.6s">
          <div class="d1-card-title">企业税收分析<span>TAX ANALYSIS</span></div>
          <EChartBox ref="chart2Ref" :option="chart2" />
        </div>
        <div class="d1-card anim-left" :class="{ 'pure-out': !mode }" style="grid-area: 5 / 1 / 7 / 2; animation-delay: 0.7s">
          <div class="d1-card-title">行政处罚信息<span>PENALTY INFORMATION</span></div>
          <div class="d1-table">
            <div class="d1-table-head">
              <span>省份</span><span>专利编号</span><span>处罚金额</span><span>同比百分比</span>
            </div>
            <div class="d1-table-body">
              <div class="d1-table-scroll">
                <div class="d1-table-band">
                  <div v-for="(row, i) in penaltyRows" :key="'a' + i" class="d1-table-row">
                    <span>{{ row.value1 }}</span>
                    <span>{{ row.value2 }}</span>
                    <span>{{ row.value3 }}</span>
                    <span :style="{ color: row.tone }">{{ row.value4 }}</span>
                  </div>
                </div>
                <div class="d1-table-band" aria-hidden="true">
                  <div v-for="(row, i) in penaltyRows" :key="'b' + i" class="d1-table-row">
                    <span>{{ row.value1 }}</span>
                    <span>{{ row.value2 }}</span>
                    <span>{{ row.value3 }}</span>
                    <span :style="{ color: row.tone }">{{ row.value4 }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="d1-card anim-right" :class="{ 'pure-out': !mode }" style="grid-area: 1 / 4 / 3 / 5; animation-delay: 0.5s">
          <div class="d1-card-title">企业收益总数统计<span>REVENUE STATISTICS</span></div>
          <div class="d1-rev">
            <EChartBox :option="chart4" />
            <div class="d1-rev-stat">
              <div class="d1-rev-label">收益总计</div>
              <div class="d1-rev-num">99608.00<span>亿万元</span></div>
            </div>
            <div class="d1-rev-item" v-for="n in 4" :key="n">企业数量<span>7792</span></div>
          </div>
        </div>
        <div class="d1-card anim-right" :class="{ 'pure-out': !mode }" style="grid-area: 3 / 4 / 5 / 5; animation-delay: 0.6s">
          <div class="d1-card-title">企业能耗分析<span>ENERGY CONSUMPTION ANALYSIS</span></div>
          <EChartBox :option="chart5" />
        </div>
        <div class="d1-card anim-right" :class="{ 'pure-out': !mode }" style="grid-area: 5 / 4 / 7 / 5; animation-delay: 0.7s">
          <div class="d1-card-title">企业税收分析<span>TAX ANALYSIS</span></div>
          <EChartBox ref="chart6Ref" :option="chart6" />
        </div>
      </div>

      <div class="d1-footer" :class="{ 'pure-out': !mode }">
        <svg class="d1-footer-bg" viewBox="0 0 1920 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id="d1-grad-bottom" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#fff5e8" stop-opacity="0.5" />
              <stop offset="100%" stop-color="#fff5e8" stop-opacity="1" />
            </linearGradient>
          </defs>
          <path d="M0,100 H1920 V100 Q1600,100 1450,100 Q1300,80 1200,60 Q960,10 720,60 Q620,80 470,100 Q320,100 0,100 Z" fill="url(#d1-grad-bottom)" />
          <path d="M0,100 Q320,100 470,100 Q620,80 720,60 Q960,10 1200,60 Q1300,80 1450,100 Q1600,100 1920,100" fill="none" stroke="#ff6715" stroke-width="1" stroke-opacity="0.4" />
        </svg>
        <div class="d1-btns">
          <button class="d1-btn" :class="{ active: cloud }" title="云雾" @click="toggle('cloud')">云</button>
          <button class="d1-btn" :class="{ active: rotation }" title="旋转底盘" @click="toggle('rotation')">环</button>
          <button class="d1-btn" :class="{ active: mode }" title="面板" @click="mode = !mode">屏</button>
          <button class="d1-btn" :class="{ active: heat }" title="热力" @click="toggle('heat')">热</button>
          <button class="d1-btn" :class="{ active: bar }" title="柱状" @click="toggle('bar')">柱</button>
        </div>
      </div>

      <div v-if="tooltip" class="d1-tip" :style="{ left: tipX + 'px', top: tipY + 'px' }">
        <div class="d1-tip-city">{{ tooltip.city }}</div>
        <div>人口：{{ tooltip.population }}万</div>
        <div>GDP：{{ tooltip.gdp }}</div>
        <div>面积：{{ tooltip.area }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import * as THREE from 'three'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { DatavEngine } from '../common/engine'
import { FitStage } from '../common/stage'
import EChartBox from '../common/echartBox.vue'
import { buildDemo1Scene, type Demo1Scene, type Demo1Tooltip } from './geo'
import { makeChart1Option, makeChart2Option, makeChart4Option, makeChart5Option, makeChart6Option, makePenaltyRows } from './charts'

const rootRef = ref<HTMLDivElement | null>(null)
const stageRef = ref<HTMLDivElement | null>(null)
const chart2Ref = ref<InstanceType<typeof EChartBox> | null>(null)
const chart6Ref = ref<InstanceType<typeof EChartBox> | null>(null)

const chart1 = makeChart1Option()
const chart2 = makeChart2Option()
const chart4 = makeChart4Option()
const chart5 = makeChart5Option()
const chart6 = makeChart6Option()
const penaltyRows = makePenaltyRows()

const cloud = ref(true)
const bar = ref(true)
const heat = ref(true)
const rotation = ref(true)
const mode = ref(true)
const tooltip = ref<Demo1Tooltip | null>(null)
const tipX = ref(0)
const tipY = ref(0)

let engine: DatavEngine | null = null
let stage: FitStage | null = null
let geo: Demo1Scene | null = null
let timers: number[] = []
let disposed = false
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()

const toggle = (key: 'cloud' | 'bar' | 'heat' | 'rotation') => {
  if (key === 'cloud') cloud.value = !cloud.value
  if (key === 'bar') bar.value = !bar.value
  if (key === 'heat') heat.value = !heat.value
  if (key === 'rotation') rotation.value = !rotation.value
  geo?.setFlags({ cloud: cloud.value, bar: bar.value, heat: heat.value, rotation: rotation.value })
}

const onPointer = (e: PointerEvent) => {
  if (!engine || !geo) return
  const rect = engine.renderer.domElement.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, engine.camera)
  const hit = geo.pick(raycaster)
  tooltip.value = hit
  const designW = engine.renderer.domElement.clientWidth || rect.width
  const designH = engine.renderer.domElement.clientHeight || rect.height
  tipX.value = ((e.clientX - rect.left) / rect.width) * designW + 16
  tipY.value = ((e.clientY - rect.top) / rect.height) * designH + 16
  engine.renderer.domElement.style.cursor = hit ? 'pointer' : 'auto'
}

onMounted(async () => {
  if (!rootRef.value || !stageRef.value) return
  stage = new FitStage(rootRef.value, stageRef.value)
  const engineInstance = new DatavEngine(stageRef.value, {
    background: '#fff5e8',
    camera: { fov: 50, near: 1, far: 2000, position: [-50, 125, 250] },
    controls: {
      enablePan: true,
      enableZoom: true,
      enableRotate: true,
      zoomSpeed: 0.3,
      minDistance: 100,
      maxDistance: 300,
      maxPolarAngle: 1.5,
    },
    shadows: true,
  })
  engine = engineInstance
  engineInstance.scene.add(new THREE.AmbientLight(0xffffff, 2))
  const dir = new THREE.DirectionalLight('#fff5e8', 12)
  dir.position.set(0, 200, 20)
  engineInstance.scene.add(dir)

  try {
    geo = await buildDemo1Scene()
    engineInstance.scene.add(geo.group)
    engineInstance.introMove([-50, 125, 250], [60, 125, 160], 2)
    engineInstance.addFrame((dt) => {
      geo?.update(dt, engineInstance.camera)
    })
    engineInstance.renderer.domElement.addEventListener('pointermove', onPointer)

    const c2 = { current: 0 }
    const t2 = window.setInterval(() => {
      const inst = chart2Ref.value?.getInstance()
      if (inst && !disposed) {
        inst.dispatchAction({ type: 'dataZoom', startValue: c2.current, endValue: c2.current + 8 })
        c2.current = (c2.current + 1) % 22
      }
    }, 2000)
    const c6 = { current: 0 }
    const t6 = window.setInterval(() => {
      const inst = chart6Ref.value?.getInstance()
      if (inst && !disposed) {
        inst.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: c6.current })
        c6.current = (c6.current + 1) % 5
      }
    }, 3000)
    timers.push(t2, t6)
  } catch (err) {
    console.error('[datav demo1] scene build failed', err)
  }
})

onBeforeUnmount(() => {
  disposed = true
  timers.forEach((t) => clearInterval(t))
  engine?.renderer.domElement.removeEventListener('pointermove', onPointer)
  geo?.dispose()
  geo = null
  engine?.dispose()
  engine = null
  stage?.dispose()
  stage = null
})
</script>

<style scoped>
@font-face {
  font-family: 'datav-pmzd';
  src: url('../assets/fonts/pmzd.woff2') format('woff2');
  font-display: swap;
}
.d1-root {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border-radius: 8px;
  background: #fff5e8;
  color: #5a4a42;
  font-family: 'datav-pmzd', 'Microsoft YaHei', 'PingFang SC', sans-serif;
}
.d1-stage {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  display: flex;
  flex-direction: column;
}
.d1-header {
  position: relative;
  height: 80px;
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 5;
  animation: header-in 0.6s ease both;
}
.d1-header-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.d1-title {
  position: relative;
  font-size: 36px;
  letter-spacing: 8px;
  font-weight: 700;
  background: linear-gradient(to bottom, #ea580c, #ff9100);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.d1-title::after {
  content: 'SICHUAN SMART BRAIN';
  display: block;
  font-size: 12px;
  letter-spacing: 12px;
  text-align: center;
  color: rgba(255, 145, 0, 0.6);
  -webkit-text-fill-color: rgba(255, 145, 0, 0.6);
  margin-top: -4px;
}
.d1-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-template-rows: repeat(6, minmax(0, 1fr));
  gap: 20px;
  padding: 20px;
}
.d1-card {
  position: relative;
  background: rgba(255, 245, 232, 0.65);
  border: 1px solid rgba(255, 145, 0, 0.3);
  padding: 15px;
  backdrop-filter: blur(4px);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  min-height: 0;
}
.d1-card::before,
.d1-card::after {
  content: '';
  position: absolute;
  width: 10px;
  height: 10px;
  pointer-events: none;
}
.d1-card::before {
  top: -1px;
  left: -1px;
  border-top: 2px solid #ea580c;
  border-left: 2px solid #ea580c;
}
.d1-card::after {
  bottom: -1px;
  right: -1px;
  border-bottom: 2px solid #ea580c;
  border-right: 2px solid #ea580c;
}
.d1-card-title {
  font-size: 18px;
  margin-bottom: 10px;
  padding-left: 10px;
  border-left: 4px solid #fdb961;
  display: flex;
  justify-content: space-between;
  color: #5a4a42;
}
.d1-card-title span {
  font-size: 10px;
  color: rgba(0, 0, 0, 0.4);
}
.d1-table {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  font-size: 13px;
}
.d1-table-head,
.d1-table-row {
  display: grid;
  grid-template-columns: 1.4fr 1.2fr 1fr 1fr;
  gap: 8px;
  padding: 6px 4px;
}
.d1-table-head {
  color: rgba(0, 0, 0, 0.6);
  border-bottom: 1px solid rgba(234, 88, 12, 0.2);
}
.d1-table-body {
  flex: 1;
  overflow: hidden;
}
.d1-table-scroll {
  animation: d1-scroll 18s linear infinite;
}
.d1-table-row {
  color: #000;
  height: 50px;
  align-items: center;
}
.d1-rev {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 2fr 1fr 1fr;
  gap: 8px;
}
.d1-rev-stat {
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.d1-rev-label {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.7);
}
.d1-rev-num {
  font-size: 28px;
  font-weight: 600;
  color: #ea580c;
}
.d1-rev-num span {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.7);
  font-weight: normal;
  margin-left: 4px;
}
.d1-rev-item {
  display: flex;
  align-items: center;
  color: rgba(0, 0, 0, 0.8);
}
.d1-rev-item span {
  margin-left: 12px;
  font-size: 20px;
  font-weight: 600;
  color: #ea580c;
}
.d1-footer {
  position: absolute;
  bottom: 0;
  height: 100px;
  width: 100%;
}
.d1-footer-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.d1-btns {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 30px;
  align-items: flex-end;
  z-index: 10;
}
.d1-btn {
  pointer-events: auto;
  width: 50px;
  height: 50px;
  border-radius: 12px;
  border: 1px solid rgba(234, 88, 12, 0.2);
  background: rgba(255, 255, 255, 0.9);
  color: #d35400;
  cursor: pointer;
  font-size: 16px;
}
.d1-btn.active {
  width: 60px;
  height: 60px;
  background: linear-gradient(135deg, #ff6715 0%, #ff8c00 100%);
  color: #fff;
  border: none;
  box-shadow: 0 4px 15px rgba(255, 103, 21, 0.5);
}
.d1-tip {
  position: absolute;
  z-index: 20;
  pointer-events: none;
  background: rgba(255, 245, 232, 0.85);
  backdrop-filter: blur(10px);
  border-radius: 8px;
  padding: 12px 16px;
  color: #656565;
  font-size: 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  min-width: 140px;
}
.d1-tip-city {
  font-weight: bold;
  margin-bottom: 8px;
  color: #ea580c;
}
.anim-left {
  animation: left-in 0.8s ease both;
}
.anim-right {
  animation: right-in 0.8s ease both;
}
.pure-out {
  opacity: 0 !important;
  transform: scale(0.96);
  transition: opacity 0.7s ease, transform 0.7s ease;
  pointer-events: none !important;
}
@keyframes header-in {
  from { opacity: 0; transform: translateY(-100%); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes left-in {
  from { opacity: 0; transform: translateX(-100%); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes right-in {
  from { opacity: 0; transform: translateX(100%); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes d1-scroll {
  from { transform: translateY(0); }
  to { transform: translateY(-50%); }
}
</style>
