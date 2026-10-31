// Henyey-Greenstein's phase function, normalized: 1 / (4 pi) for light scattered alike in all
// directions, which the haze and the clouds share.
float henyeyGreenstein(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * czm_pi * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
}
