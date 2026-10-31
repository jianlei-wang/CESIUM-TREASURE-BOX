// The haze lit by the searchlight's beam, at a fraction of the resolution, as in Killzone Shadow
// Fall's volumetrics (Valient, SIGGRAPH 2014): r is the light scattered along the view ray, g the
// log2 of the scene distance for SpotlightBeamBlur.glsl and the upsampling: half floats hold it, and
// distances compare as ratios. Needs EyeFromDepth, Hash, Noise, SpotlightCone and Beam.
// brightness of the beam in the air, 0 to 1
uniform float beam;
// Henyey-Greenstein asymmetry of the haze, 0 to 1: it scatters mostly forward, so the beam is
// brighter when looking toward the light
uniform float beamAnisotropy;
in vec2 v_textureCoordinates;

// radius of the beam's bright core around the light, in heights: the inverse square is softened
// within it, as the pool's is capped, so that the top of the beam does not burn out
const float BEAM_CORE = 0.25;
// brightness of the lit haze, over the height so that it keeps with the radius, matched to the
// searchlight's former analytic beam at the default anisotropy
const float BEAM_DENSITY = 19.0;
// contrast and density of the dust streaks in the beam, across its width
const float STREAKS = 0.2;
const float STREAK_SCALE = 4.0;

void main() {
  vec4 eye = eyeAt(depthTexture, v_textureCoordinates);
  // eye.w is 0 for the sky, where the view ray goes on
  float sceneDistance = eye.w == 0.0 ? 1e30 : length(eye.xyz);
  Cone spot;
  if (beam <= 0.0 || !spotlightCone(spot)) {
    out_FragColor = vec4(0.0, log2(sceneDistance), 0.0, 1.0);
    return;
  }
  Beam cone;
  cone.apex = spot.light;
  cone.forward = -up;
  cone.edgeCos = spot.coneCos;
  cone.coreCos = spot.penumbraCos;
  cone.hotCore = 0.0;
  cone.light = spot.light;
  cone.reference = spot.height;
  cone.core = BEAM_CORE * spot.height;
  cone.reach = 1e30;
  cone.extinction = 0.0;
  cone.anisotropy = beamAnisotropy;
  cone.spacing = 1.0;
  cone.nearFade = vec2(0.0);
  cone.dust = STREAKS;
  cone.dustScale = STREAK_SCALE;
  float scattered = BEAM_DENSITY / spot.height * beamAlong(normalize(eye.xyz), sceneDistance, cone);
  out_FragColor = vec4(scattered, log2(sceneDistance), 0.0, 1.0);
}
