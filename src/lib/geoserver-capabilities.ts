export type ServiceKind = 'WMS' | 'WFS' | 'WMTS'

export type BBox = [west: number, south: number, east: number, north: number]

export type CapabilityLayer = {
  name: string
  title: string
  tileMatrixSets: string[]
  bbox?: BBox
}

function findChild(el: Element, localName: string): Element | undefined {
  return Array.from(el.children).find((child) => child.localName === localName)
}

function parseNumber(value: string | null | undefined): number | undefined {
  if (value == null) return undefined
  const num = Number(value.trim())
  return Number.isFinite(num) ? num : undefined
}

function asBBox(
  west?: number,
  south?: number,
  east?: number,
  north?: number
): BBox | undefined {
  if (west === undefined || south === undefined || east === undefined || north === undefined) {
    return undefined
  }
  return [west, south, east, north]
}

function wmsLayerBbox(layerEl: Element): BBox | undefined {
  const geoEl = findChild(layerEl, 'EX_GeographicBoundingBox')
  if (geoEl) {
    const bbox = asBBox(
      parseNumber(findChild(geoEl, 'westBoundLongitude')?.textContent),
      parseNumber(findChild(geoEl, 'southBoundLatitude')?.textContent),
      parseNumber(findChild(geoEl, 'eastBoundLongitude')?.textContent),
      parseNumber(findChild(geoEl, 'northBoundLatitude')?.textContent)
    )
    if (bbox) return bbox
  }
  for (const bboxEl of Array.from(layerEl.children)) {
    if (bboxEl.localName !== 'BoundingBox') continue
    const crs = (bboxEl.getAttribute('CRS') || bboxEl.getAttribute('SRS') || '').toUpperCase()
    if (!crs.includes('4326')) continue
    const bbox = asBBox(
      parseNumber(bboxEl.getAttribute('minx')),
      parseNumber(bboxEl.getAttribute('miny')),
      parseNumber(bboxEl.getAttribute('maxx')),
      parseNumber(bboxEl.getAttribute('maxy'))
    )
    if (bbox) return bbox
  }
  return undefined
}

function parseWms(doc: Document): CapabilityLayer[] {
  const layers: CapabilityLayer[] = []

  const walk = (layerEl: Element) => {
    const nameEl = findChild(layerEl, 'Name')
    if (nameEl?.textContent) {
      const name = nameEl.textContent.trim()
      const titleEl = findChild(layerEl, 'Title')
      layers.push({
        name,
        title: titleEl?.textContent?.trim() || name,
        tileMatrixSets: [],
        bbox: wmsLayerBbox(layerEl)
      })
    }
    for (const child of Array.from(layerEl.children)) {
      if (child.localName === 'Layer') walk(child)
    }
  }

  for (const capability of Array.from(doc.getElementsByTagName('Capability'))) {
    for (const child of Array.from(capability.children)) {
      if (child.localName === 'Layer') walk(child)
    }
  }
  return layers
}

function parseWfs(doc: Document): CapabilityLayer[] {
  const layers: CapabilityLayer[] = []
  for (const featureType of Array.from(doc.getElementsByTagName('FeatureType'))) {
    const nameEl = findChild(featureType, 'Name')
    if (!nameEl?.textContent) continue
    const name = nameEl.textContent.trim()
    const titleEl = findChild(featureType, 'Title')
    const bboxEl = findChild(featureType, 'LatLongBoundingBox')
    layers.push({
      name,
      title: titleEl?.textContent?.trim() || name,
      tileMatrixSets: [],
      bbox: bboxEl
        ? asBBox(
            parseNumber(bboxEl.getAttribute('minx')),
            parseNumber(bboxEl.getAttribute('miny')),
            parseNumber(bboxEl.getAttribute('maxx')),
            parseNumber(bboxEl.getAttribute('maxy'))
          )
        : undefined
    })
  }
  return layers
}

function wmtsLayerBbox(layerEl: Element): BBox | undefined {
  const bbEl = findChild(layerEl, 'WGS84BoundingBox')
  if (!bbEl) return undefined
  const lower = findChild(bbEl, 'LowerCorner')?.textContent?.trim().split(/\s+/)
  const upper = findChild(bbEl, 'UpperCorner')?.textContent?.trim().split(/\s+/)
  if (!lower || !upper || lower.length < 2 || upper.length < 2) return undefined
  return asBBox(
    parseNumber(lower[0]),
    parseNumber(lower[1]),
    parseNumber(upper[0]),
    parseNumber(upper[1])
  )
}

function parseWmts(doc: Document): CapabilityLayer[] {
  const layers: CapabilityLayer[] = []
  for (const layerEl of Array.from(doc.getElementsByTagName('Layer'))) {
    const idEl = findChild(layerEl, 'Identifier')
    if (!idEl?.textContent) continue
    const name = idEl.textContent.trim()
    const titleEl = findChild(layerEl, 'Title')
    const matrixSets = Array.from(layerEl.getElementsByTagName('TileMatrixSet'))
      .map((el) => el.textContent?.trim() || '')
      .filter((value) => value.length > 0)
    layers.push({
      name,
      title: titleEl?.textContent?.trim() || name,
      tileMatrixSets: matrixSets,
      bbox: wmtsLayerBbox(layerEl)
    })
  }
  return layers
}

export function parseCapabilities(xmlText: string, kind: ServiceKind): CapabilityLayer[] {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  if (doc.querySelector('parsererror')) {
    throw new Error('服务返回的 XML 无法解析，请确认服务地址正确')
  }
  if (kind === 'WMS') return parseWms(doc)
  if (kind === 'WFS') return parseWfs(doc)
  return parseWmts(doc)
}

export function capabilitiesUrlFor(kind: ServiceKind, url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  if (trimmed.includes('?')) return trimmed
  const param = `service=${kind}&request=GetCapabilities`
  return trimmed.includes('?') ? `${trimmed}&${param}` : `${trimmed}?${param}`
}

export function stripQuery(url: string): string {
  const parsed = new URL(url)
  return parsed.origin + parsed.pathname
}
