// The farthest distance of the scene in each block of pixels of the clouds' march, at its
// resolution: the march goes as far as it, and the blur and the upscale compare their texels by it,
// so a cloud over the sky does not stop at a ridge in its block. "There is absolutely no physical or
// theoretical basis for this. It just looks better than halos" (Cantlay, GPU Gems 3, ch. 23).
// Needs EyeFromDepth.
precision highp sampler2D;
uniform sampler2D depthTexture;
in vec2 v_textureCoordinates;

// the pixels of a block across, one over clouds.js's CLOUD_SCALE, and the sky's distance, past any
// terrain
const int BLOCK = 4;
const float SKY_DISTANCE = 1e9;

void main() {
  // czm_viewport is this pass's texture, the march's size
  vec2 pixel = 1.0 / (czm_viewport.zw * float(BLOCK));
  float farthest = 0.0;
  for (int y = 0; y < BLOCK; y++) {
    for (int x = 0; x < BLOCK; x++) {
      vec2 offset = (vec2(float(x), float(y)) - 0.5 * float(BLOCK - 1)) * pixel;
      farthest = max(farthest, eyeDistance(depthTexture, v_textureCoordinates + offset, SKY_DISTANCE));
    }
  }
  out_FragColor = vec4(farthest, 0.0, 0.0, 1.0);
}
