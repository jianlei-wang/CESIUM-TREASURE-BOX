// Whether a surface is open to the sky (open-sky.js): not under the cover the grid holds about it, nor over its ceiling. The grid's heights at
// its nodes, two floats each (the cover's, the ceiling's), read node by node; a surface is at a cover within a slope's fall between two nodes.
uniform highp sampler2D openSkyMap;
// the grid's frame's coordinates from the eye's, made in double precision on the CPU
uniform mat4 skyFromEye;
// the first node's place and the step between two, in the frame's meters: (x0, y0, dx, dy)
uniform vec4 skyGrid;
// 1 with a grid, 0 without: everything is open
uniform float hasSky;

// meters under the cover a surface still is the cover, in steps of the grid, and over a tenth of a meter: a slope's fall between the nodes
const vec2 UNDER = vec2(1.5, 2.5);
const float UNDER_FLOOR = 0.1;
// meters over the ceiling from which a surface is not the grid's (a cloud's), and over which it fades out
const vec2 OVER = vec2(0.5, 1.0);
// a node's height under this holds nothing: what lies there is open
const float NOTHING = -1e8;

// whether a surface at a height is open at a node, neither under its cover nor over its ceiling, 0 to 1
float openAt(ivec2 node, float height, float step) {
  vec2 heights = texelFetch(openSkyMap, node, 0).rg;
  float under = heights.x < NOTHING ? 0.0 : heights.x - height;
  float over = heights.y < NOTHING ? 0.0 : height - heights.y;
  return (1.0 - smoothstep(UNDER_FLOOR + UNDER.x * step, UNDER_FLOOR + UNDER.y * step, under)) * (1.0 - smoothstep(OVER.x, OVER.y, over));
}

// 1 for a surface open to the sky, or outside the grid; 0 for one under a cover or over the ceiling; blended between the four nodes about
// it, so that the edge of a roof is not drawn in steps of the grid
float openSky(vec3 eye) {
  if (hasSky < 0.5) {
    return 1.0;
  }
  vec3 local = (skyFromEye * vec4(eye, 1.0)).xyz;
  vec2 node = (local.xy - skyGrid.xy) / skyGrid.zw;
  ivec2 size = textureSize(openSkyMap, 0);
  if (any(lessThan(node, vec2(0.0))) || any(greaterThan(node, vec2(size - 1)))) {
    return 1.0;
  }
  ivec2 first = min(ivec2(floor(node)), size - 2);
  vec2 across = node - vec2(first);
  float step = max(skyGrid.z, skyGrid.w);
  return mix(
    mix(openAt(first, local.z, step), openAt(first + ivec2(1, 0), local.z, step), across.x),
    mix(openAt(first + ivec2(0, 1), local.z, step), openAt(first + ivec2(1, 1), local.z, step), across.x),
    across.y);
}
