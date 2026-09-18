<template>
  <div class="d2-root" ref="rootRef">
    <div class="d2-stage" ref="stageRef">
      <div class="d2-header">
        <div class="d2-title">四川省电力运行监测</div>
        <div class="d2-sub">POWER GRID OPERATION · SICHUAN</div>
      </div>

      <div class="d2-grid">
        <div class="d2-card anim-left" style="grid-area: 1 / 1 / 3 / 2; animation-delay: 0.5s">
          <div class="d2-card-title">发电汇总</div>
          <div class="d2-gen">
            <div class="d2-gen-stat">
              <span>总发电量</span>
              <strong>16608.00<em>亿千瓦时</em></strong>
            </div>
            <EChartBox :option="chart1" />
            <EChartBox :option="chart1Pie" />
          </div>
        </div>
        <div class="d2-card anim-left" style="grid-area: 3 / 1 / 5 / 2; animation-delay: 0.6s">
          <div class="d2-card-title">用电量预测</div>
          <EChartBox ref="chart2Ref" :option="chart2" />
        </div>
        <div class="d2-card anim-left" style="grid-area: 5 / 1 / 7 / 2; animation-delay: 0.7s">
          <div class="d2-card-title">上半年发电情况</div>
          <EChartBox ref="chart3Ref" :option="chart3" />
        </div>
        <div class="d2-card anim-right" style="grid-area: 1 / 4 / 3 / 5; animation-delay: 0.5s">
          <div class="d2-card-title">电网设备数量</div>
          <div class="d2-devices">
            <div v-for="item in devices" :key="item.label" class="d2-device">
              <div class="d2-device-dot">{{ item.label.slice(0, 1) }}</div>
              <div>
                <div>{{ item.label }} <b>{{ item.value }}</b> {{ item.unit }}</div>
                <div class="d2-device-sub">{{ item.label2 }} <b>{{ item.value2 }}</b> {{ item.unit2 }}</div>
              </div>
            </div>
          </div>
        </div>
        <div class="d2-card anim-right" style="grid-area: 3 / 4 / 5 / 5; animation-delay: 0.6s">
          <div class="d2-card-title">用电大市 TOP5</div>
          <EChartBox :option="chart5" />
        </div>
        <div class="d2-card anim-right" style="grid-area: 5 / 4 / 7 / 5; animation-delay: 0.7s">
          <div class="d2-card-title">故障异常</div>
          <div class="d2-table">
            <div class="d2-table-head">
              <span>序号</span><span>故障事件</span><span>异常</span><span>报警</span><span>状态</span>
            </div>
            <div class="d2-table-body">
              <div class="d2-table-scroll">
                <div class="d2-table-band">
                  <div v-for="(row, i) in faults" :key="'a' + i" class="d2-table-row">
                    <span>{{ row.value1 }}</span>
                    <span>{{ row.value2 }}</span>
                    <span>{{ row.value3 }}</span>
                    <span>{{ row.value4 }}</span>
                    <span :style="{ color: row.tone }">{{ row.status }}</span>
                  </div>
                </div>
                <div class="d2-table-band" aria-hidden="true">
                  <div v-for="(row, i) in faults" :key="'b' + i" class="d2-table-row">
                    <span>{{ row.value1 }}</span>
                    <span>{{ row.value2 }}</span>
                    <span>{{ row.value3 }}</span>
                    <span>{{ row.value4 }}</span>
                    <span :style="{ color: row.tone }">{{ row.status }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
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
import { buildDemo2Scene, type Demo2Scene } from './geo'
import {
  makeChart1Option,
  makeChart1PieOption,
  makeChart2Option,
  makeChart3Option,
  makeChart5Option,
  makeDeviceStats,
  makeFaultRows,
} from './charts'

const rootRef = ref<HTMLDivElement | null>(null)
const stageRef = ref<HTMLDivElement | null>(null)
const chart2Ref = ref<InstanceType<typeof EChartBox> | null>(null)
const chart3Ref = ref<InstanceType<typeof EChartBox> | null>(null)

const chart1 = makeChart1Option()
const chart1Pie = makeChart1PieOption()
const chart2 = makeChart2Option()
const chart3 = makeChart3Option()
const chart5 = makeChart5Option()
const devices = makeDeviceStats()
const faults = makeFaultRows()

let engine: DatavEngine | null = null
let stage: FitStage | null = null
let geo: Demo2Scene | null = null
let timers: number[] = []
let disposed = false
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()

const onPointer = (e: PointerEvent) => {
  if (!engine || !geo) return
  const rect = engine.renderer.domElement.getBoundingClientRect()
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, engine.camera)
  const hit = geo.pick(raycaster)
  engine.renderer.domElement.style.cursor = hit ? 'pointer' : 'auto'
}

onMounted(async () => {
  if (!rootRef.value || !stageRef.value) return
  stage = new FitStage(rootRef.value, stageRef.value)
  const engineInstance = new DatavEngine(stageRef.value, {
    background: '#000000',
    fog: { color: '#000000', near: 10, far: 30 },
    camera: { fov: 70, near: 0.1, far: 2000, position: [3, 20, 10] },
    controls: {
      enablePan: true,
      enableZoom: true,
      enableRotate: true,
      zoomSpeed: 0.3,
      minDistance: 8,
      maxDistance: 20,
      maxPolarAngle: 1.5,
    },
  })
  engine = engineInstance
  engineInstance.scene.add(new THREE.AmbientLight(0xffffff, 2))
  const dir = new THREE.DirectionalLight(0xffffff, 10)
  dir.position.set(0, 50, -50)
  engineInstance.scene.add(dir)

  try {
    geo = await buildDemo2Scene(engineInstance.renderer)
    engineInstance.scene.add(geo.group)
    engineInstance.introMove([3, 20, 10], [-2, 7, 10], 2.5)
    engineInstance.addFrame((dt) => geo?.update(dt))
    engineInstance.renderer.domElement.addEventListener('pointermove', onPointer)

    const c2 = { current: 0 }
    timers.push(
      window.setInterval(() => {
        const inst = chart2Ref.value?.getInstance()
        if (inst && !disposed) {
          inst.dispatchAction({ type: 'dataZoom', startValue: c2.current, endValue: c2.current + 8 })
          c2.current = (c2.current + 1) % 22
        }
      }, 2000)
    )
    const c3 = { current: 0 }
    timers.push(
      window.setInterval(() => {
        const inst = chart3Ref.value?.getInstance()
        if (inst && !disposed) {
          inst.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: c3.current })
          c3.current = (c3.current + 1) % 5
        }
      }, 3000)
    )
  } catch (err) {
    console.error('[datav demo2] scene build failed', err)
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
.d2-root {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border-radius: 8px;
  background: #000;
  color: #e8efff;
  font-family: 'datav-pmzd', 'Microsoft YaHei', 'PingFang SC', sans-serif;
}
.d2-stage {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  display: flex;
  flex-direction: column;
}
.d2-header {
  height: 85px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 5;
  animation: header-in 0.6s ease both;
  background: linear-gradient(180deg, rgba(48, 97, 219, 0.35), transparent);
  border-bottom: 1px solid rgba(120, 158, 255, 0.25);
}
.d2-title {
  font-size: 34px;
  letter-spacing: 8px;
  color: #bdcfff;
  text-shadow: 0 0 16px rgba(48, 97, 219, 0.8);
}
.d2-sub {
  font-size: 11px;
  letter-spacing: 6px;
  color: rgba(189, 207, 255, 0.55);
  margin-top: 2px;
}
.d2-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-template-rows: repeat(6, minmax(0, 1fr));
  gap: 20px;
  padding: 20px;
}
.d2-card {
  position: relative;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: linear-gradient(180deg, rgba(48, 97, 219, 0.18), rgba(8, 16, 40, 0.55));
  border: 1px solid rgba(120, 158, 255, 0.35);
  clip-path: polygon(16px 0, calc(100% - 16px) 0, 100% 16px, 100% calc(100% - 8px), calc(100% - 12px) 100%, 12px 100%, 0 calc(100% - 8px), 0 16px);
}
.d2-card-title {
  position: relative;
  font-size: 16px;
  color: #e8efff;
  border-bottom: 1px solid rgba(186, 206, 255, 0.33);
  line-height: 50px;
  margin-inline: 20px;
}
.d2-card-title::before {
  content: '';
  position: absolute;
  left: 0;
  bottom: 0;
  width: 50px;
  height: 4px;
  background: #bdcfff;
}
.d2-gen {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: auto 1fr 1fr;
  padding: 8px 16px 16px;
}
.d2-gen-stat {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  color: rgba(255, 255, 255, 0.7);
}
.d2-gen-stat strong {
  font-size: 28px;
  color: #3061db;
}
.d2-gen-stat em {
  font-style: normal;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  margin-left: 4px;
  font-weight: normal;
}
.d2-devices {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 12px;
  padding: 16px;
}
.d2-device {
  display: flex;
  align-items: center;
  gap: 10px;
  color: rgba(255, 255, 255, 0.85);
  font-size: 13px;
}
.d2-device b {
  color: #3061db;
  font-size: 20px;
  text-shadow: 0 0 10px currentColor;
  margin: 0 4px;
}
.d2-device-sub b {
  color: #bdcfff;
  font-size: 16px;
}
.d2-device-dot {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid #3061db;
  box-shadow: 0 0 10px #3061db;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #bdcfff;
  flex: none;
}
.d2-table {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  font-size: 13px;
  padding: 8px 16px 16px;
}
.d2-table-head,
.d2-table-row {
  display: grid;
  grid-template-columns: 0.6fr 1.2fr 0.8fr 0.8fr 0.8fr;
  gap: 8px;
  padding: 6px 4px;
}
.d2-table-head {
  color: rgba(255, 255, 255, 0.6);
  border-bottom: 1px solid rgba(189, 207, 255, 0.2);
}
.d2-table-body {
  flex: 1;
  overflow: hidden;
}
.d2-table-scroll {
  animation: d2-scroll 18s linear infinite;
}
.d2-table-row {
  color: #3061db;
  height: 44px;
  align-items: center;
}
.anim-left {
  animation: left-in 0.8s ease both;
}
.anim-right {
  animation: right-in 0.8s ease both;
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
@keyframes d2-scroll {
  from { transform: translateY(0); }
  to { transform: translateY(-50%); }
}
</style>
