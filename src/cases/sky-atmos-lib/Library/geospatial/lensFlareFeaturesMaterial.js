import lensFlareFeaturesMaterialVertexShaderSource from "../shaders/geospatial/lensFlareFeaturesMaterial.vert.glsl?raw";
import lensFlareFeaturesMaterialFragmentShaderSource from "../shaders/geospatial/lensFlareFeaturesMaterial.frag.glsl?raw";
import { 
    PixelDatatype, PostProcessStageComposite, PostProcessStageSampleMode
 } from "cesium";
import RenderPass from "../PostProcessStage.js";
const vs = lensFlareFeaturesMaterialVertexShaderSource;
const fs = lensFlareFeaturesMaterialFragmentShaderSource;

export function lensFlareFeaturesMaterial(index, inputBuffer, textureScale, texelSize, that) {
    const lensFlareFeaturesMaterial = new RenderPass({
        name: `czm_lensFlareFeaturesMaterial` + index,
        fragmentShader: fs,
        vertexShader: vs,
        uniforms: {
            inputBuffer: inputBuffer.name,
            texelSize: () => {
                return texelSize
            },
            ghostAmount: () => {
                return that._ghostAmount
            },
            haloAmount: () => {
                return that._haloAmount
            },
            chromaticAberration: () => {
                return that._chromaticAberration
            },
        },
        pixelDatatype: PixelDatatype.HALF_FLOAT,
        textureScale: textureScale,
        sampleMode: PostProcessStageSampleMode.LINEAR
    })
    const lensFlareFeaturesMaterialComposite = new PostProcessStageComposite({
        name: lensFlareFeaturesMaterial.name + "_" + inputBuffer.name,
        inputPreviousStageTexture: false,
        stages: [inputBuffer, lensFlareFeaturesMaterial]
    });

    return lensFlareFeaturesMaterialComposite;
}

export default {};