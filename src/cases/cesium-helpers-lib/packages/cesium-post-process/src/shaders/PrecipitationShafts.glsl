// The shafts of the rain or the snow, at a fraction of the resolution: their opacity along each
// view ray, for Precipitation.glsl to shade, and the ray's mean extinction, as a share of the
// extinction where the map is full, for its haze, which it computes at its own resolution, sharp at
// the ridges. Both are over the part of the ray below the cloud base, where it rains, found from the
// scene's depth before it is sampled:
// from far above, a pixel shows the rain in the column under it. Along that part, patches of noise
// on the ground under each sample, more of them as it rains harder, slanting with the wind from the
// cloud base and drifting with it, where the map has rain. Not dithered: at this resolution the
// dither shows as dots, where the patches are too soft to band. Needs EyeFromDepth, Noise, Height,
// PrecipitationWind, WeatherMap, Fog, Phase, RainHaze and CloudsShadow. With clouds in the scene, it also finds
// the share of the rain along the ray that the sun lights through their gaps, from their shadow map:
// the haze's light shafts (Wronski 2014's front-to-back march, on the clouds' shadow map as
// Hillaire 2016, sec. 5.9).
precision highp sampler2D;
uniform sampler2D depthTexture;
// 1 when the clouds' shadow map is there to read, 0 otherwise
uniform float shadowed;
in vec2 v_textureCoordinates;

// samples along the part of each ray below the cloud base, as far as SHAFT_DISTANCE from its
// start, size of the patches in meters, extinction inside them per meter, about 6 km of visibility
const int SHAFT_STEPS = 12;
const float SHAFT_DISTANCE = 20000.0;
const float SHAFT_SIZE = 2500.0;
// snow hides more, about 2.5 km
const vec2 SHAFT_EXTINCTION = vec2(0.0006, 0.0015);
// the wind's speed, from its tilt of the drops' fall at 9 m/s, also in the snow: a drift changing
// with the snow would move the shafts
const float DRIFT_VELOCITY = 9.0;
// the shafts thin out over this height below the cloud base, into the clouds
const float SHAFT_TOP = 1000.0;

void main() {
  vec4 eye = eyeAt(depthTexture, v_textureCoordinates);
  vec3 rayEnd = eye.w == 0.0 ? eye.xyz * SKY_DISTANCE : eye.xyz;
  // the part of the ray below the cloud base, and the part of it that is sampled
  vec2 below = belowHeight(rayEnd, cloudBase);
  float t0 = below.x;
  float t1 = below.y;
  float opacity = 0.0;
  float share = 0.0;
  float wet = 0.0;
  float lit = 1.0;
  if (t1 > t0) {
    float rayLength = length(rayEnd);
    float sampled = min(t1, t0 + SHAFT_DISTANCE / rayLength);
    // the ray in world coordinates, once rather than for each sample
    vec3 rayWC = czm_inverseViewRotation * rayEnd;
    vec3 upWorld = upWC();
    vec3 eastWorld = eastWC();
    float threshold = mix(0.4, 0.0, intensity);
    // the gusts sway the shafts, but they drift with the steady wind
    float slant = tan(gustingTilt());
    float drift = DRIFT_VELOCITY * speed * tan(radians(wind)) * time;
    float raining = 0.0;
    float sunlit = 0.0;
    float density = 0.0;
    for (int i = 0; i < SHAFT_STEPS; i++) {
      float t = mix(t0, sampled, (float(i) + 0.5) / float(SHAFT_STEPS));
      float h = heightAt(rayEnd * t);
      vec3 ground = czm_viewerPositionWC + rayWC * t - upWorld * h;
      float local = mapAt(ground);
      ground -= eastWorld * ((cloudBase - h) * slant + drift);
      float patches = gradientNoise(ground / SHAFT_SIZE);
      // in bands drifting with the shafts, the noise being about -0.7 to 0.7
      float extinction = rainExtinction(intensity * local, snow) * (1.0 + RAIN_BANDS * patches / 0.7);
      raining += extinction;
      // the sun through the clouds above the sample, weighted by how much it scatters there
      vec3 sampleWC = czm_viewerPositionWC + rayWC * t;
      sunlit += extinction * (shadowed > 0.0 ? exp(-shadowDepth(sampleWC)) : 1.0);
      wet += smoothstep(0.0, 0.15, local);
      float top = clamp((cloudBase - h) / SHAFT_TOP, 0.0, 1.0);
      density += local * top * smoothstep(threshold - 0.3, threshold + 0.3, patches);
    }
    // the whole part below the cloud base is as rainy as its sampled part, its extinction as a
    // share of the heaviest bands', and the share of it in the rain
    share = raining / (float(SHAFT_STEPS) * (1.0 + RAIN_BANDS) * rainExtinction(intensity, snow));
    wet /= float(SHAFT_STEPS);
    lit = raining > 0.0 ? sunlit / raining : 1.0;
    float depth = mix(SHAFT_EXTINCTION.x, SHAFT_EXTINCTION.y, snow) * (0.5 + 0.5 * intensity) * density * (sampled - t0) * rayLength / float(SHAFT_STEPS);
    opacity = 1.0 - exp(-depth);
  }
  out_FragColor = vec4(opacity, share, wet, lit);
}
