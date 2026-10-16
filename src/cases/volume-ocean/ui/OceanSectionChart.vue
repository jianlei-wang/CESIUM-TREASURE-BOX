<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { oceanPaletteColorAt } from '../ocean-tsd.palette'
import type { OceanSection } from '../ocean-tsd.types'

const props = defineProps<{
  section: OceanSection | null
  paletteId: string
  colorRange: [number, number]
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
let observer: ResizeObserver | undefined

function draw(): void {
  const el = canvas.value
  if (!el) return
  const parent = el.parentElement
  const cssW = parent ? parent.clientWidth : 300
  const cssH = parent ? parent.clientHeight : 220
  const dpr = window.devicePixelRatio || 1
  el.width = Math.max(1, Math.round(cssW * dpr))
  el.height = Math.max(1, Math.round(cssH * dpr))
  const ctx = el.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)
  const padL = 42
  const padR = 14
  const padT = 12
  const padB = 26
  const plotW = cssW - padL - padR
  const plotH = cssH - padT - padB
  const section = props.section
  if (!section || plotW <= 0 || plotH <= 0) return

  const samples = section.values.length
  const levels = section.depthM.length
  const distMax = section.distanceKm[samples - 1] || 1
  const depthMax = section.depthM[levels - 1] || 1
  const [minV, maxV] = props.colorRange
  const span = maxV - minV || 1

  const img = ctx.createImageData(Math.max(1, Math.round(plotW)), Math.max(1, Math.round(plotH)))
  const iw = img.width
  const ih = img.height
  for (let py = 0; py < ih; py += 1) {
    const depth = (py / ih) * depthMax
    let lz = 0
    while (lz < levels - 2 && section.depthM[lz + 1] < depth) lz += 1
    const d0 = section.depthM[lz]
    const d1 = section.depthM[lz + 1]
    const tz = d1 > d0 ? (depth - d0) / (d1 - d0) : 0
    for (let px = 0; px < iw; px += 1) {
      const si = Math.min(samples - 1, Math.round((px / iw) * (samples - 1)))
      const v0 = section.values[si][lz]
      const v1 = section.values[si][lz + 1]
      let value = NaN
      if (Number.isFinite(v0) && Number.isFinite(v1)) value = v0 + (v1 - v0) * tz
      else if (Number.isFinite(v0)) value = v0
      else if (Number.isFinite(v1)) value = v1
      const o = (py * iw + px) * 4
      if (Number.isFinite(value)) {
        const [r, g, b] = oceanPaletteColorAt(props.paletteId, (value - minV) / span)
        img.data[o] = r
        img.data[o + 1] = g
        img.data[o + 2] = b
        img.data[o + 3] = 230
      } else {
        img.data[o + 3] = 0
      }
    }
  }
  const scratch = document.createElement('canvas')
  scratch.width = iw
  scratch.height = ih
  const sctx = scratch.getContext('2d')
  if (sctx) {
    sctx.putImageData(img, 0, 0)
    ctx.drawImage(scratch, 0, 0, iw, ih, padL, padT, plotW, plotH)
  }

  // 海底包络线
  ctx.strokeStyle = 'rgba(40,30,20,0.85)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let i = 0; i < samples; i += 1) {
    const x = padL + (section.distanceKm[i] / distMax) * plotW
    const y = padT + (Math.min(section.seabedM[i], depthMax) / depthMax) * plotH
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  ctx.fillStyle = '#9fb8d4'
  ctx.font = '10px ui-monospace, monospace'
  ctx.textAlign = 'right'
  for (let i = 0; i <= 4; i += 1) {
    ctx.fillText(`${((depthMax * i) / 4).toFixed(0)}`, padL - 5, padT + (plotH * i) / 4 + 3)
  }
  ctx.textAlign = 'center'
  ctx.fillText('距离 km', padL + plotW / 2, cssH - 6)
  ctx.textAlign = 'left'
  ctx.fillText('0', padL, padT - 2)
  ctx.textAlign = 'right'
  ctx.fillText(distMax.toFixed(0), padL + plotW, padT - 2)
}

function schedule(): void {
  requestAnimationFrame(draw)
}

watch(() => [props.section, props.paletteId, props.colorRange], schedule, { deep: true })

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
