// The clouds' shadow map, a Beer shadow map: across an area around the camera, seen from the sun,
// the optical depth of the clouds along the sun's rays, from the top of the slab down to each
// quarter of its height, so that a point finds how much cloud lies between it and the sun. One
// read rather than a march toward the sun, as Unreal's (it loses only the "volumetric self shadow
// color") and three-clouds' in WebGL2.
precision highp sampler2D;
uniform sampler2D shadowMap;
// the ground point the map is centered on, in world coordinates, and the base and the top of the
// slab it covers, in meters above the ellipsoid, from clouds.js
uniform vec3 shadowCenter;
// the map's side, in meters, wider as the camera is higher, from clouds.js
uniform float shadowExtent;
uniform float shadowBase;
uniform float shadowTop;

// the shadow fades out over the outer share of the map's half side, so that its edge does not show
const float SHADOW_FADE = 0.2;

// the axes of the map, across the sun's rays: the sun's direction in world coordinates crossed
// with the up at its center, and the third direction
void shadowAxes(out vec3 across, out vec3 along) {
  vec3 up = normalize(shadowCenter);
  across = cross(czm_lightDirectionWC, up);
  across = dot(across, across) > 1e-6 ? normalize(across) : normalize(cross(czm_lightDirectionWC, vec3(1.0, 0.0, 0.0)));
  along = cross(czm_lightDirectionWC, across);
}

// a point's height above the sphere through the map's center: over the map, it differs from the
// height above the ellipsoid by meters
float shadowHeight(vec3 positionWC) {
  return length(positionWC) - length(shadowCenter);
}

// the optical depth of the clouds between a point in world coordinates and the sun, 0 off the map
float shadowDepth(vec3 positionWC) {
  vec3 across;
  vec3 along;
  shadowAxes(across, along);
  vec3 offset = positionWC - shadowCenter;
  vec2 uv = vec2(dot(offset, across), dot(offset, along)) / shadowExtent + 0.5;
  float edge = 2.0 * max(abs(uv.x - 0.5), abs(uv.y - 0.5));
  if (edge >= 1.0) {
    return 0.0;
  }
  float fade = 1.0 - smoothstep(1.0 - SHADOW_FADE, 1.0, edge);
  vec4 depths = texture(shadowMap, uv);
  // the share of the slab above the point, in quarters, through the depths at each
  float f = 4.0 * clamp((shadowTop - shadowHeight(positionWC)) / max(shadowTop - shadowBase, 1.0), 0.0, 1.0);
  return fade * (f < 1.0 ? f * depths.x : f < 2.0 ? mix(depths.x, depths.y, f - 1.0) : f < 3.0 ? mix(depths.y, depths.z, f - 2.0) : mix(depths.z, depths.w, f - 3.0));
}
