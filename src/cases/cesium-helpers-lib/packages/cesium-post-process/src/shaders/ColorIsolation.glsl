// Color isolation: one hue keeps its color, the rest of the scene turns gray. After prod80's
// ReShade Color Isolation (MIT), https://github.com/prod80/prod80-ReShade-Repository
precision highp sampler2D;
uniform sampler2D colorTexture;
// the hue kept and the half width of the selection, 0 to 1 for the whole circle
uniform float hue;
uniform float range;
// 0 to 1
uniform float strength;
in vec2 v_textureCoordinates;

void main() {
  vec4 sceneColor = texture(colorTexture, v_textureCoordinates);
  vec3 color = clamp(sceneColor.rgb, 0.0, 1.0);
  float gray = czm_luminance(color);
  float h = czm_RGBToHSL(color).x;
  // a triangle around the hue, on the circle
  float r = 1.0 / max(range, 1e-3);
  float weight = max(1.0 - abs((h - hue) * r), 0.0)
    + max(1.0 - abs((h + 1.0 - hue) * r), 0.0)
    + max(1.0 - abs((h - 1.0 - hue) * r), 0.0);
  float w = clamp(weight, 0.0, 1.0);
  float keep = w * w * w * (w * (w * 6.0 - 15.0) + 10.0);
  vec3 isolated = mix(vec3(gray), color, keep);
  out_FragColor = vec4(mix(color, isolated, strength), sceneColor.a);
}
