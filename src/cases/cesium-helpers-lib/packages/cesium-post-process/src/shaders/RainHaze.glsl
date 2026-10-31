// The haze of the rain or the snow, which Precipitation and Clouds share: its extinction, its
// opacity over an optical depth, and its color. The rain has no color of its own: its extinction
// is the same at all wavelengths for drops above 0.2 mm (Montero-Martinez et al. 2025), so the
// haze is the light of the sky and the sun it scatters toward the eye, L_in = (1 - T) * (the light
// scattered toward the eye) (Hillaire 2020): the clear sky of Cesium's atmosphere at the horizon,
// warm toward the sun and blue away from it, turning under thick clouds to the gray of an
// overcast sky, brighter overhead, and the sun's forward glow through thin clouds. A moonlit blue
// at night, as ValleyFog's. Needs Height, Fog and Phase.
precision highp sampler2D;

// the light intensity of the sky's atmosphere, which is not the scene's atmosphere's: 50 rather than
// 10 by default
uniform float skyLightIntensity;
// the clear sky toward the horizon and overhead, from SkyTable.glsl
uniform sampler2D skyTable;

// the rain rate, in mm/h, at intensity 1, the map's intensity being sqrt(R / RAIN_RATE), as the
// weather demo draws it from MeteoSwiss' radar
const float RAIN_RATE = 10.0;
// the extinction per meter of the rain, 0.11 R^0.85 per km at R mm/h, added to the clear air's, 0.1
// per km (Montero-Martinez et al. 2025): 39 km of visibility in dry air, 11.5 km at 2.5 mm/h, 4.4 km
// at 10 mm/h
const vec2 RAIN_LAW = vec2(0.00011, 0.85);
// layers of haze thinning out with the height, their extinction per meter at sea level and their
// scale height in meters, summed in optical depth with the rain's: the clear air's, 0.1 per km at
// the ground, over an aerosol's scale height of 1 to 2 km; and a mist lying low, 1 per km at the
// Swiss plateau's 500 m, that fills the valleys and leaves the ridges above it. Both scale heights
// and the mist's extinction are not from a source
const vec2 CLEAR_AIR = vec2(0.0001, 1200.0);
const vec2 MIST = vec2(0.0035, 400.0);
// the rain's extinction drifts in bands, by this share around its mean: sigma_rain *=
// mix(0.6, 1.4, noise) (Wronski 2014, "procedural Perlin noise animated by wind")
const float RAIN_BANDS = 0.4;
// visibility in meters at intensity 0 and 1 in the snow
const vec2 SNOW_VISIBILITY = vec2(20000.0, 500.0);
// the haze never quite hides the sky and the far terrain
const float MAX_HAZE = 0.9;
// the overcast sky at the horizon by day, a brighter gray under snow clouds; overhead, it is three
// times as bright, the CIE's overcast sky, L / L_zenith = (1 + 2 sin(elevation)) / 3 (CIE 2003),
// and darker under thick clouds, by up to this share: the report's 0.6 left the haze under the
// heaviest rain at a quarter of the brightness, darker than the scene it veils, which the overcast
// only dims by half
const vec3 RAIN_HAZE = vec3(0.6, 0.64, 0.68);
const vec3 SNOW_HAZE = vec3(0.7, 0.72, 0.76);
const float THICK_CLOUDS = 0.3;
// the asymmetry of the light scattered by the rain and by the snow, from the haze's 0.7 to the
// rain's 0.9 to 1 (arXiv 1403.2977)
const vec2 HAZE_ASYMMETRY = vec2(0.9, 0.75);
// the sky toward the horizon is a ray this long, out of the atmosphere
const float SKY_RAY = 1e7;
// the clear sky at the horizon is read this far above it, in radians, 5 degrees: right at it,
// Cesium's atmosphere turns a pale cyan that its sky, interpolated from the vertices of its dome,
// never shows
const float SKY_ELEVATION = 0.087;
// the sky table's texels toward the horizon, besides the one overhead, SkyTable.glsl's
const float SKY_TABLE = 64.0;

// the extinction per meter, from the rain's to the snow's, as hard as it rains: 3.912 / visibility
// is the extinction that leaves 2 % of the light. None where it does not rain, rising from 0 at the
// edge of the rain: the dry air is Cesium's fog's
float rainExtinction(float intensity, float snow) {
  float rain = max(RAIN_LAW.x * pow(RAIN_RATE * intensity * intensity, RAIN_LAW.y), 1e-9);
  float snowfall = 3.912 / (SNOW_VISIBILITY.x * pow(SNOW_VISIBILITY.y / SNOW_VISIBILITY.x, intensity));
  return smoothstep(0.0, 0.15, intensity) * rain * pow(snowfall / rain, snow);
}

// the optical depth of a layer of haze along a straight ray this long from height h0 to h1, its
// height linear along it: the line integral of exponential height fog,
// (a / b) exp(-b h0) (1 - exp(-b dh)) / dh per unit of length (Quilez), with the first terms of its
// Taylor series where the ray is level, as Flax's ExponentialHeightFog.hlsl
float layerDepth(vec2 layer, float h0, float h1, float rayLength) {
  float x = (h1 - h0) / layer.y;
  float level = abs(x) < 1e-3 ? 1.0 - 0.5 * x : (1.0 - exp(-x)) / x;
  return layer.x * rayLength * exp(-h0 / layer.y) * level;
}

// the haze's opacity over an optical depth in the rain
float rainHaze(float opticalDepth) {
  return MAX_HAZE * (1.0 - exp(-opticalDepth));
}

// the clear sky in a direction in world coordinates from a point at a height, as the sky shader of Cesium's atmosphere
// renders it without high dynamic range, its inner radius lowered as SkyAtmosphereCommon.glsl
// lowers it: from the ellipsoid's surface, a ray toward the horizon would cross the densest air
// for hundreds of kilometers and turn a dim yellow
vec3 clearSkyFrom(vec3 originWC, float height, vec3 directionWC, vec3 lightWC) {
  czm_ray ray = czm_ray(originWC, directionWC);
  float radiiDifference = czm_ellipsoidRadii.x - czm_ellipsoidRadii.z;
  float adjust = 0.5 * radiiDifference * clamp((height - 0.25 * czm_ellipsoidRadii.x) / (0.75 * czm_ellipsoidRadii.x), 0.0, 1.0);
  float innerRadius = length(originWC) - height - 0.25 * radiiDifference - adjust;
  vec3 rayleigh;
  vec3 mie;
  float opacity;
  czm_computeScattering(ray, SKY_RAY, lightWC, innerRadius, rayleigh, mie, opacity);
  vec3 color = czm_computeAtmosphereColor(ray, lightWC, rayleigh, mie, opacity).rgb * skyLightIntensity / czm_atmosphereLightIntensity;
  return czm_inverseGamma(czm_pbrNeutralTonemapping(color));
}

// the clear sky seen from the camera
vec3 clearSky(vec3 directionWC, vec3 lightWC) {
  return clearSkyFrom(czm_viewerPositionWC, czm_eyeHeight, directionWC, lightWC);
}

// the clear sky seen from under the camera at a height, or from the camera if it is lower: from
// far above, the camera sees the black of space overhead, not the sky the clouds and the haze see,
// whose color divided by its luminance would turn to any hue
vec3 clearSkyBelow(float height, vec3 directionWC, vec3 lightWC) {
  float h = min(czm_eyeHeight, height);
  return clearSkyFrom(czm_viewerPositionWC - normalize(czm_viewerPositionWC) * (czm_eyeHeight - h), h, directionWC, lightWC);
}

// the clear sky toward a view direction in eye coordinates, at its azimuth and at an elevation
// above the horizon, in radians, lit by the scene's light, as the sky's atmosphere is lit by
// default: the scene's atmosphere is lit from overhead by default, and would turn the horizon cyan
// at any time of day
vec3 skyToward(vec3 view, float elevation) {
  vec3 level = view - dot(view, up) * up;
  level = dot(level, level) > 1e-6 ? normalize(level) : normalize(cross(up, vec3(1.0, 0.0, 0.0)));
  return clearSky(czm_inverseViewRotation * (cos(elevation) * level + sin(elevation) * up), czm_lightDirectionWC);
}

// the clear sky toward a view direction in eye coordinates, from the sky table: at its azimuth from
// the sun's, SKY_ELEVATION above the horizon, toward overhead as it looks up
vec3 skyFromTable(vec3 view) {
  vec3 level = view - dot(view, up) * up;
  vec3 sun = czm_lightDirectionEC - dot(czm_lightDirectionEC, up) * up;
  float cosAzimuth = dot(level, level) > 1e-6 && dot(sun, sun) > 1e-6 ? dot(normalize(level), normalize(sun)) : 1.0;
  float u = (acos(clamp(cosAzimuth, -1.0, 1.0)) / czm_pi * (SKY_TABLE - 1.0) + 0.5) / (SKY_TABLE + 1.0);
  vec3 horizon = texture(skyTable, vec2(u, 0.5)).rgb;
  vec3 zenith = texture(skyTable, vec2((SKY_TABLE + 0.5) / (SKY_TABLE + 1.0), 0.5)).rgb;
  return mix(horizon, zenith, max(dot(view, up), 0.0));
}

// the haze's light toward the eye along a view direction in eye coordinates, under an overcast as
// thick as it rains at the camera or along the ray, 0 to 1: the sky's, from the clear sky to the
// overcast gray, and the sun's through the clouds, as much of it as reaches the haze, 0 to 1.
// Drops scatter nearly all the light they intercept: an albedo of 1
vec3 rainHazeColor(vec3 view, float day, float snow, float overcast, float sunlit) {
  float elevation = max(dot(view, up), 0.0);
  vec3 sky = skyFromTable(view);
  vec3 overcastSky = mix(RAIN_HAZE, SNOW_HAZE, snow) * (1.0 + 2.0 * elevation) * (1.0 - THICK_CLOUDS * overcast);
  vec3 sun = czm_lightColor * sunlit * henyeyGreenstein(dot(view, czm_lightDirectionEC), mix(HAZE_ASYMMETRY.x, HAZE_ASYMMETRY.y, snow));
  vec3 color = min(mix(sky, overcastSky, overcast) + sun, vec3(1.0));
  return byDaylight(color, day);
}
