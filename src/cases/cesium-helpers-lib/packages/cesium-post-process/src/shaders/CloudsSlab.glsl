// The slab of the clouds along a view ray, which the march and the resolve share: where the ray's
// height reaches a height, and the part of the ray in the slab. Needs Height.
// meters above the ellipsoid
uniform float cloudBase;
// the top of the tallest cloud the map makes, where the march starts from above, from clouds.js
uniform float slabTop;

// the ray is marched as far as this from where it enters the slab, in meters, not from the camera:
// from far above, the slab itself is farther than that. A grazing ray marched farther would take
// steps longer than the billows and turn the far clouds into streaks; deeper than this into the
// slab, it is nearly always behind a cloud
const float MAX_DISTANCE = 40000.0;

// where the height along the view ray, at a distance t in direction k = dot(direction, up), reaches
// c: the height is cameraHeight + k t + (1 - k k) t t / (2 radius), as heightAt's. False if it never
// does. Without the cancellation of the textbook formula, also for a vertical ray, where the
// quadratic term is 0
bool crossings(float c, float k, out float near, out float far) {
  float a = (1.0 - k * k) / (2.0 * radius);
  float d = cameraHeight - c;
  float discriminant = k * k - 4.0 * a * d;
  if (discriminant < 0.0) {
    return false;
  }
  float q = -0.5 * (k + (k < 0.0 ? -1.0 : 1.0) * sqrt(discriminant));
  q = q == 0.0 ? 1e-9 : q;
  float r0 = a > 1e-12 ? q / a : (q > 0.0 ? 1e20 : -1e20);
  float r1 = d / q;
  near = min(r0, r1);
  far = max(r0, r1);
  return true;
}

// the part of the ray in the slab up to a top, from where it enters it to where it leaves it, meets
// the ground or is MAX_DISTANCE long; empty when it misses the slab
vec2 slab(float k, float sceneDistance, float top) {
  float near;
  float far;
  // always above the tops
  if (!crossings(top, k, near, far)) {
    return vec2(0.0);
  }
  float start = max(near, 0.0);
  float end = far;
  if (crossings(cloudBase, k, near, far)) {
    if (cameraHeight >= cloudBase) {
      // going down below the base
      if (near > 0.0) {
        end = min(end, near);
      }
    } else {
      // coming up through the base
      start = max(start, far);
    }
  }
  end = min(end, min(sceneDistance, start + MAX_DISTANCE));
  return vec2(start, max(end, start));
}
