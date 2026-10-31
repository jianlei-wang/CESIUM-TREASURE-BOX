// The track as a trail: behind the marker a light core in a glow of the color, ahead a
// thin white line on a faint dark edge. st.s runs along the whole line, st.t across it.
uniform vec4 color;
// the marker's fraction of the line's length
uniform float progress;
// the line's width, pixels
uniform float width;

const vec3 AHEAD = vec3(1.0);
const vec3 EDGE = vec3(0.04, 0.08, 0.12);

czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material material = czm_getDefaultMaterial(materialInput);
  // 0 on the center line, 1 on the edge of the geometry's width
  float d = abs(materialInput.st.t - 0.5) * 2.0;
  // the width is measured level, off a vertical plane through the line: a slope seen
  // from low down stretches it over many pixels, up to the height of a wall. The
  // across coordinate's change per pixel tells the distance on screen instead
  vec2 dt = vec2(dFdx(materialInput.st.t), dFdy(materialInput.st.t));
  d = max(d, abs(materialInput.st.t - 0.5) / max(length(dt) * 0.5 * width * czm_pixelRatio, 1e-6));
  vec4 fragColor;
  if (materialInput.st.s <= progress) {
    float core = 1.0 - smoothstep(0.14, 0.24, d);
    float glow = 0.8 * (1.0 - smoothstep(0.2, 1.0, d));
    fragColor = vec4(mix(color.rgb, mix(color.rgb, vec3(1.0), 0.45), core), max(core, glow) * color.a);
  } else {
    float line = 1.0 - smoothstep(0.1, 0.16, d);
    float edge = 1.0 - smoothstep(0.16, 0.26, d);
    fragColor = vec4(mix(EDGE, AHEAD, line), max(0.85 * line, 0.35 * edge));
  }
  fragColor = czm_gammaCorrect(fragColor);
  material.emission = fragColor.rgb;
  material.alpha = fragColor.a;
  return material;
}
