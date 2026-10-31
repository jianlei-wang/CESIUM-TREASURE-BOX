// Speed lines: the picture zooms toward the focus, more toward the edges of the screen, and thin
// streaks radiate from it, a new pattern many times a second, as in comics.
precision highp sampler2D;
uniform sampler2D colorTexture;
// in eye coordinates; w is 0 for the middle of the screen
uniform vec4 focus;
// 0 to 1
uniform float strength;
// seconds
uniform float time;
in vec2 v_textureCoordinates;

const int BLUR_STEPS = 8;
// length of the zoom blur at full strength, as a fraction of the distance to the focus
const float BLUR = 0.12;
// streaks around the focus, and their changes per second
const float STREAK_COUNT = 360.0;
const float STREAK_RATE = 24.0;
const float STREAK_OPACITY = 0.2;

// the streaks draw their randomness from hash: with a sin, they disappeared for half of each
// cycle of frames
void main() {
  vec2 uv = v_textureCoordinates;
  vec4 clip = czm_projection * vec4(focus.xyz, 1.0);
  // on the screen, in front of the camera
  vec2 center = focus.w > 0.0 && focus.z < 0.0 ? 0.5 * clip.xy / clip.w + 0.5 : vec2(0.5);
  vec2 toCenter = center - uv;
  // distance to the focus, 1 at the half height of the screen
  vec2 aspect = vec2(czm_viewport.z / czm_viewport.w, 1.0);
  float fromCenter = 2.0 * length(toCenter * aspect);
  float edge = smoothstep(0.2, 1.0, fromCenter);

  vec4 sceneColor = texture(colorTexture, uv);
  vec3 color = sceneColor.rgb;
  // zoom blur, from a start that varies with the pixel so that the steps blur into noise; none
  // where it would be shorter than a pixel, around the focus
  float blur = strength * BLUR * edge;
  if (blur * length(toCenter * czm_viewport.zw) > 0.5) {
    float jitter = pixelNoise(gl_FragCoord.xy);
    color = vec3(0.0);
    for (int i = 0; i < BLUR_STEPS; i++) {
      color += texture(colorTexture, uv + toCenter * blur * (float(i) + jitter) / float(BLUR_STEPS)).rgb;
    }
    color /= float(BLUR_STEPS);
  }

  // streaks: noise around the focus, constant along each ray from it, only toward the edges
  float streaks = STREAK_OPACITY * strength * smoothstep(0.5, 1.2, fromCenter);
  if (streaks > 0.0) {
    vec2 direction = toCenter * aspect;
    float frame = mod(floor(time * STREAK_RATE), 1000.0);
    // value noise over the angle, in whole cells so that it closes around the focus
    float around = (atan(direction.y, direction.x) / czm_twoPi + 0.5) * STREAK_COUNT;
    float cell = floor(around);
    float t = fract(around);
    float noise = mix(hash(vec2(cell, frame)), hash(vec2(mod(cell + 1.0, STREAK_COUNT), frame)), t * t * (3.0 - 2.0 * t));
    color = mix(color, vec3(1.0), streaks * smoothstep(0.72, 0.9, noise));
  }
  out_FragColor = vec4(color, sceneColor.a);
}
