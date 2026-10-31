
#version 300 es
#define SHADER_TYPE RawShaderMaterial
#define SHADER_NAME ShadowResolveMaterial
#define CASCADE_COUNT 3
#define FRAMEBUFFER_PRECISION_HIGH 1
precision highp float;
layout(location = 0) in vec3 position;
out vec2 vUv;
void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 1.0, 1.0);
}
