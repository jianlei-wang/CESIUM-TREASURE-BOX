/** 分析结果报告：HTML 装配 + PDF / Word 导出。 */

export type ReportKV = { label: string; value: string }
export type ReportTable = { caption: string; head: string[]; body: (string | number)[][] }
export type ReportSection = { title: string; kv?: ReportKV[]; table?: ReportTable; lines?: string[]; image?: string }
export type SlopeReportModel = {
  generatedAt: string
  title: string
  subtitle: string
  intro: string
  watermark: string
  sections: ReportSection[]
}

function escapeHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function sectionsHtml(model: SlopeReportModel): string {
  let html = ''
  for (const section of model.sections) {
    html += `<h2>${escapeHtml(section.title)}</h2>`
    if (section.image) html += `<div class="shot"><img src="${section.image}" alt="${escapeHtml(section.title)}" /></div>`
    if (section.kv && section.kv.length > 0) {
      let rows = ''
      for (const pair of section.kv) rows += `<tr><th>${escapeHtml(pair.label)}</th><td>${escapeHtml(pair.value)}</td></tr>`
      html += `<table class="kv">${rows}</table>`
    }
    if (section.table) {
      if (section.table.caption) html += `<p class="caption">${escapeHtml(section.table.caption)}</p>`
      let body = '<tr>'
      for (const head of section.table.head) body += `<th>${escapeHtml(head)}</th>`
      body += '</tr>'
      for (const row of section.table.body) {
        body += '<tr>'
        for (const cell of row) body += `<td>${escapeHtml(cell)}</td>`
        body += '</tr>'
      }
      html += `<table>${body}</table>`
    }
    if (section.lines && section.lines.length > 0) {
      for (const line of section.lines) html += `<p>${escapeHtml(line)}</p>`
    }
  }
  return html
}

const REPORT_STYLE = `
.sg-report { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; color: #22303e; width: 760px; padding: 26px 30px; background: #fff; }
.sg-report h1 { margin: 0 0 4px; font-size: 21px; text-align: center; }
.sg-report .sub { text-align: center; color: #5b6b7c; font-size: 12px; margin: 0 0 4px; }
.sg-report .meta { text-align: center; color: #8794a3; font-size: 11px; margin: 0 0 14px; }
.sg-report .intro { font-size: 12px; line-height: 1.75; background: #f4f8fb; border-left: 3px solid #2f80ed; padding: 8px 12px; }
.sg-report h2 { margin: 18px 0 8px; font-size: 14px; border-left: 4px solid #2f80ed; padding-left: 8px; }
.sg-report table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 12px; }
.sg-report th, .sg-report td { border: 1px solid #cdd8e3; padding: 5px 8px; text-align: left; }
.sg-report th { background: #eef4fa; font-weight: 600; }
.sg-report table.kv th { width: 150px; background: #f6f9fc; }
.sg-report p { font-size: 12px; line-height: 1.7; margin: 4px 0; }
.sg-report .caption { color: #5b6b7c; font-size: 11px; margin-top: 8px; }
.sg-report .shot img { width: 100%; border: 1px solid #cdd8e3; border-radius: 4px; }
.sg-report .watermark { margin-top: 18px; padding-top: 8px; border-top: 1px dashed #c3cfdb; color: #a06a00; font-size: 11px; }
`

export function buildReportBodyHtml(model: SlopeReportModel): string {
  return `<style>${REPORT_STYLE}</style><div class="sg-report"><h1>${escapeHtml(
    model.title
  )}</h1><p class="sub">${escapeHtml(model.subtitle)}</p><p class="meta">生成时间：${escapeHtml(
    model.generatedAt
  )}</p><p class="intro">${escapeHtml(model.intro)}</p>${sectionsHtml(
    model
  )}<p class="watermark">${escapeHtml(model.watermark)}</p></div>`
}

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

/** 以 HTML 形式导出 .doc，Word 可直接打开并保持表格样式。 */
export function buildWordBlob(html: string): Blob {
  const head = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8" /><title>边坡GNSS预警分析报告</title></head><body>`
  return new Blob([head + html + '</body></html>'], { type: 'application/msword' })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function nowStamp(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(
    now.getMinutes()
  )}${pad(now.getSeconds())}`
}
