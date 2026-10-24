import {
  type ActionTiming,
  type EasingCurve,
  type CameraPose,
  type ChapterView,
  type EasingType,
  type EffectId,
  type EffectSnapshot,
  type InitialState,
  type LayerId,
  type LayerSnapshot,
  type PopupView,
  type PresentationAction,
  type PresentationProject,
  type PresentationStep,
  type RecordRouteAction,
  type RouteData,
  type RuntimeState,
  type StepTiming,
  type SubtitleView,
  type Timeline
} from './types'
import { LANDMARK_MAP } from './defaults'
import { sampleCurve } from './easing'

export const TIMELINE_FPS = 30

export function frameFromSeconds(seconds: number, fps = TIMELINE_FPS): number {
  return Math.max(0, Math.round(seconds * fps))
}

export function secondsFromFrame(frame: number, fps = TIMELINE_FPS): number {
  return Math.max(0, frame) / Math.max(1, fps)
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function applyEasing(t: number, easing: EasingType): number {
  const x = clamp(t, 0, 1)
  if (easing === 'linear') return x
  if (easing === 'smooth') return x * x * (3 - 2 * x)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

export function applyActionEasing(action: { easing?: EasingType; curve?: EasingCurve }, t: number): number {
  if (action.curve) return sampleCurve(action.curve, t)
  return applyEasing(t, action.easing ?? 'smooth')
}

function shortestAngle(from: number, to: number): number {
  let delta = ((to - from) % 360 + 540) % 360 - 180
  if (delta === -180) delta = 180
  return delta
}

export function lerpAngle(from: number, to: number, t: number): number {
  const value = from + shortestAngle(from, to) * t
  return ((value % 360) + 360) % 360
}

export function lerpPose(from: CameraPose, to: CameraPose, t: number): CameraPose {
  const k = clamp(t, 0, 1)
  return {
    longitude: from.longitude + (to.longitude - from.longitude) * k,
    latitude: from.latitude + (to.latitude - from.latitude) * k,
    height: from.height + (to.height - from.height) * k,
    heading: lerpAngle(from.heading, to.heading, k),
    pitch: from.pitch + (to.pitch - from.pitch) * k,
    roll: from.roll + (to.roll - from.roll) * k,
    fov: from.fov + (to.fov - from.fov) * k
  }
}

function distanceMeters(from: CameraPose, to: CameraPose): number {
  const midLat = ((from.latitude + to.latitude) / 2) * (Math.PI / 180)
  const dx = (to.longitude - from.longitude) * 111320 * Math.cos(midLat)
  const dy = (to.latitude - from.latitude) * 110540
  return Math.hypot(dx, dy)
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

function routeSamplePose(route: RouteData, t: number): CameraPose | null {
  const samples = route.samples
  if (!samples.length) return null
  if (samples.length === 1) return { ...samples[0] }
  const normalized = clamp(t, 0, 1)
  let left = 0
  for (let index = 0; index < samples.length - 1; index += 1) {
    if (normalized >= samples[index].t && normalized <= samples[index + 1].t) {
      left = index
      break
    }
    if (index === samples.length - 2) left = index
  }
  const a = samples[left]
  const b = samples[left + 1] ?? a
  const span = b.t - a.t
  const local = span > 0.000001 ? clamp((normalized - a.t) / span, 0, 1) : 0
  const altitudeOffset = route.altitudeOffset
  if (route.interpolation === 'linear') {
    return {
      longitude: a.longitude + (b.longitude - a.longitude) * local,
      latitude: a.latitude + (b.latitude - a.latitude) * local,
      height: a.height + (b.height - a.height) * local + altitudeOffset,
      heading: lerpAngle(a.heading, b.heading, local),
      pitch: a.pitch + (b.pitch - a.pitch) * local,
      roll: a.roll + (b.roll - a.roll) * local,
      fov: a.fov + (b.fov - a.fov) * local
    }
  }
  const p0 = samples[Math.max(0, left - 1)]
  const p1 = a
  const p2 = b
  const p3 = samples[Math.min(samples.length - 1, left + 2)]
  return {
    longitude: catmull(p0.longitude, p1.longitude, p2.longitude, p3.longitude, local),
    latitude: catmull(p0.latitude, p1.latitude, p2.latitude, p3.latitude, local),
    height: catmull(p0.height, p1.height, p2.height, p3.height, local) + altitudeOffset,
    heading: lerpAngle(p1.heading, p2.heading, local),
    pitch: catmull(p0.pitch, p1.pitch, p2.pitch, p3.pitch, local),
    roll: catmull(p0.roll, p1.roll, p2.roll, p3.roll, local),
    fov: catmull(p0.fov, p1.fov, p2.fov, p3.fov, local)
  }
}

export function routePoseAt(action: RecordRouteAction, p: number, from: CameraPose): CameraPose {
  const route = action.route
  if (!route.samples.length) return { ...from }
  const duration = Math.max(0.2, action.duration)
  const elapsed = clamp(p, 0, 1) * duration
  const blend = clamp(action.entryBlend, 0, Math.min(6, duration * 0.8))
  if (blend > 0.01 && elapsed < blend) {
    const start = routeSamplePose(route, 0) ?? from
    const k = applyEasing(elapsed / blend, 'smooth')
    return lerpPose(from, start, k)
  }
  const usable = Math.max(0.01, duration - blend)
  const t = clamp((elapsed - blend) / usable, 0, 1)
  const eased = applyActionEasing(action, t)
  return routeSamplePose(route, eased) ?? { ...from }
}

export function buildTimeline(project: PresentationProject): Timeline {
  const steps: StepTiming[] = []
  let cursor = 0
  project.steps.forEach((step, stepIndex) => {
    const actions: ActionTiming[] = []
    let actionCursor = 0
    step.actions.forEach((action, actionIndex) => {
      if (!action.enable) return
      const cameraAction = action.actionType === 'flyTo' || action.actionType === 'recordRoute'
      const speed = cameraAction ? clamp(step.speedRate, 0.25, 4) : 1
      const duration = clamp(action.duration / speed, 0.2, 600)
      const start = typeof action.start === 'number' && Number.isFinite(action.start) ? clamp(action.start, 0, 600) : actionCursor
      actions.push({
        action,
        index: actionIndex,
        start,
        duration,
        end: start + duration
      })
      actionCursor = Math.max(actionCursor, start + duration)
    })
    const activeDuration = Math.max(clamp(step.duration, 0.5, 600), actionCursor)
    const stayTime = clamp(step.stayTime, 0, 60)
    const timing: StepTiming = {
      step,
      index: stepIndex,
      start: cursor,
      actionsTotal: actionCursor,
      activeDuration,
      stayTime,
      total: activeDuration + stayTime,
      actions
    }
    steps.push(timing)
    cursor += timing.total
  })
  return { steps, total: cursor }
}

export function stepAtTime(timeline: Timeline, time: number): StepTiming | null {
  if (!timeline.steps.length) return null
  const t = clamp(time, 0, timeline.total)
  for (let index = 0; index < timeline.steps.length; index += 1) {
    const step = timeline.steps[index]
    if (t < step.start + step.total) return step
  }
  return timeline.steps[timeline.steps.length - 1]
}

function initialRuntime(initial: InitialState, timeline: Timeline): RuntimeState {
  const layers = {} as Record<LayerId, number>
  for (const id of Object.keys(initial.layers) as LayerId[]) layers[id] = initial.layers[id] ? 1 : 0
  const effects = {} as Record<EffectId, number>
  for (const id of Object.keys(initial.effects) as EffectId[]) effects[id] = initial.effects[id] ? 1 : 0
  return {
    time: 0,
    stepIndex: 0,
    step: timeline.steps[0]?.step ?? null,
    stepLocal: 0,
    stepDuration: timeline.steps[0]?.activeDuration ?? 0,
    actionIndex: -1,
    action: null,
    actionProgress: 0,
    camera: { ...initial.camera },
    layers,
    effects,
    timeProgress: { ...initial.time },
    route: null,
    routeCursor: null,
    subtitles: [],
    popups: [],
    chapter: null
  }
}

function blendLayers(target: LayerSnapshot, current: Record<LayerId, number>, progress: number, instant: boolean): void {
  for (const id of Object.keys(target) as LayerId[]) {
    const next = target[id] ? 1 : 0
    current[id] = instant ? (progress > 0 ? next : current[id]) : current[id] + (next - current[id]) * progress
  }
}

function blendEffects(target: EffectSnapshot, current: Record<EffectId, number>, progress: number): void {
  const k = applyEasing(progress, 'smooth')
  for (const id of Object.keys(target) as EffectId[]) {
    const next = target[id] ? 1 : 0
    current[id] = current[id] + (next - current[id]) * k
  }
}

function applyAction(
  action: PresentationAction,
  progress: number,
  runtime: RuntimeState,
  elapsed: number,
  effectiveDuration: number
): void {
  const p = clamp(progress, 0, 1)
  switch (action.actionType) {
    case 'flyTo': {
      const eased = applyActionEasing(action, p)
      const from = runtime.camera
      const target = action.camera
      const pose = lerpPose(from, target, eased)
      if (action.arc) {
        const distance = distanceMeters(from, target)
        const lift = Math.sin(Math.PI * eased) * Math.min(1500, 180 + distance * 0.12)
        pose.height += lift
      }
      runtime.camera = pose
      break
    }
    case 'recordRoute': {
      runtime.route = action.route
      runtime.camera = routePoseAt(action, p, runtime.camera)
      break
    }
    case 'layerToggle':
      blendLayers(action.layers, runtime.layers, applyEasing(p, 'smooth'), action.transition === 'instant')
      break
    case 'timeAnimation': {
      const previous = runtime.timeProgress[action.target]
      const from = action.from
      const to = action.to
      let value: number
      if (p < 0.08) {
        value = previous + (from - previous) * applyEasing(p / 0.08, 'smooth')
      } else {
        value = from + (to - from) * applyActionEasing(action, (p - 0.08) / 0.92)
      }
      runtime.timeProgress[action.target] = clamp(value, 0, 1)
      break
    }
    case 'sceneEffect':
      blendEffects(action.effects, runtime.effects, p)
      break
    case 'subtitle':
    case 'popup':
      break
    default:
      break
  }
  void elapsed
  void effectiveDuration
}

function fadeAlpha(elapsed: number, duration: number, fade: number): number {
  const safeFade = clamp(fade, 0, Math.max(0.01, duration * 0.45))
  const inAlpha = safeFade > 0 ? clamp(elapsed / safeFade, 0, 1) : 1
  const outAlpha = safeFade > 0 ? clamp((duration - elapsed) / safeFade, 0, 1) : 1
  return Math.min(inAlpha, outAlpha)
}

export function evaluateTimeline(timeline: Timeline, time: number, initial: InitialState): RuntimeState {
  const runtime = initialRuntime(initial, timeline)
  const t = clamp(time, 0, timeline.total)
  runtime.time = t
  if (!timeline.steps.length) return runtime

  const current = stepAtTime(timeline, t) ?? timeline.steps[0]
  const local = clamp(t - current.start, 0, current.total)
  runtime.stepIndex = current.index
  runtime.step = current.step
  runtime.stepLocal = local
  runtime.stepDuration = current.activeDuration

  for (const step of timeline.steps) {
    if (step.start > current.start) break
    const limit = step.index === current.index ? Math.min(local, step.activeDuration) : step.activeDuration
    for (const timing of step.actions) {
      if (timing.start > limit) break
      const progress = timing.duration > 0 ? clamp((limit - timing.start) / timing.duration, 0, 1) : 1
      applyAction(timing.action, progress, runtime, limit - timing.start, timing.duration)
      if (step.index === current.index) {
        if (limit >= timing.start && limit < timing.end) {
          runtime.actionIndex = timing.index
          runtime.action = timing.action
          runtime.actionProgress = progress
        }
      }
    }
  }

  if (local <= current.activeDuration) {
    const active = current.actions.find((timing) => local >= timing.start && local < timing.end)
    if (active) {
      runtime.actionIndex = active.index
      runtime.action = active.action
      runtime.actionProgress = clamp((local - active.start) / active.duration, 0, 1)
    }
  }

  const active = current.actions.find((timing) => local >= timing.start && local < timing.end)
  if (active) {
    const elapsed = local - active.start
    if (active.action.actionType === 'subtitle') {
      const param = active.action.subtitle
      const alpha = fadeAlpha(elapsed, active.duration, param.fade)
      const view: SubtitleView = { param, alpha }
      runtime.subtitles.push(view)
    } else if (active.action.actionType === 'popup') {
      const param = active.action.popup
      const alpha = fadeAlpha(elapsed, active.duration, 0.35)
      const view: PopupView = { param, alpha }
      runtime.popups.push(view)
    } else if (active.action.actionType === 'recordRoute') {
      runtime.routeCursor = runtime.camera
    }
  }

  const transition = current.step.transition
  if (transition.type !== 'none' && transition.duration > 0 && local < transition.duration) {
    const progress = clamp(local / transition.duration, 0, 1)
    const inAlpha = clamp(local / 0.28, 0, 1)
    const outAlpha = clamp((transition.duration - local) / 0.42, 0, 1)
    const chapter: ChapterView = {
      index: current.index + 1,
      total: timeline.steps.length,
      name: current.step.stepName,
      type: transition.type,
      progress,
      alpha: Math.min(inAlpha, outAlpha)
    }
    runtime.chapter = chapter
  }

  return runtime
}

export function totalFrames(timeline: Timeline, fps = TIMELINE_FPS): number {
  return Math.max(1, Math.ceil(timeline.total * fps))
}

/**
 * 以整数帧为语义时钟求值。同一 timeline + frame + initial 必须得到一致状态，
 * 预览、寻址与逐帧导出全部通过该入口，不得传入 performance.now()。
 */
export function evaluateFrame(timeline: Timeline, frame: number, initial: InitialState, fps = TIMELINE_FPS): RuntimeState {
  const safeFrame = Math.max(0, Math.floor(Number.isFinite(frame) ? frame : 0))
  return evaluateTimeline(timeline, secondsFromFrame(safeFrame, fps), initial)
}

export function previewTimeForSelection(timeline: Timeline, stepId: string, actionId: string): number {
  const step = timeline.steps.find((item) => item.step.stepId === stepId)
  if (!step) return 0
  if (!actionId) return step.start
  const action = step.actions.find((item) => item.action.actionId === actionId)
  if (!action) return step.start
  const local = action.start + action.duration * 0.55
  return step.start + Math.min(local, step.activeDuration)
}

export function globalTimeForStep(timeline: Timeline, index: number, fraction = 0): number {
  const step = timeline.steps[index]
  if (!step) return 0
  return step.start + step.activeDuration * clamp(fraction, 0, 1)
}

export function stepLabel(project: PresentationProject, stepId: string): string {
  return project.steps.find((step) => step.stepId === stepId)?.stepName ?? '未选择步骤'
}

export function selectedActionOf(step: PresentationStep | null, actionId: string): PresentationAction | null {
  if (!step || !actionId) return null
  return step.actions.find((action) => action.actionId === actionId) ?? null
}

export function targetCamera(targetId: string | null, fallback: CameraPose): CameraPose {
  if (!targetId) return fallback
  const landmark = LANDMARK_MAP[targetId]
  return landmark ? { ...landmark.camera } : fallback
}
