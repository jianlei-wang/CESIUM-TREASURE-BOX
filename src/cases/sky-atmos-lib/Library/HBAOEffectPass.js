import { usesLogDepthOptimization } from "./internal/CesiumAdapter.js";
import PostProcessStage from "./PostProcessStage.js";
import ambientOcclusionGenerate from "./hbao/ambientOcclusionGenerate.js";
import ambientOcclusionModulate from "./hbao/ambientOcclusionModulate.js";
import {
  reconstructNormal, reconstructPosition, crossBilateralFilter,
  highPassRandom, depth, globeDepth, turboColorMap, packing
} from "./hbao/shader.js";
/**
 * ------------------------------------------------------------
 * HBAO 使用小范围场景 高质量的柔和软阴影 补充物体遮挡之间产生的阴影
 * ------------------------------------------------------------
 */
import { 
  PostProcessStageComposite,
  PostProcessStageSampleMode,
  createGuid,
  Cartesian2,
  Cartesian3,
  PixelDatatype,
  Color,
  PerspectiveFrustum,
  Math as CesiumMath
} from "cesium";

// Cesium ESM 未导出 defaultValue，使用本地默认值工具。
const defaultValue = (a, b) => a ?? b;
defaultValue.EMPTY_OBJECT = Object.freeze({});
/**
 * @param {*} options 参数参数如下
 * @param {Number} [intensity] 强度
 * @param {Color} [color] 颜色
 * @param {Number} [maxRadius] 最大半径
 * @param {Number} [bias] 偏移量
 * @param {Number} [blackPoint] 黑色区域阈值
 * @param {Number} [whitePoint] 白色区域阈值
 * @returns {HBAOEffectPass}
 */
const prefix = "czm_hbao";
export default class HBAOEffectPass {

  constructor(scene, options = {}) {

    this.id = createGuid();

    this._scene = scene;
    this._hbaoEffect = undefined;
    this._lastViewPosition = new Cartesian3();
    this._cameraFov = 0;
    this._destroyed = false;

    this._show = defaultValue(options.show, true);

    this._intensity = defaultValue(options.intensity, 100)
    this._color = defaultValue(options.color, Color.BLACK)
    this._maxRadius = defaultValue(options.maxRadius, 30)
    this._bias = defaultValue(options.bias, 0.1)
    this._frustumLength = defaultValue(options.frustumLength, 100000)
    this._focalLength = defaultValue(options.focalLength, new Cartesian2())
    this._blackPoint = defaultValue(options.blackPoint, 0.05)
    this._whitePoint = defaultValue(options.whitePoint, 0.9)
    this._gamma = defaultValue(options.gamma, 2.5)

    this._useGlobeDepth = defaultValue(options.useGlobeDepth, true)
    this._denoise = defaultValue(options.denoise, true)
    this._textureScale = defaultValue(options.textureScale, 1)
    this._directions = defaultValue(options.directions, 8)
    this._steps = defaultValue(options.steps, 8)
    this._outputType = defaultValue(options.outputType, null)
    this._accurateNormalReconstruction = true

    this._normalExponent = defaultValue(options.normalExponent, 5)
    this._depthExponent = defaultValue(options.depthExponent, 1)

    this.init();
  }

  get stage() {

    return this._hbaoEffect;
  }

  get ready() {

    return this._hbaoEffect.ready;
  }

  get name() {

    return this._hbaoEffect.name;
  }

  get enabled() {

    return this._show;
  }

  set enabled(val) {
    this._show = val;
    if (this._hbaoEffect) this._hbaoEffect.enabled = val;
  }

  init() {

    const scene = this._scene;
    const frustum = scene.camera.frustum
    const cotFovy = 1 / Math.tan(frustum.fovy / 2)
    this._focalLength.x = cotFovy * frustum.aspectRatio
    this._focalLength.y = cotFovy
    this._pixelDatatype = scene.highDynamicRange ? PixelDatatype.HALF_FLOAT : PixelDatatype.UNSIGNED_BYTE;
    const generate = new PostProcessStage({
      name: `${prefix}_ambient_occlusion_generate`,
      fragmentShader: `
            ${this._directions !== null ? `#define NUM_DIRECTIONS (${this._directions})` : ''}
            ${this._steps !== null ? `#define NUM_STEPS (${this._steps})` : ''}
            ${this._accurateNormalReconstruction ? '#define USE_ACCURATE_NORMAL' : ''}
            ${this._outputType !== null ? `#define OUTPUT_TYPE (${this._outputType})` : ''}
            ${this._useGlobeDepth ? globeDepth : depth}
            ${packing}
            ${highPassRandom}
            ${reconstructPosition}
            ${reconstructNormal}
            ${ambientOcclusionGenerate}
            `,
      timeSlicingEnabled: true,
      uniforms: {
        textureScale: () => { return this._textureScale },
        intensity: () => { return this._intensity },
        maxRadius: () => { return this._maxRadius },
        bias: () => { return this._bias },
        frustumLength: () => { return this._frustumLength },
        focalLength: () => { return this._focalLength },
        globeDepthTexture: () => { return defaultValue(scene.context.uniformState.globeDepthTexture, scene.context.defaultTexture) },
      },
      pixelDatatype: this._pixelDatatype
    })

    const modulate = new PostProcessStage({
      name: `${prefix}_ambient_occlusion_modulate`,
      fragmentShader: `
            ${this._outputType !== null ? `#define OUTPUT_TYPE (${this._outputType})` : ''}
            ${this._useGlobeDepth ? globeDepth : depth}
            ${packing}
            ${reconstructPosition}
            ${turboColorMap}
            ${ambientOcclusionModulate}
            `,
      timeSlicingEnabled: true,
      uniforms: {
        color: () => { return this._color },
        frustumLength: () => { return this._frustumLength },
        blackPoint: () => { return this._blackPoint },
        whitePoint: () => { return this._whitePoint },
        gamma: () => { return this._gamma },
        globeDepthTexture: () => { return defaultValue(scene.context.uniformState.globeDepthTexture, scene.context.defaultTexture) },
      },
      pixelDatatype: this._pixelDatatype
    });

    if (this._denoise) {

      const filter = createBilateralFilterStage(this, generate);

      // const generateAndFilter = new PostProcessStageComposite({
      //   name: `${prefix}_ambient_occlusion_generate_and_filter`,
      //   stages: [generate, filter],
      //   inputPreviousStageTexture: false,
      // })

      modulate.uniforms.ambientOcclusionTexture = filter.name

      this._hbaoEffect = new PostProcessStageComposite({
        name: `${prefix}_ambient_occlusion`,
        stages: [filter, modulate],
        inputPreviousStageTexture: false,
      })
    } else {

      modulate.uniforms.ambientOcclusionTexture = generate.name

      this._hbaoEffect = new PostProcessStageComposite({
        name: `${prefix}_ambient_occlusion`,
        stages: [generate, modulate],
        inputPreviousStageTexture: false
      });
    }

    this._hbaoEffect.enabled = this._show;
  }

  update(context, useLogDepth) {

    const scene = this._scene;
    const frustum = scene.camera.frustum;
    const cameraPosition = scene.camera.position;
    if (this._hbaoEffect && this._hbaoEffect.enabled) {

      this._hbaoEffect.update(context, useLogDepth);

      const cotFovy = 1 / Math.tan(frustum.fovy / 2)
      this._focalLength.x = cotFovy * frustum.aspectRatio
      this._focalLength.y = cotFovy
    }

    // 深度缓冲区精度优化
    if (
      usesLogDepthOptimization(scene) &&
      (!this._lastViewPosition.equals(cameraPosition)
        || this._cameraFov !== frustum.fov
        || this._hbaoEffect.enabled
      )
    ) {
      cameraPosition.clone(this._lastViewPosition);
      this._cameraFov = frustum.fov;
      // Increase the precision of the depth buffer which HBAO looks up to
      // reconstruct normals.
      const { globeHeight } = scene;
      if (globeHeight == null) {
        return
      }
      // Screen-space camera controller should detect collision
      const cameraHeight = scene.camera.positionCartographic.height - globeHeight
      if (frustum instanceof PerspectiveFrustum) {
        scene.camera.frustum.near =
          CesiumMath.clamp(cameraHeight - 1, 1, 5) / Math.tan(frustum.fov / 2)
      }
    }
  }

  _isSupported(context) {

    return this._hbaoEffect._isSupported(context);
  }

  isDestroyed() {

    return this._destroyed;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;

    if (this._hbaoEffect) {

      if (!this._hbaoEffect.isDestroyed()) this._hbaoEffect.destroy();

      this._hbaoEffect = undefined;
    }

    return undefined;
  };
}
function createBilateralFilterStage(that, generate) {
  const blurX = new PostProcessStage({
    name: `${prefix}_ambient_occlusion_cross_bilateral_filter_x`,
    fragmentShader: `
        #define DIRECTION (0)
        ${that._outputType !== null ? `#define OUTPUT_TYPE (${that._outputType})` : ''}
        ${that._useGlobeDepth ? globeDepth : depth}
        ${packing}
        ${reconstructPosition}
        ${crossBilateralFilter}
      `,
    timeSlicingEnabled: true,
    uniforms: {
      colorTexture2: generate.name,
      textureScale: () => { return that._textureScale },
      frustumLength: () => { return that._frustumLength },
      normalExponent: () => { return that._normalExponent },
      depthExponent: () => { return that._depthExponent },
      globeDepthTexture: () => { return defaultValue(that._scene.context.uniformState.globeDepthTexture, that._scene.context.defaultTexture) },
    },
    pixelDatatype: that._pixelDatatype,
    sampleMode: PostProcessStageSampleMode.LINEAR
  })

  const blurY = new PostProcessStage({
    name: `${prefix}_ambient_occlusion_cross_bilateral_filter_y`,
    fragmentShader: `
        #define DIRECTION (1)
        ${that._outputType !== null ? `#define OUTPUT_TYPE (${that._outputType})` : ''}
        ${that._useGlobeDepth ? globeDepth : depth}
        ${packing}
        ${reconstructPosition}
        ${crossBilateralFilter}
      `,
    timeSlicingEnabled: true,
    uniforms: {
      colorTexture2: generate.name,
      textureScale: () => { return that._textureScale },
      frustumLength: () => { return that._frustumLength },
      normalExponent: () => { return that._normalExponent },
      depthExponent: () => { return that._depthExponent },
      globeDepthTexture: () => { return defaultValue(that._scene.context.uniformState.globeDepthTexture, that._scene.context.defaultTexture) },
    },
    pixelDatatype: that._pixelDatatype,
    sampleMode: PostProcessStageSampleMode.LINEAR
  })

  return new PostProcessStageComposite({
    name: `${prefix}_ambient_occlusion_cross_bilateral_filter`,
    stages: [generate, blurX, blurY],
    inputPreviousStageTexture: true
  })
}
Object.defineProperties(HBAOEffectPass.prototype, {
  show: {

    get: function () {

      return this._show;
    },
    set: function (val) {

      this._show = val;

      if (this._hbaoEffect) { this._hbaoEffect.enabled = this._show; }
    }
  }
});
