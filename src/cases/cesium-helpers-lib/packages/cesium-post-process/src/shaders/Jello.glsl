// The jello of a vibrating camera with a rolling shutter: the sensor reads its rows one after
// another, so each row sees the camera at a different moment of its shake, and straight edges
// wobble. After Readout's readout pass (stoatworks-labs, MIT): row r of H is read
// `readout * (1 - r / H)` before the frame, the camera's pose is taken at the middle of the row's
// exposure, and the shake is a few sinusoids in x, y and rotation. The phases come from the CPU,
// in double precision; the picture is magnified by zoom so that its edges do not show.
precision highp sampler2D;
uniform sampler2D colorTexture;
// the shake: frequencies in Hz, phases at the frame's time in radians, amplitudes in picture
// heights (x, y) and radians (rotation)
uniform vec4 shakeHz;
uniform vec4 phaseX;
uniform vec4 phaseY;
uniform vec4 phaseRotation;
uniform vec4 amplitudeX;
uniform vec4 amplitudeY;
uniform vec4 amplitudeRotation;
uniform float zoom;
in vec2 v_textureCoordinates;

// seconds to read all the rows, top down, and to expose each
const float READOUT = 0.02;
const float EXPOSURE = 0.004;

void main() {
  vec2 size = czm_viewport.zw;
  // the row, from the top, and how long before the frame it was read, at the middle of its exposure
  float row = floor((1.0 - v_textureCoordinates.y) * size.y);
  float tau = READOUT * (1.0 - row / size.y) + 0.5 * EXPOSURE;
  vec4 arg = czm_twoPi * shakeHz * tau;
  vec2 shift = vec2(dot(amplitudeX, sin(phaseX - arg)), dot(amplitudeY, sin(phaseY - arg)));
  float rotation = dot(amplitudeRotation, sin(phaseRotation - arg));

  // centred, in picture heights, so that a rotation is not a shear
  float aspect = size.x / size.y;
  vec2 p = vec2((v_textureCoordinates.x - 0.5) * aspect, v_textureCoordinates.y - 0.5);
  float c = cos(rotation);
  float s = sin(rotation);
  p = (vec2(p.x * c - p.y * s, p.x * s + p.y * c) + shift) / zoom;
  out_FragColor = texture(colorTexture, vec2(p.x / aspect + 0.5, p.y + 0.5));
}
