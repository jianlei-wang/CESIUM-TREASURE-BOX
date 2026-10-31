import {
    BoundingRectangle,
    Cartesian2,
    Cartesian3,
    Framebuffer,
    Matrix4,
    PassState,
    PixelDatatype,
    PixelFormat,
    RenderState,
    Sampler,
    ShaderSource,
    Texture,
    TextureMagnificationFilter,
    TextureMinificationFilter,
    destroyObject,
} from "cesium";
import vertexShader from "../shaders/geospatial/volumetricLight.vert.glsl?raw";
import fragmentShader from "../shaders/geospatial/volumetricLight.frag.glsl?raw";
import resolveShader from "../shaders/geospatial/volumetricLightResolve.frag.glsl?raw";
import compositeShader from "../shaders/geospatial/volumetricLightComposite.glsl?raw";
import { volumetricLightSunlightGLSL } from "./FocusedCloudShadowPass.js";

export const volumetricLightCompositeGLSL = compositeShader;

const qualitySettings = Object.freeze({
    low: { scale: 0.25, steps: 24 },
    balanced: { scale: 0.5, steps: 48 },
    high: { scale: 0.5, steps: 64 },
});

const defaultOptions = Object.freeze({
    mode: "off",
    density: 8e-6,
    intensity: 2,
    layerDepth: 2400,
    maxDistance: 16000,
    anisotropy: 0.55,
    quality: "balanced",
});

function finiteOption(value, fallback, minimum = 0, maximum = Infinity) {
    return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

/** Independent, terrain-clipped single-scattering fog and its own temporal history. */
export default class VolumetricLightPass {
    constructor(scene, { pipeline, shadowPass } = {}) {
        this._scene = scene;
        this.pipeline = pipeline;
        this.shadowPass = shadowPass;
        this.options = { ...defaultOptions };
        this._inverseProjection = new Matrix4();
        this._previousViewProjection = new Matrix4();
        this._currentViewProjection = new Matrix4();
        this._previousProjection = new Matrix4();
        this._center = new Cartesian3();
        this._sunDirection = new Cartesian3();
        this._previousSunDirection = new Cartesian3();
        this._previousCameraPosition = new Cartesian3();
        this._previousCameraDirection = new Cartesian3();
        this._previousCameraUp = new Cartesian3();
        this._texelSize = new Cartesian2(1, 1);
        this._historyTextures = [];
        this._historyValid = false;
        this._rendered = false;
        this._historyIndex = 0;
        this._frame = 0;
        this._temporalAlpha = 1;
        this._layerBottom = 0;
        this._layerTop = 0;
        this._byteLength = 0;
        const fallback = () => scene.context.defaultTexture;
        this.uniformMap = {
            u_volumetricLightBefore: () => this.beforeColorTexture ?? fallback(),
            u_volumetricLightAfter: () => this.afterColorTexture ?? fallback(),
            u_volumetricLightDepth: () => this.depthTexture ?? fallback(),
            u_volumetricLightEnabled: () => this.ready,
            u_volumetricLightMaxDistance: () => this.options.maxDistance,
            u_volumetricLightSceneDepth: () => this._sceneDepth ?? fallback(),
            u_volumetricLightCloudDepth: () => pipeline.cloudMaterialPass._cloudResolveDepthHistoryBuffer ?? fallback(),
            u_volumetricLightInverseProjection: () => this._inverseProjection,
            u_volumetricLightInverseView: () => scene.context.uniformState.inverseView,
            u_volumetricLightInverseEllipsoid: () => pipeline._inverseEllipsoidMatrix,
            u_volumetricLightCamera: () => scene.camera.positionWC,
            u_volumetricLightCenter: () => this._center,
            u_volumetricLightBottomRadius: () => pipeline.atmosphere.bottomRadius,
            u_volumetricLightLayerBottom: () => this._layerBottom,
            u_volumetricLightLayerTop: () => this._layerTop,
        };
        this._renderUniformMap = {
            ...shadowPass.uniformMap,
            ...this.uniformMap,
            u_volumetricLightInverseProjection: () => this._inverseProjection,
            u_volumetricLightInverseView: () => scene.context.uniformState.inverseView,
            u_volumetricLightInverseEllipsoid: () => pipeline._inverseEllipsoidMatrix,
            u_volumetricLightEllipsoid: () => pipeline.ellipsoidMatrix,
            u_volumetricLightCamera: () => scene.camera.positionWC,
            u_volumetricLightCenter: () => this._center,
            u_volumetricLightBottomRadius: () => pipeline.atmosphere.bottomRadius,
            u_volumetricLightTopRadius: () => pipeline.atmosphere.topRadius,
            u_volumetricLightAtmosphereTransmittance: () => pipeline._u_transmittance_texture ?? fallback(),
            u_volumetricLightCloudColor: () => pipeline.cloudMaterialPass._colorResolveHistoryBuffer ?? fallback(),
            u_volumetricLightCloudVisibility: () => pipeline.cloudVisibility,
            u_volumetricLightLayerBottom: () => this._layerBottom,
            u_volumetricLightLayerTop: () => this._layerTop,
            u_volumetricLightDensity: () => this.options.density,
            u_volumetricLightIntensity: () => this.options.intensity,
            u_volumetricLightAnisotropy: () => this.options.anisotropy,
            u_volumetricLightSunAngularRadius: () => pipeline.atmosphere.sunAngularRadius,
            u_volumetricLightSolarIrradiance: () => pipeline.atmosphere.solarIrradiance,
            u_volumetricLightSunRadianceToRelativeLuminance: () => pipeline.atmosphere.sunRadianceToRelativeLuminance,
            u_volumetricLightSunDirection: () => this._sunDirection,
            u_volumetricLightStepCount: () => qualitySettings[this.options.quality].steps,
            u_volumetricLightFrame: () => this._frame,
            u_volumetricLightCurrentBefore: () => this._current.before,
            u_volumetricLightCurrentAfter: () => this._current.after,
            u_volumetricLightCurrentDepth: () => this._current.depth,
            u_volumetricLightHistoryBefore: () => this._history[this._historyIndex].before,
            u_volumetricLightHistoryAfter: () => this._history[this._historyIndex].after,
            u_volumetricLightHistoryDepth: () => this._history[this._historyIndex].depth,
            u_volumetricLightHistoryValid: () => this._historyValid,
            u_volumetricLightPreviousViewProjection: () => this._previousViewProjection,
            u_volumetricLightPreviousCamera: () => this._previousCameraPosition,
            u_volumetricLightTexelSize: () => this._texelSize,
            u_volumetricLightTemporalAlpha: () => this._temporalAlpha,
        };
    }

    get ready() {
        return this.options.mode === "volumetric" && this._rendered && this.shadowPass.ready;
    }

    get beforeColorTexture() {
        return this._history?.[this._historyIndex].before;
    }

    get afterColorTexture() {
        return this._history?.[this._historyIndex].after;
    }

    get depthTexture() {
        return this._history?.[this._historyIndex].depth;
    }

    get byteLength() {
        return this._byteLength;
    }

    setOptions(options = {}) {
        const previous = this.options;
        const next = {
            mode: ["volumetric", "legacy", "off"].includes(options.mode) ? options.mode : previous.mode,
            quality: Object.hasOwn(qualitySettings, options.quality) ? options.quality : previous.quality,
            density: finiteOption(options.density, previous.density),
            intensity: finiteOption(options.intensity, previous.intensity),
            layerDepth: finiteOption(options.layerDepth, previous.layerDepth, Number.MIN_VALUE),
            maxDistance: finiteOption(options.maxDistance, previous.maxDistance, Number.MIN_VALUE),
            anisotropy: finiteOption(options.anisotropy, previous.anisotropy, 0, 0.9),
        };
        if (Object.keys(next).some((key) => next[key] !== previous[key])) this.invalidateHistory();
        this.options = next;
        if (next.quality !== previous.quality || next.mode !== "volumetric") this._releaseRenderTargets();
        if (next.mode !== "volumetric") this._destroyCommands();
    }

    invalidateHistory() {
        this._historyValid = false;
        this._rendered = false;
    }

    _createTarget(context, width, height) {
        const sampler = new Sampler({
            minificationFilter: TextureMinificationFilter.NEAREST,
            magnificationFilter: TextureMagnificationFilter.NEAREST,
        });
        const createTexture = (pixelDatatype) => new Texture({
            context,
            width,
            height,
            pixelFormat: PixelFormat.RGBA,
            pixelDatatype,
            sampler,
            flipY: false,
        });
        const target = {
            before: createTexture(PixelDatatype.HALF_FLOAT),
            after: createTexture(PixelDatatype.HALF_FLOAT),
            // Preserve kilometre-scale centroid and terrain/cloud distances.
            depth: createTexture(PixelDatatype.FLOAT),
        };
        target.passState = new PassState(context);
        target.passState.viewport = new BoundingRectangle(0, 0, width, height);
        target.passState.framebuffer = new Framebuffer({
            context,
            colorTextures: [target.before, target.after, target.depth],
            destroyAttachments: false,
        });
        return target;
    }

    _ensureResources(context) {
        const scale = qualitySettings[this.options.quality].scale;
        const width = Math.max(1, Math.ceil(this._scene.drawingBufferWidth * scale));
        const height = Math.max(1, Math.ceil(this._scene.drawingBufferHeight * scale));
        if (!this._current || this._width !== width || this._height !== height ||
            this._fullWidth !== this._scene.drawingBufferWidth || this._fullHeight !== this._scene.drawingBufferHeight) {
            this._releaseRenderTargets();
            this._width = width;
            this._height = height;
            this._fullWidth = this._scene.drawingBufferWidth;
            this._fullHeight = this._scene.drawingBufferHeight;
            this._texelSize.x = 1 / width;
            this._texelSize.y = 1 / height;
            this._current = this._createTarget(context, width, height);
            this._history = [this._createTarget(context, width, height), this._createTarget(context, width, height)];
            this._historyIndex = 0;
            // Two RGBA16F integrals and one RGBA32F depth target, in three sets.
            this._byteLength = width * height * 32 * 3;
        }
        if (!this._drawCommand) {
            const renderState = RenderState.fromCache({ depthTest: { enabled: false }, depthMask: false });
            this._drawCommand = context.createViewportQuadCommand(new ShaderSource({
                defines: ["LOG_DEPTH"],
                sources: [fragmentShader.replace("/*__VOLUMETRIC_LIGHT_SUNLIGHT__*/", volumetricLightSunlightGLSL)],
            }), { uniformMap: this._renderUniformMap, renderState }, vertexShader);
            this._resolveCommand = context.createViewportQuadCommand(new ShaderSource({
                defines: ["LOG_DEPTH"],
                sources: [resolveShader],
            }), { uniformMap: this._renderUniformMap, renderState }, vertexShader);
        }
    }

    _updateEnvelope() {
        const clouds = this.pipeline.cloudMaterialPass;
        let lowestBase = Infinity;
        for (const axis of ["x", "y", "z", "w"]) {
            if (clouds.shadowLayerMask[axis] <= 0 || clouds.densityScales[axis] <= 0 ||
                clouds.maxLayerHeights[axis] <= clouds.minLayerHeights[axis]) continue;
            lowestBase = Math.min(lowestBase, clouds.minLayerHeights[axis]);
        }
        if (!Number.isFinite(lowestBase)) return false;
        const bottom = Math.max(0, lowestBase - this.options.layerDepth);
        if (lowestBase !== this._layerTop || bottom !== this._layerBottom) this.invalidateHistory();
        this._layerTop = lowestBase;
        this._layerBottom = bottom;
        return true;
    }

    _prepareHistory(context) {
        const camera = this._scene.camera;
        const projection = context.uniformState.projection;
        const sunDirection = context.uniformState.sunDirectionWC;
        const correction = this.pipeline.shadowMaterialPass._altitudeCorrection ?? Cartesian3.ZERO;
        Cartesian3.add(this.pipeline._ellipsoidCenter, correction, this._center);
        Matrix4.multiplyByPointAsVector(this.pipeline._inverseEllipsoidMatrix, sunDirection, this._sunDirection);
        Cartesian3.normalize(this._sunDirection, this._sunDirection);
        const textures = [
            this.pipeline.localWeatherTexture,
            this.pipeline.shapeTexture,
            this.pipeline.shapeDetailTexture,
            this.pipeline._u_transmittance_texture,
        ];
        const shadowGeneration = this.shadowPass.historyGeneration;
        if (textures.some((texture, index) => texture !== this._historyTextures[index]) ||
            shadowGeneration !== this._shadowGeneration) {
            this.invalidateHistory();
            this._historyTextures = textures;
            this._shadowGeneration = shadowGeneration;
        }
        const distance = Cartesian3.distance(camera.positionWC, this._previousCameraPosition);
        const directionDot = Cartesian3.dot(camera.directionWC, this._previousCameraDirection);
        const upDot = Cartesian3.dot(camera.upWC, this._previousCameraUp);
        if (this._historyValid && (
            this._previousSceneMode !== this._scene.mode ||
            !Matrix4.equalsEpsilon(projection, this._previousProjection, 1e-6) ||
            distance > 1000 || directionDot < 0.97 || upDot < 0.97 ||
            Cartesian3.dot(sunDirection, this._previousSunDirection) < 0.999999
        )) this.invalidateHistory();
        const moving = distance > 0.1 || directionDot < 0.9999999 || upDot < 0.9999999;
        this._temporalAlpha = moving ? 0.4 : 0.16;
        Matrix4.inverse(projection, this._inverseProjection);
        Matrix4.multiply(projection, context.uniformState.view, this._currentViewProjection);
    }

    execute(context, colorTexture, depthTexture, idTexture) {
        if (this.options.mode !== "volumetric") return;
        if (!this.shadowPass.ready || !this.pipeline._u_transmittance_texture || !depthTexture || !this._updateEnvelope()) {
            this.invalidateHistory();
            return;
        }
        this._sceneDepth = depthTexture;
        this._ensureResources(context);
        this._prepareHistory(context);
        this._drawCommand.execute(context, this._current.passState);
        const nextIndex = 1 - this._historyIndex;
        this._resolveCommand.execute(context, this._history[nextIndex].passState);
        this._historyIndex = nextIndex;
        const camera = this._scene.camera;
        Matrix4.clone(this._currentViewProjection, this._previousViewProjection);
        Matrix4.clone(context.uniformState.projection, this._previousProjection);
        Cartesian3.clone(camera.positionWC, this._previousCameraPosition);
        Cartesian3.clone(camera.directionWC, this._previousCameraDirection);
        Cartesian3.clone(camera.upWC, this._previousCameraUp);
        Cartesian3.clone(context.uniformState.sunDirectionWC, this._previousSunDirection);
        this._previousSceneMode = this._scene.mode;
        this._historyValid = true;
        this._rendered = true;
        this._frame = (this._frame + 1) % 1024;
    }

    _releaseRenderTargets() {
        this.invalidateHistory();
        for (const target of [this._current, ...(this._history ?? [])]) {
            if (!target) continue;
            target.passState.framebuffer.destroy();
            target.before.destroy();
            target.after.destroy();
            target.depth.destroy();
        }
        this._current = undefined;
        this._history = undefined;
        this._byteLength = 0;
    }

    _destroyCommands() {
        for (const command of [this._drawCommand, this._resolveCommand]) command?.shaderProgram?.destroy();
        this._drawCommand = undefined;
        this._resolveCommand = undefined;
    }

    destroy() {
        this._releaseRenderTargets();
        this._destroyCommands();
        return destroyObject(this);
    }

    isDestroyed() {
        return false;
    }
}
