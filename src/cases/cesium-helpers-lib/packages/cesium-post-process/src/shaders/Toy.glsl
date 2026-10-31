// A toy's look, as an isometric game's, after DepthEdges: the edges lit where the surface bends
// outward and shaded where it bends inward, rounded as molded plastic close up; an outline along
// the jumps, on their near side, a darker shade of the color; the colors a little richer and
// warmer; the sky, if asked, a soft gradient.
// its samplers read in high precision, whatever comes before (a phone's GPU's default is low)
precision highp sampler2D;
uniform sampler2D colorTexture;
// how much brighter a convex edge gets, how much darker a concave one
uniform float light;
uniform float shade;
// the edges' bevel, in meters, a pixel at the least; how much darker the outline, 0 for none
uniform float bevel;
uniform float outline;
// the colors' saturation, and a factor each of red, green and blue
uniform float saturation;
uniform vec3 warm;
// the sky's gradient, from the top of the screen to its bottom; w 0 to keep the sky
uniform vec4 skyTop;
uniform vec4 skyBottom;
in vec2 v_textureCoordinates;

void main() {
  vec2 uv = v_textureCoordinates;
  vec4 sceneColor = texture(colorTexture, uv);
  float c = depthAt(uv);
  if (c == SKY) {
    out_FragColor = skyTop.w > 0.0 ? vec4(skyAt(uv, skyTop, skyBottom), 1.0) : sceneColor;
    return;
  }
  float pixel = pixelAt(c);
  // the neighbors a bevel's width away: the bend measured over it, strongest on the edge and fading
  // to nothing a bevel off, a rounded edge's highlight
  float steps = clamp(bevel / pixel, 1.0, BEVEL);
  vec3 color = sceneColor.rgb;
  // the creases' neighbours read only when they light or shade: a scene drawing its own edges asks for neither
  if (light != 0.0 || shade != 0.0) {
    vec4 n = neighborsAt(uv, c, steps);
    float crease = creaseOf(n, steps * pixel, pixel);
    color *= n.x + n.y + n.z + n.w > 0.0 ? 1.0 + light * crease : 1.0 - shade * crease;
  }
  if (outline > 0.0) {
    color *= 1.0 - outline * outlineAt(uv, c, vec4(0.0), steps, pixel);
  }
  color = czm_saturation(color, saturation) * warm;
  out_FragColor = vec4(clamp(color, 0.0, 1.0), sceneColor.a);
}
