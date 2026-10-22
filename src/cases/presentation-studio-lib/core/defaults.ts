import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  type ActionDefinition,
  type ActionType,
  type CameraPose,
  type EffectDefinition,
  type EffectId,
  type EffectSnapshot,
  type FlyToAction,
  type InitialState,
  type LandmarkDefinition,
  type LayerDefinition,
  type LayerId,
  type LayerSnapshot,
  type LayerToggleAction,
  type PopupAction,
  type PresentationAction,
  type PresentationProject,
  type PresentationStep,
  type RecordRouteAction,
  type RouteData,
  type RouteSample,
  type SceneEffectAction,
  type SubtitleAction,
  type TimeAnimationAction,
  type TimeTarget,
  type TimeSnapshot
} from './types'

export const PAGODA_CENTER = { longitude: 108.9642, latitude: 34.2186 }

const SITE_ELEVATION = 400

export const OVERVIEW_POSE: CameraPose = {
  longitude: 108.941,
  latitude: 34.193,
  height: 2480,
  heading: 37,
  pitch: -38,
  roll: 0,
  fov: 52
}

export const LANDMARKS: LandmarkDefinition[] = [
  {
    id: 'pagoda',
    name: '大雁塔',
    subtitle: '唐 · 大慈恩寺',
    longitude: 108.9642,
    latitude: 34.2186,
    height: SITE_ELEVATION + 64,
    beaconHeight: 150,
    color: '#ffc76a',
    camera: {
      longitude: 108.9712,
      latitude: 34.2122,
      height: SITE_ELEVATION + 235,
      heading: 328,
      pitch: -17,
      roll: 0,
      fov: 50
    }
  },
  {
    id: 'north-square',
    name: '大雁塔北广场',
    subtitle: '音乐喷泉 · 城市会客厅',
    longitude: 108.9658,
    latitude: 34.2244,
    height: SITE_ELEVATION + 10,
    beaconHeight: 90,
    color: '#5ee0ff',
    camera: {
      longitude: 108.971,
      latitude: 34.229,
      height: SITE_ELEVATION + 210,
      heading: 336,
      pitch: -24,
      roll: 0,
      fov: 54
    }
  },
  {
    id: 'datang',
    name: '大唐不夜城',
    subtitle: '步行街 · 夜游主轴',
    longitude: 108.9648,
    latitude: 34.2076,
    height: SITE_ELEVATION + 12,
    beaconHeight: 110,
    color: '#ff8f6b',
    camera: {
      longitude: 108.9582,
      latitude: 34.201,
      height: SITE_ELEVATION + 265,
      heading: 18,
      pitch: -24,
      roll: 0,
      fov: 54
    }
  },
  {
    id: 'qujiang',
    name: '曲江池遗址公园',
    subtitle: '唐长安 · 曲江流饮',
    longitude: 108.9886,
    latitude: 34.2004,
    height: SITE_ELEVATION + 8,
    beaconHeight: 80,
    color: '#7de0a5',
    camera: {
      longitude: 108.9952,
      latitude: 34.1928,
      height: SITE_ELEVATION + 430,
      heading: 322,
      pitch: -27,
      roll: 0,
      fov: 52
    }
  },
  {
    id: 'museum',
    name: '陕西历史博物馆',
    subtitle: '周秦汉唐 · 文明殿堂',
    longitude: 108.9498,
    latitude: 34.2268,
    height: SITE_ELEVATION + 20,
    beaconHeight: 100,
    color: '#c6a4ff',
    camera: {
      longitude: 108.9438,
      latitude: 34.221,
      height: SITE_ELEVATION + 300,
      heading: 68,
      pitch: -23,
      roll: 0,
      fov: 52
    }
  },
  {
    id: 'yongningmen',
    name: '永宁门',
    subtitle: '西安城墙 · 南门',
    longitude: 108.942,
    latitude: 34.2524,
    height: SITE_ELEVATION + 24,
    beaconHeight: 120,
    color: '#ffd27a',
    camera: {
      longitude: 108.9358,
      latitude: 34.2462,
      height: SITE_ELEVATION + 330,
      heading: 62,
      pitch: -24,
      roll: 0,
      fov: 52
    }
  }
]

export const LANDMARK_MAP: Record<string, LandmarkDefinition> = Object.fromEntries(
  LANDMARKS.map((item) => [item.id, item])
)

export const LAYER_DEFINITIONS: LayerDefinition[] = [
  { id: 'imagery', name: '卫星影像', description: 'Bing 高清城市底图', icon: 'globe', fade: true },
  { id: 'terrain', name: '真实地形', description: 'Cesium World Terrain', icon: 'mountain', fade: false },
  { id: 'dayanta', name: '大雁塔模型', description: '本地 3D Tiles 建筑', icon: 'building', fade: true },
  { id: 'landmarks', name: '城市地标', description: '六处曲江地标标注', icon: 'pin', fade: true },
  { id: 'beacons', name: '地标光柱', description: '垂直光柱与基座光环', icon: 'beam', fade: true },
  { id: 'route', name: '漫游航线', description: '录制与编排的相机轨迹', icon: 'route', fade: true }
]

export const EFFECT_DEFINITIONS: EffectDefinition[] = [
  { id: 'shadows', name: '实时阴影', description: '模型与地形投射阴影', icon: 'shadow' },
  { id: 'lighting', name: '太阳光照', description: '基于时间的动态光照', icon: 'sun' },
  { id: 'fog', name: '大气雾效', description: '城市尺度空气透视', icon: 'fog' },
  { id: 'atmosphere', name: '天空大气', description: '大气散射与天空盒', icon: 'sky' },
  { id: 'contour', name: '地形等高线', description: '按海拔生成等高线', icon: 'contour' },
  { id: 'slope', name: '坡度晕渲', description: '按地形起伏着色', icon: 'slope' }
]

export const ACTION_DEFINITIONS: ActionDefinition[] = [
  {
    type: 'flyTo',
    name: '定点飞行',
    short: '飞行',
    description: '从当前视角平滑飞向目标机位',
    icon: 'camera',
    color: '#5ee0ff'
  },
  {
    type: 'recordRoute',
    name: '航线录制',
    short: '航线',
    description: '记录手动漫游轨迹并回放',
    icon: 'route',
    color: '#8dd6ff'
  },
  {
    type: 'layerToggle',
    name: '图层显隐',
    short: '图层',
    description: '按演出节奏切换场景图层',
    icon: 'layers',
    color: '#7de0a5'
  },
  {
    type: 'timeAnimation',
    name: '时序动画',
    short: '时序',
    description: '驱动建筑生长、地标揭示与光柱脉冲',
    icon: 'clock',
    color: '#c6a4ff'
  },
  {
    type: 'subtitle',
    name: '字幕展示',
    short: '字幕',
    description: '全屏、角落或定点影视字幕',
    icon: 'text',
    color: '#ffc76a'
  },
  {
    type: 'popup',
    name: '信息弹窗',
    short: '弹窗',
    description: '锚定地标的属性信息窗口',
    icon: 'popup',
    color: '#ff9f7a'
  },
  {
    type: 'sceneEffect',
    name: '场景效果',
    short: '效果',
    description: '阴影、光照、雾效与地形分析',
    icon: 'sparkle',
    color: '#f0b7ff'
  }
]

export const ACTION_MAP: Record<ActionType, ActionDefinition> = Object.fromEntries(
  ACTION_DEFINITIONS.map((item) => [item.type, item])
) as Record<ActionType, ActionDefinition>

export const ACTION_LABELS: Record<ActionType, string> = Object.fromEntries(
  ACTION_DEFINITIONS.map((item) => [item.type, item.name])
) as Record<ActionType, string>

export const LAYER_LABELS: Record<LayerId, string> = Object.fromEntries(
  LAYER_DEFINITIONS.map((item) => [item.id, item.name])
) as Record<LayerId, string>

export const EFFECT_LABELS: Record<EffectId, string> = Object.fromEntries(
  EFFECT_DEFINITIONS.map((item) => [item.id, item.name])
) as Record<EffectId, string>

export const TIME_TARGET_LABELS: Record<TimeTarget, string> = {
  dayanta: '大雁塔生长',
  landmarks: '地标依次揭示',
  beacons: '光柱能量脉冲'
}

export const DEFAULT_CAMERA: CameraPose = { ...OVERVIEW_POSE }

export const DEFAULT_LAYERS: LayerSnapshot = {
  imagery: true,
  terrain: true,
  dayanta: true,
  landmarks: true,
  beacons: false,
  route: false
}

export const DEFAULT_EFFECTS: EffectSnapshot = {
  shadows: true,
  lighting: true,
  fog: false,
  atmosphere: true,
  contour: false,
  slope: false
}

export const DEFAULT_TIME: TimeSnapshot = {
  dayanta: 1,
  landmarks: 1,
  beacons: 1
}

export const DEFAULT_INITIAL_STATE: InitialState = {
  camera: { ...DEFAULT_CAMERA },
  layers: { ...DEFAULT_LAYERS },
  effects: { ...DEFAULT_EFFECTS },
  time: { ...DEFAULT_TIME }
}

export const SPEED_OPTIONS = [0.5, 1, 1.5, 2]
export const PROJECT_SUFFIX = '.cesium.presentation'

let idSeed = 0

export function createId(prefix: string): string {
  idSeed += 1
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}_${Date.now().toString(36)}${idSeed.toString(36)}${suffix}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function cloneCamera(camera: CameraPose): CameraPose {
  return { ...camera }
}

export function createSubtitleParam() {
  const pagoda = LANDMARK_MAP.pagoda
  return {
    title: '大雁塔',
    text: '千年塔影，仍是这座城市最清晰的精神坐标。',
    position: 'bottom' as const,
    fontSize: 30,
    color: '#f4f9ff',
    accent: '#5ee0ff',
    background: 'gradient' as const,
    align: 'left' as const,
    maxWidth: 760,
    callout: { longitude: pagoda.longitude, latitude: pagoda.latitude, height: pagoda.height },
    fade: 0.45
  }
}

export function createPopupParam() {
  return {
    title: '大雁塔',
    content: '现存最早、规模最大的唐代四方楼阁式砖塔，全国重点文物保护单位。',
    targetId: 'pagoda',
    placement: 'right' as const,
    accent: '#ffc76a',
    width: 320
  }
}

export function createEmptyRoute(): RouteData {
  return {
    samples: [],
    recordedDuration: 0,
    smoothing: 0.45,
    altitudeOffset: 0,
    interpolation: 'catmullrom'
  }
}

export function createAction(type: ActionType, context?: { camera?: CameraPose; layers?: LayerSnapshot; effects?: EffectSnapshot }): PresentationAction {
  const base = {
    actionId: createId('act'),
    enable: true,
    duration: 4,
    note: ''
  }

  switch (type) {
    case 'flyTo':
      return {
        ...base,
        actionType: 'flyTo',
        duration: 5,
        camera: cloneCamera(context?.camera ?? DEFAULT_CAMERA),
        targetId: null,
        easing: 'cinematic',
        arc: true
      } satisfies FlyToAction
    case 'recordRoute':
      return {
        ...base,
        actionType: 'recordRoute',
        duration: 6,
        route: createEmptyRoute(),
        easing: 'smooth',
        entryBlend: 1.2,
        showTrail: true
      } satisfies RecordRouteAction
    case 'layerToggle':
      return {
        ...base,
        actionType: 'layerToggle',
        duration: 1,
        layers: { ...(context?.layers ?? DEFAULT_LAYERS) },
        transition: 'fade'
      } satisfies LayerToggleAction
    case 'timeAnimation':
      return {
        ...base,
        actionType: 'timeAnimation',
        duration: 4,
        target: 'dayanta',
        from: 0.02,
        to: 1,
        easing: 'smooth'
      } satisfies TimeAnimationAction
    case 'subtitle':
      return {
        ...base,
        actionType: 'subtitle',
        duration: 4,
        subtitle: createSubtitleParam()
      } satisfies SubtitleAction
    case 'popup':
      return {
        ...base,
        actionType: 'popup',
        duration: 4,
        popup: createPopupParam()
      } satisfies PopupAction
    case 'sceneEffect':
      return {
        ...base,
        actionType: 'sceneEffect',
        duration: 1.4,
        effects: { ...(context?.effects ?? DEFAULT_EFFECTS) }
      } satisfies SceneEffectAction
    default: {
      const exhaustive: never = type
      throw new Error(`unknown action type ${String(exhaustive)}`)
    }
  }
}

export function createStep(index = 1, name?: string): PresentationStep {
  return {
    stepId: createId('step'),
    stepName: name ?? `步骤 ${String(index).padStart(2, '0')}`,
    duration: 8,
    speedRate: 1,
    stayTime: 0.4,
    transition: { type: 'fade', duration: 1.1 },
    actions: []
  }
}

export function createProject(name = '未命名演示', initial: InitialState = DEFAULT_INITIAL_STATE): PresentationProject {
  const timestamp = nowIso()
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: createId('prj'),
    name,
    note: '',
    createTime: timestamp,
    updateTime: timestamp,
    initial: {
      camera: cloneCamera(initial.camera),
      layers: { ...initial.layers },
      effects: { ...initial.effects },
      time: { ...initial.time }
    },
    steps: [createStep(1)]
  }
}

function orbitRoute(): RouteData {
  const count = 120
  const samples: RouteSample[] = []
  const pad = 0.0058
  const padLat = 0.0043
  for (let i = 0; i < count; i += 1) {
    const p = i / (count - 1)
    const angle = (22 + p * 340) * (Math.PI / 180)
    const longitude = PAGODA_CENTER.longitude + Math.cos(angle) * pad
    const latitude = PAGODA_CENTER.latitude + Math.sin(angle) * padLat
    const east = (PAGODA_CENTER.longitude - longitude) * Math.cos((latitude * Math.PI) / 180)
    const north = PAGODA_CENTER.latitude - latitude
    const heading = (Math.atan2(east, north) * 180) / Math.PI
    const height = SITE_ELEVATION + 245 + Math.sin(p * Math.PI) * 210 + Math.sin(p * Math.PI * 2) * 30
    const pitch = -10 - Math.sin(p * Math.PI) * 9
    const roll = Math.sin(p * Math.PI * 2) * 2.4
    samples.push({
      longitude,
      latitude,
      height,
      heading: (heading + 360) % 360,
      pitch,
      roll,
      fov: 49,
      t: p
    })
  }
  return {
    samples,
    recordedDuration: 7.2,
    smoothing: 0.45,
    altitudeOffset: 0,
    interpolation: 'catmullrom'
  }
}

export function createSampleProject(): PresentationProject {
  const project = createProject('曲江 · 大雁塔光影演示', DEFAULT_INITIAL_STATE)
  project.note = '五幕式城市光影演示，覆盖定点飞行、航线录制、图层显隐、时序动画、字幕、弹窗与场景效果。'
  project.steps = []

  const stepOne = createStep(1, '序章 · 长安天际')
  stepOne.duration = 9
  stepOne.stayTime = 0.4
  stepOne.transition = { type: 'dip', duration: 1.4 }
  const flyOne = createAction('flyTo', { camera: OVERVIEW_POSE }) as FlyToAction
  flyOne.duration = 5.2
  flyOne.camera = { ...OVERVIEW_POSE }
  flyOne.targetId = null
  const subOne = createAction('subtitle') as SubtitleAction
  subOne.duration = 3.8
  subOne.subtitle = {
    ...createSubtitleParam(),
    title: '长安 · 曲江',
    text: '从云端俯瞰一座城，让镜头成为讲述者。',
    position: 'fullscreen',
    align: 'center',
    fontSize: 44,
    background: 'gradient',
    maxWidth: 980
  }
  stepOne.actions = [flyOne, subOne]

  const stepTwo = createStep(2, '第一幕 · 塔影')
  stepTwo.duration = 10
  stepTwo.transition = { type: 'fade', duration: 1.1 }
  const flyTwo = createAction('flyTo') as FlyToAction
  flyTwo.duration = 4.2
  flyTwo.targetId = 'pagoda'
  flyTwo.camera = { ...LANDMARK_MAP.pagoda.camera }
  flyTwo.easing = 'cinematic'
  const layersTwo = createAction('layerToggle') as LayerToggleAction
  layersTwo.duration = 1
  layersTwo.layers = { ...DEFAULT_LAYERS, beacons: true, route: false }
  const popupTwo = createAction('popup') as PopupAction
  popupTwo.duration = 2.5
  popupTwo.popup = { ...createPopupParam(), placement: 'right' }
  const subTwo = createAction('subtitle') as SubtitleAction
  subTwo.duration = 2.3
  subTwo.subtitle = {
    ...createSubtitleParam(),
    title: '大雁塔',
    text: '千年塔影，仍是这座城市最清晰的精神坐标。',
    position: 'bottom'
  }
  stepTwo.actions = [flyTwo, layersTwo, popupTwo, subTwo]

  const stepThree = createStep(3, '第二幕 · 生长')
  stepThree.duration = 10.5
  stepThree.transition = { type: 'fade', duration: 1 }
  const flyThree = createAction('flyTo') as FlyToAction
  flyThree.duration = 3.5
  flyThree.camera = {
    longitude: 108.9727,
    latitude: 34.2172,
    height: SITE_ELEVATION + 118,
    heading: 283,
    pitch: -6,
    roll: 0,
    fov: 48
  }
  flyThree.easing = 'smooth'
  const grow = createAction('timeAnimation') as TimeAnimationAction
  grow.duration = 4.5
  grow.target = 'dayanta'
  grow.from = 0.02
  grow.to = 1
  const subThree = createAction('subtitle') as SubtitleAction
  subThree.duration = 2.5
  subThree.subtitle = {
    ...createSubtitleParam(),
    title: '生长',
    text: '把时间折叠进建筑，让每一次升高都有迹可循。',
    position: 'left'
  }
  stepThree.actions = [flyThree, grow, subThree]

  const stepFour = createStep(4, '第三幕 · 环绕')
  stepFour.duration = 11
  stepFour.transition = { type: 'slide', duration: 1 }
  const layersFour = createAction('layerToggle') as LayerToggleAction
  layersFour.duration = 0.9
  layersFour.layers = { ...DEFAULT_LAYERS, beacons: true, route: true }
  const route = createAction('recordRoute') as RecordRouteAction
  route.duration = 7.2
  route.route = orbitRoute()
  route.easing = 'smooth'
  route.entryBlend = 1.2
  route.showTrail = true
  const subFour = createAction('subtitle') as SubtitleAction
  subFour.duration = 2.9
  subFour.subtitle = {
    ...createSubtitleParam(),
    title: '环绕',
    text: '沿着光的轨迹，完成一次环绕千年的飞行。',
    position: 'bottom',
    accent: '#8dd6ff'
  }
  stepFour.actions = [layersFour, route, subFour]

  const stepFive = createStep(5, '终章 · 万象')
  stepFive.duration = 10
  stepFive.transition = { type: 'dip', duration: 1.4 }
  const flyFive = createAction('flyTo', { camera: OVERVIEW_POSE }) as FlyToAction
  flyFive.duration = 4.8
  flyFive.camera = { ...OVERVIEW_POSE }
  flyFive.easing = 'cinematic'
  const effectFive = createAction('sceneEffect') as SceneEffectAction
  effectFive.duration = 1.4
  effectFive.effects = { ...DEFAULT_EFFECTS, fog: true }
  const layersFive = createAction('layerToggle') as LayerToggleAction
  layersFive.duration = 1
  layersFive.layers = { ...DEFAULT_LAYERS, beacons: false, route: false }
  const subFive = createAction('subtitle') as SubtitleAction
  subFive.duration = 2.8
  subFive.subtitle = {
    ...createSubtitleParam(),
    title: '万象',
    text: '一城灯火，千年长安。演示至此，余韵未尽。',
    position: 'fullscreen',
    align: 'center',
    fontSize: 40,
    accent: '#ffc76a',
    maxWidth: 900
  }
  stepFive.actions = [flyFive, effectFive, layersFive, subFive]

  project.steps = [stepOne, stepTwo, stepThree, stepFour, stepFive]
  project.initial.camera = { ...OVERVIEW_POSE }
  project.initial.layers = { ...DEFAULT_LAYERS }
  project.initial.effects = { ...DEFAULT_EFFECTS }
  project.initial.time = { ...DEFAULT_TIME }
  return project
}

export function speedOptionsFor(): number[] {
  return SPEED_OPTIONS
}
