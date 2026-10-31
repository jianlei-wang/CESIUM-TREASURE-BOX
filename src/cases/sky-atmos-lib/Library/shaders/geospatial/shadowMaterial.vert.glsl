
#version 300 es
#define LOG_DEPTH
#define SHADER_TYPE RawShaderMaterial
#define SHADER_NAME ShadowMaterial
#define SHADOW 1
#define TEMPORAL_PASS 0
#define TEMPORAL_JITTER 0
#define LOCAL_WEATHER_CHANNELS rgba
#define CASCADE_COUNT 3
#define SHAPE_DETAIL 1
#define TURBULENCE 1
#define FRAMEBUFFER_PRECISION_HIGH 1
precision highp float;
uniform vec3 ellipsoidCenter;
uniform vec3 altitudeCorrection;
in vec3 position;
out vec2 vUv;
out vec3 vEllipsoidCenter;
void main() {
    vUv = position.xy * 0.5 + 0.5;
    vEllipsoidCenter = ellipsoidCenter + altitudeCorrection;
    gl_Position = vec4(position.xy, 1.0, 1.0);
}
