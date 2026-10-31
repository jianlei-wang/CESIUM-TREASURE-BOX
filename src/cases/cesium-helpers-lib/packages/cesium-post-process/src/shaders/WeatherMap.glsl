// Where it rains: the map of the local intensity, 0 to 1 in its red channel, over a rectangle of
// longitudes and latitudes, sampled bilinearly, which fades the rain in over a cell at its edges.
// Without a map, a pixel over the whole globe: rain everywhere for Precipitation, none for Clouds.
// A next map over the same rectangle crossfades from it by the blend, as the radar from one hour to
// the next; without one, the map again.
precision highp sampler2D;
uniform sampler2D map;
uniform sampler2D nextMap;
uniform float mapBlend;
// the rectangle in the ellipsoid's texture coordinates: its west and south, and one over its width
// and height
uniform vec4 mapBounds;

// a point in world coordinates on the map, 0 to 1 over its rectangle: single precision rounds it to
// about half a meter, nothing at the scale of a map
vec2 mapUv(vec3 positionWC) {
  vec3 normal = normalize(positionWC * czm_ellipsoidInverseRadii * czm_ellipsoidInverseRadii);
  return (czm_ellipsoidTextureCoordinates(normal) - mapBounds.xy) * mapBounds.zw;
}

// the map's texel at a point in world coordinates, all its channels, 0 outside the map
vec4 mapTexelAt(vec3 positionWC) {
  vec2 uv = mapUv(positionWC);
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
    return vec4(0.0);
  }
  return mix(texture(map, uv), texture(nextMap, uv), mapBlend);
}

// the local intensity at a point in world coordinates, 0 outside the map
float mapAt(vec3 positionWC) {
  return mapTexelAt(positionWC).r;
}
