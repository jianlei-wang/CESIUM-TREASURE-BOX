// The beam of a cone of light in the haze, for the spotlight and for lights of your own:
// raymarched along the part of the view ray inside the cone, found analytically, so that no
// sample is wasted and pixels next to each other see the same stretch of it. Needs Hash, and
// Noise for the dust.

struct Beam {
  // the cone: its apex and the direction it points, in eye coordinates
  vec3 apex;
  vec3 forward;
  // cosines of its half angle, and of the angle within which its core is hot
  float edgeCos;
  float coreCos;
  // brightness of the core over the rest of the cone, 0 for a plain penumbra
  float hotCore;
  // the light's position, from which the haze's brightness falls off as reference^2 over
  // (core^2 + distance^2): 1 at the reference distance for a small core, softened within it
  vec3 light;
  float reference;
  float core;
  // how far along the view ray the haze is lit, meters, and its extinction on the way, per meter
  float reach;
  float extinction;
  // Henyey-Greenstein asymmetry, 0 to 1: forward scattering
  float anisotropy;
  // exponent of the spacing of the samples along the ray: 1 for even, 2 for dense at the start
  float spacing;
  // the lit haze fades in over this stretch of the view ray, meters; none when empty
  vec2 nearFade;
  // dust catching the light: noise across the beam, constant along each line from the light so
  // that it streaks, in world coordinates so that it stays when the camera turns; its contrast
  // and its density across the width of the beam
  float dust;
  float dustScale;
};

const int BEAM_SAMPLES = 8;

// the part of the view ray, from the camera at the origin, inside the cone: entry and exit
// distances, exit before entry when the ray misses it
vec2 coneSegment(vec3 ray, vec3 apex, vec3 forward, float edgeCos) {
  // points t * ray in the cone: dot(p, forward)^2 >= edgeCos^2 dot(p, p), with p from the apex
  vec3 v = -apex;
  float k2 = edgeCos * edgeCos;
  float rd = dot(ray, forward);
  float vd = dot(v, forward);
  float a = rd * rd - k2;
  // a ray along the surface of the cone would divide by zero
  a = abs(a) < 1e-7 ? -1e-7 : a;
  float b = rd * vd - k2 * dot(ray, v);
  float c = vd * vd - k2 * dot(v, v);
  float discriminant = b * b - a * c;
  if (discriminant < 0.0) {
    return vec2(1.0, 0.0);
  }
  float root = sqrt(discriminant);
  float t1 = (-b - root) / a;
  float t2 = (-b + root) / a;
  vec2 segment = a < 0.0 ? vec2(min(t1, t2), max(t1, t2))
    // a ray steeper than the cone stays in it on one side, of the lit nappe or the other one
    : rd > 0.0 ? vec2(max(t1, t2), 1e30) : vec2(-1e30, min(t1, t2));
  // ahead of the apex, not in the mirrored cone behind it
  return vd + 0.5 * (segment.x + segment.y) * rd > 0.0 ? segment : vec2(1.0, 0.0);
}

// Henyey-Greenstein phase, normalized over the sphere
float henyeyGreenstein(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * czm_pi * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
}

// the haze lit by the beam along the view ray up to sceneDistance: samples over the part of the
// ray inside the cone, each weighted by the softness of the cone with its core, the dust, the
// falloff from the light and what the haze has dimmed so far, dithered per pixel so that they do
// not band, then scattered toward the camera
float beamAlong(vec3 ray, float sceneDistance, Beam beam) {
  vec2 segment = coneSegment(ray, beam.apex, beam.forward, beam.edgeCos);
  float start = max(segment.x, 0.0);
  float end = min(min(segment.y, sceneDistance), beam.reach);
  if (end <= start) {
    return 0.0;
  }
  float length_ = end - start;
  float jitter = pixelNoise(gl_FragCoord.xy);
  float scattered = 0.0;
  float transmittance = exp(-beam.extinction * start);
  for (int i = 0; i < BEAM_SAMPLES; i++) {
    float u = (float(i) + jitter) / float(BEAM_SAMPLES);
    float t = start + length_ * pow(u, beam.spacing);
    // pow(0, 0) is undefined, a NaN on some GPUs, where the jitter is 0
    float step = length_ * beam.spacing * pow(max(u, 1e-6), beam.spacing - 1.0) / float(BEAM_SAMPLES);
    vec3 p = ray * t;
    vec3 fromApex = p - beam.apex;
    float cosine = dot(fromApex, beam.forward) / length(fromApex);
    float cone = smoothstep(beam.edgeCos, beam.coreCos, cosine) + beam.hotCore * smoothstep(beam.coreCos, 1.0, cosine);
    vec3 fromLight = p - beam.light;
    if (beam.dust > 0.0) {
      float along = max(dot(fromLight, beam.forward), 1e-3);
      vec3 section = czm_inverseViewRotation * ((fromLight - along * beam.forward) * 2.0 / along);
      float noise = gradientNoise(beam.dustScale * section) + 0.25 * gradientNoise(2.0 * beam.dustScale * section);
      cone *= 1.0 + beam.dust * noise;
    }
    float falloff = beam.reference * beam.reference / (beam.core * beam.core + dot(fromLight, fromLight));
    float fade = beam.nearFade.y > beam.nearFade.x ? smoothstep(beam.nearFade.x, beam.nearFade.y, t) : 1.0;
    scattered += transmittance * cone * falloff * fade * step;
    transmittance *= exp(-beam.extinction * step);
  }
  return scattered * henyeyGreenstein(dot(ray, beam.forward), beam.anisotropy);
}
