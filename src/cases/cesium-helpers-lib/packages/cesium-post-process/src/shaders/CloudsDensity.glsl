// The clouds' density at a point, which the march and the shadow map share: as tall and as solid
// as the rain under it is heavy, shaped by billows of noise that drift with the wind. Needs
// CloudsSlab and WeatherMap.
// the noise: the billows of the base shape in red, the details in green and blue
precision highp sampler2D;
uniform highp sampler3D cloudNoise;
// the noise over the clouds' map, a square that repeats, from cloud-noise.js
uniform sampler2D mapNoise;
// meters above the ellipsoid
uniform float cloudTop;
// the direction the wind blows toward, and how far it has carried the noise, in world coordinates
uniform vec3 windDirection;
uniform vec3 windOffset;
// scale of the opacity
uniform float density;

// the clouds over the lightest rain are this thick, in meters, clouds.js's THIN_DEPTH
const float THIN_DEPTH = 1500.0;
// the clouds' base is flat, reaching their full density over this share of their height,
// remap(h, 0, 0.05, 0, 1): the lifting condensation level is about the same across an air mass; the
// deck is full up to this share of its height, then thins out to its top; towers thin out all the
// way up, in the convective envelope pow(1 - h, 1.5) (Schneider 2022); and spread an anvil from
// this share of their height to this one, their coverage raised to a power from 1 to this one,
// pow(coverage, remap(h, 0.7, 0.8, 1, lerp(1, 0.5, anvil_bias))) (Schneider 2017). The report
// gives these as starting points, not from a source it could check
const float FLAT_BASE = 0.05;
const float DECK_TOP = 0.65;
const float TOWER_ENVELOPE = 1.5;
const vec3 ANVIL = vec3(0.7, 0.8, 0.5);
// the cloud shield over dry ground is broken: its coverage is this share of the clouds' over the
// rain, which the rain raises to the full
const float SHIELD_COVERAGE = 0.5;
// the map's cells are read jittered by up to this share of a cell, uv + 0.3 * perlin2(uv * k)
// cells, so that their squares do not show; and the coverage varies by up to this share around its
// mean, by noise over 8 cells, 8 km of the radar's 1 km cells, a pattern that is not the billows'
// noise, whose tile would show (Högfeldt 2016). Both from a square of noise made once
// (cloud-noise.js), read once rather than computed three times at each sample, which spans this
// many of the map's cells, cloud-noise.js's MAP_TILE_CELLS
const float MAP_JITTER = 0.3;
const float COVERAGE_NOISE = 0.4;
const float MAP_TILE_CELLS = 64.0;

// the clouds' map at a point in world coordinates, jittered, its coverage varied, 0 outside the map
vec4 cloudMapAt(vec3 positionWC) {
  vec2 cells = vec2(textureSize(map, 0));
  vec2 uv = mapUv(positionWC);
  // the jitter in red and green, the coverage's variation in blue, -1 to 1
  vec3 noise = texture(mapNoise, uv * cells / MAP_TILE_CELLS).rgb * 2.0 - 1.0;
  uv += MAP_JITTER * noise.rg / cells;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
    return vec4(0.0);
  }
  vec4 texel = mix(texture(map, uv), texture(nextMap, uv), mapBlend);
  texel.g = clamp(texel.g * (1.0 + COVERAGE_NOISE * noise.b), 0.0, 1.0);
  return texel;
}
// extinction inside a solid cloud, per meter: about 1.3 km of visibility
const float EXTINCTION = 0.003;
// the noise repeats every this many meters, in 4 billows across, with this many voxels, clouds.js's
// NOISE_SIZE, and its details are about this size
const float NOISE_TILE = 16000.0;
const float NOISE_VOXELS = 64.0;
const float DETAIL_SIZE = 1000.0;
// the scale of the larger lookup of the noise, not a fraction that would line its tiles up
const float LARGE_SCALE = 0.27;
// the noise is read this many mipmaps blurrier than a pixel's footprint: its features then span a
// few pixels of the pass, rather than one that the upscale would turn into a square
const float LOD_BIAS = 1.5;
// the clouds lean downwind by this many meters from the base to the top of the slab,
// p += height_fraction * wind_direction * 500 (Schneider 2017)
const float WIND_SKEW = 500.0;
// how much the details erode the thin edges of the clouds
const float EROSION = 0.6;
// the details are wisps at the base of a cloud, billows above this share of its height: inverted
// Worley noise at the base for "some nice whispy shapes" (Schneider 2015)
const float WISPY_BASE = 0.3;

// the cloud's density at a point, 0 to the density uniform, from the clouds' map (cloud-map.js):
// where its shield covers the ground, as tall as its type, a deck over drizzle to towers over heavy
// rain, and as solid as the rain under it is heavy, which it gives, with the share of the height of
// its column and its dimensional profile. The noise is read at the mipmap of the footprint of a
// pixel, in meters, and the details fade out as it grows: sampled once a pixel, finer noise would
// alias into speckles
float cloudDensity(vec3 positionWC, float h, float footprint, out float rain, out float column, out float dimensional) {
  // the rain in red, the shield's coverage in green, the clouds' type in blue
  vec4 cell = cloudMapAt(positionWC);
  float m = cell.r;
  float type = cell.b;
  rain = m;
  column = 0.0;
  dimensional = 0.0;
  if (cell.g <= 0.0) {
    return 0.0;
  }
  float top = cloudBase + mix(THIN_DEPTH, cloudTop - cloudBase, type);
  float y = (h - cloudBase) / (top - cloudBase);
  column = y;
  if (y <= 0.0 || y >= 1.0) {
    return 0.0;
  }
  float base = clamp(y / FLAT_BASE, 0.0, 1.0);
  float profile = base * mix(1.0 - smoothstep(DECK_TOP, 1.0, y), pow(1.0 - y, TOWER_ENVELOPE), type);
  float lod = max(log2(footprint * NOISE_VOXELS / NOISE_TILE) + LOD_BIAS, 0.0);
  // the noise drifts with the wind and the map does not, so the clouds stay where it rains and
  // their billows pass through them (Schneider 2017)
  float slabFraction = clamp((h - cloudBase) / (cloudTop - cloudBase), 0.0, 1.0);
  vec3 q = (positionWC - windOffset - WIND_SKEW * slabFraction * windDirection) / NOISE_TILE;
  vec4 noise = textureLod(cloudNoise, fract(q), lod);
  // the same noise about four times larger, its axes swapped, breaks up the repetition of the tile,
  // which far views would show as a grid
  float large = textureLod(cloudNoise, fract(LARGE_SCALE * q.zxy + 0.5), max(lod + log2(LARGE_SCALE), 0.0)).r;
  noise.r = clamp(noise.r + 0.6 * (large - 0.5), 0.0, 1.0);
  float coverage = cell.g * mix(SHIELD_COVERAGE, 1.0, m);
  coverage = pow(coverage, mix(1.0, mix(1.0, ANVIL.z, type), clamp((y - ANVIL.x) / (ANVIL.y - ANVIL.x), 0.0, 1.0)));
  dimensional = profile * coverage;
  // the profile times the coverage carves the noise rather than scaling it,
  // saturate(noise - (1 - dimensional_profile)) (Schneider 2022): the core stays solid, and only
  // the noise's highest billows reach the top and the base. Ramped up over a softness rather than
  // sharpened by a power as in Nubis Cubed (Schneider 2023): with 250 m voxels, a sharp edge
  // follows their interpolation in a grid. The edges soften as the pixels grow, which would
  // otherwise cut them in steps of the pass's resolution
  float soft = 0.15 + 0.35 * clamp(footprint / 2000.0, 0.0, 1.0);
  float shape = smoothstep(0.0, soft, noise.r - (1.0 - profile * coverage));
  // the details erode where the cloud is thin, its edges, and leave its core solid
  float billows = mix(noise.g, noise.b, 0.4);
  float detail = mix(1.0 - billows, billows, clamp(y / WISPY_BASE, 0.0, 1.0)) * (1.0 - smoothstep(0.25, 0.5, footprint / DETAIL_SIZE));
  float erosion = EROSION * detail * (1.0 - shape);
  return density * clamp((shape - erosion) / (1.0 - erosion), 0.0, 1.0);
}
