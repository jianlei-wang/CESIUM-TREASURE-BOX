<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { oceanPaletteColorAt } from '../ocean-tsd.palette'

const props = defineProps<{
  histogram: { edges: number[]; counts: number[] } | null
  paletteId: string
  unit: string
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
let observer: ResizeObserver | undefined

function draw(): void {
  const el = canvas.value
  if (!el) return
  const parent = el.parentElement
  const cssW = parent ? parent.clientWidth : 300
  const cssH = parent ? parent.clientHeight : 180
  const dpr = window.devicePixelRatio || 1
  el.width = Math.max(1, Math.round(cssW * dpr))
  el.height = Math.max(1, Math.round(cssH * dpr))
  const ctx = el.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)
  const padL = 40
  const padR = 12
  const padT = 12
  const padB = 28
  const plotW = cssW - padL - padR
  const plotH = cssH - padT - padB
  const hist = props.histogram
  if (!hist || !hist.counts.length || plotW <= 0 || plotH <= 0) return
  const bins = hist.counts.length
  const maxCount = Math.max(...hist.counts) || 1
  const barW = plotW / bins
  for (let i = 0; i < bins; i += 1) {
    const h = (hist.counts[i] / maxCount) * plotH
    const t = bins > 1 ? i / (bins - 1) : 0
    const [r, g, b] = oceanPaletteColorAt(props.paletteId, t)
    ctx.fillStyle = `rgb(${r},${g},${b})`
    ctx.fillRect(padL + i * barW + 1, padT + plotH - h, Math.max(1, barW - 2), h)
  }
  ctx.fillStyle = '#9fb8d4'
  ctx.font = '10px ui-monospace, monospace'
  ctx.textAlign = 'left'
  ctx.fillText(hist.edges[0].toFixed(2), padL, cssH - 6)
  ctx.textAlign = 'right'
  ctx.fillText(hist.edges[bins].toFixed(2), padL + plotW, cssH - 6)
  ctx.textAlign = 'center'
  ctx.fillText(props.unit, padL + plotW / 2, cssH - 6)
  ctx.textAlign = 'right'
  ctx.fillText(maxCount.toLocaleString(), padL - 4, padT + 8)
}

function schedule(): void {
  requestAnimationFrame(draw)
}

watch(() => [props.histogram, props.paletteId, props.unit], schedule, { deep: false })

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
