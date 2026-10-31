
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
#define SHADER_NAME LensFlareFeaturesMaterial
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

#define SQRT_2 (0.7071067811865476)

uniform sampler2D inputBuffer;
uniform vec2 texelSize;
uniform float ghostAmount;
uniform float haloAmount;
uniform float chromaticAberration;
in vec2 vUv;
in vec2 vAspectRatio;
vec3 sampleGhost(const vec2 direction, const vec3 color, const float offset) {
    vec2 suv = clamp(1.0 - vUv + direction * offset, 0.0, 1.0);
    vec3 result = texture(inputBuffer, suv).rgb * color;
    
    // Falloff at the perimeter.
    
    float d = clamp(length(0.5 - suv) / (0.5 * SQRT_2), 0.0, 1.0);
    result *= pow(1.0 - d, 3.0);
    return result;
}
vec4 sampleGhosts(float amount) {
    vec3 color = vec3(0.0);
    vec2 direction = vUv - 0.5;
    color += sampleGhost(direction, vec3(0.8, 0.8, 1.0), -5.0);
    color += sampleGhost(direction, vec3(1.0, 0.8, 0.4), -1.5);
    color += sampleGhost(direction, vec3(0.9, 1.0, 0.8), -0.4);
    color += sampleGhost(direction, vec3(1.0, 0.8, 0.4), -0.2);
    color += sampleGhost(direction, vec3(0.9, 0.7, 0.7), -0.1);
    color += sampleGhost(direction, vec3(0.5, 1.0, 0.4), 0.7);
    color += sampleGhost(direction, vec3(0.5, 0.5, 0.5), 1.0);
    color += sampleGhost(direction, vec3(1.0, 1.0, 0.6), 2.5);
    color += sampleGhost(direction, vec3(0.5, 0.8, 1.0), 10.0);
    return vec4(color * amount, 1.0);
}
// Reference: https://john-chapman.github.io/2017/11/05/pseudo-lens-flare.html
float cubicRingMask(const float x, const float radius, const float thickness) {
    float v = min(abs(x - radius) / thickness, 1.0);
    return 1.0 - v * v * (3.0 - 2.0 * v);
}
vec3 sampleHalo(const float radius) {
    vec2 direction = normalize((vUv - 0.5) / vAspectRatio) * vAspectRatio;
    vec3 offset = vec3(texelSize.x * chromaticAberration) * vec3(-1.0, 0.0, 1.0);
    vec2 suv = fract(1.0 - vUv + direction * radius);
    vec3 result = vec3(
    texture(inputBuffer, suv + direction * offset.r).r, texture(inputBuffer, suv + direction * offset.g).g, texture(inputBuffer, suv + direction * offset.b).b
    );
    
    // Falloff at the center and perimeter.
    
    vec2 wuv = (vUv - vec2(0.5, 0.0)) / vAspectRatio + vec2(0.5, 0.0);
    float d = saturate(distance(wuv, vec2(0.5)));
    result *= cubicRingMask(d, 0.45, 0.25);
    return result;
}
vec4 sampleHalos(const float amount) {
    vec3 color = vec3(0.0);
    color += sampleHalo(0.3);
    return vec4(color, 1.0) * amount;
}
void main() {
    out_FragColor += sampleGhosts(ghostAmount);
    out_FragColor += sampleHalos(haloAmount);
}
