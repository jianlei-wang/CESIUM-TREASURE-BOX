/**
 * 施工扬尘扩散模拟 — 场景数据装配。
 *
 * 以程序化城市白模作为周边环境基底，在中心区域圈定施工场地并清除场地内建筑，
 * 布置施工道路、物料堆场、裸地、土石方作业点、混凝土作业点等扬尘源，
 * 以及学校、医院、居民区等环境敏感点。
 */

import { buildDefaultCity, type CityModel, type LonLat } from '../sunshine-lib/city'
import type { BuildingBoxLite, DustSource, SensitivePoint } from './dust-model'

export const DUST_CENTER: LonLat = { lon: 116.4074, lat: 39.9042 }

export interface SiteModel {
  city: CityModel
  siteRect: { minX: number; minY: number; maxX: number; maxY: number }
  sources: DustSource[]
  sensitive: SensitivePoint[]
  buildings: BuildingBoxLite[]
  center: LonLat
}

export function createDustScene(center: LonLat = DUST_CENTER): SiteModel {
  const city = buildDefaultCity(center, { cols: 7, rows: 6, blockSize: 96, street: 26, seed: 20260911 })
  const siteRect = { minX: -170, minY: -140, maxX: 170, maxY: 140 }

  const keepOut = 34
  const buildings: BuildingBoxLite[] = city.buildings
    .filter((b) => !(b.maxX > siteRect.minX - keepOut && b.minX < siteRect.maxX + keepOut && b.maxY > siteRect.minY - keepOut && b.minY < siteRect.maxY + keepOut))
    .map((b) => ({ minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY, height: b.topHeight }))

  const allStages = { foundation: true, structure: true, decoration: true }

  const sources: DustSource[] = [
    {
      id: 'road',
      name: '施工道路（运输道路）',
      type: 'line',
      path: [
        { x: -160, y: 10 },
        { x: 160, y: 10 }
      ],
      width: 6,
      height: 0.6,
      emission: 0.42,
      stages: allStages,
      color: '#ffd666'
    },
    {
      id: 'truck',
      name: '运输车辆（移动源）',
      type: 'mobile',
      path: [
        { x: -160, y: 10 },
        { x: 160, y: 10 }
      ],
      height: 1,
      emission: 0.5,
      stages: allStages,
      color: '#f7b04a'
    },
    {
      id: 'stockpile',
      name: '物料堆场（面源）',
      type: 'area',
      rect: { minX: -155, minY: -125, maxX: -65, maxY: -45 },
      height: 1.5,
      emission: 0.03,
      stages: { foundation: false, structure: true, decoration: true },
      color: '#b7791f'
    },
    {
      id: 'bare',
      name: '裸露场地（面源）',
      type: 'area',
      rect: { minX: 30, minY: -130, maxX: 160, maxY: -30 },
      height: 0.3,
      emission: 0.018,
      stages: allStages,
      color: '#c9a227'
    },
    {
      id: 'earthwork',
      name: '土石方作业点',
      type: 'point',
      position: { x: 105, y: 60 },
      height: 2,
      emission: 2.2,
      stages: { foundation: true, structure: true, decoration: false },
      color: '#ff7875'
    },
    {
      id: 'concrete',
      name: '混凝土作业点',
      type: 'point',
      position: { x: -105, y: 85 },
      height: 1.5,
      emission: 1.3,
      stages: { foundation: true, structure: true, decoration: true },
      color: '#ff9c6e'
    }
  ]

  const sensitive: SensitivePoint[] = [
    {
      id: 'school',
      name: '实验小学',
      type: 'school',
      position: { x: 70, y: 330 },
      height: 1.5,
      standard: { tsp: 300, pm10: 70, pm25: 35 }
    },
    {
      id: 'hospital',
      name: '区人民医院',
      type: 'hospital',
      position: { x: 350, y: 50 },
      height: 1.5,
      standard: { tsp: 300, pm10: 70, pm25: 35 }
    },
    {
      id: 'residential-s',
      name: '阳光花园小区',
      type: 'residential',
      position: { x: -50, y: -340 },
      height: 1.5,
      standard: { tsp: 300, pm10: 70, pm25: 35 }
    },
    {
      id: 'residential-ne',
      name: '锦绣家园',
      type: 'residential',
      position: { x: 300, y: 260 },
      height: 1.5,
      standard: { tsp: 300, pm10: 70, pm25: 35 }
    },
    {
      id: 'park',
      name: '滨河公园',
      type: 'park',
      position: { x: -340, y: 120 },
      height: 1.5,
      standard: { tsp: 300, pm10: 70, pm25: 35 }
    }
  ]

  return { city, siteRect, sources, sensitive, buildings, center }
}
