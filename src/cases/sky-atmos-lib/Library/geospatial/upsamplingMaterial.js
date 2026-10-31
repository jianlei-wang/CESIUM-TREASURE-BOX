import upsamplingMaterialVertexShaderSource from "../shaders/geospatial/upsamplingMaterial.vert.glsl?raw";
import upsamplingMaterialFragmentShaderSource from "../shaders/geospatial/upsamplingMaterial.frag.glsl?raw";
import { 
    PixelDatatype, PostProcessStageComposite, PostProcessStageSampleMode
 } from "cesium";
import RenderPass from "../PostProcessStage.js";
const vs = upsamplingMaterialVertexShaderSource;

const fs = upsamplingMaterialFragmentShaderSource;

export function upsamplingMaterial(index, inputBuffer, supportBuffer, textureScale, texelSize, radius) {
    const upsamplingMaterial = new RenderPass({
        name: `czm_upsamplingMaterial` + index,
        fragmentShader: fs,
        vertexShader: vs,
        uniforms: {
            inputBuffer: inputBuffer.name,
            supportBuffer: supportBuffer.name,
            texelSize: () => {
                return texelSize
            },
            radius: () => {
                return 0.85;
            }
        },
        pixelDatatype: PixelDatatype.HALF_FLOAT,
        textureScale: textureScale,
        sampleMode: PostProcessStageSampleMode.LINEAR
    })

    const upsamplingMaterialComposite = new PostProcessStageComposite({
        name: upsamplingMaterial.name + "_" + inputBuffer.name + "_" + supportBuffer.name,
        inputPreviousStageTexture: false,
        stages: [inputBuffer, upsamplingMaterial]
    });


    return upsamplingMaterialComposite;
}
export default {};