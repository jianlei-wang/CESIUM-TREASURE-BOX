<template>
  <div class="d3-root" ref="rootRef">
    <div class="d3-stage" ref="stageRef">
      <div class="d3-hud">
        <div class="d3-title">风机模型展台</div>
        <div class="d3-actions">
          <button class="d3-btn" :class="{ on: disassembled }" @click="toggle">
            {{ disassembled ? '还原' : '拆解' }}
          </button>
          <div class="d3-fps">FPS {{ fps }}</div>
        </div>
      </div>
      <div v-if="loading" class="d3-loading">正在加载风机模型…</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import * as THREE from 'three'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { DatavEngine } from '../common/engine'
import { FitStage } from '../common/stage'
import { buildDemo3Scene, type Demo3Scene } from './scene'

const rootRef = ref<HTMLDivElement | null>(null)
const stageRef = ref<HTMLDivElement | null>(null)
const disassembled = ref(false)
const loading = ref(true)
const fps = ref(0)

let engine: DatavEngine | null = null
let stage: FitStage | null = null
let geo: Demo3Scene | null = null
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
let frames = 0
let lastFps = performance.now()

const toggle = () => {
  disassembled.value = !disassembled.value
  geo?.setDisassembled(disassembled.value)
}

const onPointer = (e: PointerEvent) => {
  if (!engine || !geo) return
  const rect = engine.renderer.domElement.getBoundingClientRect()
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, engine.camera)
  geo.pickHover(raycaster)
}

onMounted(async () => {
  if (!rootRef.value || !stageRef.value) return
  stage = new FitStage(rootRef.value, stageRef.value)
  const engineInstance = new DatavEngine(stageRef.value, {
    background: '#26282a',
    camera: { fov: 25, near: 0.1, far: 2000, position: [-10, 5, 12] },
    controls: {
      enablePan: true,
      enableZoom: false,
      enableRotate: true,
      autoRotate: true,
      autoRotateSpeed: -0.3,
      minPolarAngle: Math.PI / 2.4,
      maxPolarAngle: Math.PI / 2,
      target: [0, 0.6, 0],
    },
    shadows: true,
    toneMapping: THREE.ACESFilmicToneMapping,
  })
  engine = engineInstance

  try {
    geo = await buildDemo3Scene(engineInstance.renderer, engineInstance.scene, engineInstance.camera)
    engineInstance.scene.add(geo.group)
    engineInstance.setCustomRender((renderer, scene, camera) => {
      void renderer
      void scene
      void camera
      geo?.composer.render()
    })
    engineInstance.addFrame((dt) => {
      geo?.update(dt)
      const w = engineInstance.renderer.domElement.width
      const h = engineInstance.renderer.domElement.height
      geo?.resize(w, h)
      frames += 1
      const now = performance.now()
      if (now - lastFps >= 1000) {
        fps.value = frames
        frames = 0
        lastFps = now
      }
    })
    engineInstance.renderer.domElement.addEventListener('pointermove', onPointer)
  } catch (err) {
    console.error('[datav demo3] scene build failed', err)
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  engine?.renderer.domElement.removeEventListener('pointermove', onPointer)
  engine?.setCustomRender(null)
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
.d3-root {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border-radius: 8px;
  background: #26282a;
  color: #fff;
  font-family: 'datav-pmzd', 'Microsoft YaHei', 'PingFang SC', sans-serif;
}
.d3-stage {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
}
.d3-hud {
  position: absolute;
  top: 24px;
  left: 32px;
  right: 32px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  z-index: 5;
}
.d3-title {
  font-size: 28px;
  letter-spacing: 6px;
}
.d3-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}
.d3-btn {
  pointer-events: auto;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(20, 22, 24, 0.75);
  color: #fff;
  padding: 8px 18px;
  border-radius: 6px;
  cursor: pointer;
  letter-spacing: 2px;
}
.d3-btn.on {
  background: #ea580c;
  border-color: #ea580c;
}
.d3-fps {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: #8f8;
  background: rgba(0, 0, 0, 0.45);
  padding: 4px 8px;
  border-radius: 4px;
}
.d3-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.7);
  letter-spacing: 4px;
}
</style>
