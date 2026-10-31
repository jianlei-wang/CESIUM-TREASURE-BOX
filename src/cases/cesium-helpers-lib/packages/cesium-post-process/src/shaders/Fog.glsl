// What ValleyFog's fog and the rain's and the snow's haze share: the sky as a ray this long, and
// their light, lit by the sun as Cesium's fog, turning around sunset to a moonlit blue as bright as
// the scene's fog.minimumBrightness, rather than a flat gray. Needs Height.

// the sky is a ray this long, in meters
const float SKY_DISTANCE = 50000.0;
// tint of the fog at night, scaled by fog.minimumBrightness
const vec3 NIGHT = vec3(0.45, 0.55, 0.85);

// 0 at night to 1 by day, from the sun's height at the camera
float daylight() {
  return smoothstep(-0.1, 0.3, dot(up, czm_sunDirectionEC));
}

// a fog's color by day, turning to the moonlit blue at night
vec3 byDaylight(vec3 color, float day) {
  return mix(NIGHT * czm_fogMinimumBrightness, color, day);
}
