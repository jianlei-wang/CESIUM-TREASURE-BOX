// The beam's haze, blurred over the neighboring texels at its own resolution, each weighted by how
// close its scene distance is to the texel's: the dither of the samples along the rays smooths
// out, but the haze in front of a ridge does not spill onto the ridge.
precision highp sampler2D;
uniform sampler2D beamTexture;
in vec2 v_textureCoordinates;

// difference of the log2 of the distances at which a neighbor no longer counts, about 10 %
const float SOFT_DEPTH = 0.14;

void main() {
  // czm_viewport is this pass's texture, the size of the beam's
  vec2 texel = 1.0 / czm_viewport.zw;
  float centerDepth = texture(beamTexture, v_textureCoordinates).g;
  float sum = 0.0;
  float total = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 sample_ = texture(beamTexture, v_textureCoordinates + vec2(float(x), float(y)) * texel).rg;
      float gap = abs(sample_.g - centerDepth);
      float weight = (x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0) * clamp(1.0 - gap / SOFT_DEPTH, 0.0, 1.0);
      sum += weight * sample_.r;
      total += weight;
    }
  }
  out_FragColor = vec4(sum / total, centerDepth, 0.0, 1.0);
}
