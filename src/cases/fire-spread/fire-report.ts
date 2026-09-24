/**
 * 林火蔓延渲染分析 — 分析报告输出。
 *
 * 复用日照/阴影案例的通用报告数据模型与 Word 导出能力，并补充
 * 基于 html2canvas + jsPDF 的 PDF 在线预览与 PDF 文件导出。
 */

import { exportReportDocx, printReport, type ReportExportOptions, type ReportModel } from '../sunshine-lib/report'

export { exportReportDocx, printReport }
export type { ReportModel, ReportSection, ReportKV, ReportTable, ReportImage, ReportExportOptions } from '../sunshine-lib/report'

export function nowStamp(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/**
 * 可作为分页断点的原子块选择器：段落、列表项、表格行、图题、图片、键值对等。
 * 分页时只在这些块的下边界切分，避免把一行文字或一整块内容截断。
 */
const ATOMIC_BREAK_SELECTOR = [
  'p',
  'li',
  'dt',
  'dd',
  'tr',
  '.rx-report-line',
  '.rx-report-caption',
  '.rx-report-figcaption',
  '.rx-report-image',
  '.rx-report-kv',
  '.rx-report-figure',
  '.rx-report-table'
].join(',')

/** 收集报告中所有可安全分页的纵向断点（相对元素顶部的画布像素）。 */
function collectBreakPoints(element: HTMLElement, scale: number): number[] {
  const base = element.getBoundingClientRect().top
  const points = new Set<number>()
  element.querySelectorAll<HTMLElement>(ATOMIC_BREAK_SELECTOR).forEach((node) => {
    // 标题不作为断点，避免标题孤立在页尾（其下边界仍会作为后续内容的起点）。
    if (node.tagName === 'H1' || node.tagName === 'H2' || node.tagName === 'H3') return
    if (node.classList.contains('rx-report-h2')) return
    const rect = node.getBoundingClientRect()
    if (rect.height <= 0) return
    const bottom = Math.round((rect.bottom - base) * scale)
    if (bottom > 0) points.add(bottom)
  })
  return Array.from(points).sort((a, b) => a - b)
}

/** 将报告 DOM 渲染为 PDF Blob（A4 分页，分页处对齐内容块边界） */
export async function renderReportPdf(element: HTMLElement): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
  const canvas = await html2canvas(element, {
    scale: Math.min(2, window.devicePixelRatio || 1.5),
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
    width: element.scrollWidth,
    height: element.scrollHeight,
    windowWidth: element.scrollWidth,
    windowHeight: element.scrollHeight
  })

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 8
  const imageWidth = pageWidth - margin * 2
  const pxPerMm = canvas.width / imageWidth
  const pageContentPx = Math.floor((pageHeight - margin * 2) * pxPerMm)

  // 内容块边界换算到画布像素，用于选择不切断文字的分页位置。
  const scale = canvas.width / Math.max(element.scrollWidth, 1)
  const breakPoints = collectBreakPoints(element, scale)
  const minSlicePx = Math.floor(pageContentPx * 0.2)

  let offset = 0
  let firstPage = true
  while (offset < canvas.height) {
    const remaining = canvas.height - offset
    let sliceHeight: number
    if (remaining <= pageContentPx) {
      sliceHeight = remaining
    } else {
      const limit = offset + pageContentPx
      let breakAt = -1
      for (const point of breakPoints) {
        if (point <= offset) continue
        if (point > limit) break
        breakAt = point
      }
      sliceHeight =
        breakAt > offset && breakAt - offset >= minSlicePx ? breakAt - offset : pageContentPx
    }
    const slice = document.createElement('canvas')
    slice.width = canvas.width
    slice.height = sliceHeight
    const ctx = slice.getContext('2d')
    if (!ctx) break
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, slice.width, slice.height)
    ctx.drawImage(canvas, 0, offset, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight)
    const data = slice.toDataURL('image/jpeg', 0.92)
    if (!firstPage) pdf.addPage()
    pdf.addImage(data, 'JPEG', margin, margin, imageWidth, sliceHeight / pxPerMm)
    offset += sliceHeight
    firstPage = false
  }
  return pdf.output('blob')
}

/** 生成 PDF 预览用的 object URL（调用方负责 revoke） */
export async function createReportPdfUrl(element: HTMLElement): Promise<string> {
  const blob = await renderReportPdf(element)
  return URL.createObjectURL(blob)
}

/** 导出 PDF 文件 */
export async function exportReportPdf(element: HTMLElement, options: ReportExportOptions): Promise<void> {
  const blob = await renderReportPdf(element)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${options.filenamePrefix}-${nowStamp()}.pdf`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  options.onStatus?.('分析报告已生成，正在下载 PDF 文件')
}
