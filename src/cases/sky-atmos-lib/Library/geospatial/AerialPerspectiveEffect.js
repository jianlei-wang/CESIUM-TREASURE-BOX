import aerialPerspectiveEffectFragmentShaderSource from "../shaders/geospatial/AerialPerspectiveEffect.frag.glsl?raw";
import aerialPerspectiveEffectVertexShaderSource from "../shaders/geospatial/AerialPerspectiveEffect.vert.glsl?raw";
// 导出 aerial perspective（大气空气透视 + 天空合成）的顶点/片元着色器字符串。

export const AerialPerspectiveEffectFS = aerialPerspectiveEffectFragmentShaderSource;

export const AerialPerspectiveEffectVS = aerialPerspectiveEffectVertexShaderSource;
