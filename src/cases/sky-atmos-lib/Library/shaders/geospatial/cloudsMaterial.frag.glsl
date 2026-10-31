
#version 300 es
#define LOG_DEPTH
#define SHADER_TYPE RawShaderMaterial
#define SHADER_NAME CloudsMaterial
#define PI 3.141592653589793
#define TRANSMITTANCE_TEXTURE_WIDTH 256
#define TRANSMITTANCE_TEXTURE_HEIGHT 64
#define SCATTERING_TEXTURE_R_SIZE 32
#define SCATTERING_TEXTURE_MU_SIZE 128
#define SCATTERING_TEXTURE_MU_S_SIZE 32
#define SCATTERING_TEXTURE_NU_SIZE 8
#define IRRADIANCE_TEXTURE_WIDTH 64
#define IRRADIANCE_TEXTURE_HEIGHT 16
#define METER_TO_LENGTH_UNIT 0.0010000
#define SUN_SPECTRAL_RADIANCE_TO_LUMINANCE vec3(1.225627882677,0.872716095900,0.829309018764)
#define SKY_SPECTRAL_RADIANCE_TO_LUMINANCE vec3(1.434369573713,0.889577441604,0.814781750602)
#define PHOTOMETRIC 1
#define LOCAL_WEATHER_CHANNELS rgba
#define SHAPE_DETAIL 1
#define TURBULENCE 1
#define SHADOW_LENGTH 1
#define HAZE 1
#define MULTI_SCATTERING_OCTAVES 8
#define ACCURATE_SUN_SKY_IRRADIANCE 1
#define SHADOW_CASCADE_COUNT 3
#define SHADOW_SAMPLE_COUNT 8
#define SCATTER_ANISOTROPY_1 0.7000000
#define SCATTER_ANISOTROPY_2 -0.2000000
#define SCATTER_ANISOTROPY_MIX 0.5000000
#define FRAMEBUFFER_PRECISION_HIGH 1
#define DEPTH_PACKING 3200
#define PERSPECTIVE_CAMERA 1
#define POWDER 1
#define GROUND_IRRADIANCE 1
// #define DEBUG_SHOW_CASCADES 1
precision highp float;
precision highp sampler3D;
precision highp sampler2DArray;
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
// cSpell:words logdepthbuf

float reverseLogDepth(const float depth, const float near, const float far) {
    #ifdef USE_LOGDEPTHBUF
        float d = pow(2.0, depth * log2(far + 1.0)) - 1.0;
        float a = far / (far - near);
        float b = far * near / (near - far);
        return a + b / d;
    #else // USE_LOGDEPTHBUF
        return depth;
    #endif // USE_LOGDEPTHBUF
}
float linearizeDepth(const float depth, const float near, const float far) {
    float ndc = depth * 2.0 - 1.0;
    return 2.0 * near * far / (far + near - ndc * (far - near));
}
#if !defined(saturate)
    #define saturate(a) clamp(a, 0.0, 1.0)
#endif // !defined(saturate)
float remap(const float x, const float min1, const float max1, const float min2, const float max2) {
    return min2 + (x - min1) / (max1 - min1) * (max2 - min2);
}
vec2 remap(const vec2 x, const vec2 min1, const vec2 max1, const vec2 min2, const vec2 max2) {
    return min2 + (x - min1) / (max1 - min1) * (max2 - min2);
}
vec3 remap(const vec3 x, const vec3 min1, const vec3 max1, const vec3 min2, const vec3 max2) {
    return min2 + (x - min1) / (max1 - min1) * (max2 - min2);
}
vec4 remap(const vec4 x, const vec4 min1, const vec4 max1, const vec4 min2, const vec4 max2) {
    return min2 + (x - min1) / (max1 - min1) * (max2 - min2);
}
float remapClamped(
const float x, const float min1, const float max1, const float min2, const float max2
) {
    return clamp(min2 + (x - min1) / (max1 - min1) * (max2 - min2), min2, max2);
}
vec2 remapClamped(
const vec2 x, const vec2 min1, const vec2 max1, const vec2 min2, const vec2 max2
) {
    return clamp(min2 + (x - min1) / (max1 - min1) * (max2 - min2), min2, max2);
}
vec3 remapClamped(
const vec3 x, const vec3 min1, const vec3 max1, const vec3 min2, const vec3 max2
) {
    return clamp(min2 + (x - min1) / (max1 - min1) * (max2 - min2), min2, max2);
}
vec4 remapClamped(
const vec4 x, const vec4 min1, const vec4 max1, const vec4 min2, const vec4 max2
) {
    return clamp(min2 + (x - min1) / (max1 - min1) * (max2 - min2), min2, max2);
}
// Implicitly remap to 0 and 1
float remap(const float x, const float min1, const float max1) {
    return (x - min1) / (max1 - min1);
}
vec2 remap(const vec2 x, const vec2 min1, const vec2 max1) {
    return (x - min1) / (max1 - min1);
}
vec3 remap(const vec3 x, const vec3 min1, const vec3 max1) {
    return (x - min1) / (max1 - min1);
}
vec4 remap(const vec4 x, const vec4 min1, const vec4 max1) {
    return (x - min1) / (max1 - min1);
}
float remapClamped(const float x, const float min1, const float max1) {
    return saturate((x - min1) / (max1 - min1));
}
vec2 remapClamped(const vec2 x, const vec2 min1, const vec2 max1) {
    return saturate((x - min1) / (max1 - min1));
}
vec3 remapClamped(const vec3 x, const vec3 min1, const vec3 max1) {
    return saturate((x - min1) / (max1 - min1));
}
vec4 remapClamped(const vec4 x, const vec4 min1, const vec4 max1) {
    return saturate((x - min1) / (max1 - min1));
}
// A fifth-order polynomial approximation of Turbo color map.
// See: https://observablehq.com/@mbostock/turbo
// prettier-ignore
vec3 turbo(const float x) {
    float r = 0.1357 + x * (4.5974 - x * (42.3277 - x * (130.5887 - x * (150.5666 - x * 58.1375))));
    float g = 0.0914 + x * (2.1856 + x * (4.8052 - x * (14.0195 - x * (4.2109 + x * 2.7747))));
    float b = 0.1067 + x * (12.5925 - x * (60.1097 - x * (109.0745 - x * (88.5066 - x * 26.8183))));
    return vec3(r, g, b);
}
float checker(const vec2 uv, const vec2 repeats) {
    vec2 c = floor(repeats * uv);
    float result = mod(c.x + c.y, 2.0);
    return sign(result);
}
float checker(const vec2 uv, const float repeats) {
    return checker(uv, vec2(repeats));
}
float raySphereFirstIntersection(
const vec3 origin, const vec3 direction, const vec3 center, const float radius
) {
    vec3 a = origin - center;
    float b = 2.0 * dot(direction, a);
    float c = dot(a, a) - radius * radius;
    float discriminant = b * b - 4.0 * c;
    return discriminant < 0.0
    ? -1.0
    : (-b - sqrt(discriminant)) * 0.5;
}
float raySphereFirstIntersection(const vec3 origin, const vec3 direction, const float radius) {
    return raySphereFirstIntersection(origin, direction, vec3(0.0), radius);
}
vec4 raySphereFirstIntersection(
const vec3 origin, const vec3 direction, const vec3 center, const vec4 radius
) {
    vec3 a = origin - center;
    float b = 2.0 * dot(direction, a);
    vec4 c = dot(a, a) - radius * radius;
    vec4 discriminant = b * b - 4.0 * c;
    vec4 mask = step(discriminant, vec4(0.0));
    return mix((-b - sqrt(max(vec4(0.0), discriminant))) * 0.5, vec4(-1.0), mask);
}
vec4 raySphereFirstIntersection(const vec3 origin, const vec3 direction, const vec4 radius) {
    return raySphereFirstIntersection(origin, direction, vec3(0.0), radius);
}
float raySphereSecondIntersection(
const vec3 origin, const vec3 direction, const vec3 center, const float radius
) {
    vec3 a = origin - center;
    float b = 2.0 * dot(direction, a);
    float c = dot(a, a) - radius * radius;
    float discriminant = b * b - 4.0 * c;
    return discriminant < 0.0
    ? -1.0
    : (-b + sqrt(discriminant)) * 0.5;
}
float raySphereSecondIntersection(const vec3 origin, const vec3 direction, const float radius) {
    return raySphereSecondIntersection(origin, direction, vec3(0.0), radius);
}
vec4 raySphereSecondIntersection(
const vec3 origin, const vec3 direction, const vec3 center, const vec4 radius
) {
    vec3 a = origin - center;
    float b = 2.0 * dot(direction, a);
    vec4 c = dot(a, a) - radius * radius;
    vec4 discriminant = b * b - 4.0 * c;
    vec4 mask = step(discriminant, vec4(0.0));
    return mix((-b + sqrt(max(vec4(0.0), discriminant))) * 0.5, vec4(-1.0), mask);
}
vec4 raySphereSecondIntersection(const vec3 origin, const vec3 direction, const vec4 radius) {
    return raySphereSecondIntersection(origin, direction, vec3(0.0), radius);
}
void raySphereIntersections(
const vec3 origin, const vec3 direction, const vec3 center, const float radius, out float intersection1, out float intersection2
) {
    vec3 a = origin - center;
    float b = 2.0 * dot(direction, a);
    float c = dot(a, a) - radius * radius;
    float discriminant = b * b - 4.0 * c;
    if (discriminant < 0.0) {
        intersection1 = -1.0;
        intersection2 = -1.0;
        return;
    }
    else {
        float Q = sqrt(discriminant);
        intersection1 = (-b - Q) * 0.5;
        intersection2 = (-b + Q) * 0.5;
    }

}
void raySphereIntersections(
const vec3 origin, const vec3 direction, const float radius, out float intersection1, out float intersection2
) {
    raySphereIntersections(origin, direction, vec3(0.0), radius, intersection1, intersection2);
}
void raySphereIntersections(
const vec3 origin, const vec3 direction, const vec3 center, const vec4 radius, out vec4 intersection1, out vec4 intersection2
) {
    vec3 a = origin - center;
    float b = 2.0 * dot(direction, a);
    vec4 c = dot(a, a) - radius * radius;
    vec4 discriminant = b * b - 4.0 * c;
    vec4 mask = step(discriminant, vec4(0.0));
    vec4 Q = sqrt(max(vec4(0.0), discriminant));
    intersection1 = mix((-b - Q) * 0.5, vec4(-1.0), mask);
    intersection2 = mix((-b + Q) * 0.5, vec4(-1.0), mask);
}
void raySphereIntersections(
const vec3 origin, const vec3 direction, const vec4 radius, out vec4 intersection1, out vec4 intersection2
) {
    raySphereIntersections(origin, direction, vec3(0.0), radius, intersection1, intersection2);
}
// Reference: https://github.com/mrdoob/three.js/blob/r171/examples/jsm/csm/CSMShader.js

#ifndef SHADOW_CASCADE_COUNT
    #error "SHADOW_CASCADE_COUNT macro must be defined."
#endif // SHADOW_CASCADE_COUNT

int getCascadeIndex(
const mat4 viewMatrix, const vec3 worldPosition, const vec2 intervals[SHADOW_CASCADE_COUNT], const float near, const float far
) {
    vec4 viewPosition = viewMatrix * vec4(worldPosition, 1.0);
    float depth = viewZToOrthographicDepth(viewPosition.z, near, far);
    vec2 interval;
    #if 0 < SHADOW_CASCADE_COUNT
        interval = intervals[0];
        if (depth >= interval.x && depth < interval.y) {
            return 0;
        }
    #endif // 0 < SHADOW_CASCADE_COUNT
    
    #if 1 < SHADOW_CASCADE_COUNT
        interval = intervals[1];
        if (depth >= interval.x && depth < interval.y) {
            return 1;
        }
    #endif // 1 < SHADOW_CASCADE_COUNT
    
    #if 2 < SHADOW_CASCADE_COUNT
        interval = intervals[2];
        if (depth >= interval.x && depth < interval.y) {
            return 2;
        }
    #endif // 2 < SHADOW_CASCADE_COUNT
    
    #if 3 < SHADOW_CASCADE_COUNT
        interval = intervals[3];
        if (depth >= interval.x && depth < interval.y) {
            return 3;
        }
    #endif // 3 < SHADOW_CASCADE_COUNT
    return SHADOW_CASCADE_COUNT - 1;
}
int getFadedCascadeIndex(
const mat4 viewMatrix, const vec3 worldPosition, const vec2 intervals[SHADOW_CASCADE_COUNT], const float near, const float far, const float jitter
) {
    vec4 viewPosition = viewMatrix * vec4(worldPosition, 1.0);
    float depth = viewZToOrthographicDepth(viewPosition.z, near, far);
    vec2 interval;
    float intervalCenter;
    float closestEdge;
    float margin;
    int nextIndex = -1;
    int prevIndex = -1;
    float alpha;
    #if 0 < SHADOW_CASCADE_COUNT
        interval = intervals[0];
        intervalCenter = (interval.x + interval.y) * 0.5;
        closestEdge = depth < intervalCenter ? interval.x : interval.y;
        margin = closestEdge * closestEdge * 0.5;
        interval += margin * vec2(-0.5, 0.5);
        #if 0 < SHADOW_CASCADE_COUNT - 1
            if (depth >= interval.x && depth < interval.y) {
                prevIndex = nextIndex;
                nextIndex = 0;
                alpha = saturate(min(depth - interval.x, interval.y - depth) / margin);
            }
        #else // 0 < SHADOW_CASCADE_COUNT - 1
            // Don't fade out the last cascade.
            if (depth >= interval.x) {
                prevIndex = nextIndex;
                nextIndex = 0;
                alpha = saturate((depth - interval.x) / margin);
            }
        #endif // 0 < SHADOW_CASCADE_COUNT - 1
    #endif // 0 < SHADOW_CASCADE_COUNT
    
    #if 1 < SHADOW_CASCADE_COUNT
        interval = intervals[1];
        intervalCenter = (interval.x + interval.y) * 0.5;
        closestEdge = depth < intervalCenter ? interval.x : interval.y;
        margin = closestEdge * closestEdge * 0.5;
        interval += margin * vec2(-0.5, 0.5);
        #if 1 < SHADOW_CASCADE_COUNT - 1
            if (depth >= interval.x && depth < interval.y) {
                prevIndex = nextIndex;
                nextIndex = 1;
                alpha = saturate(min(depth - interval.x, interval.y - depth) / margin);
            }
        #else // 1 < SHADOW_CASCADE_COUNT - 1
            // Don't fade out the last cascade.
            if (depth >= interval.x) {
                prevIndex = nextIndex;
                nextIndex = 1;
                alpha = saturate((depth - interval.x) / margin);
            }
        #endif // 1 < SHADOW_CASCADE_COUNT - 1
    #endif // 1 < SHADOW_CASCADE_COUNT
    
    #if 2 < SHADOW_CASCADE_COUNT
        interval = intervals[2];
        intervalCenter = (interval.x + interval.y) * 0.5;
        closestEdge = depth < intervalCenter ? interval.x : interval.y;
        margin = closestEdge * closestEdge * 0.5;
        interval += margin * vec2(-0.5, 0.5);
        #if 2 < SHADOW_CASCADE_COUNT - 1
            if (depth >= interval.x && depth < interval.y) {
                prevIndex = nextIndex;
                nextIndex = 2;
                alpha = saturate(min(depth - interval.x, interval.y - depth) / margin);
            }
        #else // 2 < SHADOW_CASCADE_COUNT - 1
            // Don't fade out the last cascade.
            if (depth >= interval.x) {
                prevIndex = nextIndex;
                nextIndex = 2;
                alpha = saturate((depth - interval.x) / margin);
            }
        #endif // 2 < SHADOW_CASCADE_COUNT - 1
    #endif // 2 < SHADOW_CASCADE_COUNT
    
    #if 3 < SHADOW_CASCADE_COUNT
        interval = intervals[3];
        intervalCenter = (interval.x + interval.y) * 0.5;
        closestEdge = depth < intervalCenter ? interval.x : interval.y;
        margin = closestEdge * closestEdge * 0.5;
        interval += margin * vec2(-0.5, 0.5);
        #if 3 < SHADOW_CASCADE_COUNT - 1
            if (depth >= interval.x && depth < interval.y) {
                prevIndex = nextIndex;
                nextIndex = 3;
                alpha = saturate(min(depth - interval.x, interval.y - depth) / margin);
            }
        #else // 3 < SHADOW_CASCADE_COUNT - 1
            // Don't fade out the last cascade.
            if (depth >= interval.x) {
                prevIndex = nextIndex;
                nextIndex = 3;
                alpha = saturate((depth - interval.x) / margin);
            }
        #endif // 3 < SHADOW_CASCADE_COUNT - 1
    #endif // 3 < SHADOW_CASCADE_COUNT
    return jitter <= alpha
    ? nextIndex
    : prevIndex;
}
// Reference: https://advances.realtimerendering.com/s2014/index.html#_NEXT_GENERATION_POST

float interleavedGradientNoise(const vec2 coord) {
    const vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
    return fract(magic.z * fract(dot(coord, magic.xy)));
}
// Reference: https://www.gamedev.net/tutorials/programming/graphics/contact-hardening-soft-shadows-made-fast-r4906/

vec2 vogelDisk(const int index, const int sampleCount, const float phi) {
    const float goldenAngle = 2.39996322972865332;
    float r = sqrt(float(index) + 0.5) / sqrt(float(sampleCount));
    float theta = float(index) * goldenAngle + phi;
    return r * vec2(cos(theta), sin(theta));
}
uniform vec3 u_solar_irradiance;
uniform float u_sun_angular_radius;
uniform float u_bottom_radius;
uniform float u_top_radius;
uniform vec3 u_rayleigh_scattering;
uniform vec3 u_mie_scattering;
uniform float u_mie_phase_function_g;
uniform float u_mu_s_min;
uniform sampler2D u_transmittance_texture;
uniform sampler3D u_scattering_texture;
uniform sampler3D u_single_mie_scattering_texture;
uniform sampler2D u_irradiance_texture;

// Based on the following work and adapted to Three.js.

// This file includes runtime functions only. Please refer to Bruneton's source
// code for the whole picture. It has detailed comments.
// https://github.com/ebruneton/precomputed_atmospheric_scattering/blob/master/atmosphere/functions.glsl

/**
* Copyright (c) 2017 Eric Bruneton
* All rights reserved.
*
* Redistribution and use in source and binary forms, with or without
* modification, are permitted provided that the following conditions
* are met:
* 1. Redistributions of source code must retain the above copyright
*    notice, this list of conditions and the following disclaimer.
* 2. Redistributions in binary form must reproduce the above copyright
*    notice, this list of conditions and the following disclaimer in the
*    documentation and/or other materials provided with the distribution.
* 3. Neither the name of the copyright holders nor the names of its
*    contributors may be used to endorse or promote products derived from
*    this software without specific prior written permission.
*
* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
* AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
* IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
* ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
* LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
* CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
* SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
* INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
* CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
* ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
* THE POSSIBILITY OF SUCH DAMAGE.
*
* Precomputed Atmospheric Scattering
* Copyright (c) 2008 INRIA
* All rights reserved.
*
* Redistribution and use in source and binary forms, with or without
* modification, are permitted provided that the following conditions
* are met:
* 1. Redistributions of source code must retain the above copyright
*    notice, this list of conditions and the following disclaimer.
* 2. Redistributions in binary form must reproduce the above copyright
*    notice, this list of conditions and the following disclaimer in the
*    documentation and/or other materials provided with the distribution.
* 3. Neither the name of the copyright holders nor the names of its
*    contributors may be used to endorse or promote products derived from
*    this software without specific prior written permission.
*
* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
* AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
* IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
* ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
* LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
* CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
* SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
* INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
* CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
* ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
* THE POSSIBILITY OF SUCH DAMAGE.
*/

float ClampCosine(float mu) {
    return clamp(mu, float(-1.0), float(1.0));
}
float ClampDistance(float d) {
    return max(d, 0.0);
}
float ClampRadius(float r) {
    return clamp(r, u_bottom_radius, u_top_radius);
}
float SafeSqrt(float a) {
    return sqrt(max(a, 0.0));
}
float DistanceToTopAtmosphereBoundary(float r, float mu) {
    float discriminant = r * r * (mu * mu - 1.0) + u_top_radius * u_top_radius;
    return ClampDistance(-r * mu + SafeSqrt(discriminant));
}
bool RayIntersectsGround(float r, float mu) {
    return mu < 0.0 && r * r * (mu * mu - 1.0) + u_bottom_radius * u_bottom_radius >= 0.0;
}
float GetTextureCoordFromUnitRange(float x, int texture_size) {
    return 0.5 / float(texture_size) + x * (1.0 - 1.0 / float(texture_size));
}
vec2 GetTransmittanceTextureUvFromRMu(float r, float mu) {
    float H = sqrt(u_top_radius * u_top_radius - u_bottom_radius * u_bottom_radius);
    float rho = SafeSqrt(r * r - u_bottom_radius * u_bottom_radius);
    float d = DistanceToTopAtmosphereBoundary(r, mu);
    float d_min = u_top_radius - r;
    float d_max = rho + H;
    float x_mu = (d - d_min) / (d_max - d_min);
    float x_r = rho / H;
    return vec2(
    GetTextureCoordFromUnitRange(x_mu, TRANSMITTANCE_TEXTURE_WIDTH), GetTextureCoordFromUnitRange(x_r, TRANSMITTANCE_TEXTURE_HEIGHT)
    );
}
vec3 GetTransmittanceToTopAtmosphereBoundary(
const sampler2D u_transmittance_texture, float r, float mu
) {
    vec2 uv = GetTransmittanceTextureUvFromRMu(r, mu);
    return vec3(texture(u_transmittance_texture, uv));
}
vec3 GetTransmittance(
const sampler2D u_transmittance_texture, float r, float mu, float d, bool ray_r_mu_intersects_ground
) {
    float r_d = ClampRadius(sqrt(d * d + 2.0 * r * mu * d + r * r));
    float mu_d = ClampCosine((r * mu + d) / r_d);
    if (ray_r_mu_intersects_ground) {
        return min(
        GetTransmittanceToTopAtmosphereBoundary(u_transmittance_texture, r_d, -mu_d) /
        GetTransmittanceToTopAtmosphereBoundary(u_transmittance_texture, r, -mu), vec3(1.0)
        );
    }
    else {
        return min(
        GetTransmittanceToTopAtmosphereBoundary(u_transmittance_texture, r, mu) /
        GetTransmittanceToTopAtmosphereBoundary(u_transmittance_texture, r_d, mu_d), vec3(1.0)
        );
    }

}
vec3 GetTransmittanceToSun(const sampler2D u_transmittance_texture, float r, float mu_s) {
    float sin_theta_h = u_bottom_radius / r;
    float cos_theta_h = -sqrt(max(1.0 - sin_theta_h * sin_theta_h, 0.0));
    return GetTransmittanceToTopAtmosphereBoundary(u_transmittance_texture, r, mu_s) *
    smoothstep(
    -sin_theta_h * u_sun_angular_radius, sin_theta_h * u_sun_angular_radius, mu_s - cos_theta_h
    );
}
float RayleighPhaseFunction(float nu) {
    float k = 3.0 / (16.0 * PI);
    return k * (1.0 + nu * nu);
}
float MiePhaseFunction(float g, float nu) {
    float k = 3.0 / (8.0 * PI) * (1.0 - g * g) / (2.0 + g * g);
    return k * (1.0 + nu * nu) / pow(1.0 + g * g - 2.0 * g * nu, 1.5);
}
vec4 GetScatteringTextureUvwzFromRMuMuSNu(
float r, float mu, float mu_s, float nu, bool ray_r_mu_intersects_ground
) {
    float H = sqrt(u_top_radius * u_top_radius - u_bottom_radius * u_bottom_radius);
    float rho = SafeSqrt(r * r - u_bottom_radius * u_bottom_radius);
    float u_r = GetTextureCoordFromUnitRange(rho / H, SCATTERING_TEXTURE_R_SIZE);
    float r_mu = r * mu;
    float discriminant = r_mu * r_mu - r * r + u_bottom_radius * u_bottom_radius;
    float u_mu;
    if (ray_r_mu_intersects_ground) {
        float d = -r_mu - SafeSqrt(discriminant);
        float d_min = r - u_bottom_radius;
        float d_max = rho;
        u_mu = 0.5 -
        0.5 *
        GetTextureCoordFromUnitRange(
        d_max == d_min
        ? 0.0
        : (d - d_min) / (d_max - d_min), SCATTERING_TEXTURE_MU_SIZE / 2
        );
    }
    else {
        float d = -r_mu + SafeSqrt(discriminant + H * H);
        float d_min = u_top_radius - r;
        float d_max = rho + H;
        u_mu = 0.5 +
        0.5 *
        GetTextureCoordFromUnitRange((d - d_min) / (d_max - d_min), SCATTERING_TEXTURE_MU_SIZE / 2);
    }
    float d = DistanceToTopAtmosphereBoundary(u_bottom_radius, mu_s);
    float d_min = u_top_radius - u_bottom_radius;
    float d_max = H;
    float a = (d - d_min) / (d_max - d_min);
    float D = DistanceToTopAtmosphereBoundary(u_bottom_radius, u_mu_s_min);
    float A = (D - d_min) / (d_max - d_min);
    float u_mu_s = GetTextureCoordFromUnitRange(
    max(1.0 - a / A, 0.0) / (1.0 + a), SCATTERING_TEXTURE_MU_S_SIZE
    );
    float u_nu = (nu + 1.0) / 2.0;
    return vec4(u_nu, u_mu_s, u_mu, u_r);
}
vec2 GetIrradianceTextureUvFromRMuS(float r, float mu_s) {
    float x_r = (r - u_bottom_radius) / (u_top_radius - u_bottom_radius);
    float x_mu_s = mu_s * 0.5 + 0.5;
    return vec2(
    GetTextureCoordFromUnitRange(x_mu_s, IRRADIANCE_TEXTURE_WIDTH), GetTextureCoordFromUnitRange(x_r, IRRADIANCE_TEXTURE_HEIGHT)
    );
}
vec3 GetIrradiance(const sampler2D u_irradiance_texture, float r, float mu_s) {
    vec2 uv = GetIrradianceTextureUvFromRMuS(r, mu_s);
    return vec3(texture(u_irradiance_texture, uv));
}
vec3 GetExtrapolatedSingleMieScattering(const vec4 scattering) {
    if (scattering.r <= 0.0) {
        return vec3(0.0);
    }
    return scattering.rgb *
    scattering.a /
    scattering.r *
    (u_rayleigh_scattering.r / u_mie_scattering.r) *
    (u_mie_scattering / u_rayleigh_scattering);
}
vec3 GetCombinedScattering(
const sampler3D u_scattering_texture, const sampler3D u_single_mie_scattering_texture, float r, float mu, float mu_s, float nu, bool ray_r_mu_intersects_ground, out vec3 single_mie_scattering
) {
    vec4 uvwz = GetScatteringTextureUvwzFromRMuMuSNu(r, mu, mu_s, nu, ray_r_mu_intersects_ground);
    float tex_coord_x = uvwz.x * float(SCATTERING_TEXTURE_NU_SIZE - 1);
    float tex_x = floor(tex_coord_x);
    float lerp = tex_coord_x - tex_x;
    vec3 uvw0 = vec3((tex_x + uvwz.y) / float(SCATTERING_TEXTURE_NU_SIZE), uvwz.z, uvwz.w);
    vec3 uvw1 = vec3((tex_x + 1.0 + uvwz.y) / float(SCATTERING_TEXTURE_NU_SIZE), uvwz.z, uvwz.w);
    vec4 combined_scattering = texture(u_scattering_texture, uvw0) * (1.0 - lerp) + texture(u_scattering_texture, uvw1) * lerp;
    vec3 scattering = vec3(combined_scattering);
    single_mie_scattering = GetExtrapolatedSingleMieScattering(combined_scattering);
    return scattering;
}
vec3 GetSkyRadiance(
const sampler2D u_transmittance_texture, const sampler3D u_scattering_texture, const sampler3D u_single_mie_scattering_texture, vec3 camera, const vec3 view_ray, float shadow_length, const vec3 sun_direction, out vec3 transmittance
) {
    float r = length(camera);
    float rmu = dot(camera, view_ray);
    float distance_to_top_atmosphere_boundary = -rmu - SafeSqrt(rmu * rmu - r * r + u_top_radius * u_top_radius);
    if (distance_to_top_atmosphere_boundary > 0.0) {
        camera = camera + view_ray * distance_to_top_atmosphere_boundary;
        r = u_top_radius;
        rmu += distance_to_top_atmosphere_boundary;
    }
    else if (r > u_top_radius) {
        transmittance = vec3(1.0);
        return vec3(0.0);
    }
    float mu = rmu / r;
    float mu_s = dot(camera, sun_direction) / r;
    float nu = dot(view_ray, sun_direction);
    bool ray_r_mu_intersects_ground = RayIntersectsGround(r, mu);
    transmittance = ray_r_mu_intersects_ground
    ? vec3(0.0)
    : GetTransmittanceToTopAtmosphereBoundary(u_transmittance_texture, r, mu);
    vec3 single_mie_scattering;
    vec3 scattering;
    if (shadow_length == 0.0) {
        scattering = GetCombinedScattering(
        u_scattering_texture, u_single_mie_scattering_texture, r, mu, mu_s, nu, ray_r_mu_intersects_ground, single_mie_scattering
        );
    }
    else {
        float d = shadow_length;
        float r_p = ClampRadius(sqrt(d * d + 2.0 * r * mu * d + r * r));
        float mu_p = (r * mu + d) / r_p;
        float mu_s_p = (r * mu_s + d * nu) / r_p;
        scattering = GetCombinedScattering(
        u_scattering_texture, u_single_mie_scattering_texture, r_p, mu_p, mu_s_p, nu, ray_r_mu_intersects_ground, single_mie_scattering
        );
        vec3 shadow_transmittance = GetTransmittance(
        u_transmittance_texture, r, mu, shadow_length, ray_r_mu_intersects_ground
        );
        scattering = scattering * shadow_transmittance;
        single_mie_scattering = single_mie_scattering * shadow_transmittance;
    }
    return scattering * RayleighPhaseFunction(nu) +
    single_mie_scattering * MiePhaseFunction(u_mie_phase_function_g, nu);
}
vec3 GetSkyRadianceToPoint(
const sampler2D u_transmittance_texture, const sampler3D u_scattering_texture, const sampler3D u_single_mie_scattering_texture, vec3 camera, const vec3 point, float shadow_length, const vec3 sun_direction, out vec3 transmittance
) {
    vec3 view_ray = normalize(point - camera);
    float r = length(camera);
    float rmu = dot(camera, view_ray);
    float distance_to_top_atmosphere_boundary = -rmu - sqrt(rmu * rmu - r * r + u_top_radius * u_top_radius);
    if (distance_to_top_atmosphere_boundary > 0.0) {
        camera = camera + view_ray * distance_to_top_atmosphere_boundary;
        r = u_top_radius;
        rmu += distance_to_top_atmosphere_boundary;
    }
    float mu = rmu / r;
    float mu_s = dot(camera, sun_direction) / r;
    float nu = dot(view_ray, sun_direction);
    float d = length(point - camera);
    bool ray_r_mu_intersects_ground = RayIntersectsGround(r, mu);
    
    // Hack to avoid rendering artifacts near the horizon, due to finite
    
    // atmosphere texture resolution and finite floating point precision.
    // See: https://github.com/ebruneton/precomputed_atmospheric_scattering/pull/32
    if (!ray_r_mu_intersects_ground) {
        float mu_horiz = -SafeSqrt(1.0 - u_bottom_radius / r * (u_bottom_radius / r));
        mu = max(mu, mu_horiz + 0.004);
    }
    transmittance = GetTransmittance(u_transmittance_texture, r, mu, d, ray_r_mu_intersects_ground);
    vec3 single_mie_scattering;
    vec3 scattering = GetCombinedScattering(
    u_scattering_texture, u_single_mie_scattering_texture, r, mu, mu_s, nu, ray_r_mu_intersects_ground, single_mie_scattering
    );
    d = max(d - shadow_length, 0.0);
    float r_p = ClampRadius(sqrt(d * d + 2.0 * r * mu * d + r * r));
    float mu_p = (r * mu + d) / r_p;
    float mu_s_p = (r * mu_s + d * nu) / r_p;
    vec3 single_mie_scattering_p;
    vec3 scattering_p = GetCombinedScattering(
    u_scattering_texture, u_single_mie_scattering_texture, r_p, mu_p, mu_s_p, nu, ray_r_mu_intersects_ground, single_mie_scattering_p
    );
    vec3 shadow_transmittance = transmittance;
    if (shadow_length > 0.0) {
        shadow_transmittance = GetTransmittance(
        u_transmittance_texture, r, mu, d, ray_r_mu_intersects_ground
        );
    }
    scattering = scattering - shadow_transmittance * scattering_p;
    single_mie_scattering = single_mie_scattering - shadow_transmittance * single_mie_scattering_p;
    single_mie_scattering = GetExtrapolatedSingleMieScattering(
    vec4(scattering, single_mie_scattering.r)
    );
    single_mie_scattering = single_mie_scattering * smoothstep(float(0.0), float(0.01), mu_s);
    return scattering * RayleighPhaseFunction(nu) +
    single_mie_scattering * MiePhaseFunction(u_mie_phase_function_g, nu);
}
vec3 GetSunAndSkyIrradiance(
const sampler2D u_transmittance_texture, const sampler2D u_irradiance_texture, const vec3 point, const vec3 sun_direction, out vec3 sky_irradiance
) {
    float r = length(point);
    float mu_s = dot(point, sun_direction) / r;
    // 5.30
    // sky_irradiance = GetIrradiance(u_irradiance_texture, r, mu_s);
    sky_irradiance = GetIrradiance(u_irradiance_texture, r, mu_s) * 2.0 * PI;
    return u_solar_irradiance * GetTransmittanceToSun(u_transmittance_texture, r, mu_s);
}
vec3 GetSunAndSkyIrradiance(
const sampler2D u_transmittance_texture, const sampler2D u_irradiance_texture, const vec3 point, const vec3 normal, const vec3 sun_direction, out vec3 sky_irradiance
) {
    float r = length(point);
    float mu_s = dot(point, sun_direction) / r;
    sky_irradiance = GetIrradiance(u_irradiance_texture, r, mu_s) * (1.0 + dot(normal, point) / r) * 0.5;
    return u_solar_irradiance *
    GetTransmittanceToSun(u_transmittance_texture, r, mu_s) *
    max(dot(normal, sun_direction), 0.0);
}
vec3 GetSolarRadiance() {
    vec3 radiance = u_solar_irradiance / (PI * u_sun_angular_radius * u_sun_angular_radius);
    #ifdef PHOTOMETRIC
        radiance *= SUN_SPECTRAL_RADIANCE_TO_LUMINANCE;
    #endif // PHOTOMETRIC
    return radiance;
}
vec3 GetSkyRadiance(
vec3 camera, vec3 view_ray, float shadow_length, vec3 sun_direction, out vec3 transmittance
) {
    vec3 radiance = GetSkyRadiance(
    u_transmittance_texture, u_scattering_texture, u_single_mie_scattering_texture, camera, view_ray, shadow_length, sun_direction, transmittance
    );
    #ifdef PHOTOMETRIC
        radiance *= SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;
    #endif // PHOTOMETRIC
    return radiance;
}
vec3 GetSkyRadianceToPoint(
vec3 camera, vec3 point, float shadow_length, vec3 sun_direction, out vec3 transmittance
) {
    vec3 inscatter = GetSkyRadianceToPoint(
    u_transmittance_texture, u_scattering_texture, u_single_mie_scattering_texture, camera, point, shadow_length, sun_direction, transmittance
    );
    #ifdef PHOTOMETRIC
        inscatter *= SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;
    #endif // PHOTOMETRIC
    return inscatter;
}
vec3 GetSunAndSkyIrradiance(vec3 point, vec3 sun_direction, out vec3 sky_irradiance) {
    vec3 sun_irradiance = GetSunAndSkyIrradiance(
    u_transmittance_texture, u_irradiance_texture, point, sun_direction, sky_irradiance
    );
    #ifdef PHOTOMETRIC
        sun_irradiance *= SUN_SPECTRAL_RADIANCE_TO_LUMINANCE;
        sky_irradiance *= SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;
    #endif // PHOTOMETRIC
    return sun_irradiance;
}
vec3 GetSunAndSkyIrradiance(vec3 point, vec3 normal, vec3 sun_direction, out vec3 sky_irradiance) {
    vec3 sun_irradiance = GetSunAndSkyIrradiance(
    u_transmittance_texture, u_irradiance_texture, point, normal, sun_direction, sky_irradiance
    );
    #ifdef PHOTOMETRIC
        sun_irradiance *= SUN_SPECTRAL_RADIANCE_TO_LUMINANCE;
        sky_irradiance *= SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;
    #endif // PHOTOMETRIC
    return sun_irradiance;
}
struct GroundIrradiance {
    vec3 sun;
    vec3 sky;
};
struct CloudsIrradiance {
    vec3 minSun;
    vec3 minSky;
    vec3 maxSun;
    vec3 maxSky;
};
struct DensityProfile {
    vec4 expTerms;
    vec4 exponents;
    vec4 linearTerms;
    vec4 constantTerms;
};
uniform vec2 resolution;
uniform int frame;
uniform sampler3D stbnTexture;

// Atmosphere

uniform float bottomRadius;
uniform mat4 ellipsoidMatrix;
uniform mat4 inverseEllipsoidMatrix;
uniform vec3 sunDirection;

// Participating medium

uniform float scatteringCoefficient;
uniform float absorptionCoefficient;
uniform vec3 albedo;

// Primary raymarch

uniform float minDensity;
uniform float minExtinction;
uniform float minTransmittance;

// Shape and weather

uniform sampler2D localWeatherTexture;
uniform vec2 localWeatherRepeat;
uniform vec2 localWeatherOffset;
uniform float coverage;
uniform sampler3D shapeTexture;
uniform vec3 shapeRepeat;
uniform vec3 shapeOffset;
#ifdef SHAPE_DETAIL
    uniform sampler3D shapeDetailTexture;
    uniform vec3 shapeDetailRepeat;
    uniform vec3 shapeDetailOffset;
#endif // SHAPE_DETAIL

#ifdef TURBULENCE
    uniform sampler2D turbulenceTexture;
    uniform vec2 turbulenceRepeat;
    uniform float turbulenceDisplacement;
#endif // TURBULENCE

// Haze
#ifdef HAZE
    uniform float hazeDensityScale;
    uniform bool hazeCloudAttached;
    uniform float hazeGroundDensityScale;
    uniform float hazeViewDistance;
    uniform float hazeVolumeLength;
    uniform float hazeDirectLightScale;
uniform vec3 hazeSunColor;
    uniform float hazeExponent;
    uniform float hazeAnisotropy;
    uniform int hazeSampleCount;
    uniform int hazeShadowSampleCount;
    uniform float hazeScatteringCoefficient;
    uniform float hazeAbsorptionCoefficient;
#endif // HAZE

// Cloud layers
uniform vec4 minLayerHeights;
uniform vec4 maxLayerHeights;
uniform vec3 minIntervalHeights;
uniform vec3 maxIntervalHeights;
uniform vec4 densityScales;
uniform vec4 shapeAmounts;
uniform vec4 shapeDetailAmounts;
uniform vec4 weatherExponents;
uniform vec4 shapeAlteringBiases;
uniform vec4 coverageFilterWidths;
uniform float minHeight;
uniform float maxHeight;
uniform float shadowTopHeight;
uniform float shadowBottomHeight;
uniform vec4 shadowLayerMask;
uniform DensityProfile densityProfile;
float getSTBN() {
    ivec3 size = textureSize(stbnTexture, 0);
    vec3 scale = 1.0 / vec3(size);
    return texture(stbnTexture, vec3(gl_FragCoord.xy, float(frame % size.z)) * scale).r;
}
// Straightforward spherical mapping
vec2 getSphericalUv(const vec3 position) {
    vec2 st = normalize(position.yx);
    float phi = atan(st.x, st.y);
    float theta = asin(normalize(position).z);
    return vec2(phi * RECIPROCAL_PI2 + 0.5, theta * RECIPROCAL_PI + 0.5);
}
vec2 getCubeSphereUv(const vec3 position) {
    // Cube-sphere relaxation by: http://mathproofs.blogspot.com/2005/07/mapping-cube-to-sphere.html
    // TODO: Tile and fix seams.
    // Possible improvements:
    // https://iquilezles.org/articles/texturerepetition/
    // https://gamedev.stackexchange.com/questions/184388/fragment-shader-map-dot-texture-repeatedly-over-the-sphere
    // https://github.com/mmikk/hextile-demo
    
    vec3 n = normalize(position);
    vec3 f = abs(n);
    vec3 c = n / max(f.x, max(f.y, f.z));
    vec2 m;
    if (all(greaterThan(f.yy, f.xz))) {
        m = c.y > 0.0 ? vec2(-n.x, n.z) : n.xz;
    }
    else if (all(greaterThan(f.xx, f.yz))) {
        m = c.x > 0.0 ? n.yz : vec2(-n.y, n.z);
    }
    else {
        m = c.z > 0.0 ? n.xy : vec2(n.x, -n.y);
    }
    vec2 m2 = m * m;
    float q = dot(m2.xy, vec2(-2.0, 2.0)) - 3.0;
    float q2 = q * q;
    vec2 uv;
    uv.x = sqrt(1.5 + m2.x - m2.y - 0.5 * sqrt(-24.0 * m2.x + q2)) * (m.x > 0.0 ? 1.0 : -1.0);
    uv.y = sqrt(6.0 / (3.0 - uv.x * uv.x)) * m.y;
    return uv * 0.5 + 0.5;
}
vec2 getGlobeUv(const vec3 position) {
    return getCubeSphereUv(position);
}
float getMipLevel(const vec2 uv) {
    const float mipLevelScale = 0.1;
    vec2 coord = uv * resolution;
    vec2 ddx = dFdx(coord);
    vec2 ddy = dFdy(coord);
    float deltaMaxSqr = max(dot(ddx, ddx), dot(ddy, ddy)) * mipLevelScale;
    return max(0.0, 0.5 * log2(max(1.0, deltaMaxSqr)));
}
bool insideLayerIntervals(const float height) {
    bvec3 gt = greaterThan(vec3(height), minIntervalHeights);
    bvec3 lt = lessThan(vec3(height), maxIntervalHeights);
    return any(bvec3(gt.x && lt.x, gt.y && lt.y, gt.z && lt.z));
}
/*__CLOUD_LAYER_DENSITY__*/
struct WeatherSample {
    vec4 heightFraction; // Normalized height of each layer
    
    vec4 density;
};
vec4 shapeAlteringFunction(const vec4 heightFraction, const vec4 bias) {
    // Apply a semi-circle transform to round the clouds towards the top.
    vec4 biased = pow(heightFraction, bias);
    vec4 x = clamp(biased * 2.0 - 1.0, -1.0, 1.0);
    return 1.0 - x * x;
}
WeatherSample sampleWeather(const vec2 uv, const float height, const float mipLevel) {
    WeatherSample weather;
    weather.heightFraction = remapClamped(vec4(height), minLayerHeights, maxLayerHeights);
    vec4 localWeather = pow(
    textureLod(
    localWeatherTexture, uv * localWeatherRepeat + localWeatherOffset, mipLevel
    ).LOCAL_WEATHER_CHANNELS, weatherExponents
    );
    #ifdef SHADOW
        localWeather *= shadowLayerMask;
    #endif // SHADOW
    
    vec4 heightScale = shapeAlteringFunction(weather.heightFraction, cloudHeightBias(shapeAlteringBiases));
    
    // Modulation to control weather by coverage parameter.
    
    // Reference: https://github.com/Prograda/Skybolt/blob/master/Assets/Core/Shaders/Clouds.h#L63
    vec4 factor = 1.0 - coverage * heightScale;
    weather.density = remapClamped(
    mix(localWeather, vec4(1.0), coverageFilterWidths), factor, factor + coverageFilterWidths
    );
    return weather;
}
vec4 getLayerDensity(const vec4 heightFraction) {
    // prettier-ignore
    return densityProfile.expTerms * exp(densityProfile.exponents * heightFraction) +
    densityProfile.linearTerms * heightFraction +
    densityProfile.constantTerms;
}
struct MediaSample {
    float density;
    vec4 weight;
    float scattering;
    float extinction;
};
in vec3 vCameraPosition;
in vec3 vEllipsoidCenter;
uniform float shapeTexelsPerMeterPerPixel;
MediaSample sampleMedia(
const WeatherSample weather, const vec3 position, const vec2 uv, const float mipLevel, const float jitter, inout ivec3 sampleCount
) {
    vec4 density = weather.density;
    
    // TODO: Define in physical length.
    
    vec3 surfaceNormal = normalize(position);
    float localWeatherSpeed = length(localWeatherOffset);
    vec3 evolution = -surfaceNormal * localWeatherSpeed * 2e4;
    vec3 turbulence = vec3(0.0);
    #ifdef TURBULENCE
        vec2 turbulenceUv = uv * localWeatherRepeat * turbulenceRepeat;
        turbulence = turbulenceDisplacement *
        (texture(turbulenceTexture, turbulenceUv).rgb * 2.0 - 1.0) *
        dot(density, remapClamped(weather.heightFraction, vec4(0.3), vec4(0.0)));
    #endif // TURBULENCE
    
    vec3 shapePosition = (position + evolution + turbulence) * shapeRepeat + shapeOffset;
    float cameraDistance = length(position - (vCameraPosition - vEllipsoidCenter));
    float shapeLod = log2(max(1.0, cameraDistance * shapeTexelsPerMeterPerPixel));
    int shapeSamples;
    vec4 shape = sampleCloudLayerShape(shapePosition, density, shapeLod, shapeSamples);
    density = remapClamped(density, (vec4(1.0) - shape) * shapeAmounts, vec4(1.0));
    #ifdef DEBUG_SHOW_SAMPLE_COUNT
        sampleCount.y += shapeSamples;
    #endif // DEBUG_SHOW_SAMPLE_COUNT
    
    #ifdef SHAPE_DETAIL
        // Fade detail continuously; stochastic LOD toggles also changed density.
        // Fade erosion that is smaller than a raymarch pixel, not just weather-map detail.
        float detailFootprint = cameraDistance * shapeTexelsPerMeterPerPixel *
            (shapeDetailRepeat.x / max(shapeRepeat.x, 1e-7)) *
            (float(textureSize(shapeDetailTexture, 0).x) / float(textureSize(shapeTexture, 0).x));
        float detailWeight = (1.0 - smoothstep(0.0, 1.5, mipLevel)) *
            (1.0 - smoothstep(0.5, 2.0, detailFootprint));
        if (detailWeight > 0.0) {
            vec3 detailPosition = (position + turbulence) * shapeDetailRepeat + shapeDetailOffset;
            float detailLod = cloudLodRange.y > cloudLodRange.x ? log2(max(1.0, detailFootprint)) : 0.0;
            float detail = textureLod(shapeDetailTexture, detailPosition, detailLod).r;
            // Fluffy at the top and whippy at the bottom.
            
            vec4 modifier = mix(
            vec4(pow(detail, 6.0)), vec4(1.0 - detail), remapClamped(weather.heightFraction, vec4(0.2), vec4(0.4))
            );
            modifier = mix(vec4(0.0), modifier, shapeDetailAmounts);
            vec4 detailedDensity = remapClamped(density * 2.0, vec4(modifier * 0.5), vec4(1.0));
            density = mix(density, detailedDensity, detailWeight);
            #ifdef DEBUG_SHOW_SAMPLE_COUNT
                ++sampleCount.z;
            #endif // DEBUG_SHOW_SAMPLE_COUNT
        }
    #endif // SHAPE_DETAIL
    // Nicely decrease the density at the bottom.
    density = saturate(density * densityScales * getLayerDensity(weather.heightFraction));
    MediaSample media;
    float densitySum = density.x + density.y + density.z + density.w;
    media.density = densitySum;
    media.weight = density / max(densitySum, 1e-7);
    media.scattering = densitySum * scatteringCoefficient;
    media.extinction = densitySum * absorptionCoefficient + media.scattering;
    return media;
}
MediaSample sampleMedia(
const WeatherSample weather, const vec3 position, const vec2 uv, const float mipLevel, const float jitter
) {
    ivec3 sampleCount = ivec3(0);
    return sampleMedia(weather, position, uv, mipLevel, jitter, sampleCount);
}
#if !defined(RECIPROCAL_PI4)
    #define RECIPROCAL_PI4 (0.07957747154594767)
#endif // !defined(RECIPROCAL_PI4)
uniform sampler2D depthBuffer;
uniform mat4 viewMatrix;
uniform mat4 reprojectionMatrix;
uniform vec3 previousCameraPosition;
uniform float cameraNear;
uniform float cameraFar;
uniform float cameraHeight;
uniform vec2 temporalJitter;
uniform vec2 targetUvScale;
uniform float mipLevelScale;

// Scattering

const vec2 scatterAnisotropy = vec2(SCATTER_ANISOTROPY_1, SCATTER_ANISOTROPY_2);
const float scatterAnisotropyMix = SCATTER_ANISOTROPY_MIX;
uniform float skyIrradianceScale;
uniform float groundIrradianceScale;
uniform float powderScale;
uniform float powderExponent;

// Primary raymarch

uniform int maxIterationCount;
uniform float minStepSize;
uniform float maxStepSize;
uniform float maxRayDistance;
uniform float perspectiveStepScale;

// Secondary raymarch

uniform int maxIterationCountToSun;
uniform int maxIterationCountToGround;
uniform float minSecondaryStepSize;
uniform float secondaryStepScale;

// Beer shadow map

uniform sampler2DArray shadowBuffer;
uniform vec2 shadowTexelSize;
uniform vec2 shadowIntervals[SHADOW_CASCADE_COUNT];
uniform mat4 shadowMatrices[SHADOW_CASCADE_COUNT];
uniform float shadowFar;
uniform float maxShadowFilterRadius;

// Shadow length

#ifdef SHADOW_LENGTH
    uniform int maxShadowLengthIterationCount;
    uniform float minShadowLengthStepSize;
    uniform float maxShadowLengthRayDistance;
#endif // SHADOW_LENGTH

in vec2 vUv;
in vec3 vCameraDirection; // Direction to the center of screen

in vec3 vRayDirection; // Direction to the texel

in GroundIrradiance vGroundIrradiance;
in CloudsIrradiance vCloudsIrradiance;
layout(location = 0) out vec4 outputColor;
layout(location = 1) out vec4 outputDepthVelocity;
#ifdef SHADOW_LENGTH
    layout(location = 2) out float outputShadowLength;
#endif // SHADOW_LENGTH

float readDepth(const vec2 uv) {
    // #if DEPTH_PACKING == 3201
    //     return unpackRGBAToDepth(texture(depthBuffer, uv));
    // #else // DEPTH_PACKING == 3201
    //     return texture(depthBuffer, uv).r;
    // #endif // DEPTH_PACKING == 3201
    return czm_unpackDepth(texture(depthBuffer, uv));
}
// float getViewZ(const float depth) {
//     #ifdef PERSPECTIVE_CAMERA
//         return perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
//     #else // PERSPECTIVE_CAMERA
//         return orthographicDepthToViewZ(depth, cameraNear, cameraFar);
//     #endif // PERSPECTIVE_CAMERA
// }
float getViewZ(const in float depth) {
    // float near = czm_depthRange.near;
    // float far = czm_depthRange.far;
    // return (2.0 * depth - near - far) / (far - near);
    float near = czm_currentFrustum.x;
    float far = czm_currentFrustum.y;
    return ( near * far ) / ( ( far - near ) * depth - far );
}   
vec3 ECEFToWorld(const vec3 positionECEF) {
    return mat3(ellipsoidMatrix) * (positionECEF + vEllipsoidCenter);
}
vec2 getShadowUv(const vec3 worldPosition, const int cascadeIndex) {
    vec4 clip = shadowMatrices[cascadeIndex] * vec4(worldPosition, 1.0);
    clip /= clip.w;
    return clip.xy * 0.5 + 0.5;
}
float getDistanceToShadowTop(const vec3 rayPosition) {
    // Distance to the top of the shadows along the sun direction, which matches
    // the ray origin of BSM.
    return raySphereSecondIntersection(
    rayPosition, sunDirection, vec3(0.0), bottomRadius + shadowTopHeight
    );
}
#ifdef DEBUG_SHOW_CASCADES
    const vec3 cascadeColors[4] = vec3[4](
    vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0), vec3(0.0, 0.0, 1.0), vec3(1.0, 1.0, 0.0)
    );
    vec3 getCascadeColor(const vec3 rayPosition) {
        vec3 worldPosition = ECEFToWorld(rayPosition);
        int cascadeIndex = getCascadeIndex(
        viewMatrix, worldPosition, shadowIntervals, cameraNear, shadowFar
        );
        vec2 uv = getShadowUv(worldPosition, cascadeIndex);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
            return vec3(1.0);
        }
        return cascadeColors[cascadeIndex];
    }
    vec3 getFadedCascadeColor(const vec3 rayPosition, const float jitter) {
        vec3 worldPosition = ECEFToWorld(rayPosition);
        int cascadeIndex = getFadedCascadeIndex(
        viewMatrix, worldPosition, shadowIntervals, cameraNear, shadowFar, jitter
        );
        return cascadeIndex >= 0
        ? cascadeColors[cascadeIndex]
        : vec3(1.0);
    }
#endif // DEBUG_SHOW_CASCADES
float readShadowOpticalDepth(
const vec2 uv, const float distanceToTop, const float distanceOffset, const int cascadeIndex
) {
    // r: frontDepth, g: meanExtinction, b: maxOpticalDepth, a: maxOpticalDepthTail
    // Also see the discussion here: https://x.com/shotamatsuda/status/1885322308908442106
    vec4 shadow = texture(shadowBuffer, vec3(uv, float(cascadeIndex)));
    float distanceToFront = max(0.0, distanceToTop - distanceOffset - shadow.r);
    return min(shadow.b + shadow.a, shadow.g * distanceToFront);
}
float sampleShadowOpticalDepthPCF(
const vec3 worldPosition, const float distanceToTop, const float distanceOffset, const float radius, const int cascadeIndex
) {
    vec2 uv = getShadowUv(worldPosition, cascadeIndex);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        return 0.0;
    }
    if (radius < 0.1) {
        return readShadowOpticalDepth(uv, distanceToTop, distanceOffset, cascadeIndex);
    }
    float sum = 0.0;
    vec2 offset;
    #if 0 < SHADOW_SAMPLE_COUNT
        offset = vogelDisk(
        0, SHADOW_SAMPLE_COUNT, interleavedGradientNoise(gl_FragCoord.xy + temporalJitter * resolution) * PI2
        );
        sum += readShadowOpticalDepth(
        uv + offset * radius * shadowTexelSize, distanceToTop, distanceOffset, cascadeIndex
        );
    #endif // 0 < SHADOW_SAMPLE_COUNT
    
    #if 1 < SHADOW_SAMPLE_COUNT
        offset = vogelDisk(
        1, SHADOW_SAMPLE_COUNT, interleavedGradientNoise(gl_FragCoord.xy + temporalJitter * resolution) * PI2
        );
        sum += readShadowOpticalDepth(
        uv + offset * radius * shadowTexelSize, distanceToTop, distanceOffset, cascadeIndex
        );
    #endif // 1 < SHADOW_SAMPLE_COUNT
    
    #if 2 < SHADOW_SAMPLE_COUNT
        offset = vogelDisk(
        2, SHADOW_SAMPLE_COUNT, interleavedGradientNoise(gl_FragCoord.xy + temporalJitter * resolution) * PI2
        );
        sum += readShadowOpticalDepth(
        uv + offset * radius * shadowTexelSize, distanceToTop, distanceOffset, cascadeIndex
        );
    #endif // 2 < SHADOW_SAMPLE_COUNT
    
    #if 3 < SHADOW_SAMPLE_COUNT
        offset = vogelDisk(
        3, SHADOW_SAMPLE_COUNT, interleavedGradientNoise(gl_FragCoord.xy + temporalJitter * resolution) * PI2
        );
        sum += readShadowOpticalDepth(
        uv + offset * radius * shadowTexelSize, distanceToTop, distanceOffset, cascadeIndex
        );
    #endif // 3 < SHADOW_SAMPLE_COUNT
    
    #if 4 < SHADOW_SAMPLE_COUNT
        offset = vogelDisk(
        4, SHADOW_SAMPLE_COUNT, interleavedGradientNoise(gl_FragCoord.xy + temporalJitter * resolution) * PI2
        );
        sum += readShadowOpticalDepth(
        uv + offset * radius * shadowTexelSize, distanceToTop, distanceOffset, cascadeIndex
        );
    #endif // 4 < SHADOW_SAMPLE_COUNT
    
    #if 5 < SHADOW_SAMPLE_COUNT
        offset = vogelDisk(
        5, SHADOW_SAMPLE_COUNT, interleavedGradientNoise(gl_FragCoord.xy + temporalJitter * resolution) * PI2
        );
        sum += readShadowOpticalDepth(
        uv + offset * radius * shadowTexelSize, distanceToTop, distanceOffset, cascadeIndex
        );
    #endif // 5 < SHADOW_SAMPLE_COUNT
    
    #if 6 < SHADOW_SAMPLE_COUNT
        offset = vogelDisk(
        6, SHADOW_SAMPLE_COUNT, interleavedGradientNoise(gl_FragCoord.xy + temporalJitter * resolution) * PI2
        );
        sum += readShadowOpticalDepth(
        uv + offset * radius * shadowTexelSize, distanceToTop, distanceOffset, cascadeIndex
        );
    #endif // 6 < SHADOW_SAMPLE_COUNT
    
    #if 7 < SHADOW_SAMPLE_COUNT
        offset = vogelDisk(
        7, SHADOW_SAMPLE_COUNT, interleavedGradientNoise(gl_FragCoord.xy + temporalJitter * resolution) * PI2
        );
        sum += readShadowOpticalDepth(
        uv + offset * radius * shadowTexelSize, distanceToTop, distanceOffset, cascadeIndex
        );
    #endif // 7 < SHADOW_SAMPLE_COUNT
    
    #if 8 < SHADOW_SAMPLE_COUNT
        offset = vogelDisk(
        8, SHADOW_SAMPLE_COUNT, interleavedGradientNoise(gl_FragCoord.xy + temporalJitter * resolution) * PI2
        );
        sum += readShadowOpticalDepth(
        uv + offset * radius * shadowTexelSize, distanceToTop, distanceOffset, cascadeIndex
        );
    #endif // 8 < SHADOW_SAMPLE_COUNT
    
    #if 9 < SHADOW_SAMPLE_COUNT
        offset = vogelDisk(
        9, SHADOW_SAMPLE_COUNT, interleavedGradientNoise(gl_FragCoord.xy + temporalJitter * resolution) * PI2
        );
        sum += readShadowOpticalDepth(
        uv + offset * radius * shadowTexelSize, distanceToTop, distanceOffset, cascadeIndex
        );
    #endif // 9 < SHADOW_SAMPLE_COUNT
    
    #if 10 < SHADOW_SAMPLE_COUNT
        offset = vogelDisk(
        10, SHADOW_SAMPLE_COUNT, interleavedGradientNoise(gl_FragCoord.xy + temporalJitter * resolution) * PI2
        );
        sum += readShadowOpticalDepth(
        uv + offset * radius * shadowTexelSize, distanceToTop, distanceOffset, cascadeIndex
        );
    #endif // 10 < SHADOW_SAMPLE_COUNT
    
    #if 11 < SHADOW_SAMPLE_COUNT
        offset = vogelDisk(
        11, SHADOW_SAMPLE_COUNT, interleavedGradientNoise(gl_FragCoord.xy + temporalJitter * resolution) * PI2
        );
        sum += readShadowOpticalDepth(
        uv + offset * radius * shadowTexelSize, distanceToTop, distanceOffset, cascadeIndex
        );
    #endif // 11 < SHADOW_SAMPLE_COUNT
    
    #if 12 < SHADOW_SAMPLE_COUNT
        offset = vogelDisk(
        12, SHADOW_SAMPLE_COUNT, interleavedGradientNoise(gl_FragCoord.xy + temporalJitter * resolution) * PI2
        );
        sum += readShadowOpticalDepth(
        uv + offset * radius * shadowTexelSize, distanceToTop, distanceOffset, cascadeIndex
        );
    #endif // 12 < SHADOW_SAMPLE_COUNT
    
    #if 13 < SHADOW_SAMPLE_COUNT
        offset = vogelDisk(
        13, SHADOW_SAMPLE_COUNT, interleavedGradientNoise(gl_FragCoord.xy + temporalJitter * resolution) * PI2
        );
        sum += readShadowOpticalDepth(
        uv + offset * radius * shadowTexelSize, distanceToTop, distanceOffset, cascadeIndex
        );
    #endif // 13 < SHADOW_SAMPLE_COUNT
    
    #if 14 < SHADOW_SAMPLE_COUNT
        offset = vogelDisk(
        14, SHADOW_SAMPLE_COUNT, interleavedGradientNoise(gl_FragCoord.xy + temporalJitter * resolution) * PI2
        );
        sum += readShadowOpticalDepth(
        uv + offset * radius * shadowTexelSize, distanceToTop, distanceOffset, cascadeIndex
        );
    #endif // 14 < SHADOW_SAMPLE_COUNT
    
    #if 15 < SHADOW_SAMPLE_COUNT
        offset = vogelDisk(
        15, SHADOW_SAMPLE_COUNT, interleavedGradientNoise(gl_FragCoord.xy + temporalJitter * resolution) * PI2
        );
        sum += readShadowOpticalDepth(
        uv + offset * radius * shadowTexelSize, distanceToTop, distanceOffset, cascadeIndex
        );
    #endif // 15 < SHADOW_SAMPLE_COUNT
    
    return sum / float(SHADOW_SAMPLE_COUNT);
}
float sampleShadowOpticalDepth(
const vec3 rayPosition, const float distanceOffset, const float radius, const float jitter
) {
    float distanceToTop = getDistanceToShadowTop(rayPosition);
    if (distanceToTop <= 0.0) {
        return 0.0;
    }
    vec3 worldPosition = ECEFToWorld(rayPosition);
    int cascadeIndex = getFadedCascadeIndex(
    viewMatrix, worldPosition, shadowIntervals, cameraNear, shadowFar, jitter
    );
    float mappedDepth = cascadeIndex >= 0
        ? sampleShadowOpticalDepthPCF(worldPosition, distanceToTop, distanceOffset, radius, cascadeIndex)
        : 0.0;
    if (distanceOffset <= 0.0) return mappedDepth;
    float viewDistance = -(viewMatrix * vec4(worldPosition, 1.0)).z;
    float blend = smoothstep(shadowFar * 0.9, shadowFar, viewDistance);
    if (cascadeIndex < 0) blend = 1.0;
    if (blend <= 0.0) return mappedDepth;
    // Distant cloud self-shadowing must not depend on the local ground-shadow map's reach.
    float span = max(0.0, distanceToTop - distanceOffset);
    float approximation = 0.0;
    for (int i = 0; i < 2; ++i) {
        vec3 position = rayPosition + sunDirection * (distanceOffset + span * (float(i) + 0.5) * 0.5);
        vec2 uv = getGlobeUv(position);
        float height = length(position) - bottomRadius;
        float cameraDistance = length(position - (vCameraPosition - vEllipsoidCenter));
        float lod = max(2.0, log2(max(1.0, cameraDistance * shapeTexelsPerMeterPerPixel)));
        WeatherSample weather = sampleWeather(uv, height, lod);
        MediaSample media = sampleMedia(weather, position, uv, lod, 0.5);
        approximation += media.extinction * span * 0.5;
    }
    return mix(mappedDepth, approximation, blend);
}
float hazeCascadeTransmittance(const vec3 worldPosition, const float distanceToTop, const int cascadeIndex) {
    vec2 uv = getShadowUv(worldPosition, cascadeIndex);
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 1.0;
    if (hazeShadowSampleCount <= 1) return exp(-readShadowOpticalDepth(uv, distanceToTop, 0.0, cascadeIndex));
    vec4 shadow = texture(shadowBuffer, vec3(uv, float(cascadeIndex)));
    float behindCloud = max(0.0, distanceToTop - shadow.r);
    vec3 projectionRow = vec3(shadowMatrices[cascadeIndex][0][0], shadowMatrices[cascadeIndex][1][0], shadowMatrices[cascadeIndex][2][0]);
    float metresPerTexel = shadowTexelSize.x / max(0.5 * length(projectionRow), 1e-7);
    float radius = clamp(tan(u_sun_angular_radius) * behindCloud / metresPerTexel, 0.35, 2.0);
    float sum = 0.0;
    int count = clamp(hazeShadowSampleCount, 1, 4);
    for (int i = 0; i < 4; ++i) {
        if (i >= count) break;
        vec2 offset = i == 0 ? vec2(-0.707, -0.707) : (i == 1 ? vec2(0.707, 0.707) : (i == 2 ? vec2(-0.707, 0.707) : vec2(0.707, -0.707)));
        sum += exp(-readShadowOpticalDepth(clamp(uv + offset * radius * shadowTexelSize, vec2(0.0), vec2(1.0)), distanceToTop, 0.0, cascadeIndex));
    }
    return sum / float(count);
}
float sampleHazeSunlight(const vec3 position) {
    float distanceToTop = getDistanceToShadowTop(position);
    if (distanceToTop <= 0.0) return 1.0;
    vec3 worldPosition = ECEFToWorld(position);
    int cascadeIndex = getCascadeIndex(viewMatrix, worldPosition, shadowIntervals, cameraNear, shadowFar);
    if (cascadeIndex < 0) return 1.0;
    float sunlight = hazeCascadeTransmittance(worldPosition, distanceToTop, cascadeIndex);
    float depth = (-(viewMatrix * vec4(worldPosition, 1.0)).z - cameraNear) / max(shadowFar - cameraNear, 1.0);
    vec2 interval = shadowIntervals[cascadeIndex];
    float margin = max((interval.y - interval.x) * 0.1, 1e-5);
    float blend = smoothstep(interval.y - margin, interval.y, depth);
    if (blend > 0.0) {
        float nextSunlight = 1.0;
        if (cascadeIndex + 1 < SHADOW_CASCADE_COUNT) nextSunlight = hazeCascadeTransmittance(worldPosition, distanceToTop, cascadeIndex + 1);
        sunlight = mix(sunlight, nextSunlight, blend);
    }
    return sunlight;
}
#ifdef DEBUG_SHOW_SHADOW_MAP
    vec4 getCascadedShadowMaps(vec2 uv) {
        vec4 coord = vec4(vUv, vUv - 0.5) * 2.0;
        vec4 shadow = vec4(0.0);
        if (uv.y > 0.5) {
            if (uv.x < 0.5) {
                shadow = texture(shadowBuffer, vec3(coord.xw, 0.0));
            }
            else {
                #if SHADOW_CASCADE_COUNT > 1
                    shadow = texture(shadowBuffer, vec3(coord.zw, 1.0));
                #endif // SHADOW_CASCADE_COUNT > 1
            }
    
        }
        else {
            if (uv.x < 0.5) {
                #if SHADOW_CASCADE_COUNT > 2
                    shadow = texture(shadowBuffer, vec3(coord.xy, 2.0));
                #endif // SHADOW_CASCADE_COUNT > 2
            }
            else {
                #if SHADOW_CASCADE_COUNT > 3
                    shadow = texture(shadowBuffer, vec3(coord.zy, 3.0));
                #endif // SHADOW_CASCADE_COUNT > 3
            }
    
        }
        #if !defined(DEBUG_SHOW_SHADOW_MAP_TYPE)
            #define DEBUG_SHOW_SHADOW_MAP_TYPE (0)
        #endif // !defined(DEBUG_SHOW_SHADOW_MAP_TYPE
        const float frontDepthScale = 1e-5;
        const float meanExtinctionScale = 10.0;
        const float maxOpticalDepthScale = 0.01;
        vec3 color;
        #if DEBUG_SHOW_SHADOW_MAP_TYPE == 1
            color = vec3(shadow.r * frontDepthScale);
            #elif DEBUG_SHOW_SHADOW_MAP_TYPE == 2
            color = vec3(shadow.g * meanExtinctionScale);
            #elif DEBUG_SHOW_SHADOW_MAP_TYPE == 3
            color = vec3((shadow.b + shadow.a) * maxOpticalDepthScale);
        #else // DEBUG_SHOW_SHADOW_MAP_TYPE
            color = (shadow.rgb + vec3(0.0, 0.0, shadow.a)) *
            vec3(frontDepthScale, meanExtinctionScale, maxOpticalDepthScale);
        #endif // DEBUG_SHOW_SHADOW_MAP_TYPE
        return vec4(color, 1.0);
    }
#endif // DEBUG_SHOW_SHADOW_MAP
vec2 henyeyGreenstein(const vec2 g, const float cosTheta) {
    vec2 g2 = g * g;
    // prettier-ignore
    
    return RECIPROCAL_PI4 *
    ((1.0 - g2) / max(vec2(1e-7), pow(1.0 + g2 - 2.0 * g * cosTheta, vec2(1.5))));
}
#ifdef ACCURATE_PHASE_FUNCTION
    float draine(float u, float g, float a) {
        float g2 = g * g;
        // prettier-ignore
        
        return (1.0 - g2) *
        (1.0 + a * u * u) /
        (4.0 * (1.0 + a * (1.0 + 2.0 * g2) / 3.0) * PI * pow(1.0 + g2 - 2.0 * g * u, 1.5));
    }
    // Numerically-fitted large particles (d = 10) phase function It won't be
    // plausible without a more precise multiple scattering.
    // Reference: https://research.nvidia.com/labs/rtr/approximate-mie/
    float phaseFunction(const float cosTheta, const float attenuation) {
        const float gHG = 0.988176691700256; // exp(-0.0990567/(d-1.67154))
        
        const float gD = 0.5556712547839497; // exp(-2.20679/(d+3.91029) - 0.428934)
        
        const float alpha = 21.995520856274638; // exp(3.62489 - 8.29288/(d+5.52825))
        
        const float weight = 0.4819554318404214; // exp(-0.599085/(d-0.641583)-0.665888)
        
        return mix(
        henyeyGreenstein(vec2(gHG) * attenuation, cosTheta).x, draine(cosTheta, gD * attenuation, alpha), weight
        );
    }
#else // ACCURATE_PHASE_FUNCTION
    float phaseFunction(const float cosTheta, const float attenuation) {
        const vec2 g = scatterAnisotropy;
        const vec2 weights = vec2(1.0 - scatterAnisotropyMix, scatterAnisotropyMix);
        // A similar approximation is described in the Frostbite's paper, where phase
        
        // angle is attenuated instead of anisotropy.
        return dot(henyeyGreenstein(g * attenuation, cosTheta), weights);
    }
#endif // ACCURATE_PHASE_FUNCTION
float phaseFunction(const float cosTheta) {
    return phaseFunction(cosTheta, 1.0);
}
float marchOpticalDepth(
const vec3 rayOrigin, const vec3 rayDirection, const int maxIterationCount, const float mipLevel, const float jitter, out float rayDistance
) {
    // Keep the lighting sample count deterministic: random LOD counts shimmer at distance.
    int iterationCount = max(1, maxIterationCount);
    float stepSize = minSecondaryStepSize / float(iterationCount);
    float nextDistance = stepSize * 0.5;
    float opticalDepth = 0.0;
    float cameraDistance = length(rayOrigin - (vCameraPosition - vEllipsoidCenter));
    float quality = cloudDistanceLod(cameraDistance) * smoothstep(0.5, 2.0, cameraDistance * shapeTexelsPerMeterPerPixel);
    float previousStep = 0.0;
    for (int i = 0; i < iterationCount; ++i) {
        rayDistance = nextDistance;
        // Transfer the omitted sample's interval to its fixed neighbour without shortening the light ray.
        float weight = stepSize;
        if (i % 2 == 0 && i + 1 < iterationCount) weight *= 1.0 - quality;
        if (i % 2 == 1) weight += previousStep * quality;
        if (weight > 0.0) {
            vec3 position = rayDistance * rayDirection + rayOrigin;
            vec2 uv = getGlobeUv(position);
            float height = length(position) - bottomRadius;
            WeatherSample weather = sampleWeather(uv, height, mipLevel);
            MediaSample media = sampleMedia(weather, position, uv, mipLevel, jitter);
            opticalDepth += media.extinction * weight;
        }
        nextDistance += stepSize;
        previousStep = stepSize;
        stepSize *= secondaryStepScale;
    }
    return opticalDepth;
}
float marchOpticalDepth(
const vec3 rayOrigin, const vec3 rayDirection, const int maxIterationCount, const float mipLevel, const float jitter
) {
    float rayDistance;
    return marchOpticalDepth(
    rayOrigin, rayDirection, maxIterationCount, mipLevel, jitter, rayDistance
    );
}
float approximateMultipleScattering(const float opticalDepth, const float cosTheta) {
    // Multiple scattering approximation
    // See: https://fpsunflower.github.io/ckulla/data/oz_volumes.pdf
    // a: attenuation, b: contribution, c: phase attenuation
    vec3 coeffs = vec3(1.0); // [a, b, c]
    
    const vec3 attenuation = vec3(0.5, 0.5, 0.5); // Should satisfy a <= b
    
    float scattering = 0.0;
    float beerLambert;
    #if 0 < MULTI_SCATTERING_OCTAVES
        beerLambert = exp(-opticalDepth * coeffs.y);
        scattering += coeffs.x * beerLambert * phaseFunction(cosTheta, coeffs.z);
        coeffs *= attenuation;
    #endif // 0 < MULTI_SCATTERING_OCTAVES
    
    #if 1 < MULTI_SCATTERING_OCTAVES
        beerLambert = exp(-opticalDepth * coeffs.y);
        scattering += coeffs.x * beerLambert * phaseFunction(cosTheta, coeffs.z);
        coeffs *= attenuation;
    #endif // 1 < MULTI_SCATTERING_OCTAVES
    
    #if 2 < MULTI_SCATTERING_OCTAVES
        beerLambert = exp(-opticalDepth * coeffs.y);
        scattering += coeffs.x * beerLambert * phaseFunction(cosTheta, coeffs.z);
        coeffs *= attenuation;
    #endif // 2 < MULTI_SCATTERING_OCTAVES
    
    #if 3 < MULTI_SCATTERING_OCTAVES
        beerLambert = exp(-opticalDepth * coeffs.y);
        scattering += coeffs.x * beerLambert * phaseFunction(cosTheta, coeffs.z);
        coeffs *= attenuation;
    #endif // 3 < MULTI_SCATTERING_OCTAVES
    
    #if 4 < MULTI_SCATTERING_OCTAVES
        beerLambert = exp(-opticalDepth * coeffs.y);
        scattering += coeffs.x * beerLambert * phaseFunction(cosTheta, coeffs.z);
        coeffs *= attenuation;
    #endif // 4 < MULTI_SCATTERING_OCTAVES
    
    #if 5 < MULTI_SCATTERING_OCTAVES
        beerLambert = exp(-opticalDepth * coeffs.y);
        scattering += coeffs.x * beerLambert * phaseFunction(cosTheta, coeffs.z);
        coeffs *= attenuation;
    #endif // 5 < MULTI_SCATTERING_OCTAVES
    
    #if 6 < MULTI_SCATTERING_OCTAVES
        beerLambert = exp(-opticalDepth * coeffs.y);
        scattering += coeffs.x * beerLambert * phaseFunction(cosTheta, coeffs.z);
        coeffs *= attenuation;
    #endif // 6 < MULTI_SCATTERING_OCTAVES
    
    #if 7 < MULTI_SCATTERING_OCTAVES
        beerLambert = exp(-opticalDepth * coeffs.y);
        scattering += coeffs.x * beerLambert * phaseFunction(cosTheta, coeffs.z);
        coeffs *= attenuation;
    #endif // 7 < MULTI_SCATTERING_OCTAVES
    
    #if 8 < MULTI_SCATTERING_OCTAVES
        beerLambert = exp(-opticalDepth * coeffs.y);
        scattering += coeffs.x * beerLambert * phaseFunction(cosTheta, coeffs.z);
        coeffs *= attenuation;
    #endif // 8 < MULTI_SCATTERING_OCTAVES
    
    #if 9 < MULTI_SCATTERING_OCTAVES
        beerLambert = exp(-opticalDepth * coeffs.y);
        scattering += coeffs.x * beerLambert * phaseFunction(cosTheta, coeffs.z);
        coeffs *= attenuation;
    #endif // 9 < MULTI_SCATTERING_OCTAVES
    
    #if 10 < MULTI_SCATTERING_OCTAVES
        beerLambert = exp(-opticalDepth * coeffs.y);
        scattering += coeffs.x * beerLambert * phaseFunction(cosTheta, coeffs.z);
        coeffs *= attenuation;
    #endif // 10 < MULTI_SCATTERING_OCTAVES
    
    #if 11 < MULTI_SCATTERING_OCTAVES
        beerLambert = exp(-opticalDepth * coeffs.y);
        scattering += coeffs.x * beerLambert * phaseFunction(cosTheta, coeffs.z);
        coeffs *= attenuation;
    #endif // 11 < MULTI_SCATTERING_OCTAVES
    
    return scattering;
}
// TODO: Construct spherical harmonics of degree 2 using 2 sample points
// positioned near the horizon occlusion points on the sun direction plane.
vec3 getGroundSunSkyIrradiance(
const vec3 position, const vec3 surfaceNormal, const float height, out vec3 skyIrradiance
) {
    #ifdef ACCURATE_SUN_SKY_IRRADIANCE
        // 5.30
        // return GetSunAndSkyIrradiance(
        // (position - surfaceNormal * height) * METER_TO_LENGTH_UNIT, sunDirection, skyIrradiance
        // );
        return GetSunAndSkyIrradiance(
        (position - surfaceNormal * height) * METER_TO_LENGTH_UNIT, surfaceNormal, sunDirection, skyIrradiance
        );
    #else // ACCURATE_SUN_SKY_IRRADIANCE
        skyIrradiance = vGroundIrradiance.sky;
        return vGroundIrradiance.sun;
    #endif // ACCURATE_SUN_SKY_IRRADIANCE
}
vec3 getCloudsSunSkyIrradiance(const vec3 position, const float height, out vec3 skyIrradiance) {
    #ifdef ACCURATE_SUN_SKY_IRRADIANCE
        return GetSunAndSkyIrradiance(position * METER_TO_LENGTH_UNIT, sunDirection, skyIrradiance);
    #else // ACCURATE_SUN_SKY_IRRADIANCE
        float alpha = remapClamped(height, minHeight, maxHeight);
        skyIrradiance = mix(vCloudsIrradiance.minSky, vCloudsIrradiance.maxSky, alpha);
        return mix(vCloudsIrradiance.minSun, vCloudsIrradiance.maxSun, alpha);
    #endif // ACCURATE_SUN_SKY_IRRADIANCE
}
#ifdef GROUND_IRRADIANCE
    vec3 approximateIrradianceFromGround(
    const vec3 position, const vec3 surfaceNormal, const float height, const float mipLevel, const float jitter
    ) {
        float opticalDepthToGround = marchOpticalDepth(
        position, -surfaceNormal, maxIterationCountToGround, mipLevel, jitter
        );
        vec3 skyIrradiance;
        vec3 sunIrradiance = getGroundSunSkyIrradiance(position, surfaceNormal, height, skyIrradiance);
        const float groundAlbedo = 0.3;
        // 5.30
        // vec3 groundIrradiance = skyIrradiance + (1.0 - coverage) * sunIrradiance * RECIPROCAL_PI2;
        vec3 groundIrradiance = skyIrradiance + (1.0 - coverage) * sunIrradiance;
        vec3 bouncedLight = groundAlbedo * RECIPROCAL_PI * groundIrradiance;
        vec3 bouncedIrradiance = bouncedLight * exp(-opticalDepthToGround);
        return albedo * bouncedIrradiance * RECIPROCAL_PI4 * groundIrradianceScale;
    }
#endif // GROUND_IRRADIANCE
struct CloudRayIntervals {
    vec2 segment0;
    vec2 segment1;
    vec2 segment2;
    vec2 segment3;
    vec2 segment4;
    vec2 segment5;
    int count;
    float length;
};
// ANGLE/D3D11 cannot dynamically write an array embedded in a local structure.
vec2 cloudIntervalAt(const CloudRayIntervals intervals, const int index) {
    if (index == 0) return intervals.segment0;
    if (index == 1) return intervals.segment1;
    if (index == 2) return intervals.segment2;
    if (index == 3) return intervals.segment3;
    if (index == 4) return intervals.segment4;
    return intervals.segment5;
}
void setCloudInterval(inout CloudRayIntervals intervals, const int index, const vec2 value) {
    if (index == 0) intervals.segment0 = value;
    else if (index == 1) intervals.segment1 = value;
    else if (index == 2) intervals.segment2 = value;
    else if (index == 3) intervals.segment3 = value;
    else if (index == 4) intervals.segment4 = value;
    else intervals.segment5 = value;
}
bool cloudSphereHits(const vec3 origin, const vec3 direction, const float radius, out vec2 hits) {
    float radialLength = length(origin);
    float projection = dot(origin, direction);
    // Factoring the radius difference avoids subtracting two Earth-sized squared radii.
    float discriminant = projection * projection - (radialLength - radius) * (radialLength + radius);
    if (discriminant < 0.0) return false;
    float root = sqrt(max(0.0, discriminant));
    hits = vec2(-projection - root, -projection + root);
    return true;
}
void appendCloudInterval(inout CloudRayIntervals intervals, const vec2 segment, const vec2 bounds) {
    vec2 clipped = vec2(max(segment.x, bounds.x), min(segment.y, bounds.y));
    if (clipped.y > clipped.x && intervals.count < 6) {
        setCloudInterval(intervals, intervals.count, clipped);
        ++intervals.count;
    }
}
CloudRayIntervals getCloudRayIntervals(const vec3 origin, const vec3 direction, const vec2 bounds) {
    CloudRayIntervals intervals;
    intervals.count = 0;
    intervals.length = 0.0;
    for (int i = 0; i < 6; ++i) setCloudInterval(intervals, i, vec2(0.0));
    for (int layer = 0; layer < 3; ++layer) {
        if (densityScales[layer] <= 0.0 || maxLayerHeights[layer] <= minLayerHeights[layer]) continue;
        vec2 outerHits, innerHits;
        if (!cloudSphereHits(origin, direction, bottomRadius + maxLayerHeights[layer], outerHits)) continue;
        if (cloudSphereHits(origin, direction, bottomRadius + minLayerHeights[layer], innerHits)) {
            appendCloudInterval(intervals, vec2(outerHits.x, innerHits.x), bounds);
            appendCloudInterval(intervals, vec2(innerHits.y, outerHits.y), bounds);
        } else {
            appendCloudInterval(intervals, outerHits, bounds);
        }
    }
    for (int i = 1; i < 6; ++i) {
        if (i >= intervals.count) break;
        vec2 entry = cloudIntervalAt(intervals, i);
        int target = i;
        for (int j = i - 1; j >= 0; --j) {
            vec2 previous = cloudIntervalAt(intervals, j);
            if (previous.x <= entry.x) break;
            setCloudInterval(intervals, j + 1, previous);
            target = j;
        }
        setCloudInterval(intervals, target, entry);
    }
    int mergedCount = 0;
    for (int i = 0; i < 6; ++i) {
        if (i >= intervals.count) break;
        vec2 entry = cloudIntervalAt(intervals, i);
        if (mergedCount > 0) {
            vec2 previous = cloudIntervalAt(intervals, mergedCount - 1);
            if (entry.x <= previous.y) {
                setCloudInterval(intervals, mergedCount - 1, vec2(previous.x, max(previous.y, entry.y)));
                continue;
            }
        }
        setCloudInterval(intervals, mergedCount, entry);
        ++mergedCount;
    }
    intervals.count = mergedCount;
    for (int i = 0; i < 6; ++i) {
        if (i >= mergedCount) break;
        vec2 segment = cloudIntervalAt(intervals, i);
        intervals.length += segment.y - segment.x;
    }
    return intervals;
}
vec4 marchClouds(
const vec3 rayOrigin, const vec3 rayDirection, const vec2 rayNearFar, const float cosTheta, const float jitter, const float rayStartTexelsPerPixel, out float frontDepth, out ivec3 sampleCount, out vec4 traceStats
) {
    vec3 radianceIntegral = vec3(0.0);
    sampleCount = ivec3(0);
    float transmittanceIntegral = 1.0;
    float weightedDistanceSum = 0.0;
    float transmittanceSum = 0.0;
    CloudRayIntervals intervals = getCloudRayIntervals(rayOrigin - rayNearFar.x * rayDirection, rayDirection, rayNearFar);
    traceStats = vec4(rayNearFar.x, intervals.length, 0.0, 0.0);
    if (intervals.count == 0) {
        frontDepth = -1.0;
        return vec4(0.0);
    }
    int segmentIndex = 0;
    float cellStart = intervals.segment0.x;
    float remainingLength = intervals.length;
    for (int i = 0; i < maxIterationCount; ++i) {
        if (segmentIndex >= intervals.count) break;
        vec2 segment = cloudIntervalAt(intervals, segmentIndex);
        float quality = cloudDistanceLod(cellStart) * smoothstep(0.5, 2.0, cellStart * shapeTexelsPerMeterPerPixel);
        float desiredStep = min(maxStepSize, minStepSize + (perspectiveStepScale - 1.0) * cellStart) * mix(1.0, 2.0, quality);
        // Reserve four samples in later intervals instead of spending the whole budget on the first shell.
        int available = max(1, maxIterationCount - i - 4 * (intervals.count - segmentIndex - 1));
        float budgetStep = (segment.y - cellStart) / float(available);
        if (cloudLodRange.y > cloudLodRange.x && cellStart < cloudLodRange.x) budgetStep = 0.0;
        float stepSize = min(max(desiredStep, budgetStep), (segment.y - segment.x) * 0.25);
        float cellEnd = min(segment.y, cellStart + stepSize);
        if (cellEnd <= cellStart) cellEnd = segment.y;
        stepSize = cellEnd - cellStart;
        if (budgetStep > desiredStep && quality == 0.0) traceStats.w = 1.0;
        float rayDistance = cellStart - rayNearFar.x + stepSize * jitter;
        remainingLength = max(0.0, remainingLength - stepSize);
        traceStats.xyz = vec3(cellEnd, remainingLength, float(i + 1));
        cellStart = cellEnd;
        if (cellEnd >= segment.y) {
            ++segmentIndex;
            if (segmentIndex < intervals.count) cellStart = cloudIntervalAt(intervals, segmentIndex).x;
        }
        vec3 position = rayDistance * rayDirection + rayOrigin;
        float height = length(position) - bottomRadius;
        float mipLevel = log2(max(1.0, rayStartTexelsPerPixel + rayDistance * 1e-5));
        // Sample rough weather.
        vec2 uv = getGlobeUv(position);
        WeatherSample weather = sampleWeather(uv, height, mipLevel);
        #ifdef DEBUG_SHOW_SAMPLE_COUNT
            ++sampleCount.x;
        #endif // DEBUG_SHOW_SAMPLE_COUNT
        
        if (!any(greaterThan(weather.density, vec4(minDensity)))) {
            continue;
        }
        // Sample detailed participating media.
        MediaSample media = sampleMedia(weather, position, uv, mipLevel, jitter, sampleCount);
        if (media.extinction > minExtinction) {
            vec3 skyIrradiance;
            vec3 sunIrradiance = getCloudsSunSkyIrradiance(position, height, skyIrradiance);
            vec3 surfaceNormal = normalize(position);
            
            // March optical depth to the sun for finer details, which BSM lacks.
            
            float sunRayDistance = 0.0;
            float opticalDepth = marchOpticalDepth(
            position, sunDirection, maxIterationCountToSun, mipLevel, jitter, sunRayDistance
            );
            if (height < shadowTopHeight) {
                // Obtain the optical depth from BSM at the ray position.
                opticalDepth += sampleShadowOpticalDepth(
                position, // Take account of only positions further than the marched ray
                // distance.
                sunRayDistance, // Apply PCF only when the sun is close to the horizon.
                maxShadowFilterRadius * remapClamped(dot(sunDirection, surfaceNormal), 0.1, 0.0), jitter
                );
            }
            float scattering = approximateMultipleScattering(opticalDepth, cosTheta);
            vec3 radiance = albedo * sunIrradiance * scattering;
            #ifdef GROUND_IRRADIANCE
                // Fudge factor for the irradiance from ground.
                if (height < shadowTopHeight && mipLevel < 0.5) {
                    radiance += approximateIrradianceFromGround(
                    position, surfaceNormal, height, mipLevel, jitter
                    );
                }
            #endif // GROUND_IRRADIANCE
            // Crude approximation of sky gradient. Better than none in the shadows.
            // 5.30
            // float skyGradient = dot(0.5 + weather.heightFraction, media.weight);
            float skyGradient = dot(weather.heightFraction * 0.5 + 0.5, media.weight);
            radiance += albedo * skyIrradiance * RECIPROCAL_PI4 * skyGradient * skyIrradianceScale;
            
            // Finally multiply by extinction (redundant but kept for clarity).
            
            radiance *= media.extinction;
            #ifdef POWDER
                radiance *= 1.0 - powderScale * exp(-media.extinction * powderExponent);
            #endif // POWDER
            
            #ifdef DEBUG_SHOW_CASCADES
                if (height < shadowTopHeight) {
                    radiance = 1e-3 * getFadedCascadeColor(position, jitter);
                }
            #endif // DEBUG_SHOW_CASCADES
            // Energy-conserving analytical integration of scattered light
            // See 5.6.3 in https://media.contentapi.ea.com/content/dam/eacom/frostbite/files/s2016-pbs-frostbite-sky-clouds-new.pdf
            float transmittance = exp(-media.extinction * stepSize);
            float clampedExtinction = max(media.extinction, 1e-7);
            vec3 scatteringIntegral = (radiance - radiance * transmittance) / clampedExtinction;
            radianceIntegral += transmittanceIntegral * scatteringIntegral;
            transmittanceIntegral *= transmittance;
            
            // Aerial perspective affecting clouds
            
            // See 5.9.1 in https://media.contentapi.ea.com/content/dam/eacom/frostbite/files/s2016-pbs-frostbite-sky-clouds-new.pdf
            weightedDistanceSum += rayDistance * transmittanceIntegral;
            transmittanceSum += transmittanceIntegral;
        }
        if (transmittanceIntegral <= minTransmittance) {
            traceStats.y = 0.0;
            break; // Early termination
        }
    }
    if (segmentIndex >= intervals.count) traceStats.y = 0.0;
    // The final product of 5.9.1 and we'll evaluate this in aerial perspective.
    frontDepth = transmittanceSum > 0.0 ? weightedDistanceSum / transmittanceSum : -1.0;
    return vec4(radianceIntegral, remapClamped(transmittanceIntegral, 1.0, minTransmittance));
}
#ifdef SHADOW_LENGTH
    float marchShadowLength(
    const vec3 rayOrigin, const vec3 rayDirection, const vec2 rayNearFar, const float jitter
    ) {
        float shadowLength = 0.0;
        float maxRayDistance = rayNearFar.y - rayNearFar.x;
        float stepSize = minShadowLengthStepSize;
        float rayDistance = stepSize * jitter;
        // 5.31
        // const float attenuationFactor = 1.0 - 1e-3;
        const float attenuationFactor = 1.0 - 5e-4;
        float attenuation = 1.0;
        
        // TODO: This march is closed, and sample resolution can be much lower.
        
        // Refining the termination by binary search will make it much more efficient.
        for (int i = 0; i < maxShadowLengthIterationCount; ++i) {
            if (rayDistance > maxRayDistance) {
                break; // Termination
            }
            vec3 position = rayDistance * rayDirection + rayOrigin;
            float opticalDepth = sampleShadowOpticalDepth(position, 0.0, 0.0, jitter);
            shadowLength += (1.0 - exp(-opticalDepth)) * stepSize * attenuation;
            
            // Hack to prevent over-integration of shadow length. The shadow should be
            
            // attenuated by the inscatter as the ray travels further.
            attenuation *= attenuationFactor;
            if (attenuation < 1e-5) {
                break;
            }
            stepSize *= 1.01; // Keep the shadow ray long enough after refining cloud steps.
            rayDistance += stepSize;
        }
        return shadowLength;
    }
#endif // SHADOW_LENGTH

#ifdef HAZE
    CloudRayIntervals getLocalHazeIntervals(const vec3 origin, const vec3 direction, const float distance) {
        CloudRayIntervals intervals;
        intervals.count = 0;
        intervals.length = 0.0;
        for (int i = 0; i < 6; ++i) setCloudInterval(intervals, i, vec2(0.0));
        bool firstActive = densityScales.x > 0.0 && shadowLayerMask.x > 0.0 && maxLayerHeights.x > minLayerHeights.x;
        bool secondActive = densityScales.y > 0.0 && shadowLayerMask.y > 0.0 && maxLayerHeights.y > minLayerHeights.y;
        if (!firstActive && !secondActive) return intervals;
        float heightScale = 1.0 / max(hazeExponent, 1e-7);
        for (int region = 0; region < 3; ++region) {
            if (region == 0 && hazeGroundDensityScale <= 0.0) continue;
            float lower = 0.0;
            float upper = heightScale * 2.0;
            if (region > 0) {
                int layer = region - 1;
                if (densityScales[layer] <= 0.0 || shadowLayerMask[layer] <= 0.0 || maxLayerHeights[layer] <= minLayerHeights[layer]) continue;
                upper = minLayerHeights[layer];
                lower = max(0.0, upper - heightScale * 2.0);
            }
            if (upper <= lower) continue;
            vec2 outerHits, innerHits;
            if (!cloudSphereHits(origin, direction, bottomRadius + upper, outerHits)) continue;
            if (cloudSphereHits(origin, direction, bottomRadius + lower, innerHits)) {
                appendCloudInterval(intervals, vec2(outerHits.x, innerHits.x), vec2(0.0, distance));
                appendCloudInterval(intervals, vec2(innerHits.y, outerHits.y), vec2(0.0, distance));
            } else {
                appendCloudInterval(intervals, outerHits, vec2(0.0, distance));
            }
        }
        for (int i = 1; i < 6; ++i) {
            if (i >= intervals.count) break;
            vec2 entry = cloudIntervalAt(intervals, i);
            int target = i;
            for (int j = i - 1; j >= 0; --j) {
                vec2 previous = cloudIntervalAt(intervals, j);
                if (previous.x <= entry.x) break;
                setCloudInterval(intervals, j + 1, previous);
                target = j;
            }
            setCloudInterval(intervals, target, entry);
        }
        int mergedCount = 0;
        for (int i = 0; i < 6; ++i) {
            if (i >= intervals.count) break;
            vec2 entry = cloudIntervalAt(intervals, i);
            if (mergedCount > 0) {
                vec2 previous = cloudIntervalAt(intervals, mergedCount - 1);
                if (entry.x <= previous.y) {
                    setCloudInterval(intervals, mergedCount - 1, vec2(previous.x, max(previous.y, entry.y)));
                    continue;
                }
            }
            setCloudInterval(intervals, mergedCount, entry);
            ++mergedCount;
        }
        int count = 0;
        for (int i = 0; i < 6; ++i) {
            if (i >= mergedCount || intervals.length >= hazeVolumeLength) break;
            vec2 entry = cloudIntervalAt(intervals, i);
            entry.y = min(entry.y, entry.x + hazeVolumeLength - intervals.length);
            setCloudInterval(intervals, count, entry);
            intervals.length += entry.y - entry.x;
            ++count;
        }
        intervals.count = count;
        return intervals;
    }
    float localHazeDensity(const vec3 position) {
        float height = max(length(position) - bottomRadius, 0.0);
        bool insideCloudShell = false;
        for (int layer = 0; layer < 3; ++layer) {
            insideCloudShell = insideCloudShell || (densityScales[layer] > 0.0 && height >= minLayerHeights[layer] && height <= maxLayerHeights[layer]);
        }
        float heightScale = 1.0 / max(hazeExponent, 1e-7);
        vec2 uv = getGlobeUv(position);
        vec4 weather = pow(textureLod(localWeatherTexture, uv * localWeatherRepeat + localWeatherOffset, 2.0).LOCAL_WEATHER_CHANNELS, weatherExponents);
        float weight = 0.0;
        for (int layer = 0; layer < 2; ++layer) {
            if (densityScales[layer] <= 0.0 || shadowLayerMask[layer] <= 0.0 || maxLayerHeights[layer] <= minLayerHeights[layer]) continue;
            // The broad weather gate retains sunlit shape gaps instead of masking them with cloud density.
            float gate = smoothstep(max(0.0, 1.0 - coverage - 0.6), max(0.1, 1.0 - coverage - 0.1), weather[layer]);
            float ground = exp(-height * hazeExponent) * (1.0 - smoothstep(heightScale * 1.5, heightScale * 2.0, height));
            float belowBase = minLayerHeights[layer] - height;
            float attached = 0.0;
            if (belowBase > 0.0 && belowBase < heightScale * 2.0) {
                attached = exp(-belowBase * hazeExponent) * smoothstep(0.0, heightScale * 0.15, belowBase) *
                    (1.0 - smoothstep(heightScale * 1.5, heightScale * 2.0, belowBase));
            }
            // At low sun angles, cloud gaps project far from the vertical weather footprint.
            float attachedGate = 0.0;
            if (attached > 0.0) {
                vec2 sunHits;
                if (cloudSphereHits(position, sunDirection, bottomRadius + minLayerHeights[layer], sunHits)) {
                    float sunDistance = sunHits.x > 0.0 ? sunHits.x : sunHits.y;
                    vec2 groundHits;
                    bool planetOcclusion = cloudSphereHits(position, sunDirection, bottomRadius, groundHits) &&
                        groundHits.x > 0.0 && groundHits.x < sunDistance;
                    if (sunDistance > 0.0 && !planetOcclusion) {
                        vec3 lightEntry = position + sunDirection * sunDistance;
                        vec2 lightUv = getGlobeUv(lightEntry);
                        vec4 lightWeather = pow(textureLod(localWeatherTexture, lightUv * localWeatherRepeat + localWeatherOffset, 2.0).LOCAL_WEATHER_CHANNELS, weatherExponents);
                        attachedGate = smoothstep(max(0.0, 1.0 - coverage - 0.6), max(0.1, 1.0 - coverage - 0.1), lightWeather[layer]);
                    }
                }
            }
            weight = max(weight, max(ground * hazeGroundDensityScale * gate, attached * attachedGate));
        }
        if (weight > 0.0 && insideCloudShell) {
            float cameraDistance = length(position - (vCameraPosition - vEllipsoidCenter));
            float lod = log2(max(1.0, cameraDistance * shapeTexelsPerMeterPerPixel));
            WeatherSample cloudWeather = sampleWeather(uv, height, lod);
            if (any(greaterThan(cloudWeather.density, vec4(minDensity)))) {
                // A geometric shell also contains clear air; only actual cloud media suppresses the extra haze.
                MediaSample cloud = sampleMedia(cloudWeather, position, uv, lod, 0.5);
                weight *= 1.0 - smoothstep(0.0, max(minExtinction, 1e-7), cloud.extinction);
            }
        }
        return weight;
    }
    vec4 approximateHaze(
    const vec3 rayOrigin, const vec3 rayDirection, const float maxRayDistance, const float cosTheta, out float hazeDepth
    ) {
        hazeDepth = -1.0;
        float modulation = remapClamped(coverage, 0.2, 0.4);
        if (cameraHeight < 0.0 || modulation <= 0.0 || hazeDensityScale <= 0.0 || maxRayDistance <= 0.0) {
            return vec4(0.0);
        }
        float distance = clamp(maxRayDistance, 0.0, maxShadowLengthRayDistance);
        vec3 skyLight = vGroundIrradiance.sky * RECIPROCAL_PI4 * skyIrradianceScale;
        float hazePhase = henyeyGreenstein(vec2(hazeAnisotropy), cosTheta).x;
        vec3 sunLight = vGroundIrradiance.sun * hazePhase * hazeSunColor * hazeDirectLightScale;
        bool hasSunlight = dot(max(sunLight, vec3(0.0)), vec3(1.0)) > 1e-7;
        vec3 inscatter = vec3(0.0);
        float transmission = 1.0;
        int samples = clamp(hazeSampleCount, 1, 32);
        if (hazeCloudAttached) {
            float cameraOffset = length(rayOrigin - (vCameraPosition - vEllipsoidCenter));
            distance = min(maxRayDistance, max(0.0, hazeViewDistance - cameraOffset));
            CloudRayIntervals intervals = getLocalHazeIntervals(rayOrigin, rayDirection, distance);
            if (intervals.count == 0) return vec4(0.0);
            int segmentIndex = 0;
            int segmentSample = 0;
            int segmentBudget = 1;
            float completedLength = 0.0;
            float depthSum = 0.0;
            float depthWeight = 0.0;
            vec2 segment = intervals.segment0;
            for (int i = 0; i < 32; ++i) {
                if (i >= samples || segmentIndex >= intervals.count) break;
                if (segmentSample == 0) {
                    segment = cloudIntervalAt(intervals, segmentIndex);
                    int available = max(1, samples - i - (intervals.count - segmentIndex - 1));
                    segmentBudget = clamp(int(float(samples - i) * (segment.y - segment.x) / max(intervals.length - completedLength, 1.0)), 1, available);
                }
                float t0 = float(segmentSample) / float(segmentBudget);
                float t1 = float(segmentSample + 1) / float(segmentBudget);
                float start = mix(segment.x, segment.y, t0 * t0);
                float end = mix(segment.x, segment.y, t1 * t1);
                float rayDistance = (start + end) * 0.5;
                float volumeDistance = completedLength + rayDistance - segment.x;
                ++segmentSample;
                if (segmentSample >= segmentBudget) {
                    completedLength += segment.y - segment.x;
                    ++segmentIndex;
                    segmentSample = 0;
                }
                vec3 position = rayOrigin + rayDirection * rayDistance;
                float viewFalloff = 1.0 - smoothstep(hazeViewDistance * 0.75, hazeViewDistance, cameraOffset + rayDistance);
                float volumeFalloff = 1.0 - smoothstep(hazeVolumeLength * 0.8, hazeVolumeLength, volumeDistance);
                float density = modulation * hazeDensityScale * localHazeDensity(position) * viewFalloff * volumeFalloff;
                float opacity = 1.0 - exp(-density * (end - start));
                if (opacity <= 0.0) continue;
                float sunlight = hasSunlight ? sampleHazeSunlight(position) : 1.0;
                float contribution = transmission * opacity;
                // Cloud-shadow leakage must not become a uniform direct-light fog floor.
                float directVisibility = smoothstep(0.02, 0.65, sunlight);
                inscatter += contribution * (skyLight * 0.02 + sunLight * directVisibility);
                depthSum += contribution * rayDistance;
                depthWeight += contribution;
                transmission *= 1.0 - opacity;
                if (transmission < 0.01) break;
            }
            if (depthWeight > 0.0) hazeDepth = depthSum / depthWeight;
            inscatter *= hazeScatteringCoefficient / max(hazeAbsorptionCoefficient + hazeScatteringCoefficient, 1e-7);
            return vec4(inscatter, 1.0 - transmission);
        }
        for (int i = 0; i < 32; ++i) {
            if (i >= samples) break;
            float t0 = float(i) / float(samples);
            float t1 = float(i + 1) / float(samples);
            // Anchor the grid and density falloff to the light range, not each foreground depth.
            float start = maxShadowLengthRayDistance * t0 * t0;
            if (start >= distance) break;
            float end = min(distance, maxShadowLengthRayDistance * t1 * t1);
            vec3 position = rayOrigin + rayDirection * (start + end) * 0.5;
            float height = max(length(position) - bottomRadius, 0.0);
            float falloff = 1.0 - smoothstep(maxShadowLengthRayDistance * 0.5, maxShadowLengthRayDistance, (start + end) * 0.5);
            float density = modulation * hazeDensityScale * exp(-height * hazeExponent) * falloff;
            float opacity = 1.0 - exp(-density * (end - start));
            if (opacity <= 0.0) continue;
            float sunlight = hasSunlight ? sampleHazeSunlight(position) : 1.0;
            inscatter += transmission * opacity * (skyLight * 0.1 + sunLight * sunlight);
            transmission *= 1.0 - opacity;
            if (transmission < 0.01) break;
        }
        inscatter *= hazeScatteringCoefficient / max(hazeAbsorptionCoefficient + hazeScatteringCoefficient, 1e-7);
        return vec4(inscatter, 1.0 - transmission);
        // end
        // Analytical optical depth where density exponentially decreases with height.
        // Based on: https://iquilezles.org/articles/fog/
        // float angle = max(dot(normalize(rayOrigin), rayDirection), 1e-5);
        // float exponent = angle * hazeExponent;
        // // Derive the optical depths separately for with and without shadow length.
        // 
        // float expTerm = 1.0 - exp(-maxRayDistance * exponent);
        // float shadowExpTerm = 1.0 - exp(-min(maxRayDistance, shadowLength) * exponent);
        // float linearTerm = density / hazeExponent / angle;
        // float opticalDepth = expTerm * linearTerm;
        // float effectiveOpticalDepth = max((expTerm - shadowExpTerm) * linearTerm, 0.0);
        // vec3 skyIrradiance = vGroundIrradiance.sky;
        // vec3 sunIrradiance = vGroundIrradiance.sun;
        // vec3 irradiance = sunIrradiance * phaseFunction(cosTheta);
        // irradiance += skyIrradiance * RECIPROCAL_PI4 * skyIrradianceScale;
        // vec3 inscatter = albedo * irradiance * saturate(1.0 - exp(-effectiveOpticalDepth));
        // 
        // // Inscatter is attenuated by shadow length, but transmittance is not.
        // 
        // return vec4(inscatter, saturate(1.0 - exp(-opticalDepth)));
    }
#endif // HAZE
void applyAerialPerspective(
const vec3 cameraPosition, const vec3 frontPosition, const float shadowLength, inout vec4 color
) {
    vec3 transmittance;
    vec3 inscatter = GetSkyRadianceToPoint(
    cameraPosition * METER_TO_LENGTH_UNIT, frontPosition * METER_TO_LENGTH_UNIT, shadowLength * METER_TO_LENGTH_UNIT, sunDirection, transmittance
    );
    // 6.2
    // float clampedAlpha = max(color.a, 1e-7);
    // color.rgb = mix(vec3(0.0), color.rgb * transmittance / clampedAlpha + inscatter, color.a);
    color.rgb = color.rgb * transmittance + inscatter * color.a;
}
bool rayIntersectsGround(const vec3 cameraPosition, const vec3 rayDirection) {
    float r = length(cameraPosition);
    float mu = dot(cameraPosition, rayDirection) / r;
    return mu < 0.0 && r * r * (mu * mu - 1.0) + bottomRadius * bottomRadius >= 0.0;
}
struct IntersectionResult {
    bool ground;
    vec4 first;
    vec4 second;
};
IntersectionResult getIntersections(const vec3 cameraPosition, const vec3 rayDirection) {
    IntersectionResult intersections;
    intersections.ground = rayIntersectsGround(cameraPosition, rayDirection);
    raySphereIntersections(
    cameraPosition, rayDirection, bottomRadius + vec4(0.0, minHeight, maxHeight, shadowTopHeight), intersections.first, intersections.second
    );
    return intersections;
}
vec2 getRayNearFar(const IntersectionResult intersections) {
    vec2 nearFar;
    if (cameraHeight < minHeight) {
        // View below the clouds
        if (intersections.ground) {
            nearFar = vec2(-1.0); // No clouds to the ground
        }
        else {
            nearFar = vec2(intersections.second.y, intersections.second.z);
        }

    }
    else if (cameraHeight < maxHeight) {
        // View inside the total cloud layer
        if (intersections.ground) {
            nearFar = vec2(cameraNear, intersections.first.y);
        }
        else {
            nearFar = vec2(cameraNear, intersections.second.z);
        }

    }
    else {
        // View above the clouds
        nearFar = vec2(intersections.first.z, intersections.second.z);
        if (intersections.ground) {
            // Clamp the ray at the min height.
            nearFar.y = intersections.first.y;
        }

    }
    nearFar.y = min(nearFar.y, maxRayDistance);
    return nearFar;
}
#ifdef SHADOW_LENGTH
    vec2 getShadowRayNearFar(const IntersectionResult intersections) {
        vec2 nearFar;
        if (cameraHeight < shadowTopHeight) {
            if (intersections.ground) {
                nearFar = vec2(cameraNear, intersections.first.x);
            }
            else {
                nearFar = vec2(cameraNear, intersections.second.w);
            }
    
        }
        else {
            nearFar = vec2(intersections.first.w, intersections.second.w);
            if (intersections.ground) {
                // Clamp the ray at the ground.
                nearFar.y = intersections.first.x;
            }
    
        }
        nearFar.y = min(nearFar.y, maxShadowLengthRayDistance);
        return nearFar;
    }
#endif // SHADOW_LENGTH

#ifdef HAZE
    vec2 getHazeRayNearFar(const IntersectionResult intersections) {
        vec2 nearFar;
        if (cameraHeight < maxHeight) {
            if (intersections.ground) {
                nearFar = vec2(cameraNear, intersections.first.x);
            }
            else {
                nearFar = vec2(cameraNear, intersections.second.z);
            }
    
        }
        else {
            nearFar = vec2(cameraNear, intersections.second.z);
            if (intersections.ground) {
                // Clamp the ray at the ground.
                nearFar.y = intersections.first.x;
            }
    
        }
        return nearFar;
    }
#endif // HAZE
float getRayDistanceToScene(const vec3 rayDirection) {
    float depth = readDepth(vUv * targetUvScale + temporalJitter);
    if (depth < 1.0 - 1e-7) {
        depth = czm_reverseLogDepth(depth);
        float viewZ = getViewZ(depth);
        return -viewZ / dot(rayDirection, vCameraDirection);
    }
    return -1.0;
}
void main() {
    #ifdef DEBUG_SHOW_SHADOW_MAP
        outputColor = getCascadedShadowMaps(vUv);
        outputDepthVelocity = vec4(0.0);
        #ifdef SHADOW_LENGTH
            outputShadowLength = 0.0;
        #endif // SHADOW_LENGTH
        return;
    #endif // DEBUG_SHOW_SHADOW_MAP
    
    vec3 cameraPosition = vCameraPosition - vEllipsoidCenter;
    vec3 rayDirection = normalize(vRayDirection);
    float cosTheta = dot(sunDirection, rayDirection);
    IntersectionResult intersections = getIntersections(cameraPosition, rayDirection);
    vec2 rayNearFar = getRayNearFar(intersections);
    #ifdef SHADOW_LENGTH
        vec2 shadowRayNearFar = getShadowRayNearFar(intersections);
    #endif // SHADOW_LENGTH
    #ifdef HAZE
        vec2 hazeRayNearFar = getHazeRayNearFar(intersections);
    #endif // HAZE
    
    float rayDistanceToScene = getRayDistanceToScene(rayDirection);
    if (rayDistanceToScene >= 0.0) {
        rayNearFar.y = min(rayNearFar.y, rayDistanceToScene);
        #ifdef SHADOW_LENGTH
            shadowRayNearFar.y = min(shadowRayNearFar.y, rayDistanceToScene);
        #endif // SHADOW_LENGTH
        #ifdef HAZE
            hazeRayNearFar.y = min(hazeRayNearFar.y, rayDistanceToScene);
        #endif // HAZE
    }
    bool intersectsGround = any(lessThan(rayNearFar, vec2(0.0)));
    bool intersectsScene = rayNearFar.y < rayNearFar.x;
    float stbn = getSTBN();
    vec4 color = vec4(0.0);
    float frontDepth = rayNearFar.y;
    vec4 depthVelocity = vec4(0.0);
    float shadowLength = 0.0;
    // Derivatives must run on both sides of terrain silhouettes, before divergent tracing.
    vec3 lodRayOrigin = max(cameraNear, rayNearFar.x) * rayDirection + cameraPosition;
    vec2 globeUv = getGlobeUv(lodRayOrigin);
    float mipLevel = getMipLevel(globeUv * localWeatherRepeat) * mipLevelScale;
    mipLevel = mix(0.0, mipLevel, min(1.0, 0.2 * cameraHeight / maxHeight));
    if (!intersectsGround && !intersectsScene) {
        vec3 rayOrigin = rayNearFar.x * rayDirection + cameraPosition;
        #ifdef DEBUG_SHOW_UV
            outputColor = vec4(vec3(checker(globeUv, localWeatherRepeat + localWeatherOffset)), 1.0);
            outputDepthVelocity = vec4(0.0);
            #ifdef SHADOW_LENGTH
                outputShadowLength = 0.0;
            #endif // SHADOW_LENGTH
            return;
        #endif // DEBUG_SHOW_UV
        
        float marchedFrontDepth;
        ivec3 sampleCount = ivec3(0);
        vec4 traceStats;
        color = marchClouds(
        rayOrigin, rayDirection, rayNearFar, cosTheta, mix(stbn, 0.5, smoothstep(25000.0, 100000.0, rayNearFar.x)), pow(2.0, mipLevel), marchedFrontDepth, sampleCount, traceStats
        );
        #ifdef DEBUG_SHOW_SAMPLE_COUNT
            outputColor = vec4(vec3(sampleCount) / vec3(2048.0, 8192.0, 2048.0), 1.0);
            outputDepthVelocity = traceStats;
            #ifdef SHADOW_LENGTH
                outputShadowLength = 0.0;
            #endif // SHADOW_LENGTH
            return;
        #endif // DEBUG_SHOW_SAMPLE_COUNT
        
        // Front depth will be -1.0 when no samples are accumulated.
        if (marchedFrontDepth >= 0.0) {
            frontDepth = rayNearFar.x + marchedFrontDepth;
            #ifdef SHADOW_LENGTH
                // Clamp the shadow length ray at the clouds.
                shadowRayNearFar.y = mix(
                shadowRayNearFar.y, min(frontDepth, shadowRayNearFar.y), color.a // Interpolate by the alpha for smoother edges.
                );
            #endif // SHADOW_LENGTH
            
            #ifdef HAZE
                // Clamp the haze ray at the clouds.
                hazeRayNearFar.y = mix(
                hazeRayNearFar.y, min(frontDepth, hazeRayNearFar.y), color.a // Interpolate by the alpha for smoother edges.
                );
            #endif // HAZE
        }
        #ifdef SHADOW_LENGTH
            if (all(greaterThanEqual(shadowRayNearFar, vec2(0.0)))) {
                shadowLength = marchShadowLength(
                shadowRayNearFar.x * rayDirection + cameraPosition, rayDirection, shadowRayNearFar, stbn
                );
            }
        #endif // SHADOW_LENGTH
        // Apply aerial perspective.
        vec3 frontPosition = cameraPosition + frontDepth * rayDirection;
        applyAerialPerspective(cameraPosition, frontPosition, shadowLength, color);
        
        // Velocity for temporal resolution.
        
        vec3 frontPositionWorld = ECEFToWorld(frontPosition);
        vec4 prevClip = reprojectionMatrix * vec4(frontPositionWorld, 1.0);
        prevClip /= prevClip.w;
        vec2 prevUv = prevClip.xy * 0.5 + 0.5;
        vec2 velocity = (vUv * targetUvScale - prevUv) * resolution;
        float previousDepth = length(frontPositionWorld - previousCameraPosition);
        depthVelocity = vec4(frontDepth, velocity, previousDepth);
    }
    else {
        #ifdef SHADOW_LENGTH
            if (all(greaterThanEqual(shadowRayNearFar, vec2(0.0)))) {
                shadowLength = marchShadowLength(
                shadowRayNearFar.x * rayDirection + cameraPosition, rayDirection, shadowRayNearFar, stbn
                );
            }
        #endif // SHADOW_LENGTH
        // TODO: We can calculate velocity to reduce occlusion errors at the edges, // but suffers from floating-point precision errors on near objects.
        
        // if (intersectsScene) {
        //   vec3 frontPosition = cameraPosition + rayNearFar.y * rayDirection;
        //   vec3 frontPositionWorld = ECEFToWorld(frontPosition);
        //   vec4 prevClip = reprojectionMatrix * vec4(frontPositionWorld, 1.0);
        //   prevClip /= prevClip.w;
        //   vec2 prevUv = prevClip.xy * 0.5 + 0.5;
        //   vec2 velocity = (vUv - prevUv) * resolution;
        //   depthVelocity = vec3(rayNearFar.y, velocity);
        // }
    }
    #ifdef DEBUG_SHOW_FRONT_DEPTH
        outputColor = vec4(turbo(frontDepth / maxRayDistance), 1.0);
        outputDepthVelocity = vec4(0.0);
        #ifdef SHADOW_LENGTH
            outputShadowLength = 0.0;
        #endif // SHADOW_LENGTH
        return;
    #endif // DEBUG_SHOW_FRONT_DEPTH
    
    #ifdef HAZE
        float hazeDepth;
        float hazeNear = max(cameraNear, hazeRayNearFar.x);
        vec4 haze = approximateHaze(
        hazeNear * rayDirection + cameraPosition, rayDirection, hazeRayNearFar.y - hazeNear, cosTheta, hazeDepth
        );
        if (hazeCloudAttached && hazeDepth >= 0.0 && color.a <= 0.0) {
            vec3 hazePositionWorld = ECEFToWorld(cameraPosition + (hazeNear + hazeDepth) * rayDirection);
            vec4 prevClip = reprojectionMatrix * vec4(hazePositionWorld, 1.0);
            if (prevClip.w > 0.0) {
                vec2 prevUv = prevClip.xy / prevClip.w * 0.5 + 0.5;
                vec2 velocity = (vUv * targetUvScale - prevUv) * resolution;
                depthVelocity = vec4(hazeNear + hazeDepth, velocity, length(hazePositionWorld - previousCameraPosition));
            }
        }
        // 6.2
        // color = color * (1.0 - haze.a) + haze;
        // Haze radiance already contains its scattering integral (premultiplied).
        color.rgb = color.rgb * (1.0 - haze.a) + haze.rgb;
        color.a = color.a * (1.0 - haze.a) + haze.a;
    #endif // HAZE
    
    outputColor = color;
    outputDepthVelocity = depthVelocity;
    #ifdef SHADOW_LENGTH
        outputShadowLength = shadowLength * METER_TO_LENGTH_UNIT;
    #endif // SHADOW_LENGTH
}
