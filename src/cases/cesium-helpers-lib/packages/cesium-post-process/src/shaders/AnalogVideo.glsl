// An analog FPV video feed, as in the recordings of FPV pilots' goggles: a soft PAL picture,
// washed out, its color bleeding sideways (the signal carries the brightness at a higher
// resolution than the color, yet smeared a little), with ringing beside sharp edges and lines
// that jitter sideways. As the signal weakens (low over the ground, behind obstacles), the
// color goes first, the picture washes out toward a cold white and fills with colored streaks:
// short dashes along the video lines, the clicks of FM video below its threshold. Now and then
// the receiver loses the sync for a frame or two: the picture tears, a white band and black
// below it. Without a signal, the receiver shows its own noise: a dark field of colored
// streaks, the picture and its display gone. After ntsc-rs's chroma lowpass and delay, luma
// smear and ringing, and the recordings of FPV drones flying low and crashing.
precision highp sampler2D;
uniform sampler2D colorTexture;
// seconds
uniform float time;
// 0 to 1
uniform float noise;
// per frame: how weak the signal is now, 0 to 1, 1 without a signal; where the picture tears,
// as a fraction of its height from the top, or -1
uniform float weak;
uniform float tear;
in vec2 v_textureCoordinates;

// PAL video runs at 25 frames per second, in 576 lines of about 720 samples
const float FRAME_RATE = 25.0;
const vec2 VIDEO = vec2(720.0, 576.0);
// in video samples: the color spread on either side, and shifted to the right; the overshoot
// beside edges; the brightness trailing to the right, as through a lowpass filter
const float BLEED = 3.0;
const float BLEED_SHIFT = 1.0;
const float RING_DISTANCE = 1.5;
const float RING = 0.5;
const float SMEAR = 1.0;
// the white band of a tear, as a fraction of the picture height
const float TEAR_BAND = 0.07;

// BT.601 luma and color differences
vec3 toYuv(vec3 rgb) {
  float y = dot(rgb, vec3(0.299, 0.587, 0.114));
  return vec3(y, 0.492 * (rgb.b - y), 0.877 * (rgb.r - y));
}

vec3 toRgb(vec3 yuv) {
  float b = yuv.x + yuv.y / 0.492;
  float r = yuv.x + yuv.z / 0.877;
  return vec3(r, (yuv.x - 0.299 * r - 0.114 * b) / 0.587, b);
}

float luma(vec2 uv) {
  return toYuv(texture(colorTexture, uv).rgb).x;
}

// the streaks of one layer on a video line: at most one starts in each cell of the line, and runs
// for up to maxSpan samples, shorter than a cell so that only the previous cell reaches this one;
// with this chance per cell; its color, and its coverage in alpha
vec4 streaks(float x, float line, float frame, float cell, float maxSpan, float chance, float seed) {
  float index = floor(x / cell);
  vec4 streak = vec4(0.0);
  for (int i = 0; i < 2; i++) {
    // a new pattern each frame, offset by more cells than a line holds so that frames do not repeat
    vec2 id = vec2(index - float(i) + frame * 61.0 + seed, line);
    float start = (index - float(i) + hash(id + 0.5)) * cell;
    float span = 2.0 + (maxSpan - 2.0) * hash(id + 1.5) * hash(id + 1.5);
    float along = (x - start) / span;
    float on = step(hash(id), chance) * step(0.0, along) * step(along, 1.0);
    float shape = on * smoothstep(0.0, 0.15, along) * (1.0 - smoothstep(0.7, 1.0, along));
    if (shape > streak.a) {
      // bright, whitish or colored: magenta, green, blue, yellow
      float angle = 6.2832 * hash(id + 3.5);
      vec3 yuv = vec3(0.55 + 0.45 * hash(id + 2.5), 0.22 * hash(id + 4.5) * vec2(cos(angle), sin(angle)));
      streak = vec4(toRgb(yuv), shape);
    }
  }
  return streak;
}

void main() {
  float frame = mod(floor(time * FRAME_RATE), 1000.0);
  // the video line, counted from the top, and the sample along it
  float fromTop = 1.0 - v_textureCoordinates.y;
  float line = floor(fromTop * VIDEO.y);
  // the lines jitter sideways, more as the signal weakens
  float shake = (hash(vec2(line, frame)) - 0.5) * (0.4 + 2.0 * weak);
  vec2 uv = vec2(v_textureCoordinates.x + shake / VIDEO.x, 1.0 - (line + 0.5) / VIDEO.y);
  float x = uv.x * VIDEO.x;

  // the brightness smeared to the right, with ringing beside the edges; the color averaged sideways
  // and shifted
  vec4 sceneColor = texture(colorTexture, uv);
  vec3 yuv = toYuv(sceneColor.rgb);
  float texel = 1.0 / VIDEO.x;
  yuv.x = 0.5 * yuv.x + 0.3 * luma(uv - vec2(0.5 * SMEAR * texel, 0.0)) + 0.2 * luma(uv - vec2(SMEAR * texel, 0.0));
  float left = luma(uv - vec2(RING_DISTANCE * texel, 0.0));
  float right = luma(uv + vec2(RING_DISTANCE * texel, 0.0));
  yuv.x += RING * (yuv.x - 0.5 * (left + right));
  vec2 color = vec2(0.0);
  for (int i = -2; i <= 2; i++) {
    float offset = (BLEED_SHIFT + BLEED * float(i) / 2.0) * texel;
    color += toYuv(texture(colorTexture, uv - vec2(offset, 0.0)).rgb).yz;
  }
  yuv.yz = color / 5.0;

  // washed out: less color and contrast, lifted blacks; as the signal weakens, the color lost and
  // the picture washed out toward a cold white
  float wash = smoothstep(0.4, 0.85, weak);
  yuv.yz *= 0.75 * (1.0 - smoothstep(0.35, 0.6, weak));
  yuv.x = 0.06 + 0.86 * yuv.x;
  yuv.x = mix(yuv.x, 0.55 + 0.45 * yuv.x, 0.6 * wash);
  yuv.yz += vec2(0.04, -0.02) * wash;
  vec3 rgb = toRgb(yuv);

  // grain, one value per video sample and a new pattern each frame, heavier in the dark
  float grain = hash(vec2(floor(x), line) + vec2(frame * 37.0, frame * 17.0)) - 0.5;
  rgb += grain * noise * 0.2 * (1.0 - 0.6 * yuv.x);

  // the sync lost: below the tear, a white band, then black
  if (tear >= 0.0) {
    float below = step(tear, fromTop);
    rgb = mix(rgb, vec3(0.02 + 0.05 * grain), below);
    rgb = mix(rgb, vec3(0.92), below * (1.0 - smoothstep(0.0, TEAR_BAND, fromTop - tear)));
  }

  // no signal: the receiver's dark noise instead of the picture
  rgb = mix(rgb, vec3(0.08 + 0.12 * grain), smoothstep(0.92, 1.0, weak));

  // the streaks, rare in a good signal, everywhere without one: long ones, and short ones as the
  // signal fails
  vec4 longStreak = streaks(x, line, frame, 24.0, 18.0, 0.35 * weak * weak * weak, 0.0);
  vec4 shortStreak = streaks(x, line, frame, 8.0, 6.0, 0.6 * smoothstep(0.5, 1.0, weak), 500.0);
  vec4 streak = longStreak.a > shortStreak.a ? longStreak : shortStreak;
  rgb = mix(rgb, streak.rgb, 0.85 * streak.a);
  out_FragColor = vec4(clamp(rgb, 0.0, 1.0), sceneColor.a);
}
