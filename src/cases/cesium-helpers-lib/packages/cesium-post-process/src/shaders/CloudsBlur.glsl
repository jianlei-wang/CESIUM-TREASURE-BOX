// The clouds blurred over the neighboring texels at the march's resolution, as the precipitation's
// shafts are: an edge thinner than a texel would otherwise come out of the upscale as a square. A
// 3 x 3 binomial kernel here costs a 16th of the reads the same blur would take at the full
// resolution. Only the neighbors at about the texel's depth count, so a cloud over the sky does not
// bleed onto a ridge in front of it.
precision highp sampler2D;
uniform sampler2D cloudTexture;
// the farthest distance of the scene in each texel's block of pixels, from CloudsDepth.glsl
uniform sampler2D cloudDepth;
in vec2 v_textureCoordinates;

// texels are at the same depth within this share of it, CloudsComposite.glsl's
const float DEPTH_TOLERANCE = 0.1;

void main() {
  // czm_viewport is this pass's texture, the size of the march's
  vec2 texel = 1.0 / czm_viewport.zw;
  float here = texture(cloudDepth, v_textureCoordinates).r;
  vec4 sum = vec4(0.0);
  float weights = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 uv = v_textureCoordinates + vec2(float(x), float(y)) * texel;
      float weight = (x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0) * (abs(texture(cloudDepth, uv).r - here) <= DEPTH_TOLERANCE * here ? 1.0 : 0.0);
      sum += weight * texture(cloudTexture, uv);
      weights += weight;
    }
  }
  out_FragColor = sum / weights;
}
