function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sanitizeUrl(raw: string): string {
  const url = raw.trim()
  if (/^(https?:|mailto:)/i.test(url) || url.startsWith('#') || url.startsWith('/') || url.startsWith('./')) {
    return url
  }
  return '#'
}

function renderInline(source: string): string {
  const codes: string[] = []
  let text = source.replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`)
    return `\u0000${codes.length - 1}\u0000`
  })

  text = escapeHtml(text)
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => {
    return `<a href="${escapeHtml(sanitizeUrl(url))}" target="_blank" rel="noopener noreferrer">${label}</a>`
  })
  text = text.replace(/\u0000(\d+)\u0000/g, (_m, idx: string) => codes[Number(idx)] ?? '')
  return text
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line)
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((cell) => cell.trim())
}

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []
  let i = 0

  const flushParagraph = (buffer: string[]) => {
    if (!buffer.length) return
    html.push(`<p>${renderInline(buffer.join(' '))}</p>`)
    buffer.length = 0
  }

  const paragraph: string[] = []

  while (i < lines.length) {
    const line = lines[i]

    if (/^\s*$/.test(line)) {
      flushParagraph(paragraph)
      i += 1
      continue
    }

    const fence = line.match(/^\s*```(\S*)\s*$/)
    if (fence) {
      flushParagraph(paragraph)
      const lang = fence[1] ?? ''
      const code: string[] = []
      i += 1
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        code.push(lines[i])
        i += 1
      }
      i += 1
      const langTag = lang ? `<span class="md-code-lang">${escapeHtml(lang)}</span>` : ''
      html.push(`<pre class="md-code">${langTag}<code>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      flushParagraph(paragraph)
      const level = Math.min(heading[1].length, 6)
      html.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`)
      i += 1
      continue
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph(paragraph)
      html.push('<hr />')
      i += 1
      continue
    }

    if (/^\s*>/.test(line)) {
      flushParagraph(paragraph)
      const quoted: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s*>\s?/, ''))
        i += 1
      }
      html.push(`<blockquote>${renderMarkdown(quoted.join('\n'))}</blockquote>`)
      continue
    }

    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushParagraph(paragraph)
      const header = splitTableRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) {
        rows.push(splitTableRow(lines[i]))
        i += 1
      }
      const headHtml = header.map((cell) => `<th>${renderInline(cell)}</th>`).join('')
      const bodyHtml = rows
        .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`)
        .join('')
      html.push(`<div class="md-table-wrap"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`)
      continue
    }

    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/)
    if (bullet) {
      flushParagraph(paragraph)
      const items: string[] = []
      while (i < lines.length) {
        const match = lines[i].match(/^(\s*)[-*+]\s+(.*)$/)
        if (!match) break
        items.push(`<li>${renderInline(match[2].trim())}</li>`)
        i += 1
      }
      html.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    const ordered = line.match(/^(\s*)\d+\.\s+(.*)$/)
    if (ordered) {
      flushParagraph(paragraph)
      const items: string[] = []
      while (i < lines.length) {
        const match = lines[i].match(/^(\s*)\d+\.\s+(.*)$/)
        if (!match) break
        items.push(`<li>${renderInline(match[2].trim())}</li>`)
        i += 1
      }
      html.push(`<ol>${items.join('')}</ol>`)
      continue
    }

    paragraph.push(line.trim())
    i += 1
  }

  flushParagraph(paragraph)
  return html.join('\n')
}

export interface ParsedFrontmatter {
  data: Record<string, string>
  body: string
}

export function parseFrontmatter(source: string): ParsedFrontmatter {
  const normalized = source.replace(/\r\n?/g, '\n')
  if (!normalized.startsWith('---\n')) return { data: {}, body: normalized }
  const end = normalized.indexOf('\n---', 3)
  if (end === -1) return { data: {}, body: normalized }
  const block = normalized.slice(4, end)
  const data: Record<string, string> = {}
  for (const line of block.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (match) data[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
  }
  return { data, body: normalized.slice(end + 4).replace(/^\n+/, '') }
}
