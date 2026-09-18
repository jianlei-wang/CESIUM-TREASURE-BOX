import { type Scene } from 'cesium'
import {
  computeCameraMatrices,
  type CameraMatrixResult,
  type ProjectionCameraConfig
} from './MatrixEngine'
import { FrustumVisualizer } from './FrustumVisualizer'
import { ProjectionBoundary } from './ProjectionBoundary'
import { VideoProjectionStage, type ProjectionStageParams } from './VideoProjectionStage'
import { VideoSource } from './VideoSource'

export type CameraStateInput = {
  id: string
  active: boolean
  config: ProjectionCameraConfig
  videoUrl: string
}

export type GlobalStateInput = {
  fusionEnabled: boolean
  frustumVisible: boolean
  boundaryVisible: boolean
}

type CameraRuntime = {
  id: string
  config: ProjectionCameraConfig
  source: VideoSource
  matrices: CameraMatrixResult
  frustum: FrustumVisualizer
  boundary: ProjectionBoundary
  stage: VideoProjectionStage
  active: boolean
}

function toStageParams(config: ProjectionCameraConfig): ProjectionStageParams {
  return {
    videoAlpha: config.videoAlpha,
    edgeFeather: config.edgeFeather,
    depthFeather: config.depthFeather,
    near: config.near,
    far: config.far,
    tint: config.tint
  }
}

/**
 * 视频投影融合管理器：协调视频源、矩阵计算、视锥体线框、裁切边界与后处理投影。
 * 每个摄像头独立持有一套完整资源，多路摄像头按顺序叠加融合。
 */
export class VideoFusionManager {
  private readonly _scene: Scene
  private readonly _cameras = new Map<string, CameraRuntime>()
  private _frustumVisible = true
  private _boundaryVisible = true
  private _fusionEnabled = true
  private _refreshHandle: number | null = null
  private _destroyed = false
  private readonly _removePreUpdate: () => void

  constructor(scene: Scene) {
    this._scene = scene
    const onPreUpdate = () => {
      if (this._destroyed) return
      for (const camera of this._cameras.values()) camera.source.updateTexture()
    }
    scene.preUpdate.addEventListener(onPreUpdate)
    this._removePreUpdate = () => scene.preUpdate.removeEventListener(onPreUpdate)
  }

  get cameraCount(): number {
    return this._cameras.size
  }

  cameraConfig(id: string): ProjectionCameraConfig | undefined {
    return this._cameras.get(id)?.config
  }

  sync(inputs: CameraStateInput[], global: GlobalStateInput): void {
    if (this._destroyed) return
    this._fusionEnabled = global.fusionEnabled
    this._frustumVisible = global.frustumVisible
    this._boundaryVisible = global.boundaryVisible

    const seen = new Set<string>()
    for (const input of inputs) {
      seen.add(input.id)
      const existing = this._cameras.get(input.id)
      if (existing) {
        existing.config = input.config
        existing.active = input.active
      } else {
        this._createCamera(input)
      }
    }

    for (const id of [...this._cameras.keys()]) {
      if (!seen.has(id)) this._removeCamera(id)
    }

    this._scheduleRefresh()
  }

  private _createCamera(input: CameraStateInput): void {
    const source = new VideoSource(this._scene, { url: input.videoUrl })
    const matrices = computeCameraMatrices(input.config)
    const frustum = new FrustumVisualizer(this._scene)
    const boundary = new ProjectionBoundary(this._scene)
    const stage = new VideoProjectionStage(this._scene, source, input.id)
    const camera: CameraRuntime = {
      id: input.id,
      config: input.config,
      source,
      matrices,
      frustum,
      boundary,
      stage,
      active: input.active
    }
    this._cameras.set(input.id, camera)
    this._apply(camera)
    void source.open()
  }

  private _removeCamera(id: string): void {
    const camera = this._cameras.get(id)
    if (!camera) return
    camera.frustum.destroy()
    camera.boundary.destroy()
    camera.stage.destroy()
    camera.source.destroy()
    this._cameras.delete(id)
  }

  private _apply(camera: CameraRuntime): void {
    const matrices = computeCameraMatrices(camera.config)
    camera.matrices = matrices
    camera.stage.update(matrices.viewMatrix, matrices.projectionMatrix, toStageParams(camera.config))
    camera.frustum.setVisible(this._frustumVisible && camera.active)
    camera.boundary.setVisible(this._boundaryVisible && camera.active)
    camera.stage.setEnabled(this._fusionEnabled && camera.active)
    camera.frustum.update(matrices.inverseViewProjection)
    camera.boundary.update(matrices.inverseViewProjection, matrices.position)
  }

  private _scheduleRefresh(): void {
    if (this._refreshHandle !== null || this._destroyed) return
    this._refreshHandle = requestAnimationFrame(() => {
      this._refreshHandle = null
      if (this._destroyed) return
      for (const camera of this._cameras.values()) this._apply(camera)
    })
  }

  refresh(): void {
    this._scheduleRefresh()
  }

  playAll(): void {
    for (const camera of this._cameras.values()) camera.source.play()
  }

  pauseAll(): void {
    for (const camera of this._cameras.values()) camera.source.pause()
  }

  destroy(): void {
    if (this._destroyed) return
    this._destroyed = true
    this._removePreUpdate()
    if (this._refreshHandle !== null) {
      cancelAnimationFrame(this._refreshHandle)
      this._refreshHandle = null
    }
    for (const id of [...this._cameras.keys()]) this._removeCamera(id)
  }
}
