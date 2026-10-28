import type { ScenarioMeta } from './types'
import { S01 } from './scenes/s01'
import { S02 } from './scenes/s02'
import { S03 } from './scenes/s03'
import { S04 } from './scenes/s04'
import { S05 } from './scenes/s05'
import { S06 } from './scenes/s06'
import { S07 } from './scenes/s07'
import { S08 } from './scenes/s08'
import { S09 } from './scenes/s09'
import { S10 } from './scenes/s10'
import { S11 } from './scenes/s11'
import { S12 } from './scenes/s12'
import { S13 } from './scenes/s13'
import { S14 } from './scenes/s14'
import { S15 } from './scenes/s15'
import { S16 } from './scenes/s16'
import { S17 } from './scenes/s17'
import { S18 } from './scenes/s18'
import { S19 } from './scenes/s19'
import { S20 } from './scenes/s20'
import { S21 } from './scenes/s21'
import { S22 } from './scenes/s22'
import { S23 } from './scenes/s23'
import { S24 } from './scenes/s24'
import { S25 } from './scenes/s25'
import { S26 } from './scenes/s26'

export const SCENARIOS: ScenarioMeta[] = [
  S01,
  S02,
  S03,
  S04,
  S05,
  S06,
  S07,
  S08,
  S09,
  S10,
  S11,
  S12,
  S13,
  S14,
  S15,
  S16,
  S17,
  S18,
  S19,
  S20,
  S21,
  S22,
  S23,
  S24,
  S25,
  S26
]

export const SCENARIO_MAP: Record<string, ScenarioMeta> = Object.fromEntries(
  SCENARIOS.map((scenario) => [scenario.id, scenario])
)

export type { ScenarioMeta }
