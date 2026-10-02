/**
 * 地质剖面绘制 —— 把 Worker 回传的 A-B 剖面栅格渲染为专业二维地质剖面图。
 *
 * 岩性模式下按标准岩性色板着色并勾画层界；属性模式下按给定色带（支持渗透率对数色标）
 * 着色。同时绘制深度刻度与剖面端点标记，可直接用于成果展示或导出。
 */

import { LITHOLOGY_CATEGORIES, PALETTES, lerpStops } from '../../lib/volume-engine/palette'

export type GeologyProfileResult = {
  steps: number
  levels: number
  litho: Uint8Array
  values: Float32Array
  a: [number, number]
  b: [number, number]
  channel: string
}

export type ProfileDrawOptions = {
  /** 'litho' 按岩性着色；其余按属性值着色 */
  channel: string
  palette: string
  valueMin: number
  valueMax: number
  log?: boolean
  /** 体域垂向厚度（米），用于深度标注 */
  heightM: number
  /** 剖面水平长度（米），用于距离标注 */
  lengthM: number
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function colorAt(result: GeologyProfileResult, idx: number, options: ProfileDrawOptions): [number, number, number] {
  if (options.channel === 'litho') {
    const code = result.litho[idx]
    const hit = LITHOLOGY_CATEGORIES.find((c) => c.code === code)
    return hit ? hit.color : [120, 120, 120]
  }
  const value = result.values[idx]
  let t: number
  if (options.log && value > 0) {
    const lo = Math.log(Math.max(options.valueMin, 1e-6))
    const hi = Math.log(Math.max(options.valueMax, 1e-6))
    t = clamp01((Math.log(value) - lo) / ((hi - lo) || 1))
  } else {
    t = clamp01((value - options.valueMin) / ((options.valueMax - options.valueMin) || 1))
  }
  const stops = (PALETTES[options.palette] ?? PALETTES.viridis).stops
  return lerpStops(stops, t)
}

/** 在给定 canvas 上绘制地质剖面（自动重置尺寸以适配 DPR） */
export function drawGeologySection(
  canvas: HTMLCanvasElement,
  result: GeologyProfileResult,
  options: ProfileDrawOptions
): void {
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)
  const cssW = canvas.clientWidth || 320
  const cssH = canvas.clientHeight || 160
  canvas.width = Math.round(cssW * dpr)
  canvas.height = Math.round(cssH * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)

  const padL = 30
  const padR = 8
  const padT = 6
  const padB = 18
  const plotW = cssW - padL - padR
  const plotH = cssH - padT - padB
  const { steps, levels } = result
  const cw = plotW / steps
  const ch = plotH / levels

  // 属性模式先铺底，岩性模式直接逐格着色
  const image = ctx.createImageData(Math.max(1, Math.round(plotW)), Math.max(1, Math.round(plotH)))
  const iw = image.width
  const ih = image.height
  for (let py = 0; py < ih; py += 1) {
    const l = Math.min(levels - 1, Math.floor((py / ih) * levels))
    for (let px = 0; px < iw; px += 1) {
      const s = Math.min(steps - 1, Math.floor((px / iw) * steps))
      const idx = l * steps + s
      const [r, g, b] = colorAt(result, idx, options)
      const o = (py * iw + px) * 4
      image.data[o] = r
      image.data[o + 1] = g
      image.data[o + 2] = b
      image.data[o + 3] = 255
    }
  }
  ctx.putImageData(image, padL, padT)

  // 层界描线（岩性模式）
  if (options.channel === 'litho') {
    ctx.strokeStyle = 'rgba(8, 19, 31, 0.65)'
    ctx.lineWidth = 1
    for (let s = 0; s < steps; s += 1) {
      const x = padL + s * cw
      for (let l = 1; l < levels; l += 1) {
        if (result.litho[l * steps + s] !== result.litho[(l - 1) * steps + s]) {
          const y = padT + l * ch
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(x + cw, y)
          ctx.stroke()
        }
      }
    }
  }

  // 边框
  ctx.strokeStyle = 'rgba(157, 188, 224, 0.55)'
  ctx.lineWidth = 1
  ctx.strokeRect(padL, padT, plotW, plotH)

  // 深度刻度
  ctx.fillStyle = '#9fb8d4'
  ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  const depthStepM = options.heightM <= 1500 ? 250 : 500
  for (let d = 0; d <= options.heightM; d += depthStepM) {
    const y = padT + (d / options.heightM) * plotH
    ctx.fillText(`${d}`, padL - 4, y)
    ctx.strokeStyle = 'rgba(157, 188, 224, 0.14)'
    ctx.beginPath()
    ctx.moveTo(padL, y)
    ctx.lineTo(padL + plotW, y)
    ctx.stroke()
  }

  // 端点标记
  ctx.fillStyle = '#ffd21e'
  ctx.font = 'bold 10px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText('A', padL + 2, padT + plotH - 2)
  ctx.textAlign = 'right'
  ctx.fillText('B', padL + plotW - 2, padT + plotH - 2)
  ctx.fillStyle = '#7f96b3'
  ctx.font = '9px ui-monospace, monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('0 m', padL, padT + plotH + 2)
  ctx.textAlign = 'right'
  ctx.fillText(`${options.lengthM.toFixed(0)} m`, padL + plotW, padT + plotH + 2)
}
