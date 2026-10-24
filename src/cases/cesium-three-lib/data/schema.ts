export type DatasetProvenance = 'synthetic' | 'measured' | 'hybrid'

export interface QuantityMeta {
  key: string
  label: string
  unit: string
  min: number
  max: number
  defaultValue: number
  source: string
  provenance: DatasetProvenance
}

export interface GeoDataset {
  id: string
  title: string
  crs: string
  verticalDatum: string
  anchor: { lon: number; lat: number; height: number }
  quantities: QuantityMeta[]
  features: Array<Record<string, number | string>>
  license: string
  updatedAt: string
}

export interface SimulationConfig {
  scenario: string
  seed: number
  fixedDt: number
  provenance: DatasetProvenance
  quantities: Record<string, number>
}

export function defineQuantity(meta: QuantityMeta): QuantityMeta {
  if (meta.min > meta.max) throw new Error(`quantity ${meta.key} has inverted range`)
  if (meta.defaultValue < meta.min || meta.defaultValue > meta.max)
    throw new Error(`quantity ${meta.key} default is outside its range`)
  if (!meta.unit) throw new Error(`quantity ${meta.key} must declare a unit`)
  return meta
}

export function validateDataset(dataset: GeoDataset): GeoDataset {
  if (!dataset.crs) throw new Error('dataset must declare CRS')
  if (!dataset.verticalDatum) throw new Error('dataset must declare vertical datum')
  if (!dataset.anchor || !Number.isFinite(dataset.anchor.lon) || !Number.isFinite(dataset.anchor.lat))
    throw new Error('dataset anchor is invalid')
  const keys = new Set<string>()
  for (const quantity of dataset.quantities) {
    const checked = defineQuantity(quantity)
    if (keys.has(checked.key)) throw new Error(`duplicate quantity ${checked.key}`)
    keys.add(checked.key)
  }
  return dataset
}

export function configFromDataset(dataset: GeoDataset, scenario: string, seed = 1): SimulationConfig {
  const quantities: Record<string, number> = {}
  for (const quantity of dataset.quantities) quantities[quantity.key] = quantity.defaultValue
  return { scenario, seed, fixedDt: 1 / 60, provenance: dataset.features.length ? 'hybrid' : dataset.quantities[0]?.provenance ?? 'synthetic', quantities }
}
