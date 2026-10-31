import { PixelDatatype, WebGLConstants } from "cesium";

// Cesium's renderer internals are intentionally confined to this compatibility boundary.
// Every interception below affects a supplied instance, never an engine/global prototype.
export function getWebGLContext(context) { return context._gl; }
export function getAnisotropicExtension(context) { return context._textureFilterAnisotropic; }
export function getCameraPosition(scene) { return scene.context.uniformState._cameraPosition; }
export function usesLogDepthOptimization(scene) { return scene.postProcessStages._logDepthOptimization; }
export function getStageIndex(stage) { return stage._index; }

export function restoreStageOrder(collection, stage, index) {
    // Official PostProcessStageCollection has no insert operation.
    if (index != null && Array.isArray(collection._stages)) {
        collection._stages[index] = collection._stages.pop();
        stage._index = index;
    }
}

export function bindFramebuffer(framebuffer) { framebuffer._bind(); }
export function unbindFramebuffer(framebuffer) { framebuffer._unBind(); }

export function toWebGL2PixelDatatype(pixelDatatype) {
    // HALF_FLOAT uses the WebGL 1 OES constant in Cesium; 3D/array uploads require WebGL 2.
    return pixelDatatype === PixelDatatype.HALF_FLOAT ? WebGLConstants.HALF_FLOAT : pixelDatatype;
}

const samplerContexts = new WeakMap();
export function adaptArraySamplerProgram(program, context) {
    const gl = getWebGLContext(context);
    if (!samplerContexts.has(gl)) {
        samplerContexts.set(gl, new Proxy(gl, {
            get(target, key) {
                if (key === "getActiveUniform") {
                    return (shader, index) => {
                        const info = target.getActiveUniform(shader, index);
                        return info && info.type === target.SAMPLER_2D_ARRAY
                            ? { name: info.name, size: info.size, type: target.SAMPLER_2D }
                            : info;
                    };
                }
                const value = Reflect.get(target, key, target);
                return typeof value === "function" ? value.bind(target) : value;
            },
        }));
    }
    program._gl = samplerContexts.get(gl);
}

export function installFramebufferCallbacks(framebuffer) {
    if (framebuffer._skyAtmosCallbacksInstalled) return;
    const originalBind = framebuffer._bind;
    framebuffer._bind = function () {
        originalBind.call(this);
        const buffers = this._getActiveColorAttachments();
        if (this.onBindEvent) this.onBindEvent(buffers);
        if (this.onDrawEvent) this.onDrawEvent(buffers);
    };
    framebuffer._skyAtmosCallbacksInstalled = true;
}
