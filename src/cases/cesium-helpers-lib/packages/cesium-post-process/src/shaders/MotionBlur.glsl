// Camera motion blur, after "A Reconstruction Filter for Plausible Motion Blur" (McGuire et al.,
// I3D 2012). Only the camera moves, so each pixel's motion follows from its depth and the
// reprojection into the previous frame, computed once per pixel into the velocity buffer of
// MotionBlurVelocity.glsl. The blur gathers jittered samples along the pixel's motion, weighted
// by depth so that near terrain and far ridges or sky do not smear into each other.
precision highp sampler2D;
uniform sampler2D colorTexture;
// xy: half the blur, as a fraction of the viewport; z: the distance from the camera
uniform sampler2D velocityTexture;
in vec2 v_textureCoordinates;

const int SAMPLES = 16;
// depth difference, relative to the depth, over which a sample goes from in front to behind
const float SOFT_DEPTH = 0.1;


// xy: half the blur of the pixel at uv, in pixels; z: its distance from the camera
vec3 halfBlurAt(vec2 uv) {
  vec3 velocity = texture(velocityTexture, uv).xyz;
  return vec3(velocity.xy * czm_viewport.zw, velocity.z);
}

// 1 when b is in front of a, 0 when it is SOFT_DEPTH behind
float inFront(float a, float b) {
  return clamp(1.0 - (b - a) / (SOFT_DEPTH * min(a, b)), 0.0, 1.0);
}

// the blur of a pixel with this half blur covers a sample this far away; the extents are kept
// above 0 for samples without blur
float cone(float gap, vec2 halfBlur) {
  return clamp(1.0 - gap / max(length(halfBlur), 1e-3), 0.0, 1.0);
}

// both pixels are blurred over the gap between them
float cylinder(float gap, vec2 halfBlur) {
  float extent = max(length(halfBlur), 1e-3);
  return 1.0 - smoothstep(0.95 * extent, 1.05 * extent, gap);
}

void main() {
  vec3 center = halfBlurAt(v_textureCoordinates);
  vec2 halfBlur = center.xy;
  vec4 centerColor = texture(colorTexture, v_textureCoordinates);
  float extent = length(halfBlur);
  if (extent < 0.5) {
    out_FragColor = centerColor;
    return;
  }

  float weight = 1.0 / extent;
  vec4 color = centerColor * weight;
  // the jitter turns the banding of few samples into fine noise
  float jitter = pixelNoise(gl_FragCoord.xy) - 0.5;
  for (int i = 0; i < SAMPLES; i++) {
    float t = mix(-1.0, 1.0, (float(i) + jitter + 1.0) / float(SAMPLES + 1));
    vec2 uv = v_textureCoordinates + t * halfBlur / czm_viewport.zw;
    vec3 other = halfBlurAt(uv);
    float gap = abs(t) * extent;
    float front = inFront(center.z, other.z);
    float behind = inFront(other.z, center.z);
    // a sample in front counts when its own blur reaches this pixel, one behind when this
    // pixel's blur reaches it, and both when they are blurred together
    float alpha =
      front * cone(gap, other.xy) +
      behind * cone(gap, halfBlur) +
      2.0 * cylinder(gap, other.xy) * cylinder(gap, halfBlur);
    weight += alpha;
    color += alpha * texture(colorTexture, uv);
  }
  out_FragColor = color / weight;
}
