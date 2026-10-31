// A digital FPV video feed and its breakups: clean, slightly punchy colors, until a weak signal
// breaks the picture into macroblocks, some displaced, strips shifted sideways and the color
// channels split, and at worst a short black screen. A block keeps only its lowest frequencies,
// as a codec that has thrown its detail away: a gradient between its corners, with fewer colors.
// The displaced blocks and strips follow three.js's DigitalGlitch. Without the previous frames,
// there are no freezes.
precision highp sampler2D;
uniform sampler2D colorTexture;
// how broken the picture is, 0 to 1, and 1 during a black screen
uniform float severity;
uniform float blackout;
// the video frame number, for the random patterns
uniform float frame;
in vec2 v_textureCoordinates;

// a macroblock, in CSS pixels
const float BLOCK = 16.0;

void main() {
  vec2 size = czm_viewport.zw;
  vec2 pixel = gl_FragCoord.xy / czm_pixelRatio;
  vec2 uv = v_textureCoordinates;
  vec4 sceneColor = texture(colorTexture, uv);
  // clean: slightly crushed blacks, a little more color
  vec3 rgb = sceneColor.rgb;
  rgb = czm_saturation(rgb, 1.1);
  rgb = max(rgb - 0.02, 0.0) / 0.98;

  if (severity > 0.0) {
    // the pattern changes every few frames, as the decoder stutters
    float pattern = floor(frame / 3.0);
    // strips shifted sideways
    float strip = floor(pixel.y / (BLOCK * 2.0));
    if (hash(vec2(strip, pattern + 7.0)) < 0.25 * severity) {
      uv.x += (hash(vec2(strip, pattern + 11.0)) - 0.5) * 0.2 * severity;
    }
    // macroblocks: more of them as the signal gets worse; some show the picture displaced
    vec2 block = floor(uv * size / czm_pixelRatio / BLOCK);
    if (hash(block + pattern * 0.37) < 1.2 * severity) {
      vec2 displaced = hash(block + pattern + 3.0) < 0.3
        ? floor((vec2(hash(block + 5.0), hash(block + 9.0)) - 0.5) * 4.0)
        : vec2(0.0);
      vec2 cell = BLOCK * czm_pixelRatio / size;
      vec2 origin = (block + displaced) * cell;
      // the block's corners, and a gradient between them
      vec2 inset = 0.5 / size;
      vec3 c00 = texture(colorTexture, origin + inset).rgb;
      vec3 c10 = texture(colorTexture, origin + vec2(cell.x - inset.x, inset.y)).rgb;
      vec3 c01 = texture(colorTexture, origin + vec2(inset.x, cell.y - inset.y)).rgb;
      vec3 c11 = texture(colorTexture, origin + cell - inset).rgb;
      vec2 f = fract(uv * size / czm_pixelRatio / BLOCK);
      rgb = mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
      // fewer colors
      float levels = mix(24.0, 6.0, severity);
      rgb = floor(rgb * levels + 0.5) / levels;
    } else if (uv != v_textureCoordinates) {
      rgb = texture(colorTexture, uv).rgb;
    }
    // the color channels split sideways
    vec2 split = vec2(3.0 * severity * czm_pixelRatio / size.x, 0.0);
    rgb.r = mix(rgb.r, texture(colorTexture, uv + split).r, severity);
    rgb.b = mix(rgb.b, texture(colorTexture, uv - split).b, severity);
  }
  out_FragColor = vec4(rgb * (1.0 - blackout), sceneColor.a);
}
