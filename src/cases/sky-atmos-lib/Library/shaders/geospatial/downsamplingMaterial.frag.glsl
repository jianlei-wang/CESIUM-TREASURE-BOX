
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
#define SHADER_NAME DownsamplingMaterial
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
#define WEIGHT_INNER 0.125
#define WEIGHT_OUTER 0.0555555
varying vec2 vUv;
varying vec2 vUv00;
varying vec2 vUv01;
varying vec2 vUv02;
varying vec2 vUv03;
varying vec2 vUv04;
varying vec2 vUv05;
varying vec2 vUv06;
varying vec2 vUv07;
varying vec2 vUv08;
varying vec2 vUv09;
varying vec2 vUv10;
varying vec2 vUv11;
float clampToBorder(const in vec2 uv) {
    return float(uv.s >= 0.0&&uv.s <= 1.0&&uv.t >= 0.0&&uv.t <= 1.0);
}
void main() {
    vec4 c = vec4(0.0);
    vec4 w = WEIGHT_INNER*vec4(clampToBorder(vUv00), clampToBorder(vUv01), clampToBorder(vUv02), clampToBorder(vUv03));
    c += w.x*texture2D(inputBuffer, vUv00);
    c += w.y*texture2D(inputBuffer, vUv01);
    c += w.z*texture2D(inputBuffer, vUv02);
    c += w.w*texture2D(inputBuffer, vUv03);
    w = WEIGHT_OUTER*vec4(clampToBorder(vUv04), clampToBorder(vUv05), clampToBorder(vUv06), clampToBorder(vUv07));
    c += w.x*texture2D(inputBuffer, vUv04);
    c += w.y*texture2D(inputBuffer, vUv05);
    c += w.z*texture2D(inputBuffer, vUv06);
    c += w.w*texture2D(inputBuffer, vUv07);
    w = WEIGHT_OUTER*vec4(clampToBorder(vUv08), clampToBorder(vUv09), clampToBorder(vUv10), clampToBorder(vUv11));
    c += w.x*texture2D(inputBuffer, vUv08);
    c += w.y*texture2D(inputBuffer, vUv09);
    c += w.z*texture2D(inputBuffer, vUv10);
    c += w.w*texture2D(inputBuffer, vUv11);
    c += WEIGHT_OUTER*texture2D(inputBuffer, vUv);
    out_FragColor = c;
    out_FragColor = linearToOutputTexel( out_FragColor );
}
