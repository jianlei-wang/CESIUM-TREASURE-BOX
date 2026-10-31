// The clouds accumulated over the frames, at the march's resolution: each frame's march, jittered
// anew, blended into the clouds of the previous frames, reprojected to where they are seen now, as
// Frostbite's, whose 14 samples a frame "look converged" (Hillaire 2016, sec. 5.5.3). The previous
// frames' clouds are reprojected through where the ray enters the slab, near what is seen of them
// from outside, rather than through their transmittance-weighted distance (Sakmary 2022), which the
// march has no channel left for, and clamped to the current frame's 3 x 3 neighborhood so that they
// do not trail behind what moved. Needs EyeFromDepth, Height and CloudsSlab.
precision highp sampler2D;
uniform sampler2D depthTexture;
// the farthest distance of the scene in this texel's block of pixels, from CloudsDepth.glsl
uniform sampler2D cloudDepth;
// this frame's march, and the accumulation of the previous frames, from clouds.js
uniform sampler2D cloudTexture;
uniform sampler2D historyTexture;
// from the eye coordinates of this frame to the clip coordinates of the previous one
uniform mat4 reprojection;
// the share of the previous frames in the blend, 0 when there are none
uniform float historyWeight;
in vec2 v_textureCoordinates;

// inside the slab, the clouds are reprojected through a point this far along the ray, in meters
const float INSIDE_DISTANCE = 2000.0;

void main() {
  vec4 current = texture(cloudTexture, v_textureCoordinates);
  // czm_viewport is this pass's texture, the march's size
  vec2 texel = 1.0 / czm_viewport.zw;
  vec4 low = current;
  vec4 high = current;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec4 neighbor = texture(cloudTexture, v_textureCoordinates + vec2(float(x), float(y)) * texel);
      low = min(low, neighbor);
      high = max(high, neighbor);
    }
  }
  vec3 direction = normalize(eyeAt(depthTexture, v_textureCoordinates).xyz);
  vec2 segment = slab(dot(direction, up), texture(cloudDepth, v_textureCoordinates).r, slabTop);
  // where the ray misses the slab, nothing is there to move: only the view turns
  vec4 point = segment.y > segment.x ? vec4(direction * max(segment.x, min(segment.y, INSIDE_DISTANCE)), 1.0) : vec4(direction, 0.0);
  vec4 clip = reprojection * point;
  vec2 previous = clip.xy / clip.w * 0.5 + 0.5;
  bool seen = clip.w > 0.0 && all(greaterThanEqual(previous, vec2(0.0))) && all(lessThanEqual(previous, vec2(1.0)));
  vec4 history = clamp(texture(historyTexture, previous), low, high);
  out_FragColor = mix(current, history, seen ? historyWeight : 0.0);
}
