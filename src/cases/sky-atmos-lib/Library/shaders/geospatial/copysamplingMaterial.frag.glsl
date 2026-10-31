
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
#define SHADER_NAME CopyMaterial
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
#ifdef DITHERING
    vec3 dithering( vec3 color ) {
        float grid_position = rand( gl_FragCoord.xy );
        vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
        dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
        return color + dither_shift_RGB;
    }
#endif
uniform sampler2D inputBuffer;
uniform float opacity;
varying vec2 vUv;
void main() {
    vec4 texel = texture2D(inputBuffer, vUv);
    out_FragColor = opacity*texel;
    out_FragColor = linearToOutputTexel( out_FragColor );
    #ifdef DITHERING
        out_FragColor.rgb = dithering( out_FragColor.rgb );
    #endif
}
