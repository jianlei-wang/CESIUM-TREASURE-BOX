// random in [0, 1) for a point, without sin, which GPUs compute poorly for large numbers
float hash(vec2 p) {
  vec3 p3 = fract(p.xyx * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// per pixel noise in [0, 1), "interleaved gradient noise" (Jimenez 2014): a dither that
// spreads the sample positions of a blur between neighbouring pixels
float pixelNoise(vec2 pixel) {
  return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}
