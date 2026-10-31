/**
 * SkyAtmos —— 体积云 / 大气散射 / 体积光（丁达尔）/ 镜头光晕 天空渲染管线。
 *
 * SkyAtmos for Cesium SDK 的天空渲染入口，在 Cesium（ESM）中一行开启后处理效果：
 *
 *   import { SkyAtmos } from "./SkyAtmos.js";
 *   const fx = new SkyAtmos(viewer);          // 使用内置默认预设
 *   // 或覆盖参数：
 *   const fx = new SkyAtmos(viewer, { coverage: 0.35, toneMappingExposure: 6 });
 *
 * 依赖与前置条件：
 *   1. 官方 Cesium（正式支持 1.142.0+，所需渲染器内部接口随版本升级验收）。
 *   2. three（资源加载器 EXRLoader / CSM 阴影使用，工程内执行 `npm i three`）。
 *   3. 设置 window.CESIUM_BASE_URL 指向包含 sky-atmos-assets/GeospatialAssets/ 的静态目录
 *      （大气 LUT *.exr、3D 噪声 *.bin、天气图 *.png）。
 *
 * 设计：零侵入官方内核——不 patch Scene.prototype；仅用官方导出 API + 运行时配置，
 * 以及在传入的 scene.context 实例上安装两个支持自定义顶点着色器的视口命令方法。
 */
import { Cartesian2, Cartesian3, Cartesian4, JulianDate, PerspectiveFrustum, SceneMode, defined } from "cesium";
import GeospatialPipelinePass from "./Library/GeospatialPipelinePass.js";
import HBAOEffectPass from "./Library/HBAOEffectPass.js";
import SMAAStage from "./Library/SMAAStage.js";
import preloadAssets from "./Library/internal/preloadAssets.js";
import { installViewportCommands } from "./Library/viewportQuadCommand.js";
import { DEFAULT_OPTIONS, cloneOptions, isPlainObject, mergeOptions, prepareOptions } from "./src/options.js";

// Symbol.for also shares the lease with a second copy of the SDK bundle.
const ACTIVE_INSTANCE = Symbol.for("sky-atmos.activeInstance");
const CLOUD_LAYER_TYPES = ["cumulus", "altocumulus", "cirrus"];
const HAZE_QUALITY_SAMPLES = Object.freeze({
  low: [16, 1],
  balanced: [24, 2],
  high: [32, 4],
});

function toCartesian2(value) {
  return new Cartesian2(value[0], value[1]);
}
function toCartesian4(value) {
  return new Cartesian4(value[0], value[1], value[2], value[3]);
}

function getUseLogDepth(scene) {
  const fs = scene.frameState || scene._frameState;
  if (fs && typeof fs.useLogDepth === "boolean") return fs.useLogDepth;
  return !!scene.logarithmicDepthBuffer;
}

function getSceneSupportError(scene) {
  if (!defined(scene.globe)) return "需要具有 globe 的 Cesium 场景。";
  if (scene.mode !== SceneMode.SCENE3D) return "仅支持 SceneMode.SCENE3D 场景。";
  if (!(scene.camera?.frustum instanceof PerspectiveFrustum)) return "仅支持 PerspectiveFrustum 透视相机。";
  return undefined;
}

function assertRuntimeSupport(scene) {
  const sceneError = getSceneSupportError(scene);
  if (sceneError) throw new Error(`[SkyAtmos] ${sceneError}`);
  if (typeof globalThis.Float16Array !== "function") throw new Error("[SkyAtmos] 当前浏览器需要支持 Float16Array。");
  if (typeof globalThis.structuredClone !== "function") throw new Error("[SkyAtmos] 当前浏览器需要支持 structuredClone。");
  const context = scene.context;
  if (!context.webgl2) throw new Error("[SkyAtmos] 需要 WebGL 2。");
  for (const capability of ["floatingPointTexture", "halfFloatingPointTexture", "colorBufferFloat", "colorBufferHalfFloat", "textureFloatLinear", "textureHalfFloatLinear"]) {
    if (!context[capability]) throw new Error(`[SkyAtmos] 当前 WebGL 环境缺少所需浮点纹理能力：${capability}。`);
  }
}

export class SkyAtmos {
  /** 预下载必需的天空资源，后续实例在当前页面内复用原始数据；无需 Viewer。 */
  static preloadAssets() {
    return preloadAssets();
  }

  /** 返回内置默认预设的独立副本。 */
  static getDefaultOptions() {
    return cloneOptions(DEFAULT_OPTIONS);
  }

  /**
   * @param {Cesium.Viewer|Cesium.Scene} viewerOrScene Cesium Viewer 或 Scene
   * @param {object} [options] 覆盖默认预设的配置（深合并）
   */
  constructor(viewerOrScene, options = {}) {
    const prepared = prepareOptions(options);
    options = prepared.options;
    if (!defined(viewerOrScene)) {
      throw new Error("[SkyAtmos] 需要传入 Cesium Viewer 或 Scene。");
    }
    const scene = defined(viewerOrScene.scene) ? viewerOrScene.scene : viewerOrScene;
    if (!defined(scene) || !defined(scene.context)) {
      throw new Error("[SkyAtmos] 无法获取 scene.context，请确认传入的是 Viewer/Scene。");
    }
    if (globalThis[ACTIVE_INSTANCE]) {
      throw new Error("[SkyAtmos] 同页仅允许一个活动实例，请先 dispose() 现有实例。");
    }
    assertRuntimeSupport(scene);
    this._viewer = defined(viewerOrScene.scene) ? viewerOrScene : undefined;
    this._scene = scene;
    this._options = mergeOptions(DEFAULT_OPTIONS, options);
    this._hbaoOptions = cloneOptions(this._options.hbao);
    this._options.time = Object.hasOwn(options, "time") ? options.time ?? null : this._options.time;
    this._disposed = false;
    this._assetSubscriptions = new Set();
    const clock = this._viewer?.clock;
    const initialTime = defined(clock) && defined(this._options.time)
      ? prepared.time ?? JulianDate.fromIso8601(this._options.time) : undefined;
    // Only a failed construction rolls these settings back. Normal dispose keeps
    // the documented clock/HDR settings and restores the pass-owned sky settings.
    const initialSettings = this._options.applySceneSettings ? [
      [scene, "highDynamicRange", scene.highDynamicRange],
      [scene, "logarithmicDepthBuffer", scene.logarithmicDepthBuffer],
      [scene, "gamma", scene.gamma],
      [scene.globe, "depthTestAgainstTerrain", scene.globe.depthTestAgainstTerrain],
    ] : [];
    if (defined(initialTime)) initialSettings.push([clock, "currentTime", JulianDate.clone(clock.currentTime)]);
    globalThis[ACTIVE_INSTANCE] = this;

    try {

    // 1) 在 context 上安装支持自定义顶点着色器的视口命令
    installViewportCommands(scene.context);

    // 2) 必要的场景设置
    if (this._options.applySceneSettings) {
      if (defined(this._options.highDynamicRange)) scene.highDynamicRange = !!this._options.highDynamicRange;
      if (defined(this._options.logarithmicDepthBuffer)) scene.logarithmicDepthBuffer = !!this._options.logarithmicDepthBuffer;
      if (defined(this._options.gamma)) scene.gamma = this._options.gamma;
      scene.globe.depthTestAgainstTerrain = true;
    }
    if (defined(initialTime)) clock.currentTime = initialTime;

    // 3) HBAO 环境光遮蔽（可选，先于天空效果加入，在地表几何上叠加柔和接触阴影）
    const hbaoEnabled = this._options.hbao.enabled;
    this._hbao = new HBAOEffectPass(scene, { show: hbaoEnabled, ...this._hbaoOptions });
    scene.postProcessStages.add(this._hbao.stage);

    // 4) 创建天空管线 Pass（关闭依赖 GBuffer 的 SSR / fields；太阳跟随系统光）
    this._geo = new GeospatialPipelinePass(scene, {
      systemLight: this._options.systemLight,
      showSSR: false,
      showFields: false,
      show: this._options.enabled,
    });

    // 5) 加入官方后处理集合
    scene.postProcessStages.add(this._geo.stage);

    // 6) SMAA 抗锯齿（可选，链尾——对天空效果合成后的最终图像抗锯齿）
    this._smaa = undefined;
    if (this._options.smaa) {
      this._smaa = new SMAAStage(scene, { show: true });
      scene.postProcessStages.add(this._smaa.stage);
    }

    // 7) 应用预设参数
    this._applyPreset(this._options);

    // 8) 每帧驱动：在渲染前计算行星半径/太阳月亮/风偏移并更新离屏 Pass
    this._removePreRender = scene.preRender.addEventListener(() => {
      if (this._disposed || this._runtimeError) return;
      const sceneError = getSceneSupportError(scene);
      if (sceneError) {
        this._runtimeError = new Error(`[SkyAtmos] ${sceneError} 效果已停止，请 dispose() 后在支持的场景中重建。`);
        this._options.enabled = false;
        this._applyEnabled();
        console.error(this._runtimeError);
        return;
      }
      try {
        const useLog = getUseLogDepth(scene);
        if (this._hbao) this._hbao.update(scene.context, useLog);
        if (this._geo) this._geo.update(scene.context, useLog);
        if (this._smaa) this._smaa.update(scene.context, useLog);
      } catch (e) {
        // 单帧异常不应中断渲染循环
        console.error("[SkyAtmos] update error:", e);
      }
    });

    } catch (error) {
      try { this.dispose(); } catch (cleanupError) { console.error("[SkyAtmos] 初始化失败后的资源清理异常：", cleanupError); }
      if (globalThis[ACTIVE_INSTANCE] === this) delete globalThis[ACTIVE_INSTANCE];
      for (const [target, key, value] of initialSettings) target[key] = value;
      throw error;
    }
  }

  /** 应用一组预设参数到底层 Pass。 */
  _applyPreset(opt) {
    const geo = this._geo;
    let cloudHistoryChanged = false;
    if (defined(opt.systemLight)) geo._systemLight = !!opt.systemLight;
    if (defined(opt.coverage)) {
      geo.coverage = opt.coverage;
      cloudHistoryChanged = true;
    }
    if (defined(opt.localWeatherVelocity)) geo.localWeatherVelocity = toCartesian2(opt.localWeatherVelocity);
    if (defined(opt.bloomIntensity)) geo._bloomIntensity = opt.bloomIntensity;
    if (defined(opt.toneMappingExposure)) geo.toneMappingExposure = opt.toneMappingExposure;
    if (defined(opt.irradianceScale)) geo._irradianceScale = opt.irradianceScale;
    if (defined(opt.aerialPerspectiveStrength)) geo.aerialPerspectiveStrength = opt.aerialPerspectiveStrength;
    if (defined(opt.nightGlowIntensity)) geo._customDarkParam.y = opt.nightGlowIntensity;
    // toneMappingMode 的 setter 会触发管线重建，放在最后
    if (defined(opt.cloud)) {
      const c = opt.cloud;
      if ("hazeCloudAttached" in c) {
        geo.cloudMaterialPass.hazeCloudAttached = c.hazeCloudAttached;
        cloudHistoryChanged = true;
      }
      if ("altitudeFadeRange" in c) {
        geo.cloudAltitudeFadeRange = c.altitudeFadeRange?.slice() ?? null;
        cloudHistoryChanged = true;
      }
      if ("layerTypes" in c) {
        const types = c.layerTypes?.map(type => CLOUD_LAYER_TYPES.indexOf(type) + 1) ?? [0, 0, 0];
        geo.cloudMaterialPass.layerTypes = new Cartesian4(types[0], types[1], types[2], 0);
        cloudHistoryChanged = true;
      }
      if ("lodRange" in c) {
        geo.cloudMaterialPass.lodRange = toCartesian2(c.lodRange ?? [0, 0]);
        cloudHistoryChanged = true;
      }
      if (defined(c.hazeQuality)) {
        const [samples, shadowSamples] = HAZE_QUALITY_SAMPLES[c.hazeQuality];
        geo.cloudMaterialPass.hazeSampleCount = samples;
        geo.cloudMaterialPass.hazeShadowSampleCount = shadowSamples;
        cloudHistoryChanged = true;
      }
      if (defined(c.hazeHeightFalloff)) {
        geo.cloudMaterialPass.hazeExponent = 1 / c.hazeHeightFalloff;
        cloudHistoryChanged = true;
      }
      if (defined(c.hazeAnisotropy)) {
        geo.cloudMaterialPass.hazeAnisotropy = c.hazeAnisotropy;
        cloudHistoryChanged = true;
      }
      if (defined(c.altitudes)) {
        geo.cloudMaterialPass.altitudes = toCartesian4(c.altitudes);
        cloudHistoryChanged = true;
      }
      if (defined(c.heights)) {
        geo.cloudMaterialPass.heights = toCartesian4(c.heights);
        cloudHistoryChanged = true;
      }
      if (defined(c.densityScales)) {
        geo.cloudMaterialPass.densityScales = toCartesian4(c.densityScales);
        cloudHistoryChanged = true;
      }
      if (defined(c.shapeDetailAmounts)) {
        geo.cloudMaterialPass.shapeDetailAmounts = toCartesian4(c.shapeDetailAmounts);
        cloudHistoryChanged = true;
      }
      if (defined(c.denoise)) {
        for (const key of Object.keys(DEFAULT_OPTIONS.cloud.denoise)) {
          if (defined(c.denoise[key])) geo.cloudMaterialPass[`_${key}`] = c.denoise[key];
        }
      }
      if (defined(c.hazeSunColor)) {
        Cartesian3.fromArray(c.hazeSunColor, 0, geo.cloudMaterialPass.hazeSunColor);
        cloudHistoryChanged = true;
      }
      for (const key of ["skyIrradianceScale", "groundIrradianceScale", "hazeDensityScale", "hazeGroundDensityScale", "maxShadowLengthRayDistance", "hazeViewDistance", "hazeVolumeLength", "hazeDirectLightScale"]) {
        if (defined(c[key])) {
          geo.cloudMaterialPass[key] = c[key];
          cloudHistoryChanged = true;
        }
      }
    }
    if (cloudHistoryChanged) geo.cloudMaterialPass.invalidateHistory();
    if (defined(opt.volumetricLight)) geo.setVolumetricLightOptions(this._options.volumetricLight);
    if ("rain" in opt) geo.showRain = opt.rain;
    if ("snow" in opt) geo.showSnow = opt.snow;
    if (defined(opt.toneMappingMode)) geo.toneMappingMode = opt.toneMappingMode;
    if (defined(opt.hbao)) {
      if (isPlainObject(opt.hbao)) {
        for (const key of ["intensity", "maxRadius", "bias", "frustumLength", "blackPoint", "whitePoint", "gamma"]) {
          if (defined(opt.hbao[key])) this._hbao[`_${key}`] = opt.hbao[key];
        }
      }
    }
    if (opt.smaa && !this._smaa) {
      this._smaa = new SMAAStage(this._scene, { show: true });
      this._scene.postProcessStages.add(this._smaa.stage);
      this._subscribeSmaaAssets();
    }
    if ("hbao" in opt || "smaa" in opt || "enabled" in opt) this._applyEnabled();
  }

  /** Keep configured switches distinct from their effective, master-gated state. */
  _applyEnabled() {
    const enabled = this._options.enabled;
    if (this._geo) this._geo.enabled = enabled;
    if (this._hbao) this._hbao.enabled = enabled && this._options.hbao.enabled;
    if (this._smaa) this._smaa.enabled = enabled && this._options.smaa;
  }

  _assertMutable() {
    if (this._disposed) throw new Error("[SkyAtmos] 实例已销毁，请重新创建。");
    if (this._runtimeError) throw this._runtimeError;
    const sceneError = getSceneSupportError(this._scene);
    if (sceneError) throw new Error(`[SkyAtmos] ${sceneError} 请在支持的场景中更新。`);
  }

  /** 返回最近接受的完整配置副本。 */
  getOptions() {
    return cloneOptions(this._options);
  }

  _assetState() {
    if (this._disposed) return Object.freeze({ status: "disposed", errors: Object.freeze([]) });
    const states = [this._geo.getAssetState({ includeSnow: this._options.snow })];
    if (this._options.smaa && this._smaa) states.push(this._smaa.getAssetState());
    const status = states.some(state => state.status === "loading") ? "loading"
      : states.some(state => state.status === "error") ? "error"
        : states.some(state => state.status === "idle") ? "idle" : "ready";
    return Object.freeze({ status, errors: Object.freeze(states.flatMap(state => state.errors)) });
  }

  /** 无副作用地查询当前配置所需资源状态。 */
  getAssetState() {
    return this._assetState();
  }

  _captureAssets({ start = false, retry = false } = {}) {
    if (this._disposed) return Promise.reject(Object.assign(new Error("[SkyAtmos] 实例已销毁。"), { name: "AbortError" }));
    this._assertMutable();
    const jobs = [this._geo.captureAssets({
      start,
      retry,
      includeSnow: this._options.snow,
    })];
    if (this._options.smaa) {
      if (!this._smaa) {
        this._smaa = new SMAAStage(this._scene, { show: this._options.enabled });
        this._scene.postProcessStages.add(this._smaa.stage);
        this._subscribeSmaaAssets();
      }
      jobs.push(this._smaa.captureAssets({ start, retry }));
    }
    return Promise.all(jobs).then(states => {
      if (this._disposed) throw Object.assign(new Error("[SkyAtmos] 实例已销毁。"), { name: "AbortError" });
      const status = states.some(state => state.status === "error") ? "error"
        : states.every(state => state.status === "ready") ? "ready" : "idle";
      if (status === "error") throw new AggregateError(
        states.flatMap(state => state.errors),
        "[SkyAtmos] 当前配置所需资源加载失败。",
      );
    });
  }

  /** 启动并等待当前配置所需资源。 */
  loadAssets() {
    return this._captureAssets({ start: true });
  }

  /** 重试当前配置所需资源的失败项。 */
  retryAssets() {
    // Newly enabled feature scopes may still be idle, so leave them in this run.
    return this._captureAssets({ start: true, retry: true });
  }

  /** 订阅资源状态变化，并返回取消订阅函数。 */
  subscribeAssets(listener) {
    if (typeof listener !== "function") throw new Error("[SkyAtmos] 资源监听器必须是函数。");
    if (this._disposed) return () => {};
    const subscription = {
      notify: () => listener(this._assetState()),
      unsubscribeGeo: undefined,
      unsubscribeSmaa: undefined,
    };
    subscription.unsubscribeGeo = this._geo.subscribeAssets(subscription.notify);
    if (this._smaa) subscription.unsubscribeSmaa = this._smaa.subscribeAssets(subscription.notify);
    this._assetSubscriptions.add(subscription);
    return () => {
      if (!this._assetSubscriptions.delete(subscription)) return;
      subscription.unsubscribeGeo();
      subscription.unsubscribeSmaa?.();
    };
  }

  _subscribeSmaaAssets() {
    for (const subscription of this._assetSubscriptions) {
      subscription.unsubscribeSmaa ??= this._smaa.subscribeAssets(subscription.notify);
    }
  }

  /** 官方后处理 Composite（已加入 scene.postProcessStages） */
  get stage() {
    return this._geo ? this._geo.stage : undefined;
  }

  /** 批量更新参数（同构造时 options，部分字段即可） */
  update(options = {}) {
    this._updateOptions(options);
  }

  /** All public commands are normalized and validated before saving or applying any field. */
  _updateOptions(input) {
    this._assertMutable();
    const { options, time } = prepareOptions(input);
    const hbaoOptions = isPlainObject(options.hbao) ? mergeOptions(this._hbaoOptions, options.hbao) : this._hbaoOptions;
    if (hbaoOptions.denoise !== this._hbaoOptions.denoise) {
      throw new Error("[SkyAtmos] hbao.denoise 仅支持构造时配置，请 dispose() 后重建实例。");
    }
    const previousApplySceneSettings = this._options.applySceneSettings;
    const nextOptions = mergeOptions(this._options, options);
    if ("hbao" in options) nextOptions.hbao = cloneOptions(hbaoOptions);
    if ("time" in options) nextOptions.time = time ? options.time : null;
    this._options = nextOptions;
    this._hbaoOptions = cloneOptions(hbaoOptions);
    if (nextOptions.applySceneSettings) {
      const sceneFields = previousApplySceneSettings ? options : {
        highDynamicRange: nextOptions.highDynamicRange,
        logarithmicDepthBuffer: nextOptions.logarithmicDepthBuffer,
        gamma: nextOptions.gamma,
      };
      if (defined(sceneFields.highDynamicRange)) this._scene.highDynamicRange = !!sceneFields.highDynamicRange;
      if (defined(sceneFields.logarithmicDepthBuffer)) this._scene.logarithmicDepthBuffer = !!sceneFields.logarithmicDepthBuffer;
      if (defined(sceneFields.gamma)) this._scene.gamma = sceneFields.gamma;
      if (!previousApplySceneSettings) this._scene.globe.depthTestAgainstTerrain = true;
    }
    if (defined(time) && defined(this._viewer?.clock)) this._viewer.clock.currentTime = time;
    this._applyPreset(options);
  }

  /** 释放：移除每帧驱动、从后处理集合移除并销毁。 */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    const errors = [];
    const cleanup = (callback) => { try { callback(); } catch (error) { errors.push(error); } };
    if (defined(this._removePreRender)) cleanup(() => this._removePreRender());
    this._removePreRender = undefined;
    const pps = this._scene.postProcessStages;
    if (this._geo) cleanup(() => this._geo.restoreScene());
    const removeStage = (pass) => {
      if (!defined(pass)) return;
      const stage = pass.stage;
      cleanup(() => {
        if (defined(stage) && defined(pps) && typeof pps.contains === "function" && pps.contains(stage)) {
          pps.remove(stage); // remove() 内部会 destroy
        }
      });
      // 集合只销毁 stage；包装器还持有 SMAA 等离屏资源。
      if (typeof pass.isDestroyed === "function" && !pass.isDestroyed()) {
        cleanup(() => pass.destroy());
      }
    };
    cleanup(() => removeStage(this._geo));
    cleanup(() => removeStage(this._hbao));
    cleanup(() => removeStage(this._smaa));
    for (const subscription of this._assetSubscriptions) {
      cleanup(subscription.unsubscribeGeo);
      if (subscription.unsubscribeSmaa) cleanup(subscription.unsubscribeSmaa);
    }
    this._assetSubscriptions.clear();
    this._geo = undefined;
    this._hbao = undefined;
    this._smaa = undefined;
    if (globalThis[ACTIVE_INSTANCE] === this) delete globalThis[ACTIVE_INSTANCE];
    if (errors.length) throw new AggregateError(errors, "[SkyAtmos] 部分资源释放失败。");
  }
}
