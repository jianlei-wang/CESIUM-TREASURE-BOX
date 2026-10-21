import type { Viewer } from 'cesium'
import {
  clamp,
  projectDuration,
  stepEffectiveSeconds,
  type CameraPose,
  type PresentationAction,
  type PresentationProject,
  type PresentationStep,
  type RouteSample,
  type SceneEffectState,
  type SubtitleParam
} from './presentation'
import type { PresentationScene } from './scene'

export interface ActionRun {
  action: PresentationAction
  step: PresentationStep
  stepIndex: number
  actionIndex: number
  start: number
  end: number
}

export interface StepRun {
  step: PresentationStep
  index: number
  start: number
  end: number
  actions: ActionRun[]
}

export interface SubtitleView {
  param: SubtitleParam
  stepName: string
  actionId: string
}

export interface PlayerState {
  camera: CameraPose
  stepIndex: number
  actionIndex: number
  stepTime: number
  subtitle: SubtitleView | null
  layers: Record<string, boolean>
  scene: SceneEffectState
  buildProgress: number
  routeSamples: RouteSample[] | null
}

export type PlayerListener = (state: PlayerState, time: number, duration: number, playing: boolean) => void

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

function lerpAngle(from: number, to: number, t: number): number {
  let delta = to - from
  while (delta > 180) delta -= 360
  while (delta < -180) delta += 360
  return from + delta * t
}

function easeInOut(t: number): number {
  const value = clamp(t, 0, 1)
  return value * value * (3 - 2 * value)
}

function blendPose(from: CameraPose, to: CameraPose, t: number): CameraPose {
  return {
    longitude: lerp(from.longitude, to.longitude, t),
    latitude: lerp(from.latitude, to.latitude, t),
    height: lerp(from.height, to.height, t),
    heading: lerpAngle(from.heading, to.heading, t),
    pitch: lerp(from.pitch, to.pitch, t),
    roll: lerpAngle(from.roll, to.roll, t),
    fov: lerp(from.fov ?? 60, to.fov ?? 60, t)
  }
}

export function routePoseAt(samples: RouteSample[], progress: number): CameraPose {
  if (samples.length === 0) return { longitude: 0, latitude: 0, height: 1000, heading: 0, pitch: -45, roll: 0, fov: 60 }
  if (samples.length === 1) return samples[0]
  const scaled = clamp(progress, 0, 1) * (samples.length - 1)
  const index = Math.min(samples.length - 2, Math.floor(scaled))
  const local = scaled - index
  return blendPose(samples[index], samples[index + 1], local)
}

export function buildTimeline(project: PresentationProject): { steps: StepRun[]; duration: number } {
  let cursor = 0
  const steps: StepRun[] = project.steps.map((step, stepIndex) => {
    const start = cursor
    let actionCursor = start
    const actions: ActionRun[] = []
    for (let actionIndex = 0; actionIndex < step.actions.length; actionIndex += 1) {
      const action = step.actions[actionIndex]
      if (!action.enable) continue
      const end = actionCursor + Math.max(0.1, action.duration) / step.speedRate
      actions.push({ action, step, stepIndex, actionIndex, start: actionCursor, end })
      actionCursor = end
    }
    const effective = stepEffectiveSeconds(step)
    const end = start + Math.max(effective, actionCursor - start + step.stayTime / step.speedRate)
    cursor = end
    return { step, index: stepIndex, start, end, actions }
  })
  return { steps, duration: cursor || projectDuration(project) }
}

export class PresentationPlayer {
  private viewer: Viewer
  private scene: PresentationScene
  private project: PresentationProject
  private timeline: { steps: StepRun[]; duration: number }
  private listener: PlayerListener | null = null
  private endListener: (() => void) | null = null

  time = 0
  speed = 1
  playing = false
  private rangeEnd: number | null = null
  private raf: number | null = null
  private lastTimestamp = 0
  private lastState: PlayerState | null = null

  constructor(viewer: Viewer, scene: PresentationScene, project: PresentationProject) {
    this.viewer = viewer
    this.scene = scene
    this.project = project
    this.timeline = buildTimeline(project)
  }

  get duration(): number {
    return this.timeline.duration
  }

  get steps(): StepRun[] {
    return this.timeline.steps
  }

  setProject(project: PresentationProject): void {
    this.project = project
    this.timeline = buildTimeline(project)
    this.time = clamp(this.time, 0, this.timeline.duration)
    this.lastState = null
    this.applyState(this.evaluate(this.time))
  }

  setListener(listener: PlayerListener | null): void {
    this.listener = listener
  }

  setEndListener(listener: (() => void) | null): void {
    this.endListener = listener
  }

  getState(): PlayerState {
    return this.evaluate(this.time)
  }

  private evaluate(time: number): PlayerState {
    const project = this.project
    let camera: CameraPose = { ...project.initialCamera }
    let lastCamera: CameraPose = { ...project.initialCamera }
    const layers: Record<string, boolean> = { ...project.layerStates }
    const scene: SceneEffectState = { ...project.sceneState }
    let buildProgress = 0
    let subtitle: SubtitleView | null = null
    let routeSamples: RouteSample[] | null = null
    let stepIndex = -1
    let actionIndex = -1
    let stepTime = 0

    for (const run of this.timeline.steps) {
      if (time >= run.start && time <= run.end) {
        stepIndex = run.index
        stepTime = time - run.start
      }
      for (const actionRun of run.actions) {
        if (time < actionRun.start) continue
        if (stepIndex < 0) {
          stepIndex = run.index
          stepTime = time - run.start
        }
        actionIndex = actionRun.actionIndex
        const action = actionRun.action
        const span = Math.max(0.001, actionRun.end - actionRun.start)
        const progress = clamp((time - actionRun.start) / span, 0, 1)
        const active = time < actionRun.end

        switch (action.actionType) {
          case 'flyTo': {
            const target = action.cameraParam ?? project.initialCamera
            if (active) {
              const eased = run.step.transition > 0 ? easeInOut(progress) : progress
              camera = blendPose(lastCamera, target, eased)
            } else {
              lastCamera = target
              camera = target
            }
            break
          }
          case 'recordRoute': {
            const samples = action.routeSamples ?? []
            if (samples.length > 0) {
              routeSamples = samples
              const pose = routePoseAt(samples, progress)
              if (active) {
                const intro = 0.09
                camera = progress < intro ? blendPose(lastCamera, pose, easeInOut(progress / intro)) : pose
              } else {
                camera = samples[samples.length - 1]
                lastCamera = samples[samples.length - 1]
              }
            }
            break
          }
          case 'layerToggle': {
            if (action.layerToggle) layers[action.layerToggle.layerId] = action.layerToggle.visible
            break
          }
          case 'sceneEffect': {
            if (action.sceneEffect) {
              const { effect, enabled, value } = action.sceneEffect
              if (effect === 'fog') {
                scene.fog = enabled
                scene.fogDensity = value
              } else {
                scene[effect] = enabled
              }
            }
            break
          }
          case 'timeAnimation': {
            if (action.timeAnimation) {
              const { from, to } = action.timeAnimation
              buildProgress = active ? lerp(from, to, easeInOut(progress)) : to
            }
            break
          }
          case 'subtitle': {
            if (active && action.subtitle) {
              subtitle = { param: action.subtitle, stepName: run.step.stepName, actionId: action.actionId }
            }
            break
          }
          default:
            break
        }
      }
    }

    if (stepIndex < 0) stepIndex = 0
    if (stepTime < 0) stepTime = 0
    return {
      camera,
      stepIndex,
      actionIndex,
      stepTime,
      subtitle,
      layers,
      scene,
      buildProgress,
      routeSamples
    }
  }

  private applyState(state: PlayerState): void {
    const previous = this.lastState
    this.scene.setCamera(state.camera)
    if (!previous || JSON.stringify(previous.layers) !== JSON.stringify(state.layers)) {
      this.scene.setLayerVisibility(state.layers)
    }
    if (!previous || JSON.stringify(previous.scene) !== JSON.stringify(state.scene)) {
      this.scene.applySceneEffects(state.scene)
    }
    if (!previous || Math.abs(previous.buildProgress - state.buildProgress) > 0.001) {
      this.scene.setBuildProgress(state.buildProgress)
    }
    this.lastState = state
    this.listener?.(state, this.time, this.duration, this.playing)
  }

  private tick = (timestamp: number): void => {
    if (!this.playing) return
    const delta = this.lastTimestamp > 0 ? (timestamp - this.lastTimestamp) / 1000 : 0
    this.lastTimestamp = timestamp
    this.time += delta * this.speed
    const limit = this.rangeEnd ?? this.duration
    if (this.time >= limit) {
      this.time = limit
      if (this.rangeEnd !== null) {
        this.pause()
        this.applyState(this.evaluate(this.time))
        return
      }
      this.playing = false
      this.raf = null
      this.applyState(this.evaluate(this.duration))
      this.seek(0)
      this.endListener?.()
      return
    }
    this.applyState(this.evaluate(this.time))
    this.raf = requestAnimationFrame(this.tick)
  }

  play(): void {
    if (this.playing) return
    if (this.time >= this.duration - 0.01) this.time = 0
    this.playing = true
    this.rangeEnd = null
    this.lastTimestamp = 0
    this.raf = requestAnimationFrame(this.tick)
  }

  playStep(index: number): void {
    const run = this.timeline.steps[index]
    if (!run) return
    this.pause()
    this.time = run.start
    this.rangeEnd = run.end
    this.applyState(this.evaluate(this.time))
    this.playing = true
    this.lastTimestamp = 0
    this.raf = requestAnimationFrame(this.tick)
  }

  pause(): void {
    this.playing = false
    if (this.raf !== null) cancelAnimationFrame(this.raf)
    this.raf = null
    this.lastState = null
    this.listener?.(this.evaluate(this.time), this.time, this.duration, false)
  }

  stop(): void {
    this.playing = false
    this.rangeEnd = null
    if (this.raf !== null) cancelAnimationFrame(this.raf)
    this.raf = null
    this.time = 0
    this.lastState = null
    this.applyState(this.evaluate(0))
  }

  seek(time: number): void {
    this.time = clamp(time, 0, this.duration)
    this.lastState = null
    this.applyState(this.evaluate(this.time))
  }

  seekStep(index: number): void {
    const run = this.timeline.steps[index]
    if (!run) return
    this.seek(run.start)
  }

  setSpeed(speed: number): void {
    this.speed = clamp(speed, 0.1, 4)
  }

  currentStepIndex(): number {
    return this.evaluate(this.time).stepIndex
  }

  dispose(): void {
    this.playing = false
    if (this.raf !== null) cancelAnimationFrame(this.raf)
    this.raf = null
    this.listener = null
    this.endListener = null
    this.lastState = null
  }
}
