import { LANDMARKS, OVERVIEW_POSE, PAGODA_CENTER } from './defaults'
import type { CameraPose, LandmarkDefinition } from './types'

export interface SceneTilesetTemplate {
  id: string
  name: string
  uri: string
  maximumScreenSpaceError: number
  required: boolean
  license: string
  source: string
}

export interface SceneTemplate {
  id: string
  name: string
  crs: string
  center: { longitude: number; latitude: number }
  initialCamera: CameraPose
  imagerySourceId: string
  terrainSourceId: string
  tileset: SceneTilesetTemplate | null
  landmarks: LandmarkDefinition[]
  debugGlobal: boolean
}

export const DAYANTA_TILESET: SceneTilesetTemplate = {
  id: 'asset_dayanta_tileset',
  name: '大雁塔 3D Tiles',
  uri: 'dayanta/tileset.json',
  maximumScreenSpaceError: 8,
  required: false,
  license: '项目内置示例资源',
  source: 'public/dayanta'
}

export const DAYANTA_SCENE_TEMPLATE: SceneTemplate = {
  id: 'template_dayanta',
  name: '曲江 · 大雁塔示例场景',
  crs: 'EPSG:4326',
  center: PAGODA_CENTER,
  initialCamera: { ...OVERVIEW_POSE },
  imagerySourceId: 'imagery_bing',
  terrainSourceId: 'terrain_world',
  tileset: DAYANTA_TILESET,
  landmarks: LANDMARKS,
  debugGlobal: true
}

export const EMPTY_SCENE_TEMPLATE: SceneTemplate = {
  id: 'template_empty',
  name: '空场景',
  crs: 'EPSG:4326',
  center: PAGODA_CENTER,
  initialCamera: { ...OVERVIEW_POSE },
  imagerySourceId: 'imagery_osm',
  terrainSourceId: 'terrain_ellipsoid',
  tileset: null,
  landmarks: [],
  debugGlobal: false
}

export function sceneTemplateById(id: string): SceneTemplate {
  return id === EMPTY_SCENE_TEMPLATE.id ? EMPTY_SCENE_TEMPLATE : DAYANTA_SCENE_TEMPLATE
}
