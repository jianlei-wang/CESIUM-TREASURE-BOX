// a filmic roll-off (ACES, Narkowicz's fit) for the effects that add light to the picture: Cesium
// has already tone mapped it, so their light would clip to flat white without it
vec3 filmic(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
