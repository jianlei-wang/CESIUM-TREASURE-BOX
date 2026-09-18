import { Cartesian3, Matrix4, PostProcessStage, type Scene } from 'cesium'
import { VIDEO_PROJECTION_FRAGMENT } from './shader'
import type { VideoSource } from './VideoSource'

export type ProjectionStageParams = {
  videoAlpha: number
  edgeFeather: number
  depthFeather: number
  near: number
  far: number
  tint: [number, number, number]
}

export const DEFAULT_STAGE_PARAMS: ProjectionStageParams = {
  videoAlpha: 0.92,
  edgeFeather: 0.08,
  depthFeather: 60,
  near: 1,
  far: 3000,
  tint: [1, 1, 1]
}

/**
 * 视频投影融合后处理：每个摄像头一个全屏 Pass，
 * 依据场景深度重建世界坐标，再投影到视频相机空间采样视频纹理。
 * 多路摄像头时 Pass 按加入顺序链式叠加，重叠区域自然混合。
 */
export class VideoProjectionStage {
  private readonly _scene: Scene
  private readonly _source: VideoSource
  private readonly _stage: PostProcessStage
  private _viewMatrix = Matrix4.IDENTITY.clone()
  private _projectionMatrix = Matrix4.IDENTITY.clone()
  private _params: ProjectionStageParams = { ...DEFAULT_STAGE_PARAMS }
  private readonly _tint = new Cartesian3(1, 1, 1)
  private _enabled = true

  constructor(scene: Scene, source: VideoSource, id: string) {
    this._scene = scene
    this._source = source
    const self = this
    this._stage = new PostProcessStage({
      name: `video_projection_${id}`,
      fragmentShader: VIDEO_PROJECTION_FRAGMENT,
      uniforms: {
        u_videoTexture: () => self._source.texture,
        u_videoViewMatrix: () => self._viewMatrix,
        u_videoProjectionMatrix: () => self._projectionMatrix,
        u_tint: () => self._tint,
        u_videoAlpha: () => self._params.videoAlpha,
        u_edgeFeather: () => self._params.edgeFeather,
        u_depthFeather: () => self._params.depthFeather,
        u_near: () => self._params.near,
        u_far: () => self._params.far,
        u_enabled: () => (self._enabled ? 1 : 0)
      }
    })
    this._scene.postProcessStages.add(this._stage)
  }

  get enabled(): boolean {
    return this._enabled
  }

  update(viewMatrix: Matrix4, projectionMatrix: Matrix4, params: ProjectionStageParams): void {
    this._viewMatrix = viewMatrix
    this._projectionMatrix = projectionMatrix
    this._params = params
    this._tint.x = params.tint[0]
    this._tint.y = params.tint[1]
    this._tint.z = params.tint[2]
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled
    this._stage.enabled = enabled
  }

  destroy(): void {
    this._scene.postProcessStages.remove(this._stage)
  }
}
