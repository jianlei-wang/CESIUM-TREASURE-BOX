// Rings where the rain lands: the ground cut into cells of a local frame, in each cell a drop landing, as often as the intensity says, where the
// cell's hash puts it, a thin ring growing from it and fading as it grows, on what is flat enough. Over water slower and wider. The cells are in a
// local frame, in double precision from the CPU (local-frame.js), so they stay where they are as the camera moves and do not step with the globe's
// size. Only on what is open to the sky. Needs EyeFromDepth, Height, Hash, Normal and OpenSky.
precision highp sampler2D;
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform mat4 localFromEye;
// 0 to 1: the share of the cells that have a drop
uniform float intensity;
// meters: a cell's size, and how far a ring on the ground grows
uniform float cell;
uniform float reach;
// meters above the ellipsoid, far above anything with no water
uniform float waterLevel;
// radians
uniform float maxSlope;
// rings a second
uniform float rate;
// seconds
uniform float time;
// the color of a ring, its alpha how strongly it shows
uniform vec4 color;
in vec2 v_textureCoordinates;

// a ring over water reaches this much farther, and runs this much slower
const float WATER_REACH = 1.7;
const float WATER_RATE = 0.5;
// meters from the water's level within which a surface is water, and beyond which it is not
const vec2 WET = vec2(0.1, 0.25);
// the drop lands in the middle of its cell, this far from its edge, in cells: a ring is clipped at the edge
const float MARGIN = 0.3;
// the narrowest line, in meters
const float LINE = 0.045;
// a pixel wider than the first, in meters, fades the rings out to none at the second: they would be a speckle
const vec2 SMALL = vec2(0.08, 0.2);
// half the width of the slope limit, in radians
const float SLOPE_EDGE = 0.1;

void main() {
  vec4 sceneColor = texture(colorTexture, v_textureCoordinates);
  vec4 eye = eyeAt(depthTexture, v_textureCoordinates);
  if (intensity <= 0.0 || eye.w == 0.0) {
    out_FragColor = sceneColor;
    return;
  }
  vec3 normal = smoothNormalAt(depthTexture, v_textureCoordinates, eye.xyz);
  float slope = acos(clamp(dot(normal, up), -1.0, 1.0));
  vec2 local = (localFromEye * vec4(eye.xyz, 1.0)).xy;
  float wet = 1.0 - smoothstep(WET.x, WET.y, abs(heightAt(eye.xyz) - waterLevel));

  vec2 id = floor(local / cell);
  vec2 centre = (id + MARGIN + (1.0 - 2.0 * MARGIN) * vec2(hash(id + 3.1), hash(id + 7.7))) * cell;
  float phase = fract(time * rate * mix(1.0, WATER_RATE, wet) + hash(id + 11.3));
  // never past the cell's edge from the centre
  float grown = min(reach * mix(1.0, WATER_REACH, wet), MARGIN * cell) * phase;
  float distance = length(local - centre);
  float width = max(LINE, 1.5 * fwidth(distance));
  float ring = (1.0 - smoothstep(0.0, width, abs(distance - grown))) * (1.0 - phase);
  ring *= float(hash(id) < intensity);
  ring *= 1.0 - smoothstep(maxSlope - SLOPE_EDGE, maxSlope + SLOPE_EDGE, slope);
  ring *= 1.0 - smoothstep(SMALL.x, SMALL.y, length(fwidth(local)));
  ring *= openSky(eye.xyz);
  out_FragColor = vec4(mix(sceneColor.rgb, color.rgb, ring * color.a), sceneColor.a);
}
