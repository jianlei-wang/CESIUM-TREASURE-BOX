// HBAO 调制 pass。
// 把 AO 结果按 blackPoint/whitePoint/gamma 调制到场景颜色上。
// 依赖的 readPosition / getTurboColormap 由 HBAOEffectPass 在编译前拼接注入。
import ambientOcclusionModulate from "../shaders/hbao/ambientOcclusionModulate.frag.glsl?raw";

export default ambientOcclusionModulate;
