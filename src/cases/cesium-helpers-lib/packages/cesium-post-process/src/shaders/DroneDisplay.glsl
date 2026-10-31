// A drone's OSD, as ArduPilot draws it on an HD video system: 50 columns and 18 rows of 12 x 18
// pixel character cells over the whole picture, with the readouts near its edges, here in the
// blocky white glyphs of an analog chip with their black outline, and some in color. The layout
// follows a fixed-wing plane's display; the glyphs are drawn here, not copied from a font.
// - The horizon: 9 dots of 2 x 2 pixels around the middle, as ArduPilot's draw_horizon: pitch (at
//   most 20 degrees) moves it a row per 5 degrees, and roll tilts it at its angle on the screen;
//   each dot is at one of 9 heights in its cell, or past 45 degrees of roll, one per row at one of
//   9 places across its cell. A dot more than 4 cells from the middle is not drawn, and upside
//   down the horizon blinks. It is a symbol, not lined up with the real horizon.
// - The flight mode, top left: FBWA, RTL in failsafe; the heading, top middle.
// - Top right, the link bar, green, orange then red as the link quality drops, and the battery,
//   its symbol filled in green in 7 steps, and its voltage.
// - The right column: the altitude since the display turned on, under a mountain with a green
//   dot; the vertical speed, with one or two green arrows; the throttle.
// - The air speed, bottom middle, after its pale blue label.
// - The FAILSAFE warning, blinking red in the lower part of the middle while the control link is
//   lost.
precision highp sampler2D;
uniform sampler2D colorTexture;
// 0 to 1
uniform float opacity;
// degrees, negative looking down
uniform float pitch;
// degrees, positive to the right
uniform float roll;
// degrees, 0 to 360
uniform float heading;
// meters, since the display turned on
uniform float altitude;
// m/s, positive climbing
uniform float verticalSpeed;
// km/h
uniform float speed;
// volts
uniform float voltage;
// 0 to 99
uniform float linkQuality;
// percent
uniform float throttle;
// 1 while the control link is lost, 0 otherwise
uniform float failsafe;
// 1 or 0, twice per second: the blinking of the warning and of the horizon upside down
uniform float blink;
in vec2 v_textureCoordinates;

const float COLUMNS = 50.0;
const float ROWS = 18.0;
// a cell, in pixels
const float CELL_WIDTH = 12.0;
const float CELL_HEIGHT = 18.0;
// the middle cell, where the horizon is
const int MIDDLE_COLUMN = 24;
const int MIDDLE_ROW = 8;
// ArduPilot's horizon: its limit in pitch, rows per degree of it (16 rows per 80 degrees), and
// rows per column at 45 degrees of roll, for the line to tilt at its angle
const float MAX_PITCH = 20.0;
const float ROWS_PER_DEGREE = 0.2;
const float RATIO = CELL_WIDTH / CELL_HEIGHT;
// battery: volts full and empty of a 3S, and the steps of its symbol's fill (full, 5 to 1, empty)
const float FULL_VOLTS = 12.6;
const float EMPTY_VOLTS = 10.5;
const float BATTERY_STEPS = 6.0;
// the right column: the units in its last column, right of the numbers
const int UNIT_COLUMN = 41;
// the link bar: its first column, and its length in cells
const int LINK_COLUMN = 36;
const float LINK_CELLS = 6.0;

const vec3 WHITE = vec3(1.0);
const vec3 GREEN = vec3(0.2, 0.85, 0.35);
const vec3 ORANGE = vec3(1.0, 0.6, 0.1);
const vec3 RED = vec3(0.95, 0.15, 0.15);
const vec3 PALE_BLUE = vec3(0.55, 0.75, 0.95);

// the glyphs, at 12 x 18 pixels: one row of 12 bits each, the leftmost bit highest; the table is
// written by scripts/osd-font.js from its pixel drawings
const int DOT = 10;
const int SPACE = 11;
const int MINUS = 12;
const int VOLT = 13;
const int DEGREE = 14;
const int PERCENT = 15;
// the units of the altitude, the vertical speed and the air speed, and the air speed's label
const int ALTITUDE = 16;
const int METERS_PER_SECOND = 17;
const int KILOMETERS_PER_HOUR = 18;
const int AIR_SPEED = 19;
// the vertical speed's arrows
const int UP = 20;
const int UP_TWO = 21;
const int DOWN = 22;
const int DOWN_TWO = 23;
// the letters of the flight modes and the warning
const int LETTER_F = 24;
const int LETTER_B = 25;
const int LETTER_W = 26;
const int LETTER_A = 27;
const int LETTER_R = 28;
const int LETTER_T = 29;
const int LETTER_L = 30;
const int LETTER_I = 31;
const int LETTER_E = 32;
const int LETTER_S = 33;
// the warning's row and first column: FAILSAFE, centered under the middle
const int WARNING_ROW = 12;
const int WARNING_COLUMN = 21;

const int FONT[612] = int[612](
  0, 0, 0, 983040, 1671264, 1474704, 1474704, 1474704, 1474704, 1474704, 1474704, 1474704, 1671264, 983040, 0, 0, 0, 0, // 0
  0, 0, 0, 917504, 1704000, 1179840, 1704000, 655424, 655424, 655424, 655424, 1769536, 1114336, 2031616, 0, 0, 0, 0, // 1
  0, 0, 0, 983040, 1671264, 1474704, 1998864, 426000, 884768, 1769536, 1441920, 1540224, 1081584, 2064384, 0, 0, 0, 0, // 2
  0, 0, 0, 2031616, 1147104, 1998864, 163856, 950288, 622688, 950288, 163856, 1998864, 1147104, 2031616, 0, 0, 0, 0, // 3
  0, 0, 0, 2064384, 1474704, 1474704, 1474704, 1474704, 1081584, 1998864, 163856, 163856, 163856, 229376, 0, 0, 0, 0, // 4
  0, 0, 0, 2064384, 1081584, 1540224, 1507456, 1147104, 1998864, 163856, 1998864, 1474704, 1671264, 983040, 0, 0, 0, 0, // 5
  0, 0, 0, 983040, 1638496, 1507456, 1507456, 1147104, 1474704, 1474704, 1474704, 1474704, 1671264, 983040, 0, 0, 0, 0, // 6
  0, 0, 0, 2064384, 1081584, 1998864, 426000, 360480, 852000, 720960, 655424, 655424, 655424, 917504, 0, 0, 0, 0, // 7
  0, 0, 0, 983040, 1671264, 1474704, 1474704, 1474704, 1671264, 1474704, 1474704, 1474704, 1671264, 983040, 0, 0, 0, 0, // 8
  0, 0, 0, 983040, 1671264, 1474704, 1474704, 1474704, 1605744, 950288, 163856, 950288, 622688, 983040, 0, 0, 0, 0, // 9
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 983040, 589920, 589920, 983040, 0, 0, 0, 0, // .
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // space
  0, 0, 0, 0, 0, 0, 0, 2064384, 1081584, 2064384, 0, 0, 0, 0, 0, 0, 0, 0, // -
  0, 0, 0, 0, 0, 0, 3899392, 2785552, 2785552, 3047696, 3506336, 1376416, 1769536, 917504, 0, 0, 0, 0, // v, volts
  0, 0, 1966080, 3342528, 2949408, 2949408, 3342528, 1966080, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // °, degrees
  0, 0, 0, 0, 7979008, 4932360, 5161744, 8224800, 1769536, 3653760, 7225624, 5915160, 7585792, 0, 0, 0, 0, 0, // %
  1835008, 3539072, 7061824, 14508584, 11973652, 6543362, 12611584, 0, 4128768, 2195936, 2785616, 2785616, 2785616, 4161536, 0, 0, 0, 0, // a mountain over m, the altitude; the shader adds a green dot inside
  0, 4128768, 2195936, 2785616, 2785616, 2785616, 4161536, 0, 983040, 1638496, 1507456, 1769536, 1900576, 1245376, 1966080, 0, 0, 0, // m over s, meters per second
  14680064, 12567552, 11036024, 10135124, 11183444, 11183444, 16769024, 917504, 655424, 720960, 622688, 688208, 688208, 1015808, 0, 0, 0, 0, // km over h, kilometers per hour
  0, 8257536, 14410304, 11445524, 9070424, 11191632, 11175248, 16744448, 15757312, 2022914, 7575750, 1400490, 13849290, 1547910, 16576512, 0, 0, 0, // Air over Spd, the air speed
  0, 0, 0, 0, 0, 0, 917504, 1769536, 3244256, 6341104, 4211704, 8372224, 0, 0, 0, 0, 0, 0, // an arrow up
  0, 0, 917504, 1769536, 3244256, 6341104, 4211704, 8372224, 0, 917504, 1769536, 3244256, 6341104, 4211704, 8372224, 0, 0, 0, // two arrows up
  0, 0, 0, 0, 0, 0, 8372224, 4211704, 6341104, 3244256, 1769536, 917504, 0, 0, 0, 0, 0, 0, // an arrow down
  0, 0, 8372224, 4211704, 6341104, 3244256, 1769536, 917504, 0, 8372224, 4211704, 6341104, 3244256, 1769536, 917504, 0, 0, 0, // two arrows down
  0, 0, 0, 2064384, 1081584, 1540224, 1310848, 1507456, 1114336, 1507456, 1310848, 1310848, 1310848, 1835008, 0, 0, 0, 0, // F
  0, 0, 0, 2031616, 1147104, 1474704, 1474704, 1474704, 1147104, 1474704, 1474704, 1474704, 1147104, 2031616, 0, 0, 0, 0, // B
  0, 0, 0, 3899392, 2785552, 2785552, 2785552, 3047696, 2785616, 2785616, 2785616, 2785616, 3506336, 2031616, 0, 0, 0, 0, // W
  0, 0, 0, 983040, 1671264, 1474704, 1474704, 1474704, 1081584, 1474704, 1474704, 1474704, 1474704, 2064384, 0, 0, 0, 0, // A
  0, 0, 0, 2031616, 1147104, 1474704, 1474704, 1474704, 1147104, 1409184, 1474704, 1474704, 1474704, 2064384, 0, 0, 0, 0, // R
  0, 0, 0, 4161536, 2130416, 3899456, 655424, 655424, 655424, 655424, 655424, 655424, 655424, 917504, 0, 0, 0, 0, // T
  0, 0, 0, 1835008, 1310848, 1310848, 1310848, 1310848, 1310848, 1310848, 1310848, 1540224, 1081584, 2064384, 0, 0, 0, 0, // L
  0, 0, 0, 2031616, 1114336, 1769536, 655424, 655424, 655424, 655424, 655424, 1769536, 1114336, 2031616, 0, 0, 0, 0, // I
  0, 0, 0, 2064384, 1081584, 1540224, 1310848, 1507456, 1114336, 1507456, 1310848, 1540224, 1081584, 2064384, 0, 0, 0, 0, // E
  0, 0, 0, 1015808, 1605744, 1540224, 1310848, 1507456, 1671264, 950288, 163856, 1998864, 1147104, 2031616, 0, 0, 0, 0 // S
);

int digit(float value, float power) {
  return int(mod(floor(value / power), 10.0));
}

// 10 to the n, exactly: pow may be off by a little on the GPU
float powerOfTen(int n) {
  return n == 3 ? 1000.0 : n == 2 ? 100.0 : n == 1 ? 10.0 : 1.0;
}

// a number right-aligned to end at the column last: its whole part, and its tenths after a dot,
// and a minus before it when negative; -1 left of it
int numberAt(float value, bool tenths, int column, int last) {
  float scaled = floor(abs(value) * (tenths ? 10.0 : 1.0) + 0.5);
  float whole = tenths ? floor(scaled / 10.0) : scaled;
  int digits = whole >= 1000.0 ? 4 : whole >= 100.0 ? 3 : whole >= 10.0 ? 2 : 1;
  int i = last - column;
  if (tenths) {
    if (i == 0) {
      return digit(scaled, 1.0);
    }
    if (i == 1) {
      return DOT;
    }
    i -= 2;
  }
  if (i >= 0 && i < digits) {
    return digit(whole, powerOfTen(i));
  }
  return i == digits && value < 0.0 && scaled > 0.0 ? MINUS : -1;
}

// the glyph in this cell and its color, or -1
int glyphAt(int column, int row, out vec3 color) {
  color = WHITE;
  // the flight mode, top left
  if (row == 1 && column >= 3 && column <= 6) {
    int i = column - 3;
    if (failsafe > 0.5) {
      return i == 0 ? LETTER_R : i == 1 ? LETTER_T : i == 2 ? LETTER_L : -1;
    }
    return i == 0 ? LETTER_F : i == 1 ? LETTER_B : i == 2 ? LETTER_W : LETTER_A;
  }
  // the heading, top middle
  if (row == 1 && column >= 23 && column <= 26) {
    return column == 26 ? DEGREE : numberAt(mod(floor(heading + 0.5), 360.0), false, column, 25);
  }
  // the battery voltage, top right after its symbol: 12.0v
  if (row == 2 && column > LINK_COLUMN && column <= UNIT_COLUMN) {
    return column == UNIT_COLUMN ? VOLT : numberAt(clamp(voltage, 0.0, 99.9), true, column, UNIT_COLUMN - 1);
  }
  // the right column: the altitude, the vertical speed after its arrows, the throttle
  bool right = column >= UNIT_COLUMN - 6 && column <= UNIT_COLUMN;
  if (row == MIDDLE_ROW && right) {
    return column == UNIT_COLUMN ? ALTITUDE : numberAt(clamp(altitude, -999.0, 9999.0), false, column, UNIT_COLUMN - 1);
  }
  if (row == MIDDLE_ROW + 1 && right) {
    if (column == UNIT_COLUMN) {
      return METERS_PER_SECOND;
    }
    float climb = min(abs(verticalSpeed), 99.9);
    int width = climb >= 9.95 ? 4 : 3;
    if (column == UNIT_COLUMN - 1 - width) {
      color = GREEN;
      bool up = verticalSpeed > 0.0;
      return climb < 0.05 ? -1 : climb < 5.0 ? (up ? UP : DOWN) : (up ? UP_TWO : DOWN_TWO);
    }
    return numberAt(climb, true, column, UNIT_COLUMN - 1);
  }
  if (row == MIDDLE_ROW + 3 && right) {
    return column == UNIT_COLUMN ? PERCENT : numberAt(clamp(throttle, 0.0, 100.0), false, column, UNIT_COLUMN - 1);
  }
  // the warning
  if (failsafe > 0.5 && blink > 0.5 && row == WARNING_ROW && column >= WARNING_COLUMN && column < WARNING_COLUMN + 8) {
    int i = column - WARNING_COLUMN;
    color = RED;
    return i == 0 ? LETTER_F : i == 1 ? LETTER_A : i == 2 ? LETTER_I : i == 3 ? LETTER_L : i == 4 ? LETTER_S : i == 5 ? LETTER_A : i == 6 ? LETTER_F : LETTER_E;
  }
  // the air speed, bottom middle: its label, whole km/h and the unit
  if (row == 16 && column >= 20 && column <= 25) {
    if (column == 20) {
      color = PALE_BLUE;
      return AIR_SPEED;
    }
    return column == 25 ? KILOMETERS_PER_HOUR : numberAt(clamp(speed, 0.0, 999.0), false, column, 24);
  }
  return -1;
}

// 2 where the glyph is drawn, 1 on its black outline, 0 elsewhere; x and y in the cell's pixels.
// A row of the table holds the glyph in its low 12 bits and the outline in the 12 above, the
// leftmost pixel highest
float glyphInk(int glyph, int x, int y) {
  if (glyph < 0) {
    return 0.0;
  }
  int row = FONT[glyph * int(CELL_HEIGHT) + y] >> (int(CELL_WIDTH) - 1 - x);
  return (row & 1) == 1 ? 2.0 : ((row >> int(CELL_WIDTH)) & 1) == 1 ? 1.0 : 0.0;
}

// 2 inside the box, 1 on its outline a pixel around, 0 elsewhere; in pixels
float boxInk(vec2 p, vec2 low, vec2 high) {
  if (all(greaterThanEqual(p, low)) && all(lessThan(p, high))) {
    return 2.0;
  }
  return all(greaterThanEqual(p, low - 1.0)) && all(lessThan(p, high + 1.0)) ? 1.0 : 0.0;
}

// what is drawn over what is under it, its outline under what is drawn
void paint(inout float ink, inout vec3 fill, float layer, vec3 color) {
  if (layer > ink) {
    ink = layer;
    fill = color;
  }
}

void main() {
  vec4 sceneColor = texture(colorTexture, v_textureCoordinates);
  // the grid as large as fits the screen, centered, from its top left, in pixels
  vec2 size = czm_viewport.zw;
  vec2 grid = vec2(COLUMNS * CELL_WIDTH, ROWS * CELL_HEIGHT);
  float scale = min(size.x / grid.x, size.y / grid.y);
  vec2 fromCorner = vec2(gl_FragCoord.x - czm_viewport.x, czm_viewport.y + size.y - gl_FragCoord.y) - 0.5 * (size - grid * scale);
  vec2 p = floor(fromCorner / scale);
  int column = int(floor(p.x / CELL_WIDTH));
  int row = int(floor(p.y / CELL_HEIGHT));
  if (column < 0 || column >= int(COLUMNS) || row < 0 || row >= int(ROWS)) {
    out_FragColor = sceneColor;
    return;
  }
  vec2 inCell = p - vec2(float(column) * CELL_WIDTH, float(row) * CELL_HEIGHT);

  vec3 glyphColor;
  int glyph = glyphAt(column, row, glyphColor);
  float ink = 0.0;
  vec3 fill = WHITE;
  paint(ink, fill, glyphInk(glyph, int(inCell.x), int(inCell.y)), glyphColor);

  // the horizon, as ArduPilot's draw_horizon in rows and columns from the middle cell, with the
  // pitch (positive nose down) raising it: a dot per column, at its height in the cell in ninths,
  // or past 45 degrees of roll a dot per row, at its place across the cell in ninths
  bool nearMiddle = abs(column - MIDDLE_COLUMN) <= 5 && abs(row - MIDDLE_ROW) <= 5;
  if (nearMiddle && (abs(roll) < 90.0 || blink > 0.5)) {
    float level = clamp(-pitch, -MAX_PITCH, MAX_PITCH) * ROWS_PER_DEGREE;
    float ky = sin(radians(roll));
    float kx = cos(radians(roll));
    bool steep = abs(ky) >= abs(kx);
    for (int k = -4; k <= 4; k++) {
      float along = steep ? (float(k) - level) / RATIO * kx / ky + 0.5 : RATIO * float(k) * ky / kx + level + 0.5;
      float cell = floor(along);
      float ninth = floor((along - cell) * 9.0);
      if (abs(cell) > 4.0) {
        continue;
      }
      vec2 center = steep
        ? vec2(float(MIDDLE_COLUMN) + cell, float(MIDDLE_ROW - k)) * vec2(CELL_WIDTH, CELL_HEIGHT) + vec2(2.0 + ninth, 9.0)
        : vec2(float(MIDDLE_COLUMN + k), float(MIDDLE_ROW) - cell) * vec2(CELL_WIDTH, CELL_HEIGHT) + vec2(6.0, 17.0 - 2.0 * ninth);
      float d = length(p + 0.5 - center);
      paint(ink, fill, d < 1.0 ? 2.0 : d < 2.0 ? 1.0 : 0.0, WHITE);
    }
  }

  // the link bar, top right: as long as the link quality, its color by it; full and red in
  // failsafe
  if (row == 1) {
    float quality = failsafe > 0.5 ? 99.0 : clamp(linkQuality, 0.0, 99.0);
    vec3 color = failsafe > 0.5 || quality < 40.0 ? RED : quality < 70.0 ? ORANGE : GREEN;
    float left = float(LINK_COLUMN) * CELL_WIDTH;
    float bar = floor(LINK_CELLS * CELL_WIDTH * (quality + 1.0) / 100.0);
    if (bar > 0.0) {
      paint(ink, fill, boxInk(p, vec2(left, CELL_HEIGHT + 7.0), vec2(left + bar, CELL_HEIGHT + 11.0)), color);
    }
  }

  // the battery symbol, top right before its voltage: a white frame with a cap, filled in green
  // from the bottom in steps as the voltage drops, black inside above the fill
  if (column == LINK_COLUMN && row == 2) {
    float charge = clamp((voltage - EMPTY_VOLTS) / (FULL_VOLTS - EMPTY_VOLTS), 0.0, 1.0);
    float fillTop = 17.0 - 13.0 * ceil(charge * BATTERY_STEPS) / BATTERY_STEPS;
    paint(ink, fill, max(boxInk(inCell, vec2(2.0, 3.0), vec2(10.0, 18.0)), boxInk(inCell, vec2(4.0, 1.0), vec2(8.0, 3.0))), WHITE);
    if (all(greaterThanEqual(inCell, vec2(3.0, 4.0))) && all(lessThan(inCell, vec2(9.0, 17.0)))) {
      ink = inCell.y >= fillTop ? 2.0 : 1.0;
      fill = GREEN;
    }
  }

  // the green dot inside the altitude's mountain
  if (glyph == ALTITUDE) {
    paint(ink, fill, all(greaterThanEqual(inCell, vec2(3.0, 4.0))) && all(lessThan(inCell, vec2(5.0, 6.0))) ? 2.0 : 0.0, GREEN);
  }

  vec3 color = ink == 2.0 ? fill : ink == 1.0 ? vec3(0.0) : sceneColor.rgb;
  out_FragColor = vec4(mix(sceneColor.rgb, color, ink > 0.0 ? opacity : 0.0), sceneColor.a);
}
