import downsamplingMaterialVertexShaderSource from "../shaders/geospatial/downsamplingMaterial.vert.glsl?raw";
import downsamplingMaterialFragmentShaderSource from "../shaders/geospatial/downsamplingMaterial.frag.glsl?raw";
import { 
    PixelDatatype, PostProcessStageComposite, PostProcessStageSampleMode
 } from "cesium";
import RenderPass from "../PostProcessStage.js";

const vs = downsamplingMaterialVertexShaderSource;

const fs = downsamplingMaterialFragmentShaderSource;

export function downsamplingMaterial(index, inputBuffer, textureScale, texelSize, isComposite) {
    const uniforms = {
        texelSize: () => {
            return texelSize
        },
    }
    if (index === 1) {
        uniforms.inputBuffer = function () {
            return inputBuffer;
        }
    } else {
        uniforms.inputBuffer = inputBuffer.name;
    }
    const downsamplingMaterial = new RenderPass({
        name: `czm_downsamplingMaterial` + index,
        fragmentShader: fs,
        vertexShader: vs,
        uniforms: uniforms,
        pixelDatatype: PixelDatatype.HALF_FLOAT,
        textureScale: textureScale,
        sampleMode: PostProcessStageSampleMode.LINEAR
    })
    if (!isComposite) {
        return downsamplingMaterial;
    }
    const downsamplingMaterialComposite = new PostProcessStageComposite({
        name: downsamplingMaterial.name + "_" + inputBuffer.name,
        inputPreviousStageTexture: false,
        stages: [inputBuffer, downsamplingMaterial]
    });

    return downsamplingMaterialComposite;
}

export default {};