
import {  Box3, Matrix4, Object3D, Vector2, Vector3  } from "three";
function invariant(condition, message = 'Invariant failed') {
    if (!condition) {
        throw new Error(message);
    }
}
export class FrustumCorners {
    near = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
    far = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];

    constructor(camera, far) {
        if (camera !== undefined && far !== undefined) {
            this.setFromCamera(camera, far);
        }
    }

    clone() {
        return new FrustumCorners().copy(this);
    }

    copy(other) {
        for (let i = 0; i < 4; ++i) {
            this.near[i].copy(other.near[i]);
            this.far[i].copy(other.far[i]);
        }
        return this;
    }

    setFromCamera(camera, far) {
        const isOrthographic = camera.isOrthographicCamera === true;
        const inverseProjectionMatrix = camera.projectionMatrixInverse;

        // 3 --- 0
        // |     |
        // 2 --- 1
        this.near[0].set(1, 1, -1);
        this.near[1].set(1, -1, -1);
        this.near[2].set(-1, -1, -1);
        this.near[3].set(-1, 1, -1);
        for (let i = 0; i < 4; ++i) {
            this.near[i].applyMatrix4(inverseProjectionMatrix);
        }

        this.far[0].set(1, 1, 1);
        this.far[1].set(1, -1, 1);
        this.far[2].set(-1, -1, 1);
        this.far[3].set(-1, 1, 1);
        for (let i = 0; i < 4; ++i) {
            const corner = this.far[i];
            corner.applyMatrix4(inverseProjectionMatrix);
            const absZ = Math.abs(corner.z);
            if (isOrthographic) {
                corner.z *= Math.min(far / absZ, 1);
            } else {
                corner.multiplyScalar(Math.min(far / absZ, 1));
            }
        }
        return this;
    }

    split(clipDepths, result = []) {
        for (let index = 0; index < clipDepths.length; ++index) {
            const frustum = (result[index] ??= new FrustumCorners());
            if (index === 0) {
                for (let i = 0; i < 4; ++i) {
                    frustum.near[i].copy(this.near[i]);
                }
            } else {
                for (let i = 0; i < 4; ++i) {
                    frustum.near[i].lerpVectors(
                        this.near[i],
                        this.far[i],
                        clipDepths[index - 1]
                    );
                }
            }
            if (index === clipDepths.length - 1) {
                for (let i = 0; i < 4; ++i) {
                    frustum.far[i].copy(this.far[i]);
                }
            } else {
                for (let i = 0; i < 4; ++i) {
                    frustum.far[i].lerpVectors(
                        this.near[i],
                        this.far[i],
                        clipDepths[index]
                    );
                }
            }
        }
        result.length = clipDepths.length;
        return result;
    }

    applyMatrix4(matrix) {
        for (let i = 0; i < 4; ++i) {
            this.near[i].applyMatrix4(matrix);
            this.far[i].applyMatrix4(matrix);
        }
        return this;
    }
}
function lerp(start, end, alpha) {
    return start + (end - start) * alpha;
}
const modes = {
    uniform(count, near, far, _, result = []) {
        for (let i = 0; i < count; ++i) {
            result[i] = (near + ((far - near) * (i + 1)) / count) / far;
        }
        result.length = count;
        return result;
    },

    logarithmic(count, near, far, _, result = []) {
        for (let i = 0; i < count; ++i) {
            result[i] = (near * Math.pow(far / near, (i + 1) / count)) / far;
        }
        result.length = count;
        return result;
    },

    practical(count, near, far, lambda = 0.5, result = []) {
        for (let i = 0; i < count; ++i) {
            const uniform = (near + ((far - near) * (i + 1)) / count) / far;
            const logarithmic = (near * Math.pow(far / near, (i + 1) / count)) / far;
            result[i] = lerp(uniform, logarithmic, lambda);
        }
        result.length = count;
        return result;
    }
};

export const frustumSplitFunctions = modes;

export function splitFrustum(
    mode,
    count,
    near,
    far,
    lambda,
    result = []
) {
    return modes[mode](count, near, far, lambda, result);
}


const vectorScratch1 = /*#__PURE__*/ new Vector3();
const vectorScratch2 = /*#__PURE__*/ new Vector3();
const matrixScratch1 = /*#__PURE__*/ new Matrix4();
const matrixScratch2 = /*#__PURE__*/ new Matrix4();
const frustumScratch = /*#__PURE__*/ new FrustumCorners();
const boxScratch = /*#__PURE__*/ new Box3();

export const cascadedShadowMapsDefaults = {
    maxFar: null,
    // farScale: 0.25, 
    // splitMode: 'logarithmic',
    farScale: 1,
    splitMode: 'practical',
    splitLambda: 0.5,
    margin: 0,
    fade: true
};

export default class CascadedShadowMaps {
    cascades = [];
    mapSize = new Vector2();
    maxFar = null;
    farScale = 1;
    splitMode = 'logarithmic';//'practical';
    splitLambda = 0.5;
    margin = 0;
    fade = true;

    cameraFrustum = new FrustumCorners();
    frusta = [];
    splits = [];
    _far = 0;

    constructor(options) {
        const {
            cascadeCount,
            mapSize,
            maxFar,
            farScale,
            splitMode,
            splitLambda,
            margin,
            fade
        } = {
            ...cascadedShadowMapsDefaults,
            ...options
        };

        this.cascadeCount = cascadeCount;
        this.mapSize.copy(mapSize);
        this.maxFar = maxFar;
        this.farScale = farScale;
        this.splitMode = splitMode;
        this.splitLambda = splitLambda;
        this.margin = margin;
        this.fade = fade;
    }

    get cascadeCount() {
        return this.cascades.length;
    }

    set cascadeCount(value) {
        if (value !== this.cascades.length) {
            for (let i = 0; i < value; ++i) {
                if (!this.cascades[i]) {
                    this.cascades[i] = {
                        interval: new Vector2(),
                        matrix: new Matrix4(),
                        inverseMatrix: new Matrix4(),
                        projectionMatrix: new Matrix4(),
                        inverseProjectionMatrix: new Matrix4(),
                        viewMatrix: new Matrix4(),
                        inverseViewMatrix: new Matrix4()
                    };
                }
            }
            this.cascades.length = value;
        }
    }

    get far() {
        return this._far;
    }

    updateIntervals(camera) {
        const cascadeCount = this.cascadeCount;
        const splits = this.splits;
        const far = this.far;

        splitFrustum(
            this.splitMode,
            cascadeCount,
            camera.near,
            far,
            this.splitLambda,
            splits
        );

        this.cameraFrustum.setFromCamera(camera, far);
        this.cameraFrustum.split(splits, this.frusta);

        const cascades = this.cascades;
        for (let i = 0; i < cascadeCount; ++i) {
            cascades[i].interval.set(splits[i - 1] ?? 0, splits[i] ?? 0);
        }
    }

    getFrustumRadius(camera, frustum) {
        const nearCorners = frustum.near;
        const farCorners = frustum.far;
        let diagonalLength = Math.max(
            farCorners[0].distanceTo(farCorners[2]),
            farCorners[0].distanceTo(nearCorners[2])
        );

        if (this.fade) {
            const near = camera.near;
            const far = this.far;
            const distance = farCorners[0].z / (far - near);
            diagonalLength += 0.25 * Math.pow(distance, 2) * (far - near);
        }
        return diagonalLength * 0.5;
    }

    updateMatrices(camera, sunDirection, distance = 1) {
        const lightOrientationMatrix = matrixScratch1.lookAt(
            vectorScratch1.setScalar(0),
            vectorScratch2.copy(sunDirection).multiplyScalar(-1),
            Object3D.DEFAULT_UP
        );

        const cameraToLightMatrix = matrixScratch2.multiplyMatrices(
            matrixScratch2.copy(lightOrientationMatrix).invert(),
            camera.matrixWorld
        );

        const frusta = this.frusta;
        const cascades = this.cascades;
        invariant(frusta.length === cascades.length);

        const margin = this.margin;
        const mapSize = this.mapSize;

        for (let i = 0; i < frusta.length; ++i) {
            const frustum = frusta[i];
            const cascade = cascades[i];

            const radius = this.getFrustumRadius(camera, frusta[i]);
            const left = -radius;
            const right = radius;
            const top = radius;
            const bottom = -radius;

            cascade.projectionMatrix.makeOrthographic(
                left,
                right,
                top,
                bottom,
                -margin,
                radius * 2 + margin
            );

            const { near, far } = frustumScratch
                .copy(frustum)
                .applyMatrix4(cameraToLightMatrix);

            const bbox = boxScratch.makeEmpty();
            for (let j = 0; j < 4; j++) {
                bbox.expandByPoint(near[j]);
                bbox.expandByPoint(far[j]);
            }

            const center = bbox.getCenter(vectorScratch1);
            center.z = bbox.max.z + margin;

            const texelWidth = (right - left) / mapSize.width;
            const texelHeight = (top - bottom) / mapSize.height;
            center.x = Math.round(center.x / texelWidth) * texelWidth;
            center.y = Math.round(center.y / texelHeight) * texelHeight;

            center.applyMatrix4(lightOrientationMatrix);
            const position = vectorScratch2
                .copy(sunDirection)
                .multiplyScalar(distance)
                .add(center);

            cascade.inverseViewMatrix
                .lookAt(center, position, Object3D.DEFAULT_UP)
                .setPosition(position);
        }
    }

    update(camera, sunDirection, distance) {
        this._far = this.maxFar != null
            ? Math.min(this.maxFar, camera.far * this.farScale)
            : camera.far * this.farScale;

        this.updateIntervals(camera);
        this.updateMatrices(camera, sunDirection, distance);

        const cascades = this.cascades;
        const cascadeCount = this.cascadeCount;
        for (let i = 0; i < cascadeCount; ++i) {
            const {
                matrix,
                inverseMatrix,
                projectionMatrix,
                inverseProjectionMatrix,
                viewMatrix,
                inverseViewMatrix
            } = cascades[i];

            inverseProjectionMatrix.copy(projectionMatrix).invert();
            viewMatrix.copy(inverseViewMatrix).invert();
            matrix.copy(projectionMatrix).multiply(viewMatrix);
            inverseMatrix.copy(inverseViewMatrix).multiply(inverseProjectionMatrix);
        }
    }
}


export const defaultsPass = {
    resolutionScale: 1,
    lightShafts: true,
    shapeDetail: true,
    turbulence: true,
    haze: true,
    clouds: {
        multiScatteringOctaves: 8,
        accurateSunSkyIrradiance: true,
        accuratePhaseFunction: false,

        // Primary raymarch
        maxIterationCount: 2048,
        minStepSize: 50,
        maxStepSize: 300,
        maxRayDistance: 1e6,
        perspectiveStepScale: 1.004,
        minDensity: 1e-5,
        minExtinction: 1e-5,
        minTransmittance: 1e-2,

        // Secondary raymarch
        maxIterationCountToGround: 3,
        maxIterationCountToSun: 4,
        minSecondaryStepSize: 100,
        secondaryStepScale: 2,

        // Shadow length
        maxShadowLengthIterationCount: 500,
        minShadowLengthStepSize: 50,
        maxShadowLengthRayDistance: 2e5
    },
    shadow: {
        cascadeCount: 3,
        mapSize: /*#__PURE__*/ new Vector2(512, 512),

        // Primary raymarch
        maxIterationCount: 50,
        minStepSize: 100,
        maxStepSize: 1000,
        minDensity: 1e-5,
        minExtinction: 1e-5,
        minTransmittance: 1e-4
    }
} 