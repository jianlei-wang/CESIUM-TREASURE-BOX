export const WGS84_HEIGHT_GLSL = `
float dc_approxEllipsoidHeight(vec3 p) {
  float a = 6378137.0;
  float e2 = 0.00669437999014;
  float pxy = length(p.xy);
  float b = a * sqrt(1.0 - e2);
  float theta = atan(p.z * a, pxy * b);
  float ep2 = e2 / (1.0 - e2);
  float xh = pxy - a * cos(theta);
  float yh = p.z - b * sin(theta);
  float zh = pxy * ep2 / a * (b * sin(theta) - p.z);
  return length(vec3(xh, yh, zh)) - zh;
}
`
