export const VIDEO_PROJECTION_FRAGMENT = `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
in vec2 v_textureCoordinates;

uniform sampler2D u_videoTexture;
uniform mat4 u_videoViewMatrix;
uniform mat4 u_videoProjectionMatrix;
uniform vec3 u_tint;
uniform float u_videoAlpha;
uniform float u_edgeFeather;
uniform float u_depthFeather;
uniform float u_near;
uniform float u_far;
uniform float u_enabled;

void main() {
  vec4 sceneColor = texture(colorTexture, v_textureCoordinates);
  if (u_enabled < 0.5) {
    out_FragColor = sceneColor;
    return;
  }

  float depth = czm_unpackDepth(texture(depthTexture, v_textureCoordinates));
  if (depth >= 1.0) {
    out_FragColor = sceneColor;
    return;
  }

  vec4 eyeCoordinate = czm_windowToEyeCoordinates(gl_FragCoord.xy, depth);
  eyeCoordinate /= eyeCoordinate.w;
  vec4 worldCoordinate = czm_inverseView * eyeCoordinate;
  vec3 worldPos = worldCoordinate.xyz / worldCoordinate.w;

  vec4 videoViewPos = u_videoViewMatrix * vec4(worldPos, 1.0);
  vec4 videoClipPos = u_videoProjectionMatrix * videoViewPos;
  if (videoClipPos.w <= 0.0001) {
    out_FragColor = sceneColor;
    return;
  }

  vec3 videoNdc = videoClipPos.xyz / videoClipPos.w;
  if (abs(videoNdc.x) > 1.0 || abs(videoNdc.y) > 1.0 || abs(videoNdc.z) > 1.0) {
    out_FragColor = sceneColor;
    return;
  }

  vec2 uv = videoNdc.xy * 0.5 + 0.5;
  vec4 videoColor = texture(u_videoTexture, uv);
  videoColor.rgb *= u_tint;

  float edgeFeather = max(u_edgeFeather, 0.0001);
  float edgeX = smoothstep(0.0, edgeFeather, uv.x) * smoothstep(0.0, edgeFeather, 1.0 - uv.x);
  float edgeY = smoothstep(0.0, edgeFeather, uv.y) * smoothstep(0.0, edgeFeather, 1.0 - uv.y);
  float edgeAlpha = edgeX * edgeY;

  float viewDist = -videoViewPos.z;
  float depthFeather = max(u_depthFeather, 0.0001);
  float nearAlpha = smoothstep(u_near, u_near + depthFeather, viewDist);
  float farAlpha = smoothstep(u_far, u_far - depthFeather, viewDist);
  float depthAlpha = nearAlpha * farAlpha;

  float finalAlpha = clamp(edgeAlpha * depthAlpha * u_videoAlpha * videoColor.a, 0.0, 1.0);
  out_FragColor = vec4(mix(sceneColor.rgb, videoColor.rgb, finalAlpha), max(sceneColor.a, finalAlpha));
}
`
