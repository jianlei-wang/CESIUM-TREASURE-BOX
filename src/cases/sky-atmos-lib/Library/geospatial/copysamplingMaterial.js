import copysamplingMaterialVertexShaderSource from "../shaders/geospatial/copysamplingMaterial.vert.glsl?raw";
import copysamplingMaterialFragmentShaderSource from "../shaders/geospatial/copysamplingMaterial.frag.glsl?raw";
import { 
    PixelDatatype, PostProcessStageComposite, PostProcessStageSampleMode
 } from "cesium";
import RenderPass from "../PostProcessStage.js";
const vs = copysamplingMaterialVertexShaderSource;
const fs = copysamplingMaterialFragmentShaderSource;

export function copysamplingMaterial(index, inputBuffer, textureScale, opacity) {
    const copysamplingMaterial = new RenderPass({
        name: `czm_copysamplingMaterial` + index,
        fragmentShader: fs,
        vertexShader: vs,
        uniforms: {
            inputBuffer: inputBuffer.name,
            opacity: () => {
                return opacity
            },
        },
        pixelDatatype: PixelDatatype.HALF_FLOAT,
        textureScale: textureScale,
        sampleMode: PostProcessStageSampleMode.LINEAR
    })
    const copysamplingMaterialComposite = new PostProcessStageComposite({
        name: copysamplingMaterial.name + "_" + inputBuffer.name,
        inputPreviousStageTexture: false,
        stages: [inputBuffer, copysamplingMaterial]
    });

    return copysamplingMaterialComposite;
}

export default {};