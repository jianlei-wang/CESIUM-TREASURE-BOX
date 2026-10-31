// The clouds' shadow map, drawn by clouds.js into its own texture: for each texel, the sun's ray
// through it marched from the top of the slab down to its base, the optical depth of the clouds
// kept at each quarter of the slab's height, unless the ray crosses no clouds. Needs CloudsSlab,
// WeatherMap, Noise, CloudsDensity and CloudsShadow.
// the highest coverage around each block of the clouds' map, from weather-map.js
precision highp sampler2D;
uniform sampler2D maxMap;
in vec2 v_textureCoordinates;

// the steps along each ray, 4 for each quarter, and the texels across, clouds.js's SHADOW_SIZE, for
// a texel's footprint, for the noise's mipmap
const int SHADOW_STEPS = 16;
const float SHADOW_SIZE = 512.0;
// the ray is probed at this many points of the max map before its march, as the clouds' march, and
// skipped where they find no clouds: the max map's 12 km windows overlap between probes as long as
// the ray crosses the slab over less than about 100 km, the sun above about 4 degrees; lower, a
// small cell between two probes casts no shadow
const int SHADOW_PROBES = 8;
// the sun is taken this high at least, the sine of its height: lower, its rays cross the slab over
// more than 100 km
const float LOW_SUN = 0.05;

void main() {
  vec3 across;
  vec3 along;
  shadowAxes(across, along);
  vec2 xy = (v_textureCoordinates - 0.5) * shadowExtent;
  vec3 start = shadowCenter + across * xy.x + along * xy.y;
  float sine = dot(czm_lightDirectionWC, normalize(start));
  if (sine <= 0.0) {
    // the sun is down: no shadows to speak of
    out_FragColor = vec4(0.0);
    return;
  }
  sine = max(sine, LOW_SUN);
  float h0 = shadowHeight(start);
  // from the top of the slab down to its base, along the ray
  float top = (slabTop - h0) / sine;
  float base = (cloudBase - h0) / sine;
  float covered = 0.0;
  for (int k = 0; k < SHADOW_PROBES; k++) {
    vec2 uv = mapUv(start + czm_lightDirectionWC * mix(top, base, (float(k) + 0.5) / float(SHADOW_PROBES)));
    if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) {
      covered = max(covered, texture(maxMap, uv).g);
    }
  }
  if (covered <= 0.0) {
    out_FragColor = vec4(0.0);
    return;
  }
  float ds = (top - base) / float(SHADOW_STEPS);
  float depth = 0.0;
  vec4 depths = vec4(0.0);
  float unused;
  for (int i = 0; i < SHADOW_STEPS; i++) {
    vec3 point = start + czm_lightDirectionWC * mix(top, base, (float(i) + 0.5) / float(SHADOW_STEPS));
    depth += EXTINCTION * cloudDensity(point, shadowHeight(point), shadowExtent / SHADOW_SIZE, unused, unused, unused) * ds;
    if (i == SHADOW_STEPS / 4 - 1) {
      depths.x = depth;
    } else if (i == SHADOW_STEPS / 2 - 1) {
      depths.y = depth;
    } else if (i == 3 * SHADOW_STEPS / 4 - 1) {
      depths.z = depth;
    }
  }
  depths.w = depth;
  out_FragColor = depths;
}
