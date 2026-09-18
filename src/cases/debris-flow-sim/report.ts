export type ReportKV = { label: string; value: string }
export type ReportTable = { caption: string; head: string[]; body: (string | number)[][] }
export type ReportSection = { title: string; kv?: ReportKV[]; table?: ReportTable; lines?: string[] }
export type DebrisReportModel = { generatedAt: string; intro: string; sections: ReportSection[] }

function escapeHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function sectionsHtml(model: DebrisReportModel): string {
  let html = ''
  for (const section of model.sections) {
    html += `<h2>${escapeHtml(section.title)}</h2>`
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

export function buildReportBodyHtml(model: DebrisReportModel, docTitle: string): string {
  return `<div class="df-report"><h1>${escapeHtml(
    docTitle
  )}</h1><p class="meta">生成时间：${escapeHtml(model.generatedAt)}</p><p class="intro">${escapeHtml(
    model.intro
  )}</p>${sectionsHtml(model)}</div>`
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
