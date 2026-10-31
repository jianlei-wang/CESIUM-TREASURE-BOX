// The barrel distortion and dark corners of a wide-angle lens, like those of FPV cameras: straight
// lines bend outward away from the middle. The corners stay in place and the middle is
// magnified, so the picture keeps filling the screen.
precision highp sampler2D;
uniform sampler2D colorTexture;
// 0 to 1
uniform float distortion;
uniform float vignette;
in vec2 v_textureCoordinates;

// strongest distortion: the middle magnified by 1 + this, relative to the corners
const float MAX_DISTORTION = 0.5;

void main() {
  vec2 aspect = vec2(czm_viewport.z / czm_viewport.w, 1.0);
  // from the middle, 1 at the corners
  vec2 fromMiddle = (v_textureCoordinates - 0.5) * aspect / (0.5 * length(aspect));
  float r2 = dot(fromMiddle, fromMiddle);
  float k = distortion * MAX_DISTORTION;
  vec2 uv = 0.5 + (v_textureCoordinates - 0.5) * (1.0 + k * r2) / (1.0 + k);
  vec4 sceneColor = texture(colorTexture, uv);
  float dark = 1.0 - vignette * smoothstep(0.3, 1.0, r2);
  out_FragColor = vec4(sceneColor.rgb * dark, sceneColor.a);
}
