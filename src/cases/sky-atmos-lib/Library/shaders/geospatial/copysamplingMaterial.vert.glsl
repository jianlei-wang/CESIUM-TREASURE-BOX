
#version 300 es
#define attribute in
#define varying out
#define texture2D texture
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp samplerCube;
precision highp sampler3D;
precision highp sampler2DArray;
precision highp sampler2DShadow;
precision highp samplerCubeShadow;
precision highp sampler2DArrayShadow;
precision highp isampler2D;
precision highp isampler3D;
precision highp isamplerCube;
precision highp isampler2DArray;
precision highp usampler2D;
precision highp usampler3D;
precision highp usamplerCube;
precision highp usampler2DArray;
#define HIGH_PRECISION
#define SHADER_TYPE ShaderMaterial
#define SHADER_NAME CopyMaterial
#define FRAMEBUFFER_PRECISION_HIGH 1
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
#ifdef USE_INSTANCING
    attribute mat4 instanceMatrix;
#endif
#ifdef USE_INSTANCING_COLOR
    attribute vec3 instanceColor;
#endif
#ifdef USE_INSTANCING_MORPH
    uniform sampler2D morphTexture;
#endif
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
#ifdef USE_UV1
    attribute vec2 uv1;
#endif
#ifdef USE_UV2
    attribute vec2 uv2;
#endif
#ifdef USE_UV3
    attribute vec2 uv3;
#endif
#ifdef USE_TANGENT
    attribute vec4 tangent;
#endif
#if defined( USE_COLOR_ALPHA )
    attribute vec4 color;
    #elif defined( USE_COLOR )
    attribute vec3 color;
#endif
#ifdef USE_SKINNING
    attribute vec4 skinIndex;
    attribute vec4 skinWeight;
#endif

varying vec2 vUv;
void main() {
    vUv = position.xy*0.5+0.5;
    gl_Position = vec4(position.xy, 1.0, 1.0);
}
