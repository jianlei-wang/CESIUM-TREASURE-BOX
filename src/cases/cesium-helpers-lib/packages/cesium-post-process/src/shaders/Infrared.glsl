// Black and white infrared film: foliage, which reflects the near infrared, turns bright, the sky
// and water dark. The gray is the lightness raised or lowered by a weight per hue. After prod80's
// ReShade Black & White (MIT), its Infrared preset, https://github.com/prod80/prod80-ReShade-Repository
precision highp sampler2D;
uniform sampler2D colorTexture;
// 0 to 1
uniform float strength;
in vec2 v_textureCoordinates;

// weights of the red, yellow, green, cyan, blue and magenta hues
const float RED = -1.35;
const float YELLOW = 2.35;
const float GREEN = 1.35;
const float CYAN = -1.35;
const float BLUE = -1.6;
const float MAGENTA = -1.07;
// shape of the hue selections
const float CURVE = 1.5;

float curve(float x, float k) {
  float s = sign(x - 0.5);
  float o = 0.5 * (1.0 + s);
  return o - 0.5 * s * pow(max(2.0 * (o - s * x), 0.0), k);
}

// how much of the hue centered at center there is in hue
float hueWeight(float hue, float center) {
  return curve(max(1.0 - abs((hue - center) * 6.0), 0.0), CURVE);
}

void main() {
  vec4 sceneColor = texture(colorTexture, v_textureCoordinates);
  vec3 hsl = czm_RGBToHSL(clamp(sceneColor.rgb, 0.0, 1.0));
  float h = hsl.x;
  float weight = RED * (hueWeight(h, 0.0) + hueWeight(h, 1.0))
    + YELLOW * hueWeight(h, 1.0 / 6.0)
    + GREEN * hueWeight(h, 2.0 / 6.0)
    + CYAN * hueWeight(h, 3.0 / 6.0)
    + BLUE * hueWeight(h, 4.0 / 6.0)
    + MAGENTA * hueWeight(h, 5.0 / 6.0);
  float saturation = hsl.y * (1.0 - hsl.y) + hsl.y;
  float gray = clamp(hsl.z + hsl.z * weight * saturation * (1.0 - hsl.z), 0.0, 1.0);
  out_FragColor = vec4(mix(sceneColor.rgb, vec3(gray), strength), sceneColor.a);
}
