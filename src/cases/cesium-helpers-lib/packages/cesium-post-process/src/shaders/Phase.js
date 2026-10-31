// AUTO-GENERATED from Phase.glsl by scripts/build-helper-shaders.mjs
/* eslint-disable */
export default "// Henyey-Greenstein's phase function, normalized: 1 / (4 pi) for light scattered alike in all\n// directions, which the haze and the clouds share.\nfloat henyeyGreenstein(float cosTheta, float g) {\n  float g2 = g * g;\n  return (1.0 - g2) / (4.0 * czm_pi * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));\n}\n"
