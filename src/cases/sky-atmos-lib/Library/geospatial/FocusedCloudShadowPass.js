import {
    BoundingRectangle, Cartesian2, Cartesian3, Cartesian4, Framebuffer, Matrix4,
    PassState, PixelDatatype, PixelFormat, RenderState, Sampler, Texture,
    TextureMagnificationFilter, TextureMinificationFilter, destroyObject,
} from "cesium";
import shadowVertexShaderSource from "../shaders/geospatial/shadowMaterial.vert.glsl?raw";
import shadowFragmentShaderSource from "../shaders/geospatial/shadowMaterial.frag.glsl?raw";
import volumetricLightShadowShaderSource from "../shaders/geospatial/volumetricLightShadow.glsl?raw";
import { cloudLayerDensityGLSL } from "./CloudsMaterialPass.js";

export const volumetricLightSunlightGLSL = volumetricLightShadowShaderSource;

const qualitySettings = Object.freeze({
    low: { size: 512, iterations: 32, minStepSize: 50 },
    balanced: { size: 1024, iterations: 48, minStepSize: 32 },
    high: { size: 2048, iterations: 64, minStepSize: 24 },
});

// Share the complete cloud density and Beer shadow integration with the ground
// pass, while keeping its large cascades, history and allocations independent.
function createFocusedFragmentShader() {
    const source = shadowFragmentShaderSource.replace("/*__CLOUD_LAYER_DENSITY__*/", cloudLayerDensityGLSL);
    const uniformStart = source.indexOf("uniform mat4 inverseShadowMatrices");
    const marchStart = source.indexOf("vec4 marchClouds(", uniformStart);
    const marchEnd = source.indexOf("void getRayNearFar(", marchStart);
    if (uniformStart < 0 || marchStart < 0 || marchEnd < 0) {
        throw new Error("Focused cloud shadows require the shared cloud shadow integration.");
    }
    // A long solar step can extinguish the first sample completely. Preserve
    // that first hit when the shared post-attenuation weights underflow to zero.
    const marchSource = source.slice(marchStart, marchEnd)
        .replace("float transmittanceSum = 0.0;", "float transmittanceSum = 0.0;\n    float firstSampleDistance = maxRayDistance;")
        .replace("extinctionSum += media.extinction;", "firstSampleDistance = min(firstSampleDistance, rayDistance);\n                extinctionSum += media.extinction;")
        .replace("float frontDepth = min(weightedDistanceSum / transmittanceSum, maxRayDistance);", `float frontDepth = transmittanceSum > 1e-20
        ? clamp(weightedDistanceSum / transmittanceSum, 0.0, maxRayDistance)
        : clamp(firstSampleDistance, 0.0, maxRayDistance);`);
    return source.slice(0, uniformStart) + `
uniform mat4 focusedInverseShadowMatrix;
uniform int maxIterationCount;
uniform float minStepSize;
uniform float maxStepSize;
uniform float opticalDepthTailScale;
uniform float focusedWorldTexelSize;
in vec2 vUv;
in vec3 vEllipsoidCenter;
layout(location = 0) out vec4 focusedShadow;
` + marchSource + `
void main() {
    vec4 point = focusedInverseShadowMatrix * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
    vec3 sunPosition = mat3(inverseEllipsoidMatrix) * (point.xyz / point.w) - vEllipsoidCenter;
    vec3 rayDirection = normalize(-sunDirection);
    float rayNear;
    float shellExit;
    raySphereIntersections(sunPosition, rayDirection, vec3(0.0),
        bottomRadius + shadowTopHeight, rayNear, shellExit);
    if (shellExit <= 0.0) {
        focusedShadow = vec4(0.0);
        return;
    }
    rayNear = max(0.0, rayNear);
    float bottomHit = raySphereFirstIntersection(sunPosition, rayDirection,
        vec3(0.0), bottomRadius + shadowBottomHeight);
    float rayFar = bottomHit > rayNear ? bottomHit : shellExit;
    vec3 rayOrigin = rayNear * rayDirection + sunPosition;
    // Analytic orthographic footprint remains defined across the shell boundary.
    // Oblique sunlight stretches a texel over the curved cloud shell.
    float shellCosine = max(0.05, abs(dot(normalize(rayOrigin), rayDirection)));
    float shapeFrequency = max(abs(shapeRepeat.x), max(abs(shapeRepeat.y), abs(shapeRepeat.z)));
    shadowTexelsPerPixel = focusedWorldTexelSize * shapeFrequency *
        float(textureSize(shapeTexture, 0).x) / shellCosine;
    focusedShadow = marchClouds(rayOrigin, rayDirection, max(0.0, rayFar - rayNear), 0.5, 0.0);
    // Kilometres and extinction per kilometre keep long solar paths finite in
    // RGBA16F, including low-angle paths beyond its 65,504 metre limit.
    focusedShadow.r *= 0.001;
    focusedShadow.g *= 1000.0;
    focusedShadow = clamp(focusedShadow, vec4(0.0), vec4(65504.0));
}
`;
}

const focusedFragmentShaderSource = createFocusedFragmentShader();

export default class FocusedCloudShadowPass {
    constructor(scene, options = {}) {
        this._scene = scene;
        this.pipeline = options.pipeline;
        this._ready = false;
        this._historyGeneration = 0;
        this._size = 0;
        this._center = new Cartesian3();
        this._texelSize = new Cartesian2(1, 1);
        this._sunDirection = new Cartesian3();
        this._shadowMatrix = new Matrix4();
        this._inverseShadowMatrix = new Matrix4();
        this._inverseProjection = new Matrix4();
        this._lightView = new Matrix4();
        this._lightProjection = new Matrix4();
        this._corners = Array.from({ length: 8 }, () => new Cartesian3());
        this._scratchPoint = new Cartesian4();
        this._scratchWorld = new Cartesian3();
        this._lightRight = new Cartesian3();
        this._lightUp = new Cartesian3();
        this._lightForward = new Cartesian3();
        this._lightSun = new Cartesian3();
        this._lightPosition = new Cartesian3();
        this._receiverCenter = new Cartesian3();
        this._planetCenterWorld = new Cartesian3();
        this._parameterState = [];
        this._textureState = [];
        this._uniforms = this._createTraceUniformMap();
        this._uniformMap = {
            u_volumetricShadowTexture: () => this._texture ?? this._scene.context.defaultTexture,
            u_volumetricShadowMatrix: () => this._shadowMatrix,
            u_volumetricShadowEllipsoidMatrix: () => this.pipeline.ellipsoidMatrix,
            u_volumetricShadowCenter: () => this._center,
            u_volumetricShadowSunDirection: () => this._sunDirection,
            u_volumetricShadowTopRadius: () => this.pipeline.atmosphere.bottomRadius +
                this.pipeline.cloudMaterialPass.shadowTopHeight,
            u_volumetricShadowTexelSize: () => this._texelSize,
            u_volumetricShadowReady: () => this._ready,
            u_volumetricShadowSunAngularRadius: () => this.pipeline.atmosphere.sunAngularRadius,
            u_volumetricShadowWorldTexelSize: () => this.worldTexelSize,
        };
    }

    get ready() { return this._ready; }
    get uniformMap() { return this._uniformMap; }
    get historyGeneration() { return this._historyGeneration; }
    get byteLength() { return this._texture ? this._size * this._size * 8 : 0; }
    get mapSize() { return this._size; }
    get worldTexelSize() { return this._worldTexelSize ?? 0; }

    _createTraceUniformMap() {
        const uniforms = {
            focusedInverseShadowMatrix: () => this._inverseShadowMatrix,
            ellipsoidCenter: () => this._center,
            altitudeCorrection: () => Cartesian3.ZERO,
            ellipsoidMatrix: () => this.pipeline.ellipsoidMatrix,
            inverseEllipsoidMatrix: () => this.pipeline._inverseEllipsoidMatrix,
            bottomRadius: () => this.pipeline.atmosphere.bottomRadius,
            sunDirection: () => this._sunDirection,
            resolution: () => this._resolution,
            frame: () => this.pipeline._frame,
            maxIterationCount: () => this._settings.iterations,
            minStepSize: () => this._settings.minStepSize,
            // Cover the complete spherical cloud interval even near the horizon.
            maxStepSize: () => 100000,
            minDensity: () => 1e-5,
            minExtinction: () => 1e-5,
            minTransmittance: () => 1e-4,
            opticalDepthTailScale: () => 2,
            focusedWorldTexelSize: () => this.worldTexelSize,
            coverage: () => this.pipeline.effectiveCloudCoverage,
            cloudLayerTypes: () => this.pipeline.cloudMaterialPass.layerTypes,
            cloudLodRange: () => this.pipeline.cloudMaterialPass.lodRange,
        };
        for (const name of ["scatteringCoefficient", "absorptionCoefficient", "localWeatherTexture",
            "localWeatherRepeat", "localWeatherOffset", "shapeTexture", "shapeRepeat", "shapeOffset",
            "shapeDetailTexture", "shapeDetailRepeat", "shapeDetailOffset", "turbulenceTexture",
            "turbulenceRepeat", "turbulenceDisplacement", "stbnTexture"]) {
            uniforms[name] = () => this.pipeline[name];
        }
        for (const name of ["minLayerHeights", "maxLayerHeights", "minIntervalHeights", "maxIntervalHeights",
            "densityScales", "shapeAmounts", "shapeDetailAmounts", "weatherExponents", "shapeAlteringBiases",
            "coverageFilterWidths", "minHeight", "maxHeight", "shadowTopHeight", "shadowBottomHeight", "shadowLayerMask"]) {
            uniforms[name] = () => this.pipeline.cloudMaterialPass[name];
        }
        for (const name of ["expTerms", "exponents", "linearTerms", "constantTerms"]) {
            uniforms[`densityProfile.${name}`] = () => this.pipeline.cloudMaterialPass[name];
        }
        return uniforms;
    }

    invalidateHistory() {
        this._ready = false;
        this._historyGeneration++;
    }

    _releaseRenderTargets() {
        if (this._passState?.framebuffer) {
            this._passState.framebuffer.destroy();
            this._passState.framebuffer = undefined;
        }
        if (this._texture) {
            this._texture.destroy();
            this._texture = undefined;
        }
        this._ready = false;
    }

    releaseResources() {
        this._releaseRenderTargets();
        this.invalidateHistory();
    }

    _ensureRenderTarget(context, settings) {
        this._settings = settings;
        if (this._size === settings.size && this._texture) return;
        this._releaseRenderTargets();
        this._size = settings.size;
        this._resolution = new Cartesian2(this._size, this._size);
        this._texelSize.x = this._texelSize.y = 1 / this._size;
        this._texture = new Texture({
            context, width: this._size, height: this._size,
            pixelFormat: PixelFormat.RGBA, pixelDatatype: PixelDatatype.HALF_FLOAT,
            sampler: new Sampler({ minificationFilter: TextureMinificationFilter.LINEAR,
                magnificationFilter: TextureMagnificationFilter.LINEAR }),
            flipY: false,
        });
        this._passState ??= new PassState(context);
        this._passState.viewport = new BoundingRectangle(0, 0, this._size, this._size);
        this._passState.framebuffer = new Framebuffer({
            context, colorTextures: [this._texture], destroyAttachments: false,
        });
        this._command ??= context.createViewportQuadCommand(focusedFragmentShaderSource, {
            uniformMap: this._uniforms,
            renderState: RenderState.fromCache({ depthTest: { enabled: false }, depthMask: false }),
            owner: this,
        }, shadowVertexShaderSource);
        this.invalidateHistory();
    }

    _updateProjection(maxDistance) {
        const camera = this._scene.camera;
        Matrix4.inverse(camera.frustum.projectionMatrix, this._inverseProjection);
        const near = Math.max(0.1, Math.min(camera.frustum.near, maxDistance));
        const receiverCenter = Cartesian3.clone(Cartesian3.ZERO, this._receiverCenter);
        for (let depthIndex = 0; depthIndex < 2; depthIndex++) {
            for (let cornerIndex = 0; cornerIndex < 4; cornerIndex++) {
                const point = this._scratchPoint;
                point.x = cornerIndex & 1 ? 1 : -1;
                point.y = cornerIndex & 2 ? 1 : -1;
                point.z = -1;
                point.w = 1;
                Matrix4.multiplyByVector(this._inverseProjection, point, point);
                const scale = (depthIndex === 0 ? near : maxDistance) / Math.max(1e-6, Math.abs(point.z));
                const corner = this._corners[depthIndex * 4 + cornerIndex];
                corner.x = point.x * scale;
                corner.y = point.y * scale;
                corner.z = point.z * scale;
                Matrix4.multiplyByPoint(camera.inverseViewMatrix, corner, corner);
                Cartesian3.add(receiverCenter, corner, receiverCenter);
            }
        }
        Cartesian3.multiplyByScalar(receiverCenter, 1 / 8, receiverCenter);
        let radius = 0;
        for (const corner of this._corners) radius = Math.max(radius, Cartesian3.distance(receiverCenter, corner));
        // A spherical bound stays the same size while the camera turns. A small
        // guard band covers rounding to world-fixed sunlight texels.
        radius = Math.ceil(radius * 16) / 16;
        radius /= 1 - 4 / this._size;
        const texelSize = 2 * radius / this._size;
        this._worldTexelSize = texelSize;
        Cartesian3.normalize(Matrix4.multiplyByPointAsVector(this.pipeline.ellipsoidMatrix,
            this._sunDirection, this._lightSun), this._lightSun);
        Cartesian3.negate(this._lightSun, this._lightForward);
        const upReference = Math.abs(Cartesian3.dot(this._lightSun, Cartesian3.UNIT_Z)) < 0.98
            ? Cartesian3.UNIT_Z : Cartesian3.UNIT_Y;
        Cartesian3.normalize(Cartesian3.cross(this._lightForward, upReference, this._lightRight), this._lightRight);
        Cartesian3.cross(this._lightRight, this._lightForward, this._lightUp);
        const centerX = Math.round(Cartesian3.dot(receiverCenter, this._lightRight) / texelSize) * texelSize;
        const centerY = Math.round(Cartesian3.dot(receiverCenter, this._lightUp) / texelSize) * texelSize;
        Matrix4.multiplyByPointAsVector(this.pipeline.ellipsoidMatrix, this._center, this._planetCenterWorld);
        const relativeX = centerX - Cartesian3.dot(this._planetCenterWorld, this._lightRight);
        const relativeY = centerY - Cartesian3.dot(this._planetCenterWorld, this._lightUp);
        const minX = Math.max(0, Math.abs(relativeX) - radius);
        const minY = Math.max(0, Math.abs(relativeY) - radius);
        const topRadius = this.pipeline.atmosphere.bottomRadius + this.pipeline.cloudMaterialPass.shadowTopHeight;
        const planeZ = Cartesian3.dot(this._planetCenterWorld, this._lightSun) +
            Math.sqrt(Math.max(0, topRadius * topRadius - minX * minX - minY * minY)) + 100;
        Cartesian3.multiplyByScalar(this._lightRight, centerX, this._lightPosition);
        Cartesian3.add(this._lightPosition, Cartesian3.multiplyByScalar(this._lightUp, centerY, this._scratchWorld), this._lightPosition);
        Cartesian3.add(this._lightPosition, Cartesian3.multiplyByScalar(this._lightSun, planeZ, this._scratchWorld), this._lightPosition);
        Matrix4.computeView(this._lightPosition, this._lightForward, this._lightUp, this._lightRight, this._lightView);
        Matrix4.computeOrthographicOffCenter(-radius, radius, -radius, radius, 0, 2 * topRadius, this._lightProjection);
        Matrix4.multiply(this._lightProjection, this._lightView, this._shadowMatrix);
        Matrix4.inverse(this._shadowMatrix, this._inverseShadowMatrix);
    }

    _updateParameterState(options, maxDistance) {
        const cloud = this.pipeline.cloudMaterialPass;
        const state = [options.quality, maxDistance, options.layerDepth, this.pipeline.effectiveCloudCoverage,
            this.pipeline.scatteringCoefficient, this.pipeline.absorptionCoefficient];
        for (const name of ["altitudes", "heights", "layerTypes", "densityScales", "shapeAmounts",
            "shapeDetailAmounts", "weatherExponents", "shapeAlteringBiases", "coverageFilterWidths", "shadowLayerMask"]) {
            for (const axis of ["x", "y", "z", "w"]) state.push(cloud[name]?.[axis]);
        }
        const textures = [this.pipeline.localWeatherTexture, this.pipeline.shapeTexture, this.pipeline.shapeDetailTexture];
        if (state.some((value, index) => value !== this._parameterState[index]) ||
            textures.some((texture, index) => texture !== this._textureState[index])) {
            this.invalidateHistory();
            this._parameterState = state;
            this._textureState = textures;
        }
    }

    execute(context, options = {}) {
        const cloud = this.pipeline.cloudMaterialPass;
        if (!cloud || !this.pipeline.shapeTexture || this.pipeline.shapeTexture.width <= 1 ||
            !(cloud.shadowTopHeight > cloud.shadowBottomHeight)) {
            this._ready = false;
            return;
        }
        const settings = qualitySettings[options.quality] ?? qualitySettings.balanced;
        const maxDistance = Math.max(1, options.maxDistance ?? 16000);
        this._ensureRenderTarget(context, settings);
        this._updateParameterState(options, maxDistance);
        Cartesian3.add(this.pipeline._ellipsoidCenter,
            this.pipeline.shadowMaterialPass._altitudeCorrection, this._center);
        Cartesian3.normalize(context.uniformState.sunDirectionWC, this._sunDirection);
        this._updateProjection(maxDistance);
        this._command.execute(context, this._passState);
        this._ready = true;
    }

    destroy() {
        this._releaseRenderTargets();
        if (this._command?.shaderProgram) this._command.shaderProgram.destroy();
        this._command = undefined;
        return destroyObject(this);
    }

    isDestroyed() { return false; }
}
