
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
#define SHADER_NAME EffectMaterial
#define THREE_REVISION 174
#define DEPTH_PACKING 3200
#define ENCODE_OUTPUT 1
#define PERSPECTIVE_CAMERA 1
#define UV vUv
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
#define DEPTH_PACKING 3200

#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
    #define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) {
    return x*x;
}
vec3 pow2( const in vec3 x ) {
    return x*x;
}
float pow3( const in float x ) {
    return x*x*x;
}
float pow4( const in float x ) {
    float x2 = x*x;
    return x2*x2;
}
float max3( const in vec3 v ) {
    return max( max( v.x, v.y ), v.z );
}
float average( const in vec3 v ) {
    return dot( v, vec3( 0.3333333 ) );
}
highp float rand( const in vec2 uv ) {
    const highp float a = 12.9898, b = 78.233, c = 43758.5453;
    highp float dt = dot( uv.xy, vec2( a, b ) ), sn = mod( dt, PI );
    return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
    float precisionSafeLength( vec3 v ) {
        return length( v );
    }
#else
    float precisionSafeLength( vec3 v ) {
        float maxComponent = max3( abs( v ) );
        return length( v / maxComponent ) * maxComponent;
    }
#endif
struct IncidentLight {
    vec3 color;
    vec3 direction;
    bool visible;
};
struct ReflectedLight {
    vec3 directDiffuse;
    vec3 directSpecular;
    vec3 indirectDiffuse;
    vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
    varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
    return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
    return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
mat3 transposeMat3( const in mat3 m ) {
    mat3 tmp;
    tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
    tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
    tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
    return tmp;
}
bool isPerspectiveMatrix( mat4 m ) {
    return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
    float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
    float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
    return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
    return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
    float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
    return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
    float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
    return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
// validated
vec3 packNormalToRGB( const in vec3 normal ) {
    return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
    return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;
const float UnpackDownscale = 255. / 256.;
const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
    if( v <= 0.0 )
    return vec4( 0., 0., 0., 0. );
    if( v >= 1.0 )
    return vec4( 1., 1., 1., 1. );
    float vuf;
    float af = modf( v * PackFactors.a, vuf );
    float bf = modf( vuf * ShiftRight8, vuf );
    float gf = modf( vuf * ShiftRight8, vuf );
    return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
    if( v <= 0.0 )
    return vec3( 0., 0., 0. );
    if( v >= 1.0 )
    return vec3( 1., 1., 1. );
    float vuf;
    float bf = modf( v * PackFactors.b, vuf );
    float gf = modf( vuf * ShiftRight8, vuf );
    return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
    if( v <= 0.0 )
    return vec2( 0., 0. );
    if( v >= 1.0 )
    return vec2( 1., 1. );
    float vuf;
    float gf = modf( v * 256., vuf );
    return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
    return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
    return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
    return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
    vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
    return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
    return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
    return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
    return depth * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
    return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
    return ( near * far ) / ( ( far - near ) * depth - far );
}
#ifdef DITHERING
    vec3 dithering( vec3 color ) {
        float grid_position = rand( gl_FragCoord.xy );
        vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
        dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
        return color + dither_shift_RGB;
    }
#endif
#define packFloatToRGBA(v) packDepthToRGBA(v)
#define unpackRGBAToFloat(v) unpackRGBAToDepth(v)
uniform sampler2D inputBuffer;
#if DEPTH_PACKING == 3201
    uniform lowp sampler2D depthBuffer;
    #elif defined(GL_FRAGMENT_PRECISION_HIGH)
    uniform highp sampler2D depthBuffer;
#else
    uniform mediump sampler2D depthBuffer;
#endif
uniform vec2 resolution;
uniform vec2 texelSize;
uniform float cameraNear;
uniform float cameraFar;
uniform float aspect;
uniform float time;
varying vec2 vUv;
vec4 sRGBToLinear(const in vec4 value) {
    return vec4(mix(pow(value.rgb*0.9478672986+vec3(0.0521327014), vec3(2.4)), value.rgb*0.0773993808, vec3(lessThanEqual(value.rgb, vec3(0.04045)))), value.a);
}
float readDepth(const in vec2 uv) {
    #if DEPTH_PACKING == 3201
        return unpackRGBAToDepth(texture2D(depthBuffer, uv));
    #else
        return texture2D(depthBuffer, uv).r;
    #endif
}
float getViewZ(const in float depth) {
    #ifdef PERSPECTIVE_CAMERA
        return perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
    #else
        return orthographicDepthToViewZ(depth, cameraNear, cameraFar);
    #endif
}
vec3 RGBToHCV(const in vec3 RGB) {
    vec4 P = mix(vec4(RGB.bg, -1.0, 2.0/3.0), vec4(RGB.gb, 0.0, -1.0/3.0), step(RGB.b, RGB.g));
    vec4 Q = mix(vec4(P.xyw, RGB.r), vec4(RGB.r, P.yzx), step(P.x, RGB.r));
    float C = Q.x-min(Q.w, Q.y);
    float H = abs((Q.w-Q.y)/(6.0*C+EPSILON)+Q.z);
    return vec3(H, C, Q.x);
}
vec3 RGBToHSL(const in vec3 RGB) {
    vec3 HCV = RGBToHCV(RGB);
    float L = HCV.z-HCV.y*0.5;
    float S = HCV.y/(1.0-abs(L*2.0-1.0)+EPSILON);
    return vec3(HCV.x, S, L);
}
vec3 HueToRGB(const in float H) {
    float R = abs(H*6.0-3.0)-1.0;
    float G = 2.0-abs(H*6.0-2.0);
    float B = 2.0-abs(H*6.0-4.0);
    return clamp(vec3(R, G, B), 0.0, 1.0);
}
vec3 HSLToRGB(const in vec3 HSL) {
    vec3 RGB = HueToRGB(HSL.x);
    float C = (1.0-abs(2.0*HSL.z-1.0))*HSL.y;
    return(RGB-0.5)*C+HSL.z;
}
uniform float e0BlendOpacity;
uniform sampler2D e0BloomBuffer;
uniform sampler2D e0FeaturesBuffer;
uniform float e0Intensity;
void e0MainImage(const vec4 inputColor, const vec2 uv, out vec4 outputColor) {
    vec3 bloom = texture(e0BloomBuffer, uv).rgb;
    vec3 features = texture(e0FeaturesBuffer, uv).rgb;
    outputColor = vec4(inputColor.rgb + (bloom + features) * e0Intensity, inputColor.a);
    // outputColor = vec4(inputColor.rgb + (bloom) * e0Intensity, inputColor.a);
}
vec4 blend23(const in vec4 x, const in vec4 y, const in float opacity) {
    return mix(x, y, opacity);
}
void main() {
    vec4 color0 = texture2D(inputBuffer, UV);
    vec4 color1 = vec4(0.0);
    e0MainImage(color0, UV, color1);
    color0 = blend23(color0, color1, e0BlendOpacity);
    color0.a = clamp(color0.a, 0.0, 1.0);
    out_FragColor = color0;
    #ifdef ENCODE_OUTPUT
        out_FragColor = linearToOutputTexel( out_FragColor );
    #endif
    #ifdef DITHERING
        out_FragColor.rgb = dithering( out_FragColor.rgb );
    #endif
}
