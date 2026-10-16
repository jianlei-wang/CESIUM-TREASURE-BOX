<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { oceanPaletteColorAt } from '../ocean-tsd.palette'
import type { OceanTSPoint } from '../ocean-tsd.types'

const props = defineProps<{
  points: OceanTSPoint[] | null
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
let observer: ResizeObserver | undefined

function draw(): void {
  const el = canvas.value
  if (!el) return
  const parent = el.parentElement
  const cssW = parent ? parent.clientWidth : 300
  const cssH = parent ? parent.clientHeight : 260
  const dpr = window.devicePixelRatio || 1
  el.width = Math.max(1, Math.round(cssW * dpr))
  el.height = Math.max(1, Math.round(cssH * dpr))
  const ctx = el.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)
  const padL = 40
  const padR = 14
  const padT = 12
  const padB = 28
  const plotW = cssW - padL - padR
  const plotH = cssH - padT - padB
  const points = (props.points ?? []).filter((p) => p.valid)
  if (points.length === 0 || plotW <= 0 || plotH <= 0) {
    ctx.fillStyle = '#7f96b3'
    ctx.font = '11px sans-serif'
    ctx.fillText('无有效 T–S 数据', padL + 8, padT + 20)
    return
  }
  const sMin = Math.min(...points.map((p) => p.salinity))
  const sMax = Math.max(...points.map((p) => p.salinity))
  const tMin = Math.min(...points.map((p) => p.temperatureC))
  const tMax = Math.max(...points.map((p) => p.temperatureC))
  const dMin = Math.min(...points.map((p) => p.densityKgM3))
  const dMax = Math.max(...points.map((p) => p.densityKgM3))
  const sSpan = sMax - sMin || 1
  const tSpan = tMax - tMin || 1
  const dSpan = dMax - dMin || 1

  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.beginPath()
  for (let i = 0; i <= 4; i += 1) {
    const y = padT + (plotH * i) / 4
    ctx.moveTo(padL, y)
    ctx.lineTo(padL + plotW, y)
    const x = padL + (plotW * i) / 4
    ctx.moveTo(x, padT)
    ctx.lineTo(x, padT + plotH)
  }
  ctx.stroke()

  for (const p of points) {
    const x = padL + ((p.salinity - sMin) / sSpan) * plotW
    const y = padT + plotH - ((p.temperatureC - tMin) / tSpan) * plotH
    const [r, g, b] = oceanPaletteColorAt('density', (p.densityKgM3 - dMin) / dSpan)
    ctx.fillStyle = `rgb(${r},${g},${b})`
    ctx.beginPath()
    ctx.arc(x, y, 3, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.fillStyle = '#9fb8d4'
  ctx.font = '10px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.fillText('盐度 PSU', padL + plotW / 2, cssH - 6)
  ctx.save()
  ctx.translate(12, padT + plotH / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.fillText('温度 °C', 0, 0)
  ctx.restore()
  ctx.textAlign = 'right'
  ctx.fillText(tMax.toFixed(1), padL - 4, padT + 8)
  ctx.fillText(tMin.toFixed(1), padL - 4, padT + plotH)
  ctx.textAlign = 'left'
  ctx.fillText(sMin.toFixed(1), padL, cssH - 16)
  ctx.textAlign = 'right'
  ctx.fillText(sMax.toFixed(1), padL + plotW, cssH - 16)
}

function schedule(): void {
  requestAnimationFrame(draw)
}

watch(() => props.points, schedule, { deep: false })

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
