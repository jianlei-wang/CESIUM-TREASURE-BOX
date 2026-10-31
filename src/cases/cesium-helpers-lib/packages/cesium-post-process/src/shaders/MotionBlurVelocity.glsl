// The velocity buffer of the motion blur, at a fraction of the resolution: each pixel's half
// blur, as a fraction of the viewport, and its distance from the camera. Computed once per
// pixel here rather than once per sample in the gather. Needs EyeFromDepth.
precision highp sampler2D;
uniform sampler2D depthTexture;
// current eye coordinates to the previous frame's clip coordinates, computed in double
// precision on the CPU
uniform mat4 reprojection;
// exposure time over the time since the previous frame: the blur spans the motion during the
// exposure, whatever the frame rate
uniform float exposureScale;
in vec2 v_textureCoordinates;

// longest blur, as a fraction of the viewport height
const float MAX_BLUR = 0.05;

void main() {
  // the sky is a direction: only the camera rotation moves it
  vec4 eye = eyeAt(depthTexture, v_textureCoordinates);
  vec4 previous = reprojection * eye;
  vec2 motion = previous.w > 0.0 ? v_textureCoordinates - (previous.xy / previous.w * 0.5 + 0.5) : vec2(0.0);
  motion *= exposureScale;
  // the clamp is resolution independent: the ratio to the viewport height is the same at any scale
  vec2 pixels = motion * czm_viewport.zw;
  float extent = length(pixels);
  float maxExtent = MAX_BLUR * czm_viewport.w;
  if (extent > maxExtent) {
    motion *= maxExtent / extent;
  }
  out_FragColor = vec4(0.5 * motion, eye.w == 0.0 ? 1e30 : length(eye.xyz), 1.0);
}
