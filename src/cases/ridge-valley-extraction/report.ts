/**
 * 山脊线 / 山谷线提取 — 分析报告输出。
 *
 * 提供在线预览所需的数据模型，以及基于 html2canvas + jsPDF 的
 * PDF 在线预览与 PDF 文件导出能力（A4 分页）。
 */

export type ReportKV = { label: string; value: string }
export type ReportImage = { src: string; caption?: string }
export type ReportSection = {
  title: string
  kv?: ReportKV[]
  lines?: string[]
  image?: ReportImage
}
export type RidgeReportModel = {
  generatedAt: string
  intro: string
  sections: ReportSection[]
}

export function nowStamp(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/** 将报告 DOM 渲染为 PDF Blob（A4 分页） */
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

  let offset = 0
  let firstPage = true
  while (offset < canvas.height) {
    const sliceHeight = Math.min(pageContentPx, canvas.height - offset)
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
export async function exportReportPdf(element: HTMLElement, filenamePrefix: string): Promise<void> {
  const blob = await renderReportPdf(element)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filenamePrefix}-${nowStamp()}.pdf`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
