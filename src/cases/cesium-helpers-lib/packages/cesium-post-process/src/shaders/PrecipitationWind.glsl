// What the passes of the precipitation share: the local frame at the camera and the wind, in gusts.
// Needs Height.
// seconds, wrapped at an hour
uniform float time;
// tilt of the fall toward the east, in degrees
uniform float wind;
// speed of the drops, 1 at their terminal velocity
uniform float speed;
// meters above the ellipsoid
uniform float cloudBase;
// 0 to 1
uniform float intensity;
// share of the precipitation that is snow, 0 to 1
uniform float snow;

// the gusts: the wind's tilt varies by this share, over periods of 18 and 7.2 s that divide the
// hour the time wraps at
const float GUSTS = 0.35;

// up and east at the camera, in world coordinates
vec3 upWC() {
  return czm_inverseViewRotation * up;
}

vec3 eastWC() {
  return normalize(cross(vec3(0.0, 0.0, 1.0), upWC()));
}

// the wind's tilt, in radians, in gusts
float gustingTilt() {
  float gust = 1.0 + GUSTS * (0.6 * sin(czm_twoPi * time / 18.0) + 0.4 * sin(czm_twoPi * time / 7.2 + 1.3));
  return radians(wind) * gust;
}
