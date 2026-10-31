// AUTO-GENERATED from Filmic.glsl by scripts/build-helper-shaders.mjs
/* eslint-disable */
export default "// a filmic roll-off (ACES, Narkowicz's fit) for the effects that add light to the picture: Cesium\n// has already tone mapped it, so their light would clip to flat white without it\nvec3 filmic(vec3 x) {\n  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);\n}\n"
