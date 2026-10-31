// The clouds over the scene: the march's samples at a fraction of the resolution, upscaled
// bilinearly from those whose depth, the farthest of their block of pixels, is about this pixel's,
// and from the one nearest in depth where none is, rather than weighting the bilinear weights by
// the depths, which "can select only one sample, but that sample is not similar to the surface
// depth you need at all" (Pesce 2016): a ridge in front of a cloud keeps a sharp outline rather
// than a halo of the march's resolution. The clouds' shadows darken the scene under them, from the
// shadow map. Needs EyeFromDepth, Height, CloudsSlab and CloudsShadow.
precision highp sampler2D;
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
// the light the clouds scatter toward the camera, and the share of the scene seen through them
uniform sampler2D cloudTexture;
// the farthest distance of the scene in each texel's block of pixels, from CloudsDepth.glsl
uniform sampler2D cloudDepth;
in vec2 v_textureCoordinates;

// the march's resolution, clouds.js's CLOUD_SCALE, and the sky's distance, past any terrain,
// CloudsDepth.glsl's
const float CLOUD_SCALE = 0.25;
const float SKY_DISTANCE = 1e9;
// texels are at this pixel's depth within this share of it, CloudsBlur.glsl's
const float DEPTH_TOLERANCE = 0.1;
// the clouds' shadow takes at most this share of the scene's light: the sunlit share of a lit
// scene, as precipitation.js's OVERCAST
const float SHADOW_STRENGTH = 0.5;

void main() {
  vec4 sceneColor = texture(colorTexture, v_textureCoordinates);
  vec2 size = ceil(czm_viewport.zw * CLOUD_SCALE);
  vec2 position = v_textureCoordinates * size - 0.5;
  vec2 corner = floor(position);
  vec2 f = position - corner;
  float here = eyeDistance(depthTexture, v_textureCoordinates, SKY_DISTANCE);
  vec4 sum = vec4(0.0);
  float weights = 0.0;
  vec4 nearest = vec4(0.0);
  float nearestGap = 1e30;
  for (int y = 0; y <= 1; y++) {
    for (int x = 0; x <= 1; x++) {
      vec2 uv = (corner + vec2(float(x), float(y)) + 0.5) / size;
      vec4 sampled = texture(cloudTexture, uv);
      float gap = abs(texture(cloudDepth, uv).r - here);
      float weight = gap <= DEPTH_TOLERANCE * here ? (x == 0 ? 1.0 - f.x : f.x) * (y == 0 ? 1.0 - f.y : f.y) : 0.0;
      sum += weight * sampled;
      weights += weight;
      if (gap < nearestGap) {
        nearestGap = gap;
        nearest = sampled;
      }
    }
  }
  vec4 cloud = weights > 1e-4 ? sum / weights : nearest;
  vec4 eye = eyeAt(depthTexture, v_textureCoordinates);
  if (eye.w != 0.0) {
    vec3 positionWC = (czm_inverseView * vec4(eye.xyz, 1.0)).xyz;
    sceneColor.rgb *= mix(1.0 - SHADOW_STRENGTH, 1.0, exp(-shadowDepth(positionWC)));
  }
  out_FragColor = vec4(sceneColor.rgb * cloud.a + cloud.rgb, sceneColor.a);
}
