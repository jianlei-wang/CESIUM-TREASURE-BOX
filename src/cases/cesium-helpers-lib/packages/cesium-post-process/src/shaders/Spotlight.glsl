// A searchlight above the focus, pointing down: it throws a pool of warm light radius meters
// wide on flat ground, with a soft penumbra, shades the relief under it and lights up the haze
// in its beam, from SpotlightBeam.glsl; the rest of the scene darkens and loses its color. The
// cone and the falloff follow three.js's SpotLight. Needs EyeFromDepth, Normal, Filmic and
// SpotlightCone.
precision highp sampler2D;
uniform sampler2D colorTexture;
// the beam's haze and the log2 of the scene distance, at a fraction of the resolution
uniform sampler2D beamTexture;
// 0 to 1
uniform float darkness;
// brightness of the beam in the air, 0 to 1
uniform float beam;
// brightness of the light, 1 for the searchlight: the pool and the beam scale with it
uniform float power;
in vec2 v_textureCoordinates;

const vec3 LIGHT_COLOR = vec3(1.0, 0.93, 0.8);
const float INTENSITY = 1.4;
// difference of the log2 of the distances, about 10 %, under which the beam's texels around a
// pixel are interpolated
const float SOFT_DEPTH = 0.14;

// light reaching a point fromLight away from the light: the cone around the axis with its
// penumbra, and the inverse square, 1 at the focus, capped for what is close to the light
float spotAt(vec3 fromLight, vec3 axis, float height, float coneCos, float penumbraCos) {
  float lightDistance = length(fromLight);
  float spot = smoothstep(coneCos, penumbraCos, dot(fromLight, -axis) / lightDistance);
  return spot * min(height * height / (lightDistance * lightDistance), 4.0);
}

// the beam's haze at the pixel, from the four texels of its lower resolution around it:
// interpolated where they are all at the pixel's distance, else the one nearest to it, so that the
// haze stops at the ridges in front of it rather than spilling onto them
float beamAt(vec2 uv, float depth) {
  ivec2 size = textureSize(beamTexture, 0);
  vec2 position = uv * vec2(size) - 0.5;
  ivec2 base = ivec2(floor(position));
  vec2 f = fract(position);
  float interpolated = 0.0;
  float nearest = 0.0;
  float nearestGap = 1e38;
  float widestGap = 0.0;
  for (int i = 0; i < 4; i++) {
    ivec2 offset = ivec2(i & 1, i >> 1);
    vec2 texel = texelFetch(beamTexture, clamp(base + offset, ivec2(0), size - 1), 0).rg;
    float gap = abs(texel.g - depth);
    vec2 weights = mix(1.0 - f, f, vec2(offset));
    interpolated += weights.x * weights.y * texel.r;
    if (gap < nearestGap) {
      nearestGap = gap;
      nearest = texel.r;
    }
    widestGap = max(widestGap, gap);
  }
  return widestGap < SOFT_DEPTH ? interpolated : nearest;
}

void main() {
  vec4 sceneColor = texture(colorTexture, v_textureCoordinates);
  Cone spot;
  if (!spotlightCone(spot)) {
    out_FragColor = sceneColor;
    return;
  }
  vec3 color = sceneColor.rgb;
  vec3 ambient = czm_saturation(color, 1.0 - darkness) * (1.0 - darkness);
  vec4 eye = eyeAt(depthTexture, v_textureCoordinates);

  // eye.w is 0 for the sky, where the view ray goes on
  float sceneDistance = eye.w == 0.0 ? 1e30 : length(eye.xyz);
  float scattered = beam > 0.0 ? beamAt(v_textureCoordinates, log2(sceneDistance)) : 0.0;
  vec3 haze = LIGHT_COLOR * (power * beam * scattered);
  if (eye.w == 0.0) {
    out_FragColor = vec4(filmic(ambient + haze), sceneColor.a);
    return;
  }

  vec3 toLight = spot.light - eye.xyz;
  // the normal over wider steps where the surface is seen at a grazing angle, where the facets
  // of the terrain mesh would show as blotches; over fine ones elsewhere, for the relief
  vec3 coarse = normalize(normalAt(depthTexture, v_textureCoordinates, eye.xyz, 6.0 * czm_pixelRatio)
    + normalAt(depthTexture, v_textureCoordinates, eye.xyz, 18.0 * czm_pixelRatio));
  float grazing = smoothstep(0.7, 0.95, 1.0 - abs(dot(coarse, normalize(-eye.xyz))));
  vec3 normal = normalize(mix(smoothNormalAt(depthTexture, v_textureCoordinates, eye.xyz), coarse, grazing));
  float lambert = max(dot(normal, normalize(toLight)), 0.0);
  vec3 light = LIGHT_COLOR * (power * INTENSITY * spotAt(-toLight, up, spot.height, spot.coneCos, spot.penumbraCos) * lambert);
  out_FragColor = vec4(filmic(ambient + color * light + haze), sceneColor.a);
}
