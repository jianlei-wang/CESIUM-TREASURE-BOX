import { ACTION_DEFINITIONS } from './defaults'
import { TIMELINE_FPS, frameFromSeconds } from './timeline'
import type { ActionType, Timeline } from './types'

export type TrackKind = 'camera' | 'layer' | 'entity' | 'effect' | 'overlay'

export interface TrackClip {
  id: string
  actionId: string
  stepId: string
  stepIndex: number
  actionIndex: number
  kind: TrackKind
  label: string
  icon: string
  color: string
  startFrame: number
  durationFrames: number
  enabled: boolean
  locked: boolean
}

export interface TrackLane {
  id: TrackKind
  label: string
  hint: string
  clips: TrackClip[]
}

export const TRACK_LANES: Array<Pick<TrackLane, 'id' | 'label' | 'hint'>> = [
  { id: 'camera', label: '相机', hint: 'FlyTo / 航线' },
  { id: 'layer', label: '图层', hint: '显隐切换' },
  { id: 'entity', label: '实体', hint: '时序与地标' },
  { id: 'effect', label: '效果', hint: '阴影 / 雾 / 光照' },
  { id: 'overlay', label: '字幕弹窗', hint: 'Overlay' }
]

const TRACK_BY_ACTION: Record<ActionType, TrackKind> = {
  flyTo: 'camera',
  recordRoute: 'camera',
  layerToggle: 'layer',
  timeAnimation: 'entity',
  sceneEffect: 'effect',
  subtitle: 'overlay',
  popup: 'overlay'
}

export function trackKindForAction(type: ActionType): TrackKind {
  return TRACK_BY_ACTION[type] ?? 'overlay'
}

/**
 * 将线性 Step/Action 时序投影为标准轨道视图。
 * 轨道仅描述整数帧区间，求值仍由 evaluateFrame 统一负责。
 */
export function buildTrackLanes(timeline: Timeline, fps = TIMELINE_FPS): TrackLane[] {
  const lanes = new Map<TrackKind, TrackLane>(TRACK_LANES.map((lane) => [lane.id, { ...lane, clips: [] }]))
  for (const stepTiming of timeline.steps) {
    for (const timing of stepTiming.actions) {
      const action = timing.action
      const kind = trackKindForAction(action.actionType)
      const definition = ACTION_DEFINITIONS.find((item) => item.type === action.actionType)
      const startFrame = frameFromSeconds(stepTiming.start + timing.start, fps)
      const endFrame = frameFromSeconds(stepTiming.start + timing.end, fps)
      lanes.get(kind)?.clips.push({
        id: `${stepTiming.step.stepId}_${action.actionId}`,
        actionId: action.actionId,
        stepId: stepTiming.step.stepId,
        stepIndex: stepTiming.index,
        actionIndex: timing.index,
        kind,
        label: definition?.short ?? definition?.name ?? action.actionType,
        icon: definition?.icon ?? 'dot',
        color: definition?.color ?? '#ffc76a',
        startFrame,
        durationFrames: Math.max(1, endFrame - startFrame),
        enabled: action.enable,
        locked: action.locked === true
      })
    }
  }
  return [...lanes.values()]
}

export const TRACK_SNAP_FRAMES = 5

/** 将目标帧吸附到最近的轨道边界，超出阈值时保持整数帧。 */
export function snapFrame(frame: number, candidates: number[], threshold = TRACK_SNAP_FRAMES): number {
  const safeFrame = Math.max(0, Math.round(Number.isFinite(frame) ? frame : 0))
  let best = safeFrame
  let bestDistance = threshold + 1
  for (const candidate of candidates) {
    const value = Math.round(candidate)
    if (!Number.isFinite(value) || value < 0) continue
    const distance = Math.abs(value - safeFrame)
    if (distance <= threshold && distance < bestDistance) {
      best = value
      bestDistance = distance
    }
  }
  return best
}

export function trackSnapPoints(lanes: TrackLane[], excludeClipId: string): number[] {
  const points = new Set<number>([0])
  for (const lane of lanes) {
    for (const clip of lane.clips) {
      if (clip.id === excludeClipId) continue
      points.add(clip.startFrame)
      points.add(clip.startFrame + clip.durationFrames)
    }
  }
  return [...points].sort((left, right) => left - right)
}

export function trimmedFrames(startFrame: number, endFrame: number, maxFrames: number): number {
  const start = Math.max(0, Math.round(startFrame))
  const end = Math.min(Math.max(0, Math.round(maxFrames)), Math.round(endFrame))
  return Math.max(1, end - start)
}

export function trackFrameRange(lanes: TrackLane[]): number {
  return lanes.reduce((max, lane) => {
    for (const clip of lane.clips) max = Math.max(max, clip.startFrame + clip.durationFrames)
    return max
  }, 0)
}
