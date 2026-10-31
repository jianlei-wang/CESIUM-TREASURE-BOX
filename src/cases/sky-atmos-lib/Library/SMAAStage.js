/**
 * SMAAStage —— 把 SMAAEffectPass 包装成一个官方 PostProcessStage 链可驱动的 stage。
 *
 * SMAA（Subpixel Morphological Anti-Aliasing，亚像素形态学抗锯齿）是纯屏幕空间、
 * 基于颜色边缘的抗锯齿，比 FXAA 更锐利、无明显模糊感，且不需要 TAA 的投影抖动(jitter)，
 * 因此可以在「零侵入官方内核」的前提下工作。
 *
 * SMAAEffectPass 通过 execute(context)/getSMAATexture() 执行离屏抗锯齿处理。
 * 本 stage 使用兼容 Cesium 后处理链的 RenderPass（pass-through）包装它：
 *   - 该 stage 接收上一阶段输出 colorTexture（即天空效果合成结果）；
 *   - 在其内部命令执行前（preExecute 钩子）先把 colorTexture 喂给 SMAA 跑完三道 pass；
 *   - pass-through 命令再把 SMAA 的输出 getSMAATexture() 写入本 stage 的输出 framebuffer。
 * 这样 SMAA 就能作为官方 postProcessStages 链的一环，对最终图像抗锯齿。
 */
import RenderPass from "./PostProcessStage.js";
import SMAAEffectPass from "./SMAAEffectPass.js";
import PASS_THROUGH_FS from "./shaders/smaa/passThrough.frag.glsl?raw";

export default class SMAAStage {
  /**
   * @param {Cesium.Scene} scene 场景
   * @param {object} [options]
   * @param {boolean} [options.show=true] 是否启用
   */
  constructor(scene, options = {}) {
    this._scene = scene;
    this._destroyed = false;
    this._smaa = new SMAAEffectPass(scene, options);
    this._smaa.enabled = options.show ?? true;

    const that = this;
    // pass-through stage：输入为上一阶段（天空效果）输出；输出 SMAA 抗锯齿结果。
    this._stage = new RenderPass({
      name: "czm_smaa_effect_composite",
      fragmentShader: PASS_THROUGH_FS,
      uniforms: {
        // 命令执行时采样 SMAA 的最终输出；首帧若未就绪则回退为原始输入。
        colorTexture: function () {
          const tex = that._smaa.getSMAATexture && that._smaa.getSMAATexture();
          return tex || that._lastInput || scene.context.defaultTexture;
        },
      },
    });
    this._stage.enabled = this._smaa.enabled;
    this._lastInput = undefined;

    // 重写 execute：官方 PostProcessStage.execute 的 preExecute 钩子早于 _colorTexture 赋值，
    // 拿不到当前帧输入，故直接在此用入参 colorTexture 跑完 SMAA 三道 pass，再走原 execute
    // 输出 pass-through（采样 getSMAATexture()）。
    const originalExecute = this._stage.execute.bind(this._stage);
    this._stage.execute = function (context, colorTexture, depthTexture, idTexture) {
      if (that._smaa.enabled && colorTexture) {
        that._lastInput = colorTexture;
        that._smaa.setInputTexture(colorTexture);
        // execute 内部会按需创建查找表/FBO/命令；查找表异步加载，未就绪时该帧近似直通。
        that._smaa.execute(context);
      }
      return originalExecute(context, colorTexture, depthTexture, idTexture);
    };
  }

  /** 官方后处理 stage（加入 scene.postProcessStages） */
  get stage() {
    return this._stage;
  }

  get ready() {
    return this._stage.ready;
  }

  get assetStatus() { return this._smaa?.assetStatus ?? "disposed"; }
  get assetErrors() { return this._smaa?.assetErrors ?? Object.freeze([]); }
  get assetsReady() { return this._smaa?.assetsReady ?? this.captureAssets({ start: true }); }
  retryAssets() { return this._smaa?.retryAssets() ?? Promise.reject(Object.assign(new Error("[SkyAtmos] SMAA is disposed."), { name: "AbortError" })); }
  subscribeAssets(listener) { return this._smaa?.subscribeAssets(listener) ?? (() => {}); }
  getAssetState() {
    return this._smaa?.getAssetState() ?? Object.freeze({ status: "disposed", errors: Object.freeze([]) });
  }
  captureAssets(options) {
    return this._smaa?.captureAssets(options) ?? Promise.reject(Object.assign(new Error("[SkyAtmos] SMAA is disposed."), { name: "AbortError" }));
  }

  get name() {
    return this._stage.name;
  }

  get enabled() {
    return this._smaa.enabled;
  }

  set enabled(val) {
    this._smaa.enabled = val;
    this._stage.enabled = val;
  }

  /** 每帧更新（计算分辨率、创建/重建 FBO 与查找表） */
  update(context, useLogDepth) {
    // 先让 SMAA 准备资源（分辨率/FBO/查找表）
    this._smaa.update(context, useLogDepth);
    // 再让 pass-through stage 更新（创建输出 framebuffer 等）
    if (this._stage && this._stage.enabled) {
      this._stage.update(context, useLogDepth);
    }
  }

  _isSupported(context) {
    return this._stage._isSupported(context);
  }

  isDestroyed() {
    return this._destroyed;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._smaa && !this._smaa.isDestroyed()) {
      this._smaa.destroy();
    }
    this._smaa = undefined;
    // 集合通常先销毁 stage；直接销毁包装器时也要释放它。
    if (this._stage && !this._stage.isDestroyed()) this._stage.destroy();
    this._stage = undefined;
  }
}
