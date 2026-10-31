// Height above the ellipsoid of a point in eye coordinates, computed relative to the camera: in
// world coordinates, single precision would round the position to about half a meter. The
// uniforms come from the CPU in double precision (height.js).
uniform float cameraHeight;
uniform vec3 up;
uniform float radius;

float heightAt(vec3 eye) {
  // the camera is at the origin of eye coordinates; away from it horizontally, the ground falls
  // below the horizontal by the Earth's curvature
  float rise = dot(eye, up);
  float across = dot(eye, eye) - rise * rise;
  return cameraHeight + rise + across / (2.0 * radius);
}

// the part below a height of the ray from the camera to a point in eye coordinates, as shares of
// it, from its start to its end, the height taken as linear along it; none when both ends are above
vec2 belowHeight(vec3 rayEnd, float height) {
  float h0 = cameraHeight;
  float h1 = heightAt(rayEnd);
  if (min(h0, h1) >= height) {
    return vec2(0.0);
  }
  return vec2(h0 > height ? (h0 - height) / (h0 - h1) : 0.0, h1 > height ? (height - h0) / (h1 - h0) : 1.0);
}
