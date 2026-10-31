import applyBloomMaterialVertexShaderSource from "../shaders/geospatial/applyBloomMaterial.vert.glsl?raw";
import applyBloomMaterialFragmentShaderSource from "../shaders/geospatial/applyBloomMaterial.frag.glsl?raw";
import { 
    PixelDatatype, PostProcessStageComposite, PostProcessStageSampleMode
 } from "cesium";
import RenderPass from "../PostProcessStage.js";
const vs = applyBloomMaterialVertexShaderSource;
const fs = applyBloomMaterialFragmentShaderSource;
export function applyBloomMaterial(inputBuffer, e0FeaturesBuffer, that) {
    const applyBloomMaterial = new RenderPass({
        name: `czm_applyBloomMaterial`,
        fragmentShader: fs,
        vertexShader: vs,
        uniforms: {
            inputBuffer: () => {
                return that._aerialPerspectiveOutputColor;
            },
            e0BloomBuffer: inputBuffer.name,
            e0FeaturesBuffer: e0FeaturesBuffer.name,
            e0BlendOpacity: () => {
                return that._bloomBlendOpacity;
            },
            e0Intensity: () => {
                return that._bloomIntensity;
            },
        },
        pixelDatatype: PixelDatatype.HALF_FLOAT,
        sampleMode: PostProcessStageSampleMode.LINEAR
    })
    const applyBloomMaterialComposite = new PostProcessStageComposite({
        name: applyBloomMaterial.name + "_" + e0FeaturesBuffer.name + "_" + inputBuffer.name,
        inputPreviousStageTexture: false,
        stages: [e0FeaturesBuffer, inputBuffer, applyBloomMaterial]
    });

    return applyBloomMaterialComposite;
}

export default {};