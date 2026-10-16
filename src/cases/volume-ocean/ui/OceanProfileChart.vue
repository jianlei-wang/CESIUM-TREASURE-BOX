<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { oceanColorRgb01 } from '../ocean-tsd.palette'
import type { OceanProfile } from '../analysis/ocean-analysis'

const props = defineProps<{
  profile: OceanProfile | null
  paletteId: string
  variableLabel: string
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
let observer: ResizeObserver | undefined

function draw(): void {
  const el = canvas.value
  if (!el) return
  const parent = el.parentElement
  const cssW = parent ? parent.clientWidth : 280
  const cssH = parent ? parent.clientHeight : 220
  const dpr = window.devicePixelRatio || 1
  el.width = Math.max(1, Math.round(cssW * dpr))
  el.height = Math.max(1, Math.round(cssH * dpr))
  const ctx = el.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)
  const padL = 42
  const padR = 12
  const padT = 14
  const padB = 26
  const plotW = cssW - padL - padR
  const plotH = cssH - padT - padB
  if (plotW <= 0 || plotH <= 0) return

  ctx.fillStyle = 'rgba(255,255,255,0.02)'
  ctx.fillRect(padL, padT, plotW, plotH)

  const profile = props.profile
  if (!profile || profile.valid.every((v) => !v)) {
    ctx.fillStyle = '#7f96b3'
    ctx.font = '11px sans-serif'
    ctx.fillText('无有效剖面数据', padL + 8, padT + 20)
    return
  }
  const values = profile.values.filter((v) => Number.isFinite(v))
  let vMin = Math.min(...values)
  let vMax = Math.max(...values)
  if (vMax === vMin) vMax = vMin + 1
  const depthMax = profile.depthM[profile.depthM.length - 1] || 1
  const xOf = (v: number) => padL + ((v - vMin) / (vMax - vMin)) * plotW
  const yOf = (d: number) => padT + (d / depthMax) * plotH

  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i <= 4; i += 1) {
    const y = padT + (plotH * i) / 4
    ctx.moveTo(padL, y)
    ctx.lineTo(padL + plotW, y)
  }
  ctx.stroke()

  ctx.fillStyle = '#9fb8d4'
  ctx.font = '10px ui-monospace, monospace'
  ctx.textAlign = 'right'
  for (let i = 0; i <= 4; i += 1) {
    const d = (depthMax * i) / 4
    ctx.fillText(`${d.toFixed(0)}`, padL - 5, padT + (plotH * i) / 4 + 3)
  }
  ctx.textAlign = 'center'
  ctx.fillText('深度 m', padL + plotW / 2, cssH - 6)
  ctx.textAlign = 'left'
  ctx.fillText(vMin.toFixed(2), padL, cssH - 6 + 0.1)
  ctx.textAlign = 'right'
  ctx.fillText(vMax.toFixed(2), padL + plotW, cssH - 6 + 0.1)

  // 海底界线
  if (Number.isFinite(profile.seabedM) && profile.seabedM < depthMax) {
    const y = yOf(profile.seabedM)
    ctx.strokeStyle = 'rgba(230,180,120,0.7)'
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(padL, y)
    ctx.lineTo(padL + plotW, y)
    ctx.stroke()
    ctx.setLineDash([])
  }

  ctx.lineWidth = 2
  ctx.beginPath()
  let started = false
  for (let i = 0; i < profile.depthM.length; i += 1) {
    if (!profile.valid[i] || profile.depthM[i] > profile.seabedM) {
      started = false
      continue
    }
    const x = xOf(profile.values[i])
    const y = yOf(profile.depthM[i])
    if (!started) {
      ctx.moveTo(x, y)
      started = true
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.strokeStyle = `rgb(${oceanColorRgb01(props.paletteId, 0.75).map((c) => Math.round(c * 255)).join(',')})`
  ctx.stroke()

  for (let i = 0; i < profile.depthM.length; i += 1) {
    if (!profile.valid[i] || profile.depthM[i] > profile.seabedM) continue
    const [r, g, b] = oceanColorRgb01(props.paletteId, (i + 1) / profile.depthM.length)
    ctx.fillStyle = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`
    ctx.beginPath()
    ctx.arc(xOf(profile.values[i]), yOf(profile.depthM[i]), 2.4, 0, Math.PI * 2)
    ctx.fill()
  }
}

function schedule(): void {
  requestAnimationFrame(draw)
}

watch(() => [props.profile, props.paletteId, props.variableLabel], schedule, { deep: false })

onMounted(() => {
  schedule()
  const parent = canvas.value?.parentElement
  if (parent && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(schedule)
    observer.observe(parent)
  }
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <canvas ref="canvas" class="chart-canvas"></canvas>
</template>

<style scoped>
.chart-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
