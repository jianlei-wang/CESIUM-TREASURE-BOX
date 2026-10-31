// Snow above an altitude, on slopes gentle enough to hold it, shaded by the sun and by the
// brightness of the scene so that the relief stays readable. The slope comes from a normal
// rebuilt from the neighboring pixels and smoothed over the facets of the terrain. Noise anchored
// to the ground breaks up the edge of the snow, which lasts lower on the slopes away from the sun.
precision highp sampler2D;
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
// meters above the ellipsoid: half covered at the altitude, over a band transition meters high
uniform float altitude;
uniform float transition;
// radians
uniform float maxSlope;
// 0 to 1
uniform float coverage;
// 0 to 1: how far the coverage thins the snow into patches, where 0 fades it
uniform float patchiness;
// meters: the noise's largest scale, its finer ones a third and a ninth of it
uniform float grain;
// 0 to 1: how far the snow's brightness is the scene's own (its shadows, the dusk), where 0 is the sun's shading
uniform float sceneLight;
// 0 to 1: the part of the snow that still covers the steep slopes at the limit, as a fraction of the coverage
uniform float steepCover;
// the local frame's coordinates from the eye's, made in double precision on the CPU (local-frame.js): the noise's place
uniform mat4 localFromEye;
// meters above the ellipsoid, far above anything with no water: none lies within a quarter meter of it
uniform float waterLevel;
// the sun toward which the snow is shaded, in eye coordinates, when ownSun is 1; else Cesium's
uniform vec3 sunEC;
uniform float ownSun;
in vec2 v_textureCoordinates;

const vec3 SNOW_SHADE = vec3(0.80, 0.87, 1.0);
const vec3 SNOW_SUN = vec3(1.0, 0.98, 0.94);
// meters the snow line moves down on a slope facing away from the sun, and up on one facing it
const float ASPECT_SHIFT = 0.6;
// meters the noise moves the snow line, as a fraction of the transition
const float NOISE_SHIFT = 0.8;
// half width of the slope limit, in radians (8 degrees), so that the snow thins out across the
// facets of the terrain rather than stopping at their edges
const float SLOPE_EDGE = 0.14;
// the coverage, moved by the noise, from which the snow begins and is whole when it is patches; how far the noise moves it
const vec2 PATCH = vec2(0.25, 0.6);
const float PATCH_NOISE = 1.6;
// meters from the water's level within which a surface is water, and beyond which it is not
const vec2 WET = vec2(0.1, 0.25);

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float valueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

// 0 to 1, from a few octaves anchored to the ground, in the local frame: in world coordinates a float steps by half a meter
float groundNoise(vec3 local) {
  return 0.55 * valueNoise(local / grain) + 0.3 * valueNoise(3.0 * local / grain) + 0.15 * valueNoise(9.0 * local / grain);
}

void main() {
  vec4 sceneColor = texture(colorTexture, v_textureCoordinates);
  vec4 eye = eyeAt(depthTexture, v_textureCoordinates);
  vec3 normal = smoothNormalAt(depthTexture, v_textureCoordinates, eye.xyz);
  float slope = acos(clamp(dot(normal, up), -1.0, 1.0));

  float sun = max(dot(normal, ownSun > 0.5 ? sunEC : czm_sunDirectionEC), 0.0);
  float noise = groundNoise((localFromEye * vec4(eye.xyz, 1.0)).xyz) - 0.5;
  // lower on the slopes away from the sun, irregular along the edge
  float shift = transition * (NOISE_SHIFT * noise + ASPECT_SHIFT * (0.5 - sun));
  float snowLine = altitude + shift;
  float snow = smoothstep(snowLine - 0.5 * transition, snowLine + 0.5 * transition, heightAt(eye.xyz));
  // opaque before the top of the band, so that the imagery does not show through the snow
  snow = smoothstep(0.0, 0.7, snow);
  // the steep slopes keep a thin, patchy cover, and the rock shows through
  float steep = smoothstep(maxSlope - SLOPE_EDGE, maxSlope + SLOPE_EDGE, slope);
  snow *= 1.0 - steep * (1.0 - steepCover * smoothstep(0.35, 0.65, noise + 0.5));
  // the coverage an opacity, or, by the patchiness, the share of the ground the snow covers, the noise leaving it in patches
  float scattered = smoothstep(PATCH.x, PATCH.y, coverage + PATCH_NOISE * noise);
  // eye.w is 0 for the sky
  snow *= mix(coverage, scattered, patchiness) * eye.w;
  snow *= smoothstep(WET.x, WET.y, abs(heightAt(eye.xyz) - waterLevel));
  snow *= openSky(eye.xyz);
  float brightness = czm_luminance(sceneColor.rgb);
  // blue in the shade, warm in the sun, with the relief of the scene kept in the brightness; or as bright as the scene, its shadows and its
  // dusk kept on the snow
  float shaded = clamp(0.68 + 0.25 * sun + 0.1 * brightness, 0.0, 1.0);
  float scene = clamp(0.15 + 1.35 * brightness, 0.0, 1.0);
  vec3 lit = mix(SNOW_SHADE, SNOW_SUN, sun) * mix(shaded, scene, sceneLight);
  out_FragColor = vec4(mix(sceneColor.rgb, lit, snow), sceneColor.a);
}
