// Depth of field: sharp around the focal distance, the blurred image further off. Distances
// compare as ratios, like a lens: sharp within FOCUS_RANGE factors of two of the focal distance,
// fully blurred at twice that.
precision highp sampler2D;
uniform sampler2D colorTexture;
uniform sampler2D blurTexture;
uniform sampler2D depthTexture;
uniform float focalDistance;
// 0 to 1, as the effect fades in and out
uniform float fade;
in vec2 v_textureCoordinates;

// in factors of two of the focal distance
const float FOCUS_RANGE = 0.8;


void main() {
  vec4 eye = eyeAt(depthTexture, v_textureCoordinates);
  float fromCamera = eye.w == 0.0 ? 1e30 : length(eye.xyz);
  float blur = fade * smoothstep(FOCUS_RANGE, 2.0 * FOCUS_RANGE, abs(log2(fromCamera / focalDistance)));
  out_FragColor = mix(texture(colorTexture, v_textureCoordinates), texture(blurTexture, v_textureCoordinates), blur);
}
