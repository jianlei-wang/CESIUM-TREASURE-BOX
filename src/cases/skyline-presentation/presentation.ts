export type KeyframeTransition = 'smooth' | 'linear' | 'easeIn' | 'easeOut'

export type PresentationKeyframe = {
  id: string
  time: number
  position: {
    longitude: number
    latitude: number
    height: number
  }
  orientation: {
    heading: number
    pitch: number
    roll: number
  }
  transition: KeyframeTransition
}

export type PresentationEventType =
  | 'layer_show'
  | 'layer_hide'
  | 'label_show'
  | 'label_hide'
  | 'popup_open'
  | 'popup_close'
  | 'effect_start'
  | 'effect_stop'
  | 'camera_jump'
  | 'custom'

export type PresentationEvent = {
  id: string
  time: number
  type: PresentationEventType
  payload: Record<string, unknown>
}

export type PresentationConfig = {
  loop: boolean
  autoPlay: boolean
  restoreSceneOnEnd: boolean
  showTimeline: boolean
}

export type Presentation = {
  id: string
  name: string
  description: string
  duration: number
  defaultPlaybackRate: number
  keyframes: PresentationKeyframe[]
  events: PresentationEvent[]
  config: PresentationConfig
}

export const demoPresentation: Presentation = {
  id: 'park-demo-001',
  name: '高新区数字孪生园区汇报演示',
  description: '招商汇报标准演示动线：全域概览→主建筑环绕→地下管网→离场远眺',
  duration: 60,
  defaultPlaybackRate: 1,
  config: {
    loop: false,
    autoPlay: false,
    restoreSceneOnEnd: true,
    showTimeline: true
  },
  keyframes: [
    {
      id: 'kf-1',
      time: 0,
      position: { longitude: 116.397, latitude: 39.908, height: 1500 },
      orientation: { heading: 0, pitch: -Math.PI / 2.5, roll: 0 },
      transition: 'smooth'
    },
    {
      id: 'kf-2',
      time: 15,
      position: { longitude: 116.397, latitude: 39.909, height: 300 },
      orientation: { heading: 0, pitch: -Math.PI / 4, roll: 0 },
      transition: 'smooth'
    },
    {
      id: 'kf-3',
      time: 30,
      position: { longitude: 116.3975, latitude: 39.9085, height: 120 },
      orientation: { heading: Math.PI / 2, pitch: -Math.PI / 6, roll: 0 },
      transition: 'smooth'
    },
    {
      id: 'kf-4',
      time: 45,
      position: { longitude: 116.3975, latitude: 39.9085, height: -15 },
      orientation: { heading: 0, pitch: -Math.PI / 8, roll: 0 },
      transition: 'easeIn'
    },
    {
      id: 'kf-5',
      time: 60,
      position: { longitude: 116.4, latitude: 39.91, height: 800 },
      orientation: { heading: -Math.PI * 0.75, pitch: -Math.PI / 5, roll: 0 },
      transition: 'easeOut'
    }
  ],
  events: [
    { id: 'e-1', time: 8, type: 'layer_show', payload: { layerId: 'buildings-3d' } },
    { id: 'e-2', time: 14, type: 'label_show', payload: { labelId: 'building-main-label' } },
    {
      id: 'e-3',
      time: 18,
      type: 'popup_open',
      payload: {
        title: '科创中心大厦',
        content: '总建筑面积 12 万㎡，地上 28 层，地下 3 层，甲级写字楼，园区地标建筑',
        longitude: 116.3975,
        latitude: 39.9085,
        height: 140
      }
    },
    { id: 'e-4', time: 25, type: 'effect_start', payload: { effectId: 'road-flow' } },
    { id: 'e-5', time: 40, type: 'layer_show', payload: { layerId: 'underground-pipe' } },
    { id: 'e-6', time: 42, type: 'custom', payload: { action: 'enableUndergroundMode', enable: true } },
    { id: 'e-7', time: 46, type: 'popup_close', payload: {} },
    { id: 'e-8', time: 50, type: 'label_hide', payload: { labelId: 'building-main-label' } },
    { id: 'e-9', time: 55, type: 'layer_hide', payload: { layerId: 'underground-pipe' } },
    { id: 'e-10', time: 57, type: 'effect_stop', payload: { effectId: 'road-flow' } }
  ]
}
