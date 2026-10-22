import { LANDMARK_MAP } from './defaults'
import type { RuntimeState, SubtitleView, PopupView, ChapterView } from './types'

export type Projector = (longitude: number, latitude: number, height: number) => { x: number; y: number; visible: boolean }

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const paragraphs = text.split(/\n/)
  const lines: string[] = []
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push('')
      continue
    }
    let line = ''
    for (const char of paragraph) {
      const next = line + char
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line)
        line = char
      } else {
        line = next
      }
    }
    if (line) lines.push(line)
  }
  return lines.length ? lines : ['']
}

function drawAnchoredCard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  anchor: { x: number; y: number },
  card: { width: number; height: number },
  placement: 'left' | 'right' | 'top' | 'bottom' | 'center'
): { x: number; y: number } {
  const margin = 24 * (width / 1920)
  if (placement === 'center') {
    return { x: (width - card.width) / 2, y: (height - card.height) / 2 }
  }
  let x = anchor.x + 34 * (width / 1920)
  let y = anchor.y - card.height / 2
  if (placement === 'left') x = anchor.x - card.width - 34 * (width / 1920)
  if (placement === 'top') {
    x = anchor.x - card.width / 2
    y = anchor.y - card.height - 34 * (width / 1920)
  }
  if (placement === 'bottom') {
    x = anchor.x - card.width / 2
    y = anchor.y + 34 * (width / 1920)
  }
  x = Math.max(margin, Math.min(width - card.width - margin, x))
  y = Math.max(margin, Math.min(height - card.height - margin, y))
  return { x, y }
}

function drawSubtitle(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  view: SubtitleView,
  project: Projector
): void {
  const scale = width / 1920
  const param = view.param
  const alpha = Math.max(0, Math.min(1, view.alpha))
  if (alpha <= 0.01) return
  const bodySize = Math.max(14, param.fontSize * scale)
  const titleSize = bodySize * 1.45
  const padding = 26 * scale
  const maxWidth = Math.min(width * 0.82, Math.max(360 * scale, param.maxWidth * scale))
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.textBaseline = 'top'

  if (param.position === 'callout') {
    const anchorSource = param.callout
    if (!anchorSource) {
      ctx.restore()
      return
    }
    const anchor = project(anchorSource.longitude, anchorSource.latitude, anchorSource.height)
    if (!anchor.visible) {
      ctx.restore()
      return
    }
    ctx.font = `600 ${titleSize}px "PingFang SC", "Microsoft YaHei", sans-serif`
    const titleLines = param.title ? [param.title] : []
    ctx.font = `400 ${bodySize * 0.72}px "PingFang SC", "Microsoft YaHei", sans-serif`
    const textLines = wrapText(ctx, param.text, maxWidth - padding * 2)
    const cardWidth = maxWidth
    const lineHeight = bodySize * 0.92
    const cardHeight = padding * 2 + titleLines.length * titleSize * 1.2 + textLines.length * lineHeight
    const card = drawAnchoredCard(ctx, width, height, anchor, { width: cardWidth, height: cardHeight }, 'right')
    const radius = 16 * scale
    ctx.fillStyle = 'rgba(5, 13, 23, 0.86)'
    roundRect(ctx, card.x, card.y, cardWidth, cardHeight, radius)
    ctx.fill()
    ctx.strokeStyle = 'rgba(120, 200, 255, 0.24)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = param.accent
    roundRect(ctx, card.x, card.y, 4 * scale, cardHeight, 2 * scale)
    ctx.fill()
    ctx.strokeStyle = param.accent
    ctx.globalAlpha = alpha * 0.7
    ctx.beginPath()
    ctx.moveTo(anchor.x, anchor.y)
    ctx.lineTo(card.x < anchor.x ? card.x + cardWidth : card.x, card.y + cardHeight / 2)
    ctx.stroke()
    ctx.globalAlpha = alpha
    ctx.beginPath()
    ctx.arc(anchor.x, anchor.y, 6 * scale, 0, Math.PI * 2)
    ctx.fillStyle = param.accent
    ctx.fill()
    let cursorY = card.y + padding
    ctx.fillStyle = param.color
    titleLines.forEach((line) => {
      ctx.font = `600 ${titleSize}px "PingFang SC", "Microsoft YaHei", sans-serif`
      ctx.fillText(line, card.x + padding + 8 * scale, cursorY)
      cursorY += titleSize * 1.2
    })
    ctx.font = `400 ${bodySize * 0.72}px "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.fillStyle = 'rgba(220, 236, 252, 0.78)'
    textLines.forEach((line) => {
      ctx.fillText(line, card.x + padding + 8 * scale, cursorY)
      cursorY += lineHeight
    })
    ctx.restore()
    return
  }

  let boxX = width * 0.07
  let boxY = height * 0.72
  let boxWidth = maxWidth
  let align: 'left' | 'center' | 'right' = param.align
  let centerText = false

  if (param.position === 'fullscreen') {
    boxWidth = Math.min(width * 0.78, maxWidth * 1.25)
    boxX = (width - boxWidth) / 2
    boxY = height * 0.34
    align = 'center'
    centerText = true
  } else if (param.position === 'top') {
    boxX = (width - boxWidth) / 2
    boxY = height * 0.1
    align = 'center'
    centerText = true
  } else if (param.position === 'left') {
    boxX = width * 0.06
    boxY = height * 0.42
  } else if (param.position === 'right') {
    boxX = width - boxWidth - width * 0.06
    boxY = height * 0.42
    align = 'left'
  } else {
    boxX = width * 0.07
    boxY = height * 0.73
  }

  ctx.font = `400 ${bodySize * 0.8}px "PingFang SC", "Microsoft YaHei", sans-serif`
  const textLines = wrapText(ctx, param.text, boxWidth - padding * 2)
  const lineHeight = bodySize * 1.02
  const titleBlock = param.title ? titleSize * 1.35 : 0
  const boxHeight = padding * 2 + titleBlock + textLines.length * lineHeight
  const radius = 14 * scale

  if (param.background === 'gradient') {
    const gradient = ctx.createLinearGradient(boxX, boxY, boxX + boxWidth, boxY)
    gradient.addColorStop(0, 'rgba(4, 11, 20, 0.88)')
    gradient.addColorStop(0.72, 'rgba(4, 11, 20, 0.65)')
    gradient.addColorStop(1, 'rgba(4, 11, 20, 0.05)')
    ctx.fillStyle = gradient
    roundRect(ctx, boxX, boxY, boxWidth, boxHeight, radius)
    ctx.fill()
  } else if (param.background === 'dark') {
    ctx.fillStyle = 'rgba(4, 11, 20, 0.72)'
    roundRect(ctx, boxX, boxY, boxWidth, boxHeight, radius)
    ctx.fill()
  } else if (param.background === 'glass') {
    ctx.fillStyle = 'rgba(12, 26, 42, 0.48)'
    roundRect(ctx, boxX, boxY, boxWidth, boxHeight, radius)
    ctx.fill()
    ctx.strokeStyle = 'rgba(130, 205, 255, 0.24)'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  ctx.fillStyle = param.accent
  roundRect(ctx, boxX, boxY + padding * 0.55, 3 * scale, Math.max(26 * scale, boxHeight - padding * 1.1), 2 * scale)
  ctx.fill()

  let cursorY = boxY + padding
  if (param.title) {
    ctx.font = `600 ${titleSize}px "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.fillStyle = param.color
    ctx.textAlign = centerText ? 'center' : align
    const x = centerText ? boxX + boxWidth / 2 : boxX + padding + 10 * scale
    ctx.fillText(param.title, x, cursorY)
    cursorY += titleBlock
  }
  ctx.font = `400 ${bodySize * 0.8}px "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.fillStyle = 'rgba(222, 238, 252, 0.9)'
  ctx.textAlign = centerText ? 'center' : align
  const textX = centerText
    ? boxX + boxWidth / 2
    : align === 'right'
      ? boxX + boxWidth - padding - 10 * scale
      : boxX + padding + 10 * scale
  textLines.forEach((line) => {
    ctx.fillText(line, textX, cursorY)
    cursorY += lineHeight
  })
  ctx.restore()
}

function drawPopup(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  view: PopupView,
  project: Projector
): void {
  const scale = width / 1920
  const param = view.param
  const alpha = Math.max(0, Math.min(1, view.alpha))
  if (alpha <= 0.01) return
  const landmark = param.targetId ? LANDMARK_MAP[param.targetId] : null
  const anchor = landmark
    ? project(landmark.longitude, landmark.latitude, landmark.height + 40)
    : { x: width / 2, y: height / 2, visible: true }
  if (!anchor.visible) return

  const cardWidth = Math.min(width * 0.6, Math.max(280 * scale, param.width * scale))
  const padding = 20 * scale
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.font = `600 ${20 * scale}px "PingFang SC", "Microsoft YaHei", sans-serif`
  const titleLines = wrapText(ctx, param.title, cardWidth - padding * 2)
  ctx.font = `400 ${13.5 * scale}px "PingFang SC", "Microsoft YaHei", sans-serif`
  const contentLines = wrapText(ctx, param.content, cardWidth - padding * 2)
  const cardHeight = padding * 2 + titleLines.length * 26 * scale + 8 * scale + contentLines.length * 21 * scale + 22 * scale
  const card = drawAnchoredCard(ctx, width, height, anchor, { width: cardWidth, height: cardHeight }, param.placement)
  const radius = 14 * scale
  ctx.fillStyle = 'rgba(5, 13, 23, 0.9)'
  roundRect(ctx, card.x, card.y, cardWidth, cardHeight, radius)
  ctx.fill()
  ctx.strokeStyle = 'rgba(150, 210, 255, 0.22)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = param.accent
  roundRect(ctx, card.x, card.y, 4 * scale, cardHeight, 2 * scale)
  ctx.fill()

  if (param.placement !== 'center') {
    ctx.strokeStyle = param.accent
    ctx.globalAlpha = alpha * 0.65
    ctx.beginPath()
    ctx.moveTo(anchor.x, anchor.y)
    const targetX = card.x < anchor.x ? card.x + cardWidth : card.x
    const targetY = card.y + cardHeight / 2
    ctx.lineTo(targetX, targetY)
    ctx.stroke()
    ctx.globalAlpha = alpha
    ctx.fillStyle = param.accent
    ctx.beginPath()
    ctx.arc(anchor.x, anchor.y, 5 * scale, 0, Math.PI * 2)
    ctx.fill()
  }

  let cursorY = card.y + padding
  ctx.textAlign = 'left'
  ctx.fillStyle = '#f3f8ff'
  titleLines.forEach((line) => {
    ctx.font = `600 ${20 * scale}px "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.fillText(line, card.x + padding + 10 * scale, cursorY)
    cursorY += 26 * scale
  })
  cursorY += 8 * scale
  ctx.fillStyle = 'rgba(216, 234, 250, 0.78)'
  contentLines.forEach((line) => {
    ctx.font = `400 ${13.5 * scale}px "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.fillText(line, card.x + padding + 10 * scale, cursorY)
    cursorY += 21 * scale
  })
  ctx.fillStyle = param.accent
  ctx.globalAlpha = alpha * 0.8
  ctx.font = `500 ${10 * scale}px "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.fillText('CITY LANDMARK / CESIUM', card.x + padding + 10 * scale, card.y + cardHeight - 18 * scale)
  ctx.restore()
}

function drawChapter(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  chapter: ChapterView
): void {
  const scale = width / 1920
  const alpha = Math.max(0, Math.min(1, chapter.alpha))
  if (alpha <= 0.01) return
  ctx.save()
  ctx.globalAlpha = alpha
  if (chapter.type === 'dip') {
    ctx.fillStyle = 'rgba(2, 6, 11, 0.72)'
    ctx.fillRect(0, 0, width, height)
  }
  if (chapter.type === 'slide') {
    const gradient = ctx.createLinearGradient(0, 0, width * 0.36, 0)
    gradient.addColorStop(0, 'rgba(3, 9, 17, 0.9)')
    gradient.addColorStop(1, 'rgba(3, 9, 17, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width * 0.36, height)
  }
  const x = width * 0.055
  const centerY = height * 0.46
  ctx.fillStyle = '#ffc76a'
  ctx.font = `700 ${Math.round(76 * scale)}px "SF Pro Display", "PingFang SC", sans-serif`
  ctx.fillText(String(chapter.index).padStart(2, '0'), x, centerY - 46 * scale)
  ctx.fillStyle = 'rgba(94, 224, 255, 0.95)'
  ctx.fillRect(x + 4 * scale, centerY + 18 * scale, 92 * scale, 2 * scale)
  ctx.fillStyle = '#f1f7ff'
  ctx.font = `600 ${Math.round(24 * scale)}px "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.fillText(chapter.name, x + 4 * scale, centerY + 36 * scale)
  ctx.fillStyle = 'rgba(180, 206, 230, 0.7)'
  ctx.font = `500 ${Math.round(11 * scale)}px "SF Pro Display", "PingFang SC", sans-serif`
  ctx.fillText(`STEP ${String(chapter.index).padStart(2, '0')} / ${String(chapter.total).padStart(2, '0')}`, x + 6 * scale, centerY + 74 * scale)
  const barWidth = 168 * scale
  ctx.fillStyle = 'rgba(255,255,255,0.16)'
  ctx.fillRect(x + 6 * scale, centerY + 92 * scale, barWidth, 2 * scale)
  ctx.fillStyle = '#5ee0ff'
  ctx.fillRect(x + 6 * scale, centerY + 92 * scale, barWidth * chapter.progress, 2 * scale)
  ctx.restore()
}

export function drawExportOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  runtime: RuntimeState,
  project: Projector
): void {
  if (runtime.chapter) drawChapter(ctx, width, height, runtime.chapter)
  for (const subtitle of runtime.subtitles) drawSubtitle(ctx, width, height, subtitle, project)
  for (const popup of runtime.popups) drawPopup(ctx, width, height, popup, project)
}
