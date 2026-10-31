import kawaseBlurMaterialVertexShaderSource from "../shaders/geospatial/kawaseBlurMaterial.vert.glsl?raw";
import kawaseBlurMaterialFragmentShaderSource from "../shaders/geospatial/kawaseBlurMaterial.frag.glsl?raw";
import { 
    PixelDatatype, PostProcessStageComposite, PostProcessStageSampleMode
 } from "cesium";
import RenderPass from "../PostProcessStage.js";

const vs = kawaseBlurMaterialVertexShaderSource;

const fs = kawaseBlurMaterialFragmentShaderSource;

export function kawaseBlurMaterial(index, inputBuffer, textureScale, texelSize, kernel, scale, isComposite) {
    const uniforms = {
        texelSize: () => {
            return texelSize
        },
        kernel: () => {
            return kernel
        },
        scale: () => {
            return scale
        },
    };
    if (index === 0) {
        uniforms.inputBuffer = function () {
            return inputBuffer;
        }
    } else {
        uniforms.inputBuffer = inputBuffer.name;
    }
    const kawaseBlurMaterial = new RenderPass({
        name: `czm_kawaseBlurMaterial` + index,
        fragmentShader: fs,
        vertexShader: vs,
        uniforms: uniforms,
        pixelDatatype: PixelDatatype.HALF_FLOAT,
        textureScale: textureScale,
        sampleMode: PostProcessStageSampleMode.LINEAR
    })
    if (!isComposite) {
        return kawaseBlurMaterial;
    }
    const kawaseBlurMaterialComposite = new PostProcessStageComposite({
        name: kawaseBlurMaterial.name + "_" + inputBuffer.name,
        inputPreviousStageTexture: false,
        stages: [inputBuffer, kawaseBlurMaterial]
    });

    return kawaseBlurMaterialComposite;
}

export default {};