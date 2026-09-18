import {
  Cartesian3,
  ClockRange,
  HeadingPitchRoll,
  HermitePolynomialApproximation,
  JulianDate,
  LagrangePolynomialApproximation,
  Quaternion,
  SampledPositionProperty,
  SampledProperty,
  TimeInterval,
  type Viewer
} from 'cesium'
import type { Presentation, PresentationEvent } from './presentation'

type EngineEventDetail =
  | { event: 'timeupdate'; seconds: number }
  | { event: 'layer'; layerId: string; visible: boolean }
  | { event: 'label'; labelId: string; visible: boolean }
  | {
      event: 'popup'
      visible: boolean
      title?: string
      content?: string
      longitude?: number
      latitude?: number
      height?: number
    }
  | { event: 'effect'; effectId: string; active: boolean }
  | { event: 'ended' }
  | { event: 'restore' }

type EngineListener = (detail: EngineEventDetail) => void

export class PresentationEngine {
  private viewer: Viewer
  private presentation: Presentation | null = null
  private positionProperty: SampledPositionProperty
  private orientationProperty: SampledProperty
  private listeners = new Map<string, Set<EngineListener>>()
  private triggeredEvents = new Set<string>()
  private epoch: JulianDate
  private initialSceneSnapshot: {
    position: Cartesian3
    heading: number
    pitch: number
    roll: number
    depthTestAgainstTerrain: boolean
  } | null = null
  private disposed = false

  constructor(viewer: Viewer) {
    this.viewer = viewer
    this.epoch = JulianDate.fromDate(new Date(0))

    this.positionProperty = new SampledPositionProperty()
    this.positionProperty.setInterpolationOptions({
      interpolationDegree: 2,
      interpolationAlgorithm: HermitePolynomialApproximation
    })

    this.orientationProperty = new SampledProperty(Quaternion)
    this.orientationProperty.setInterpolationOptions({
      interpolationDegree: 1,
      interpolationAlgorithm: LagrangePolynomialApproximation
    })

    this.viewer.clock.onTick.addEventListener(this.onTick)
  }

  private emit(detail: EngineEventDetail): void {
    const listeners = this.listeners.get(detail.event)
    if (listeners) listeners.forEach((listener) => listener(detail))
  }

  private secondsToJulianDate(seconds: number): JulianDate {
    return JulianDate.addSeconds(this.epoch, seconds, new JulianDate())
  }

  private julianDateToSeconds(date: JulianDate): number {
    return JulianDate.secondsDifference(date, this.epoch)
  }

  on(event: EngineEventDetail['event'], listener: EngineListener): void {
    let listeners = this.listeners.get(event)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(event, listeners)
    }
    listeners.add(listener)
  }

  off(event: EngineEventDetail['event'], listener: EngineListener): void {
    this.listeners.get(event)?.delete(listener)
  }

  load(presentation: Presentation): void {
    this.presentation = presentation
    this.triggeredEvents.clear()

    const camera = this.viewer.camera
    this.initialSceneSnapshot = {
      position: Cartesian3.clone(camera.position),
      heading: camera.heading,
      pitch: camera.pitch,
      roll: camera.roll,
      depthTestAgainstTerrain: this.viewer.scene.globe.depthTestAgainstTerrain
    }

    this.positionProperty.removeSamples(new TimeInterval({ start: this.epoch, stop: this.secondsToJulianDate(presentation.duration) }))
    this.orientationProperty.removeSamples(new TimeInterval({ start: this.epoch, stop: this.secondsToJulianDate(presentation.duration) }))
    presentation.keyframes.forEach((keyframe) => {
      const time = this.secondsToJulianDate(keyframe.time)
      const position = Cartesian3.fromDegrees(
        keyframe.position.longitude,
        keyframe.position.latitude,
        keyframe.position.height
      )
      const hpr = new HeadingPitchRoll(
        keyframe.orientation.heading,
        keyframe.orientation.pitch,
        keyframe.orientation.roll
      )
      this.positionProperty.addSample(time, position)
      this.orientationProperty.addSample(time, Quaternion.fromHeadingPitchRoll(hpr))
    })

    const clock = this.viewer.clock
    clock.startTime = this.secondsToJulianDate(0)
    clock.stopTime = this.secondsToJulianDate(presentation.duration)
    clock.currentTime = this.secondsToJulianDate(0)
    clock.multiplier = presentation.defaultPlaybackRate
    clock.clockRange = presentation.config.loop ? ClockRange.LOOP_STOP : ClockRange.CLAMPED
    clock.shouldAnimate = false

    this.updateCamera()
    this.emit({ event: 'timeupdate', seconds: 0 })
  }

  private onTick = (): void => {
    if (this.disposed || !this.presentation || !this.viewer.clock.shouldAnimate) return

    const currentTime = this.viewer.clock.currentTime
    const seconds = this.julianDateToSeconds(currentTime)
    const duration = this.presentation.duration

    this.updateCamera()
    this.checkEvents(seconds)

    if (seconds >= duration) {
      this.viewer.clock.shouldAnimate = false
      this.emit({ event: 'timeupdate', seconds: duration })
      if (this.presentation.config.restoreSceneOnEnd) {
        this.restoreInitialScene()
      }
      this.emit({ event: 'ended' })
      return
    }

    this.emit({ event: 'timeupdate', seconds })
  }

  private checkEvents(currentTime: number): void {
    if (!this.presentation) return
    this.presentation.events.forEach((event) => {
      if (!this.triggeredEvents.has(event.id) && currentTime >= event.time) {
        this.triggerEvent(event)
        this.triggeredEvents.add(event.id)
      }
    })
  }

  private triggerEvent(event: PresentationEvent): void {
    switch (event.type) {
      case 'layer_show':
        this.emit({ event: 'layer', layerId: String(event.payload.layerId), visible: true })
        break
      case 'layer_hide':
        this.emit({ event: 'layer', layerId: String(event.payload.layerId), visible: false })
        break
      case 'label_show':
        this.emit({ event: 'label', labelId: String(event.payload.labelId), visible: true })
        break
      case 'label_hide':
        this.emit({ event: 'label', labelId: String(event.payload.labelId), visible: false })
        break
      case 'popup_open':
        this.emit({
          event: 'popup',
          visible: true,
          title: String(event.payload.title ?? ''),
          content: String(event.payload.content ?? ''),
          longitude: Number(event.payload.longitude),
          latitude: Number(event.payload.latitude),
          height: Number(event.payload.height)
        })
        break
      case 'popup_close':
        this.emit({ event: 'popup', visible: false })
        break
      case 'effect_start':
        this.emit({ event: 'effect', effectId: String(event.payload.effectId), active: true })
        break
      case 'effect_stop':
        this.emit({ event: 'effect', effectId: String(event.payload.effectId), active: false })
        break
      case 'camera_jump': {
        const p = event.payload
        const position = Cartesian3.fromDegrees(
          Number(p.longitude),
          Number(p.latitude),
          Number(p.height)
        )
        this.viewer.camera.setView({
          destination: position,
          orientation: {
            heading: Number(p.heading ?? 0),
            pitch: Number(p.pitch ?? -Math.PI / 4),
            roll: Number(p.roll ?? 0)
          }
        })
        break
      }
      case 'custom':
        if (event.payload.action === 'enableUndergroundMode') {
          this.enableUndergroundMode(Boolean(event.payload.enable))
        }
        break
    }
  }

  private enableUndergroundMode(enable: boolean): void {
    this.viewer.scene.globe.depthTestAgainstTerrain = !enable
  }

  restoreInitialScene(): void {
    if (!this.initialSceneSnapshot) return
    const snapshot = this.initialSceneSnapshot
    this.viewer.camera.setView({
      destination: snapshot.position,
      orientation: {
        heading: snapshot.heading,
        pitch: snapshot.pitch,
        roll: snapshot.roll
      }
    })
    this.viewer.scene.globe.depthTestAgainstTerrain = snapshot.depthTestAgainstTerrain
    this.emit({ event: 'restore' })
  }

  play(): void {
    this.viewer.clock.shouldAnimate = true
  }

  pause(): void {
    this.viewer.clock.shouldAnimate = false
  }

  seek(time: number): void {
    if (!this.presentation) return
    const duration = this.presentation.duration
    const clamped = Math.max(0, Math.min(duration, time))
    this.viewer.clock.currentTime = this.secondsToJulianDate(clamped)
    this.viewer.clock.shouldAnimate = false
    this.triggeredEvents.clear()
    this.presentation.events.forEach((event) => {
      if (event.time <= clamped) {
        this.triggerEvent(event)
        this.triggeredEvents.add(event.id)
      }
    })
    this.updateCamera()
    this.emit({ event: 'timeupdate', seconds: clamped })
  }

  setSpeed(rate: number): void {
    this.viewer.clock.multiplier = rate
  }

  setLoop(loop: boolean): void {
    this.viewer.clock.clockRange = loop ? ClockRange.LOOP_STOP : ClockRange.CLAMPED
  }

  private updateCamera(): void {
    const time = this.viewer.clock.currentTime
    const position = this.positionProperty.getValue(time)
    const orientation = this.orientationProperty.getValue(time)
    if (!position || !orientation) return
    const hpr = HeadingPitchRoll.fromQuaternion(orientation)
    this.viewer.camera.setView({
      destination: position,
      orientation: {
        heading: hpr.heading,
        pitch: hpr.pitch,
        roll: hpr.roll
      }
    })
  }

  dispose(): void {
    this.disposed = true
    this.viewer.clock.onTick.removeEventListener(this.onTick)
    this.positionProperty.removeSamples(new TimeInterval({ start: this.epoch, stop: this.secondsToJulianDate(this.presentation?.duration ?? 0) }))
    this.orientationProperty.removeSamples(new TimeInterval({ start: this.epoch, stop: this.secondsToJulianDate(this.presentation?.duration ?? 0) }))
    this.listeners.clear()
  }
}
