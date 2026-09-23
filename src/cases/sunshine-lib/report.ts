/**
 * 空间分析（阴影 / 日照覆盖）共享报告输出模块。
 *
 * 提供统一的分析报告数据模型，以及两种输出形式：
 * 1. 打印 / 另存为 PDF：把报告渲染为独立 HTML 页面并调用浏览器打印；
 * 2. 下载 Word(.docx)：使用 docx 在浏览器端生成并下载文档。
 */

export type ReportKV = { label: string; value: string }
export type ReportTable = { caption: string; head: string[]; body: (string | number)[][] }
export type ReportImage = { src: string; caption: string; note?: string }
export type ReportSection = {
  title: string
  kv?: ReportKV[]
  lines?: string[]
  table?: ReportTable
  images?: ReportImage[]
}
export type ReportModel = {
  generatedAt: string
  intro: string
  sections: ReportSection[]
  /** 封面信息（密级、编号、火情名称等），可选 */
  cover?: { classification?: string; title?: string; subtitle?: string; meta?: ReportKV[] }
}

export type ReportExportOptions = {
  /** 报告标题，同时用于打印窗口标题与 Word 文档标题 */
  docTitle: string
  /** 下载文件名前缀，如 shadow-analysis-report */
  filenamePrefix: string
  /** Word 文档创建者，默认取 docTitle */
  creator?: string
  /** 状态提示回调（可选） */
  onStatus?: (message: string) => void
}

function escapeHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function nowStamp(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
}

export function buildReportStandaloneHtml(model: ReportModel, docTitle: string): string {
  let sectionsHtml = ''
  for (const section of model.sections) {
    sectionsHtml += `<h2>${escapeHtml(section.title)}</h2>`
    if (section.kv && section.kv.length > 0) {
      let kvHtml = ''
      for (const pair of section.kv) {
        kvHtml += `<tr><th>${escapeHtml(pair.label)}</th><td>${escapeHtml(pair.value)}</td></tr>`
      }
      sectionsHtml += `<table class="kv">${kvHtml}</table>`
    }
    if (section.table) {
      if (section.table.caption) sectionsHtml += `<p class="caption">${escapeHtml(section.table.caption)}</p>`
      let bodyHtml = '<tr>'
      for (const head of section.table.head) bodyHtml += `<th>${escapeHtml(head)}</th>`
      bodyHtml += '</tr>'
      for (const row of section.table.body) {
        bodyHtml += '<tr>'
        for (const cell of row) bodyHtml += `<td>${escapeHtml(cell)}</td>`
        bodyHtml += '</tr>'
      }
      sectionsHtml += `<table>${bodyHtml}</table>`
    }
    if (section.lines && section.lines.length > 0) {
      for (const line of section.lines) sectionsHtml += `<p>${escapeHtml(line)}</p>`
    }
    if (section.images && section.images.length > 0) {
      for (const image of section.images) {
        sectionsHtml += `<figure class="fig"><img src="${image.src}" alt="${escapeHtml(image.caption)}" /><figcaption>${escapeHtml(image.caption)}</figcaption>`
        if (image.note) sectionsHtml += `<p class="fig-note">${escapeHtml(image.note)}</p>`
        sectionsHtml += '</figure>'
      }
    }
  }
  const cover = model.cover
  const coverHtml = cover
    ? `<p class="classification">${escapeHtml(cover.classification ?? '')}</p>
    <h1 class="cover-title">${escapeHtml(cover.title ?? docTitle)}</h1>
    <p class="cover-subtitle">${escapeHtml(cover.subtitle ?? '')}</p>
    ${cover.meta ? `<table class="kv cover-meta">${cover.meta.map((pair) => `<tr><th>${escapeHtml(pair.label)}</th><td>${escapeHtml(pair.value)}</td></tr>`).join('')}</table>` : ''}`
    : `<h1>${escapeHtml(docTitle)}</h1>`
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(docTitle)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif; color: #1e2f3d; }
  .page { max-width: 780px; margin: 0 auto; padding: 20px 6px; }
  h1 { font-size: 20px; margin: 0 0 4px; color: #17324d; }
  .classification { font-size: 12px; color: #b23a2e; font-weight: 700; letter-spacing: 2px; margin: 0 0 10px; }
  .cover-title { font-size: 24px; text-align: center; margin: 18px 0 6px; color: #10314f; }
  .cover-subtitle { font-size: 13px; text-align: center; color: #5b6b7a; margin: 0 0 14px; }
  .cover-meta { max-width: 560px; margin: 0 auto 10px; }
  .meta { font-size: 11px; color: #6a7b8a; margin: 0 0 6px; }
  .intro { font-size: 12px; line-height: 1.7; color: #3b5061; margin: 0 0 6px; }
  h2 { font-size: 15px; color: #124c7d; margin: 16px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #cfe0ec; page-break-after: avoid; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; font-size: 11px; }
  th, td { border: 1px solid #b9c6d2; padding: 3px 7px; text-align: left; vertical-align: top; word-break: break-all; }
  th { background: #e8f1f8; color: #17324d; }
  table.kv th { width: 28%; background: #f2f7fb; }
  .caption { font-size: 11px; color: #5b6b7a; margin: 2px 0; }
  p { font-size: 12px; line-height: 1.7; }
  .fig { margin: 8px 0 12px; text-align: center; page-break-inside: avoid; }
  .fig img { max-width: 100%; border: 1px solid #c4d2de; border-radius: 4px; }
  .fig figcaption { font-size: 11px; color: #3b5061; margin-top: 4px; font-weight: 600; }
  .fig-note { font-size: 10.5px; color: #6a7b8a; margin: 2px 0 0; }
  @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style>
</head>
<body>
  <div class="page">
    ${coverHtml}
    <p class="meta">生成时间：${escapeHtml(model.generatedAt)}</p>
    <p class="intro">${escapeHtml(model.intro)}</p>
    ${sectionsHtml}
  </div>
</body>
</html>`
}

export function printReport(model: ReportModel, options: ReportExportOptions): void {
  const win = window.open('', '_blank', 'width=920,height=1000')
  if (!win) {
    options.onStatus?.('浏览器已拦截打印窗口，请允许本页弹出窗口后重试；也可改用「下载 Word(.docx)」导出')
    return
  }
  win.document.write(buildReportStandaloneHtml(model, options.docTitle))
  win.document.close()
  win.focus()
  setTimeout(() => {
    try {
      win.print()
    } catch {
      options.onStatus?.('打印窗口已打开，请在其中选择「另存为 PDF」')
    }
  }, 400)
}

export async function exportReportDocx(model: ReportModel, options: ReportExportOptions): Promise<void> {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    HeadingLevel,
    ImageRun,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType
  } = await import('docx')

  const dataUrlToBytes = (dataUrl: string): Uint8Array => {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  }
  const imageType = (dataUrl: string): 'png' | 'jpg' => (dataUrl.startsWith('data:image/jpeg') ? 'jpg' : 'png')

  const cellBorders = {
    top: { style: BorderStyle.SINGLE, size: 4, color: 'B9C6D2' },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: 'B9C6D2' },
    left: { style: BorderStyle.SINGLE, size: 4, color: 'B9C6D2' },
    right: { style: BorderStyle.SINGLE, size: 4, color: 'B9C6D2' }
  }
  const cellParagraph = (text: string | number, header = false): InstanceType<typeof Paragraph> =>
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [
        new TextRun({
          text: String(text),
          bold: header,
          font: { name: '等线', eastAsia: '等线', ascii: 'Arial', hAnsi: 'Arial' },
          size: header ? 20 : 18
        })
      ]
    })

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = []
  if (model.cover) {
    if (model.cover.classification) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: model.cover.classification, bold: true, color: 'B23A2E', size: 22 })],
          spacing: { after: 120 }
        })
      )
    }
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: model.cover.title ?? options.docTitle,
            bold: true,
            size: 44,
            font: { name: '等线', eastAsia: '等线', ascii: 'Arial', hAnsi: 'Arial' }
          })
        ],
        spacing: { before: 240, after: 100 }
      })
    )
    if (model.cover.subtitle) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: model.cover.subtitle, size: 22, color: '5B6B7A' })],
          spacing: { after: 200 }
        })
      )
    }
    if (model.cover.meta && model.cover.meta.length > 0) {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: cellBorders.top,
            bottom: cellBorders.bottom,
            left: cellBorders.left,
            right: cellBorders.right,
            insideHorizontal: cellBorders.top,
            insideVertical: cellBorders.left
          },
          rows: model.cover.meta.map(
            (pair) =>
              new TableRow({
                children: [
                  new TableCell({ width: { size: 30, type: WidthType.PERCENTAGE }, borders: cellBorders, children: [cellParagraph(pair.label, true)] }),
                  new TableCell({ width: { size: 70, type: WidthType.PERCENTAGE }, borders: cellBorders, children: [cellParagraph(pair.value)] })
                ]
              })
          )
        })
      )
    }
    children.push(new Paragraph({ children: [], pageBreakBefore: true }))
  }
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: options.docTitle, bold: true, size: 40, font: { name: '等线', eastAsia: '等线', ascii: 'Arial', hAnsi: 'Arial' } })
      ],
      spacing: { after: 120 }
    }),
    new Paragraph({
      children: [new TextRun({ text: `生成时间：${model.generatedAt}`, size: 18, color: '5B6B7A' })],
      spacing: { after: 80 }
    }),
    new Paragraph({
      children: [new TextRun({ text: model.intro, size: 20, color: '3B5061' })],
      spacing: { after: 120 }
    })
  )

  for (const section of model.sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: section.title, bold: true, size: 30 })],
        spacing: { before: 220, after: 100 }
      })
    )
    if (section.kv && section.kv.length > 0) {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: cellBorders.top,
            bottom: cellBorders.bottom,
            left: cellBorders.left,
            right: cellBorders.right,
            insideHorizontal: cellBorders.top,
            insideVertical: cellBorders.left
          },
          rows: section.kv.map(
            (pair) =>
              new TableRow({
                children: [
                  new TableCell({ width: { size: 30, type: WidthType.PERCENTAGE }, borders: cellBorders, children: [cellParagraph(pair.label, true)] }),
                  new TableCell({ width: { size: 70, type: WidthType.PERCENTAGE }, borders: cellBorders, children: [cellParagraph(pair.value)] })
                ]
              })
          )
        })
      )
    }
    if (section.table) {
      const head = new TableRow({
        children: section.table.head.map(
          (cell) => new TableCell({ borders: cellBorders, shading: { fill: 'E8F1F8' }, children: [cellParagraph(cell, true)] })
        )
      })
      const body = section.table.body.map(
        (row) => new TableRow({ children: row.map((cell) => new TableCell({ borders: cellBorders, children: [cellParagraph(cell)] })) })
      )
      children.push(
        new Paragraph({
          children: [new TextRun({ text: section.table.caption, size: 16, color: '5B6B7A', italics: true })],
          spacing: { after: 60 }
        }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [head, ...body] })
      )
    }
    if (section.lines && section.lines.length > 0) {
      for (const line of section.lines) {
        children.push(new Paragraph({ children: [new TextRun({ text: line, size: 20 })], spacing: { after: 40 } }))
      }
    }
    if (section.images && section.images.length > 0) {
      for (const image of section.images) {
        try {
          children.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new ImageRun({
                  type: imageType(image.src),
                  data: dataUrlToBytes(image.src),
                  transformation: { width: 520, height: 300 }
                })
              ],
              spacing: { before: 120, after: 40 }
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: image.caption, size: 18, bold: true, color: '3B5061' })],
              spacing: { after: image.note ? 20 : 120 }
            })
          )
          if (image.note) {
            children.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: image.note, size: 16, color: '6A7B8A' })],
                spacing: { after: 120 }
              })
            )
          }
        } catch {
          // 图片数据异常时跳过该图，不阻断文档导出
        }
      }
    }
  }

  const wordDocument = new Document({
    creator: options.creator ?? options.docTitle,
    title: options.docTitle,
    sections: [{ children }]
  })
  const blob = await Packer.toBlob(wordDocument)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${options.filenamePrefix}-${nowStamp()}.docx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  options.onStatus?.('分析报告已生成，正在下载 Word(.docx) 文件')
}
