// Clouds from a map of the rain, raymarched at a fraction of the resolution: the light they scatter
// toward the camera, and the share of the scene still seen through them, along each view ray. They
// fill a slab above the cloud base where the map has rain: a flat layer over drizzle, towers up to
// the cloud top over the heaviest rain, with a rounded base and top, shaped by billows of noise
// that repeats in world coordinates, read from a texture made once (cloud-noise.js): wispy over
// light rain and solid over heavy rain, with details eroding their edges, not their cores. The sun lights them through a few
// samples toward it, with a silver lining toward it, its light scattered more than once brightening
// their cores, and the sky lights them, brighter at their top: thick clouds are dark gray from
// below and white from above. The steps are short near the camera and longer with the distance, so
// a camera inside a cloud is in its fog. Precipitation, activated after them, draws the rain's haze
// over them. Needs EyeFromDepth, Height, CloudsSlab, WeatherMap, CloudsDensity, Fog, Phase and
// RainHaze.
precision highp sampler2D;
uniform sampler2D depthTexture;
// the farthest distance of the scene in this texel's block of pixels, from CloudsDepth.glsl
uniform sampler2D cloudDepth;
// the highest rain around each block of the map's pixels, over both maps, from weather-map.js
uniform sampler2D maxMap;
// the frames drawn, for the jitter to change at each, and CloudsResolve.glsl to accumulate them
uniform float frame;
in vec2 v_textureCoordinates;

const int STEPS = 32;
// the ray is probed at this many points of the max map before its march, less than a block of it
// apart over MAX_DISTANCE, 5 km for the 4 km blocks of a 1 km map: the march starts where the ray
// drops below the tallest cloud they find, and is skipped where they find no rain, rather than
// spending its steps in the empty air above the clouds (the coverage early-out of Schneider 2015)
const int RAY_PROBES = 8;
// the sun's light through the cloud, sampled at these distances toward it, in meters
const vec2 LIGHT_DISTANCES = vec2(200.0, 700.0);
// the sky's light on the clouds at their base and at their top, by day, and the moon's share of it
// at night. By day, their tops see the sky overhead, in the color of Cesium's at its luminance, and
// their bases the sunlight the ground bounces (Hillaire 2016, sec. 5.5.1), less as the sun is lower
// than this sine of its height. Cesium's sky itself, and an albedo of 0.1 to 0.3 for the ground,
// would leave the tops gray: our two samples toward the sun let little of it through
const vec3 AMBIENT_BASE = vec3(0.32, 0.35, 0.40);
const vec3 AMBIENT_TOP = vec3(0.62, 0.66, 0.72);
const float HIGH_SUN = 0.5;
// the sky's color on the clouds' tops is desaturated toward its gray, keeping this share of it: in
// full, its hue turns the tops sky blue, where the sun's white light dominates them (Hillaire 2016,
// sec. 5.5.1, lets artists desaturate the sky's light)
const float SKY_SATURATION = 0.3;
// the sky's light inside a cloud is occluded by its dimensional profile, its height profile times
// its coverage, pow(1 - dimensional_profile, 0.5) (Schneider 2022): bright at its edges and top,
// dark in its core; and by the lack of light from below at its base, in the share of its column's height
// pow(remap(h, 0.07, 0.14, 0.1, 1.0), 0.8) (Schneider 2017): its bases are dark
const vec2 DARK_BASE = vec2(0.07, 0.14);
// the clouds over the heaviest rain absorb this share of the light they intercept, for the
// "foreboding dark clouds" of Horizon Zero Dawn (Schneider 2015)
const float RAIN_ALBEDO = 0.8;
const float SUN = 0.8;
// the sun's light scattered more than once, as octaves of the light scattered once (Wrenninge's,
// Hillaire 2016, sec. 5.8, eq. 19-20): octave n has a^n of the scattering, b^n of the extinction and
// c^n of the phase's eccentricity, so it reaches deeper into the cloud, more alike in all
// directions. a <= b keeps it from scattering more light than reaches it; 0.5 each, Unreal's
// defaults, and 2 octaves, as Unreal and RDR2
const int OCTAVES = 2;
const float OCTAVE_SCATTERING = 0.5;
const float OCTAVE_EXTINCTION = 0.5;
const float OCTAVE_ECCENTRICITY = 0.5;
const vec3 MOONLIGHT = vec3(0.60, 0.63, 0.70);

// Henyey-Greenstein's phase function, times 4 pi: 1 for light scattered alike in all directions
float phase(float cosTheta, float g) {
  return 4.0 * czm_pi * henyeyGreenstein(cosTheta, g);
}

void main() {
  vec4 eye = eyeAt(depthTexture, v_textureCoordinates);
  vec3 direction = normalize(eye.xyz);
  // the farthest of the texel's pixels, the sky past the slab: the slab ends its rays
  float sceneDistance = texture(cloudDepth, v_textureCoordinates).r;
  vec2 segment = slab(dot(direction, up), sceneDistance, slabTop);
  float span = segment.y - segment.x;
  if (span <= 0.0) {
    out_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec3 directionWC = czm_inverseViewRotation * direction;
  // the clouds' map's coverage, and its tallest type
  float covered = 0.0;
  float highest = 0.0;
  for (int k = 0; k < RAY_PROBES; k++) {
    vec2 uv = mapUv(czm_viewerPositionWC + directionWC * (segment.x + span * (float(k) + 0.5) / float(RAY_PROBES)));
    if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) {
      vec4 cell = texture(maxMap, uv);
      covered = max(covered, cell.g);
      highest = max(highest, cell.b);
    }
  }
  segment = slab(dot(direction, up), sceneDistance, cloudBase + mix(THIN_DEPTH, cloudTop - cloudBase, highest));
  span = segment.y - segment.x;
  if (covered <= 0.0 || span <= 0.0) {
    out_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec3 lightWC = czm_inverseViewRotation * czm_lightDirectionEC;
  // a forward lobe for the silver lining, a weak backward one, for each octave: the sun is a
  // direction, the angle is the same along the ray
  float cosTheta = dot(direction, czm_lightDirectionEC);
  float octaves[OCTAVES];
  float contribution = 1.0;
  float eccentricity = 1.0;
  for (int n = 0; n < OCTAVES; n++) {
    octaves[n] = contribution * mix(phase(cosTheta, -0.2 * eccentricity), phase(cosTheta, 0.6 * eccentricity), 0.7);
    contribution *= OCTAVE_SCATTERING;
    eccentricity *= OCTAVE_ECCENTRICITY;
  }
  float day = daylight();
  // the far clouds fade into the sky behind them as Cesium's fog fades the terrain, by its factor at
  // each step's distance: the same aerial perspective on the clouds as on the earth, without which
  // "a visual discrepancy happens at the horizon between clouds and earth" (Hillaire 2016, sec.
  // 5.9.1). The sky toward the view, at least SKY_ELEVATION above the horizon
  vec3 fogColor = skyToward(direction, max(asin(clamp(dot(direction, up), -1.0, 1.0)), SKY_ELEVATION));
  vec3 sunLight = SUN * czm_lightColor * day;
  // the sky overhead, and the sunlight from the ground, by day; the moon's at night
  vec3 zenith = clearSkyBelow(cloudBase, czm_inverseViewRotation * up, czm_lightDirectionWC);
  vec3 skyHue = mix(vec3(1.0), zenith / max(czm_luminance(zenith), 1e-3), SKY_SATURATION);
  vec3 skyAbove = mix(MOONLIGHT, skyHue, day) * czm_luminance(AMBIENT_TOP);
  vec3 groundBelow = AMBIENT_BASE * mix(MOONLIGHT, czm_lightColor * clamp(dot(up, czm_lightDirectionEC) / HIGH_SUN, 0.0, 1.0), day);
  // interleaved gradient noise, a different start along the ray for each pixel, and at each frame,
  // by the golden ratio (Wolfe 2020)
  // the angle a pixel of this pass covers
  float pixelAngle = 2.0 / (czm_projection[1][1] * czm_viewport.w);
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + 0.618034 * frame);
  vec3 light = vec3(0.0);
  float transmittance = 1.0;
  float rain;
  float column;
  float dimensional;
  float unused;
  for (int i = 0; i < STEPS; i++) {
    float s = (float(i) + jitter) / float(STEPS);
    float t = segment.x + span * s * s;
    float dt = span * (2.0 * s + 1.0 / float(STEPS)) / float(STEPS);
    vec3 pointEC = direction * t;
    float h = heightAt(pointEC);
    vec3 pointWC = czm_viewerPositionWC + directionWC * t;
    float footprint = t * pixelAngle;
    float sigma = EXTINCTION * cloudDensity(pointWC, h, footprint, rain, column, dimensional);
    if (sigma <= 0.0) {
      continue;
    }
    // the sun's light through the cloud toward it
    float opticalDepth = 0.0;
    float previous = 0.0;
    for (int j = 0; j < 2; j++) {
      // jittered as the step, for the samples of neighboring pixels not to band (Hillaire 2016,
      // sec. 5.5.2)
      float distanceToward = LIGHT_DISTANCES[j] * (0.75 + 0.5 * jitter);
      opticalDepth += EXTINCTION * cloudDensity(pointWC + lightWC * distanceToward, heightAt(pointEC + czm_lightDirectionEC * distanceToward), footprint, unused, unused, unused) * (distanceToward - previous);
      previous = distanceToward;
    }
    float sunThrough = 0.0;
    float occlusion = 1.0;
    for (int n = 0; n < OCTAVES; n++) {
      sunThrough += octaves[n] * exp(-opticalDepth * occlusion);
      occlusion *= OCTAVE_EXTINCTION;
    }
    float y = clamp((h - cloudBase) / (cloudTop - cloudBase), 0.0, 1.0);
    float ambientOcclusion = sqrt(max(1.0 - dimensional, 0.0)) * pow(mix(0.1, 1.0, clamp((column - DARK_BASE.x) / (DARK_BASE.y - DARK_BASE.x), 0.0, 1.0)), 0.8);
    vec3 scattered = sunLight * sunThrough + mix(groundBelow, skyAbove, y) * ambientOcclusion;
    float stepTransmittance = exp(-sigma * dt);
    // the light scattered over the step, the integral of the source over it, (S - S T) / sigma_t
    // (Hillaire 2016, eq. 17): the albedo, sigma_s / sigma_t, of what the step intercepts
    vec3 seen = czm_fog(t, scattered * mix(1.0, RAIN_ALBEDO, rain), fogColor, czm_fogVisualDensityScalar);
    light += transmittance * seen * (1.0 - stepTransmittance);
    transmittance *= stepTransmittance;
    if (transmittance < 0.03) {
      break;
    }
  }
  out_FragColor = vec4(min(light, vec3(1.0)), transmittance);
}
