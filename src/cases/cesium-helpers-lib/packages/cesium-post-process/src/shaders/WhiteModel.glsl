// A white model's look, as an architect's plaster model or clay render, after DepthEdges: every
// color turned to its value and the values pressed into a narrow range of whites (an accent's hue
// kept, if asked; the darkest left black, a section's poché), so the light and the shapes alone
// tell the surfaces apart; darker where surfaces meet, an ambient obscurance from the depth; the
// creases lit and shaded, a fine outline along the jumps; the sky, if asked, a pale gradient.
// its samplers read in high precision, whatever comes before (a phone's GPU's default is low)
precision highp sampler2D;
uniform sampler2D colorTexture;
// how much brighter a convex edge gets, how much darker a concave one
uniform float light;
uniform float shade;
// the edges' bevel, in meters, a pixel at the least; how much darker the outline, 0 for none
uniform float bevel;
uniform float outline;
// the colors' saturation, 0 for white, and a factor each of red, green and blue: the plaster's tint
uniform float saturation;
uniform vec3 warm;
// the darkest and the lightest values, the scene's black and white; the value under which a color
// keeps it, 0 for none
uniform vec2 values;
uniform float poche;
// how much darker a corner gets, and how wide its shadow is, in meters
uniform float occlusion;
uniform float radius;
// the sky's gradient, from the top of the screen to its bottom; w 0 to keep the sky
uniform vec4 skyTop;
uniform vec4 skyBottom;
in vec2 v_textureCoordinates;

// the darkest colors' values, under the poché's, kept as they are rather than pressed into the
// whites, fading into them over these shares of it: an architect's poché, solid black, or a text's
const vec2 POCHE = vec2(0.6, 1.4);
// the occlusion: its widest, in pixels; its samples, on a spiral turned by the golden angle, the
// spiral itself turned from pixel to pixel; how steeply above the surface a sample rises to count
// (the normal from the depth is not exact), and how far from the pixel, in meters, a pixel and a
// half at the least (the depth's own steps on a flat wall not counted); how many pixels wide the
// disc is to show, fading in (zoomed out, its samples fall within the depth's noise)
const float RING = 48.0;
const int SAMPLES = 12;
const float GOLDEN = 2.39996;
const float BIAS = 0.15;
const float NEAREST = 0.05;
const vec2 SHOWN = vec2(3.0, 8.0);

// how much the surfaces around uv close in over it, from 0 to 1, as the Alchemy ambient obscurance
// (McGuire et al. 2011): the share of the samples around it, in a disc of the radius, that rise
// above its surface (its normal from the depth's slopes), each the more as it rises steeper, none
// farther than the radius; a corner's foot about a half, a flat floor none. p its eye coordinates, n
// their slopes' normal
float occludedAt(vec2 uv, vec3 p, vec3 n, float pixel) {
  float reach = min(radius, RING * pixel);
  float shown = smoothstep(SHOWN.x, SHOWN.y, reach / pixel);
  if (shown == 0.0) {
    return 0.0;
  }
  // turned toward the eye
  vec3 eye = czm_orthographicIn3D == 1.0 ? vec3(0.0, 0.0, 1.0) : normalize(-p);
  n = dot(n, eye) < 0.0 ? -n : n;
  float nearest = max(NEAREST, 1.5 * pixel);
  float spin = 6.2832 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float sum = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    float a = float(i) * GOLDEN + spin;
    vec2 o = vec2(cos(a), sin(a)) * (float(i) + 0.5) / float(SAMPLES) * reach / pixel / czm_viewport.zw;
    vec4 q = eyeAt(depthTexture, uv + o);
    vec3 v = q.xyz - p;
    float d = length(v);
    if (q.w > 0.0 && d > nearest) {
      sum += max(0.0, dot(v / d, n) - BIAS) * (1.0 - smoothstep(0.5 * reach, reach, d));
    }
  }
  return shown * sum / float(SAMPLES);
}

void main() {
  vec2 uv = v_textureCoordinates;
  // the surface's normal from the depth's slopes, read before any pixel returns, in step with its
  // neighbors
  vec3 p = eyeAt(depthTexture, uv).xyz;
  vec3 normal = normalize(cross(dFdx(p), dFdy(p)));
  vec4 sceneColor = texture(colorTexture, uv);
  float c = depthAt(uv);
  if (c == SKY) {
    out_FragColor = skyTop.w > 0.0 ? vec4(skyAt(uv, skyTop, skyBottom), 1.0) : sceneColor;
    return;
  }
  float pixel = pixelAt(c);
  // the color's value pressed between the darkest and the lightest, but the darkest's; its hue as
  // saturated as asked, scaled down rather than clipped where a channel would pass 1
  float value = czm_luminance(sceneColor.rgb);
  float kept = poche > 0.0 ? 1.0 - smoothstep(POCHE.x * poche, POCHE.y * poche, value) : 0.0;
  float pressed = mix(mix(values.x, values.y, value), value, kept);
  vec3 hue = sceneColor.rgb * pressed / max(value, 1e-4);
  vec3 color = mix(vec3(pressed), hue / max(1.0, max(hue.r, max(hue.g, hue.b))), saturation);
  float steps = clamp(bevel / pixel, 1.0, BEVEL);
  if (light != 0.0 || shade != 0.0) {
    vec4 n = neighborsAt(uv, c, steps);
    float crease = creaseOf(n, steps * pixel, pixel);
    color *= n.x + n.y + n.z + n.w > 0.0 ? 1.0 + light * crease : 1.0 - shade * crease;
  }
  if (occlusion > 0.0) {
    color *= 1.0 - occlusion * occludedAt(uv, p, normal, pixel);
  }
  if (outline > 0.0) {
    color *= 1.0 - outline * outlineAt(uv, c, vec4(0.0), steps, pixel);
  }
  out_FragColor = vec4(clamp(color * warm, 0.0, 1.0), sceneColor.a);
}
