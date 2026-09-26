import type { DggsSystem } from './spec'
import { system as h3 } from './engines/h3'
import { system as s2 } from './engines/s2'
import { system as a5 } from './engines/a5'
import { system as dggrid } from './engines/dggrid'
import { system as dggal } from './engines/dggal'
import { system as olc } from './engines/olc'
import { system as geohash } from './engines/geohash'
import { system as tilecode } from './engines/tilecode'

export type { DggsSystem, DggsSettings, DggsBounds, PanelField, IdentifyRow } from './spec'

/** 8 个离散全球网格系统，顺序与 GeoLibre 插件一致。 */
export const DGGS_SYSTEMS: DggsSystem[] = [
  h3,
  s2,
  a5,
  dggrid,
  dggal,
  olc,
  geohash,
  tilecode
]

export function getDggsSystem(id: string): DggsSystem | undefined {
  return DGGS_SYSTEMS.find((system) => system.id === id)
}
