// The Dufour map's look, after EyeFromDepth, DepthEdges, Height, Normal and Hash: the slopes drawn in hachures, ink
// strokes down the steepest slope, broken along their length, thicker where it is steeper and on the slopes away from a
// light from the north-west, the flat ground left blank; the silhouettes outlined; black ink on white paper.
precision highp sampler2D;
uniform sampler2D colorTexture;
// the strokes' spacing on the screen, in pixels, their length in spacings, the ink's weight
uniform float spacing;
uniform float strokeLength;
uniform float weight;
// how much thinner the strokes facing the light, and thicker away from it, 0 to 1
uniform float oblique;
// the slope under which the ground is left blank, radians
uniform float flatSlope;
uniform float outline;
uniform vec3 paper;
uniform vec3 ink;
// the hachures' frame, in eye coordinates: its origin on the ground below the camera, east and north there (dufour.js)
uniform vec3 originEC;
uniform vec3 eastEC;
uniform vec3 northEC;
in vec2 v_textureCoordinates;

// the strokes' finest spacing, in meters
const float BASE = 1.0;
// the strokes' directions: the way down the slope snapped to one of these many, the two nearest blended, so that the
// strokes are straight lines, parallel on a slope, rather than turning with each pixel's normal
const float DIRECTIONS = 12.0;
// a stroke's breaks: its length in spacings, strokeLength long on average, and the share of it left blank
const float BREAK = 0.08;
// the light, from the north-west, in east and north
const vec2 LIGHT = vec2(-0.7071, 0.7071);
// the ink's share grows with the slope, none on the flat, all of it at 60 degrees (radians), Lehmann's scale
// stretched for the Alps, whose slopes are mostly past his 45; the
// widest share of the spacing a stroke covers, the paper showing between them, an engraving's
const float LEHMANN = 1.047;
const float MAX_COVER = 0.45;
// the slopes over which the strokes fade in above the flat ground, radians (2 degrees): the terrain's triangles,
// slightly tilted, would show as patches
const float FLAT_RAMP = 0.035;

// the strokes' ink at a point of the ground, en its east and north, s their spacing in meters, angle the direction
// down the slope they run along, cover the share of the spacing they cover. Each stroke is a straight line along it,
// broken every strokeLength spacings or so, its breaks staggered from the next stroke's: no line across the strokes
float hachuresAt(vec2 en, float angle, vec2 across, float cover, float s) {
  vec2 down = vec2(-across.y, across.x);
  // a phase of each direction, so that two directions' strokes do not meet in a pattern
  float u = dot(en, across) / s + hash(vec2(angle, s));
  float stroke = floor(u);
  float w = dot(en, down) / (strokeLength * s) + hash(vec2(stroke, s));
  float dash = step(BREAK, fract(w * mix(0.8, 1.25, hash(vec2(s, stroke)))));
  // antialiased, and its mean, the share it covers, where the strokes grow too close to tell apart (a slope seen
  // edge on): no ink where it covers none
  float halfWidth = 0.5 * cover;
  float aa = fwidth(u);
  float sharp = 1.0 - smoothstep(halfWidth - aa, halfWidth + aa, abs(fract(u) - 0.5));
  return mix(sharp * dash, 2.0 * halfWidth * (1.0 - BREAK), smoothstep(0.2, 0.5, aa)) * step(1e-3, halfWidth);
}

// the strokes in one direction, their spacing a power of two of meters, crossfaded with the next, so that they stay at
// least spacing pixels apart: taken from the ground a pixel covers across them, far more than its width where a slope
// is seen at a grazing angle
float directionAt(vec2 en, float angle, float cover) {
  vec2 across = vec2(-sin(angle), cos(angle));
  float lod = log2(max(spacing * fwidth(dot(en, across)), BASE) / BASE);
  float s = BASE * exp2(floor(lod));
  return mix(hachuresAt(en, angle, across, cover, s), hachuresAt(en, angle, across, cover, 2.0 * s), fract(lod));
}

// the strokes in both of the directions nearest the way down, blended
float strokesAt(vec2 en, vec2 down, float cover) {
  // the strokes are lines: a direction and its opposite are the same
  float t = mod(atan(down.y, down.x), czm_pi) / czm_pi * DIRECTIONS;
  float bin = floor(t);
  float width = czm_pi / DIRECTIONS;
  return mix(directionAt(en, bin * width, cover), directionAt(en, (bin + 1.0) * width, cover), smoothstep(0.4, 0.6, fract(t)));
}

void main() {
  vec2 uv = v_textureCoordinates;
  vec4 sceneColor = texture(colorTexture, uv);
  vec4 eye = eyeAt(depthTexture, uv);
  if (eye.w == 0.0) {
    out_FragColor = vec4(paper, 1.0);
    return;
  }
  float px = czm_pixelRatio;
  // averaged wider than smoothNormalAt: the slopes of the terrain's triangles would set the strokes' width
  vec3 normal = normalize(normalAt(depthTexture, uv, eye.xyz, 4.0 * px) + normalAt(depthTexture, uv, eye.xyz, 12.0 * px) + normalAt(depthTexture, uv, eye.xyz, 24.0 * px));
  float rise = dot(normal, up);
  float slope = acos(clamp(rise, -1.0, 1.0));
  float c = depthAt(uv);

  // the way down the slope, the horizontal part of a normal smoothed wider: the strokes' direction would wobble with
  // the terrain's triangles
  vec3 wide = normalize(normal + normalAt(depthTexture, uv, eye.xyz, 32.0 * px));
  vec3 horizontal = wide - dot(wide, up) * up;
  vec2 down = normalize(vec2(dot(horizontal, eastEC), dot(horizontal, northEC)) + 1e-6);
  vec3 rel = eye.xyz - originEC;
  vec2 en = vec2(dot(rel, eastEC), dot(rel, northEC));
  float steep = smoothstep(flatSlope, flatSlope + FLAT_RAMP, slope) * clamp(slope / LEHMANN, 0.0, 1.0);
  float cover = clamp(weight * steep * (1.0 - oblique * dot(down, LIGHT)), 0.0, MAX_COVER);
  // read everywhere, outside any branch, for its derivatives
  float amount = strokesAt(en, down, cover);

  if (outline > 0.0) {
    amount = max(amount, outline * outlineAt(uv, c, vec4(0.0), 1.0, pixelAt(c)));
  }
  out_FragColor = vec4(mix(paper, ink, amount), sceneColor.a);
}
