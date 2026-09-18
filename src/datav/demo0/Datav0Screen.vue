<template>
  <div class="datav-root" ref="rootRef">
    <div
      class="datav-stage"
      ref="stageRef"
      :style="{ '--datav-card-bg': `url(${cardBg})` }"
    >
      <div class="datav-vignette" :class="{ 'datav-vignette-off': pureMode }"></div>

      <div class="datav-header anim-header" :class="{ 'pure-out': pureMode }">
        <div class="datav-title">经济运行监测</div>
        <div class="datav-badge">SC-DATAV · Demo0</div>
      </div>

      <div class="datav-grid">
        <div
          class="datav-card anim-left"
          :class="{ 'pure-out': pureMode }"
          style="grid-area: 1 / 1 / 3 / 2; animation-delay: 0.4s"
        >
          <div class="datav-card-title">月度进出口商品总价值</div>
          <EChartBox ref="chart1Ref" :option="chart1Opt" />
        </div>
        <div
          class="datav-card anim-left"
          :class="{ 'pure-out': pureMode }"
          style="grid-area: 3 / 1 / 5 / 2; animation-delay: 0.55s"
        >
          <div class="datav-card-title">进出口商品品类贸易值</div>
          <EChartBox ref="chart2Ref" :option="chart2Opt" />
        </div>
        <div
          class="datav-card anim-right"
          :class="{ 'pure-out': pureMode }"
          style="grid-area: 1 / 4 / 3 / 5; animation-delay: 0.55s"
        >
          <div class="datav-card-title" style="text-align: right">三产季度增加值</div>
          <EChartBox ref="chart3Ref" :option="chart3Opt" />
        </div>
        <div
          class="datav-card anim-right"
          :class="{ 'pure-out': pureMode }"
          style="grid-area: 3 / 4 / 5 / 5; animation-delay: 0.7s"
        >
          <div class="datav-card-title" style="text-align: right">进出口商品信息</div>
          <div class="datav-table">
            <div class="datav-table-head">
              <span>序号</span>
              <span>类型</span>
              <span>数量(万)</span>
              <span>贸易值(万元)</span>
            </div>
            <div class="datav-table-body">
              <div class="datav-table-scroll">
                <div class="datav-table-band">
                  <div v-for="(row, i) in tableRows" :key="'a' + i" class="datav-table-row">
                    <span>{{ row.value1 }}</span>
                    <span>{{ row.value2 }}</span>
                    <span>{{ row.value3 }}</span>
                    <span>{{ row.value4 }}</span>
                  </div>
                </div>
                <div class="datav-table-band" aria-hidden="true">
                  <div v-for="(row, i) in tableRows" :key="'b' + i" class="datav-table-row">
                    <span>{{ row.value1 }}</span>
                    <span>{{ row.value2 }}</span>
                    <span>{{ row.value3 }}</span>
                    <span>{{ row.value4 }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="datav-bottom" :class="{ 'pure-out': pureMode }">
        <button class="datav-grad-btn" @click="toggleMapStyle">
          <span class="datav-grad-text">切换样式</span>
        </button>
        <button class="datav-grad-btn" @click="togglePureMode">
          <span class="datav-grad-text">{{ pureMode ? '退出纯净' : '纯净模式' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import * as THREE from 'three'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { DatavEngine } from '../common/engine'
import { FitStage } from '../common/stage'
import { createGridGround, createStars } from '../common/effects'
import { buildDemo0Scene, type DemoT0Scene } from './geo'
import EChartBox from '../common/echartBox.vue'
import { makeChart1Option, makeChart2Option, makeChart3Option, makeTableRows } from './charts'
import cardBg from '../assets/card_bg.jpg'

const rootRef = ref<HTMLDivElement | null>(null)
const stageRef = ref<HTMLDivElement | null>(null)

const chart1Ref = ref<InstanceType<typeof EChartBox> | null>(null)
const chart2Ref = ref<InstanceType<typeof EChartBox> | null>(null)
const chart3Ref = ref<InstanceType<typeof EChartBox> | null>(null)

const chart1State = makeChart1Option()
const chart2State = makeChart2Option()
const chart3State = makeChart3Option()
const tableRows = makeTableRows()
const chart1Opt = chart1State.option
const chart2Opt = chart2State.option
const chart3Opt = chart3State.option

const newStyle = ref(false)
const pureMode = ref(false)

let engine: DatavEngine | null = null
let stage: FitStage | null = null
let geo: DemoT0Scene | null = null
let timers: ReturnType<typeof setInterval>[] = []
let disposed = false

const toggleMapStyle = () => {
  newStyle.value = !newStyle.value
  geo?.setNewStyle(newStyle.value)
}

const togglePureMode = () => {
  pureMode.value = !pureMode.value
}

onMounted(async () => {
  if (!rootRef.value || !stageRef.value) return

  const target = new THREE.Vector3()
  stage = new FitStage(rootRef.value, stageRef.value)
  const engineInstance = new DatavEngine(stageRef.value, {
    background: '#26282a',
    camera: { fov: 70, near: 0.1, far: 3000, position: [0, 40, 90] },
    controls: {
      enablePan: true,
      enableZoom: true,
      enableRotate: true,
      zoomSpeed: 0.3,
      minDistance: 10,
      maxDistance: 20,
      maxPolarAngle: 1.5,
      target: [0, 0, 0],
    },
  })
  engine = engineInstance

  const stars = createStars(1000, 150)
  stars.position.y = 8
  engineInstance.scene.add(stars)

  // 灯光对应参考工程 map/lights（环境光 + 点光）
  const ambient = new THREE.AmbientLight(0xffffff, 2)
  const point = new THREE.PointLight(0xffffff, 1000, 200)
  point.position.set(-5, 20, 0)
  engineInstance.scene.add(ambient, point)

  try {
    geo = await buildDemo0Scene(newStyle.value)
    const holder = new THREE.Group()
    holder.add(geo.group)
    holder.rotation.x = -Math.PI / 2
    holder.scale.setScalar(0.8)

    const ground = createGridGround({ y: 0 })
    engineInstance.scene.add(ground)
    engineInstance.scene.add(holder)

    const box = new THREE.Box3().setFromObject(holder)
    const c = new THREE.Vector3()
    box.getCenter(c)
    const size = new THREE.Vector3()
    box.getSize(size)
    holder.position.x -= c.x
    holder.position.z -= c.z
    holder.position.y -= box.min.y
    const centerY = size.y * 0.5

    target.set(0, centerY, 0)
    engineInstance.controls.target.copy(target)

    // 相机贴近参考工程观感：更近、更俯视，减少斜视导致的侧壁外露
    const frameDist = Math.min(16, Math.max(9, size.x / 1.75))
    const polar = (56 * Math.PI) / 180
    const end = new THREE.Vector3().copy(target).add(
      new THREE.Vector3(0, Math.cos(polar) * frameDist, Math.sin(polar) * frameDist)
    )
    const start = new THREE.Vector3().copy(target).add(end.clone().sub(target).multiplyScalar(3.2))
    engineInstance.controls.target.copy(target)
    engineInstance.introMove([start.x, start.y, start.z], [end.x, end.y, end.z], 1.5)

    engineInstance.addFrame((dt) => {
      geo?.update(dt)
    })

    const c1 = setInterval(() => {
      const inst = chart2Ref.value?.getInstance()
      if (inst && !disposed) {
        inst.dispatchAction({ type: 'dataZoom', startValue: c2Step.current, endValue: c2Step.current + 8 })
        c2Step.current = (c2Step.current + 1) % 22
      }
    }, 2000)
    const c3 = setInterval(() => {
      const inst = chart3Ref.value?.getInstance()
      if (inst && !disposed) {
        inst.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: c3Step.current })
        c3Step.current = (c3Step.current + 1) % 4
      }
    }, 3000)
    timers.push(c1, c3)
  } catch (err) {
    console.error('[datav demo0] scene build failed', err)
  }
})

const c2Step = { current: 0 }
const c3Step = { current: 0 }

onBeforeUnmount(() => {
  disposed = true
  timers.forEach((t) => clearInterval(t))
  timers = []
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

.datav-root {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #26282a;
  color: #ffffff;
  font-family: 'datav-pmzd', 'Microsoft YaHei', 'PingFang SC', sans-serif;
}

.datav-stage {
  position: absolute;
  inset: 0;
  pointer-events: none;
  display: flex;
  flex-direction: column;
}

.datav-vignette {
  position: absolute;
  inset: 0;
  z-index: 0;
  background: radial-gradient(transparent 55%, rgba(0, 0, 0, 0.85));
  pointer-events: none;
  opacity: 1;
  transition: opacity 0.8s;
}
.datav-vignette-off {
  opacity: 0;
}

.datav-header {
  flex: none;
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 40px;
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(141, 141, 141, 0.2);
  background: linear-gradient(180deg, rgba(30, 42, 56, 0.55), rgba(30, 42, 56, 0.15));
  z-index: 2;
}
.datav-title {
  font-size: 38px;
  letter-spacing: 6px;
  color: #fff;
  text-shadow: 0 0 14px rgba(174, 186, 190, 0.55);
}
.datav-badge {
  font-size: 18px;
  color: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(141, 141, 141, 0.3);
  padding: 6px 16px;
  border-radius: 20px;
  font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif;
}

.datav-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-template-rows: repeat(4, minmax(0, 1fr));
  gap: 20px;
  padding: 20px;
  position: relative;
  z-index: 1;
}

.datav-card {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  pointer-events: auto;
  color: #ffffff;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(141, 141, 141, 0.2);
  border-radius: 4px;
  padding: 6px;
  box-sizing: border-box;
  transition: opacity 0.8s ease, transform 0.8s ease;
}
.datav-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: var(--datav-card-bg);
  background-size: 100px;
  opacity: 0.18;
  z-index: 0;
  border-radius: 4px;
  pointer-events: none;
}
.datav-card-title {
  position: relative;
  z-index: 1;
  font-size: 26px;
  padding: 8px 16px;
  letter-spacing: 2px;
}

.anim-header {
  animation: header-in 0.9s ease both;
}
.anim-left {
  animation: left-in 0.9s ease both;
}
.anim-right {
  animation: right-in 0.9s ease both;
}
.pure-out {
  opacity: 0 !important;
  transform: scale(0.96);
  transition: opacity 0.7s ease, transform 0.7s ease;
}

@keyframes header-in {
  from {
    opacity: 0;
    transform: translateY(-100%);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes left-in {
  from {
    opacity: 0;
    transform: translateX(-100%);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
@keyframes right-in {
  from {
    opacity: 0;
    transform: translateX(100%);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.datav-bottom {
  position: absolute;
  left: 50%;
  bottom: 26px;
  transform: translateX(-50%);
  display: flex;
  gap: 24px;
  z-index: 3;
  pointer-events: auto;
}

.datav-grad-btn {
  position: relative;
  padding: 12px 30px;
  font-size: 18px;
  font-weight: bold;
  color: #fff;
  background: transparent;
  border: none;
  cursor: pointer;
  border-radius: 50px;
  overflow: hidden;
  transition: transform 0.2s ease;
  font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif;
}
.datav-grad-btn::before {
  content: '';
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: conic-gradient(from 0deg, #aca891, #6e918c);
  z-index: -2;
  filter: blur(10px);
  transition: transform 1.5s ease-in-out;
}
.datav-grad-btn:hover::before {
  transform: rotate(180deg);
}
.datav-grad-btn::after {
  content: '';
  position: absolute;
  inset: 3px;
  background: #10141c;
  border-radius: 47px;
  z-index: -1;
  filter: blur(5px);
}
.datav-grad-text {
  background: conic-gradient(from 0deg, #aca891, #6e918c);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
}

.datav-table {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif;
  font-size: 16px;
}
.datav-table-head,
.datav-table-row {
  display: grid;
  grid-template-columns: 1fr 1.2fr 1fr 1.4fr;
  align-items: center;
  height: 50px;
  padding: 0 14px;
  box-sizing: border-box;
}
.datav-table-head {
  color: rgba(172, 168, 145, 0.95);
  border-bottom: 1px solid rgba(141, 141, 141, 0.2);
}
.datav-table-row {
  color: rgba(255, 255, 255, 0.85);
  border-bottom: 1px solid rgba(141, 141, 141, 0.08);
}
.datav-table-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.datav-table-scroll {
  height: 100%;
  overflow: hidden;
  position: relative;
}
.datav-table-band {
  animation: table-roll 16s linear infinite;
}
@keyframes table-roll {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(-50%);
  }
}
.datav-table-body:hover .datav-table-band {
  animation-play-state: paused;
}
</style>
