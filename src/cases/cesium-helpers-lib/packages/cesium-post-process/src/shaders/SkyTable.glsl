// The clear sky the haze scatters, drawn by precipitation.js into a small table at each frame,
// rather than computed twice for each pixel: its first SKY_TABLE texels at SKY_ELEVATION above the
// horizon, at azimuths from the sun's to its opposite, the sky being symmetric about the sun's
// vertical plane, and its last overhead, seen from no higher than the cloud base. In world
// coordinates, the camera's up the ellipsoid's normal under it, so that the camera turning between
// frames does not skew it. Needs Height, Fog, Phase and RainHaze.
// meters above the ellipsoid, the precipitation's
uniform float cloudBase;
in vec2 v_textureCoordinates;

void main() {
  vec3 upWC = normalize(czm_viewerPositionWC * czm_ellipsoidInverseRadii * czm_ellipsoidInverseRadii);
  float i = floor(v_textureCoordinates.x * (SKY_TABLE + 1.0));
  if (i >= SKY_TABLE) {
    out_FragColor = vec4(clearSkyBelow(cloudBase, upWC, czm_lightDirectionWC), 1.0);
    return;
  }
  vec3 sun = czm_lightDirectionWC - dot(czm_lightDirectionWC, upWC) * upWC;
  sun = dot(sun, sun) > 1e-6 ? normalize(sun) : normalize(cross(upWC, vec3(1.0, 0.0, 0.0)));
  float azimuth = czm_pi * i / (SKY_TABLE - 1.0);
  vec3 level = cos(azimuth) * sun + sin(azimuth) * cross(upWC, sun);
  out_FragColor = vec4(clearSkyBelow(cloudBase, cos(SKY_ELEVATION) * level + sin(SKY_ELEVATION) * upWC, czm_lightDirectionWC), 1.0);
}
