
#version 300 es
#define varying in
#define texture2D texture
#define textureCube texture
#define texture2DProj textureProj
#define texture2DLodEXT textureLod
#define texture2DProjLodEXT textureProjLod
#define textureCubeLodEXT textureLod
#define texture2DGradEXT textureGrad
#define texture2DProjGradEXT textureProjGrad
#define textureCubeGradEXT textureGrad
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
#define SHADER_NAME UpsamplingMaterial
#define FRAMEBUFFER_PRECISION_HIGH 1
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
vec4 LinearTransferOETF( in vec4 value ) {
    return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
    return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
    return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}
vec4 linearToOutputTexel( vec4 value ) {
    return LinearTransferOETF( vec4( value.rgb * mat3( 1.0000, -0.0000, -0.0000, -0.0000, 1.0000, 0.0000, 0.0000, 0.0000, 1.0000 ), value.a ) );
}
float luminance( const in vec3 rgb ) {
    const vec3 weights = vec3( 0.2126, 0.7152, 0.0722 );
    return dot( weights, rgb );
}
uniform sampler2D inputBuffer;
uniform sampler2D supportBuffer;
uniform float radius;
varying vec2 vUv;
varying vec2 vUv0;
varying vec2 vUv1;
varying vec2 vUv2;
varying vec2 vUv3;
varying vec2 vUv4;
varying vec2 vUv5;
varying vec2 vUv6;
varying vec2 vUv7;
void main() {
    vec4 c = vec4(0.0);
    c += texture2D(inputBuffer, vUv0)*0.0625;
    c += texture2D(inputBuffer, vUv1)*0.125;
    c += texture2D(inputBuffer, vUv2)*0.0625;
    c += texture2D(inputBuffer, vUv3)*0.125;
    c += texture2D(inputBuffer, vUv)*0.25;
    c += texture2D(inputBuffer, vUv4)*0.125;
    c += texture2D(inputBuffer, vUv5)*0.0625;
    c += texture2D(inputBuffer, vUv6)*0.125;
    c += texture2D(inputBuffer, vUv7)*0.0625;
    vec4 baseColor = texture2D(supportBuffer, vUv);
    out_FragColor = mix(baseColor, c, radius);
    out_FragColor = linearToOutputTexel( out_FragColor );
}
