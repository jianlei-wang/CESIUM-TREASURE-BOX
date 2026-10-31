// Size of the visible frame of the given width over height, centered in the canvas, in texture
// coordinates: bars above and below when the canvas is narrower than the ratio, on the sides when
// it is wider; the whole canvas for a ratio of 0.
vec2 frameSize(float aspectRatio) {
  if (aspectRatio <= 0.0) {
    return vec2(1.0);
  }
  float canvas = czm_viewport.z / czm_viewport.w;
  return aspectRatio < canvas ? vec2(aspectRatio / canvas, 1.0) : vec2(1.0, canvas / aspectRatio);
}
