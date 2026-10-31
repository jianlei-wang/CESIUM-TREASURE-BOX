// The searchlight's cone, for its beam and for its pool of light: the light hangs above the focus,
// pointing down. Needs EyeFromDepth.
precision highp sampler2D;
uniform sampler2D depthTexture;
// in eye coordinates; w is 0 for what is in the middle of the screen
uniform vec4 focus;
// local up direction, in eye coordinates
uniform vec3 up;
// meters
uniform float radius;
// width of the penumbra, as a fraction of the radius
uniform float softness;

// height of the light above the focus, in radii: a cone of 53 degrees
const float HEIGHT = 2.0;

struct Cone {
  vec3 light;
  float height;
  // cosines of the angles, from the light's axis, at which the pool ends and its penumbra starts
  float coneCos;
  float penumbraCos;
};

// false without a focus in front of the camera (the sky in the middle, a focus behind)
bool spotlightCone(out Cone cone) {
  vec4 target = focus.w > 0.0 ? focus : eyeAt(depthTexture, vec2(0.5));
  if (target.w == 0.0 || target.z >= 0.0) {
    return false;
  }
  cone.height = HEIGHT * radius;
  cone.light = target.xyz + cone.height * up;
  float inner = radius * (1.0 - softness);
  cone.coneCos = cone.height / sqrt(cone.height * cone.height + radius * radius);
  cone.penumbraCos = cone.height / sqrt(cone.height * cone.height + inner * inner);
  return true;
}
