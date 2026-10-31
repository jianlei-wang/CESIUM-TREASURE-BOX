
#version 300 es
#define LOG_DEPTH
#define SHADER_TYPE RawShaderMaterial
#define SHADER_NAME ShadowMaterial
#define SHADOW 1
#define TEMPORAL_PASS 1
#define TEMPORAL_JITTER 0
#define LOCAL_WEATHER_CHANNELS rgba
#define CASCADE_COUNT 3
#define SHAPE_DETAIL 1
#define TURBULENCE 1
#define FRAMEBUFFER_PRECISION_HIGH 1
precision highp float;
precision highp sampler3D;
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
    in vec3 vPosition;
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
    uniform float hazeExponent;
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

// Implements Structured Volume Sampling in fragment shader:

// https://github.com/huwb/volsample
// Implementation reference:
// https://www.shadertoy.com/view/ttVfDc

void getIcosahedralVertices(const vec3 direction, out vec3 v1, out vec3 v2, out vec3 v3) {
    // Normalization scalers to fit dodecahedron to unit sphere.
    const float a = 0.85065080835204; // phi / sqrt(2 + phi)
    
    const float b = 0.5257311121191336; // 1 / sqrt(2 + phi)
    
    
    // Derive the vertices of icosahedron where triangle intersects the direction.
    // See: https://www.ppsloan.org/publications/AmbientDice.pdf
    const float kT = 0.6180339887498948; // 1 / phi
    
    const float kT2 = 0.38196601125010515; // 1 / phi^2
    
    vec3 absD = abs(direction);
    float selector1 = dot(absD, vec3(1.0, kT2, -kT));
    float selector2 = dot(absD, vec3(-kT, 1.0, kT2));
    float selector3 = dot(absD, vec3(kT2, -kT, 1.0));
    v1 = selector1 > 0.0 ? vec3(a, b, 0.0) : vec3(-b, 0.0, a);
    v2 = selector2 > 0.0 ? vec3(0.0, a, b) : vec3(a, -b, 0.0);
    v3 = selector3 > 0.0 ? vec3(b, 0.0, a) : vec3(0.0, a, -b);
    vec3 octantSign = sign(direction);
    v1 *= octantSign;
    v2 *= octantSign;
    v3 *= octantSign;
}
void swapIfBigger(inout vec4 a, inout vec4 b) {
    if (a.w > b.w) {
        vec4 t = a;
        a = b;
        b = t;
    }

}
void sortVertices(inout vec3 a, inout vec3 b, inout vec3 c) {
    const vec3 base = vec3(0.5, 0.5, 1.0);
    vec4 aw = vec4(a, dot(a, base));
    vec4 bw = vec4(b, dot(b, base));
    vec4 cw = vec4(c, dot(c, base));
    swapIfBigger(aw, bw);
    swapIfBigger(bw, cw);
    swapIfBigger(aw, bw);
    a = aw.xyz;
    b = bw.xyz;
    c = cw.xyz;
}
vec3 getPentagonalWeights(const vec3 direction, const vec3 v1, const vec3 v2, const vec3 v3) {
    float d1 = dot(v1, direction);
    float d2 = dot(v2, direction);
    float d3 = dot(v3, direction);
    vec3 w = exp(vec3(d1, d2, d3) * 40.0);
    return w / (w.x + w.y + w.z);
}
vec3 getStructureNormal(
const vec3 direction, const float jitter, out vec3 a, out vec3 b, out vec3 c, out vec3 weights
) {
    getIcosahedralVertices(direction, a, b, c);
    sortVertices(a, b, c);
    weights = getPentagonalWeights(direction, a, b, c);
    return jitter < weights.x
    ? a
    : jitter < weights.x + weights.y
    ? b
    : c;
}
vec3 getStructureNormal(const vec3 direction, const float jitter) {
    vec3 a, b, c, weights;
    return getStructureNormal(direction, jitter, a, b, c, weights);
}
// Reference: https://github.com/huwb/volsample/blob/master/src/unity/Assets/Shaders/RayMarchCore.cginc
void intersectStructuredPlanes(
const vec3 normal, const vec3 rayOrigin, const vec3 rayDirection, const float samplePeriod, out float stepOffset, out float stepSize
) {
    float NoD = dot(rayDirection, normal);
    stepSize = samplePeriod / abs(NoD);
    
    // Skips leftover bit to get from rayOrigin to first strata plane.
    
    stepOffset = -mod(dot(rayOrigin, normal), samplePeriod) / NoD;
    
    // mod() gives different results depending on if the arg is negative or
    
    // positive. This line makes it consistent, and ensures the first sample is in
    // front of the viewer.
    if (stepOffset < 0.0) {
        stepOffset += stepSize;
    }

}
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
// Set per cascade before raymarching; derivatives inside the march would be divergent.
float shadowTexelsPerPixel;
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
    int shapeSamples;
    vec4 shape = sampleCloudLayerShape(shapePosition, density, log2(max(1.0, shadowTexelsPerPixel)), shapeSamples);
    density = remapClamped(density, (vec4(1.0) - shape) * shapeAmounts, vec4(1.0));
    #ifdef DEBUG_SHOW_SAMPLE_COUNT
        sampleCount.y += shapeSamples;
    #endif // DEBUG_SHOW_SAMPLE_COUNT
    
    #ifdef SHAPE_DETAIL
        // Match the cloud density's continuous detail fade across shadow LODs.
        float detailFootprint = shadowTexelsPerPixel *
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
uniform mat4 inverseShadowMatrices[CASCADE_COUNT];
uniform mat4 reprojectionMatrices[CASCADE_COUNT];

// Primary raymarch

uniform int maxIterationCount;
uniform float minStepSize;
uniform float maxStepSize;
uniform float opticalDepthTailScale;
in vec2 vUv;
in vec3 vEllipsoidCenter;
layout(location = 0) out vec4 outputColor[CASCADE_COUNT];

// Redundant notation for prettier.

#if CASCADE_COUNT == 1
    layout(location = 1) out vec3 outputDepthVelocity[CASCADE_COUNT];
    #elif CASCADE_COUNT == 2
    layout(location = 2) out vec3 outputDepthVelocity[CASCADE_COUNT];
    #elif CASCADE_COUNT == 3
    layout(location = 3) out vec3 outputDepthVelocity[CASCADE_COUNT];
    #elif CASCADE_COUNT == 4
    layout(location = 4) out vec3 outputDepthVelocity[CASCADE_COUNT];
#endif // CASCADE_COUNT

vec4 marchClouds(
const vec3 rayOrigin, const vec3 rayDirection, const float maxRayDistance, const float jitter, const float mipLevel
) {
    // Setup structured volume sampling (SVS).
    // While SVS introduces spatial aliasing, it is indeed temporally stable, // which is important for lower-resolution shadow maps where a flickering
    // single pixel can be highly noticeable.
    vec3 normal = getStructureNormal(rayDirection, jitter);
    float rayDistance;
    float stepSize;
    intersectStructuredPlanes(
    normal, rayOrigin, rayDirection, clamp(maxRayDistance / float(maxIterationCount), minStepSize, maxStepSize), rayDistance, stepSize
    );
    #if TEMPORAL_JITTER
        rayDistance -= stepSize * jitter;
    #endif // TEMPORAL_JITTER
    
    float extinctionSum = 0.0;
    float maxOpticalDepth = 0.0;
    float maxOpticalDepthTail = 0.0;
    float transmittanceIntegral = 1.0;
    float weightedDistanceSum = 0.0;
    float transmittanceSum = 0.0;
    int sampleCount = 0;
    for (int i = 0; i < maxIterationCount; ++i) {
        if (rayDistance > maxRayDistance) {
            break; // Termination
        }
        vec3 position = rayDistance * rayDirection + rayOrigin;
        float height = length(position) - bottomRadius;
        #if !defined(DEBUG_MARCH_INTERVALS)
            if (insideLayerIntervals(height)) {
                rayDistance += stepSize;
                continue;
            }
        #endif // !defined(DEBUG_MARCH_INTERVALS)
        // Sample rough weather.
        vec2 uv = getGlobeUv(position);
        WeatherSample weather = sampleWeather(uv, height, mipLevel);
        if (any(greaterThan(weather.density, vec4(minDensity)))) {
            // Sample detailed participating media.
            // Note this assumes an homogeneous medium.
            MediaSample media = sampleMedia(weather, position, uv, mipLevel, jitter);
            if (media.extinction > minExtinction) {
                extinctionSum += media.extinction;
                maxOpticalDepth += media.extinction * stepSize;
                transmittanceIntegral *= exp(-media.extinction * stepSize);
                weightedDistanceSum += rayDistance * transmittanceIntegral;
                transmittanceSum += transmittanceIntegral;
                ++sampleCount;
            }

        }
        if (transmittanceIntegral <= minTransmittance) {
            // A large amount of optical depth accumulates in the tail, beyond the
            // point of minimum transmittance. The expected optical depth seems to
            // decrease exponentially with the number of samples taken before reaching
            // the minimum transmittance.
            // See the discussion here: https://x.com/shotamatsuda/status/1886259549931520437
            maxOpticalDepthTail = min(
            opticalDepthTailScale * stepSize * exp(float(1 - sampleCount)), stepSize * 0.5 // Excessive optical depth only introduces aliasing.
            );
            break; // Early termination
        }
        rayDistance += stepSize;
    }
    if (sampleCount == 0) {
        return vec4(maxRayDistance, 0.0, 0.0, 0.0);
    }
    float frontDepth = min(weightedDistanceSum / transmittanceSum, maxRayDistance);
    float meanExtinction = extinctionSum / float(sampleCount);
    return vec4(frontDepth, meanExtinction, maxOpticalDepth, maxOpticalDepthTail);
}
void getRayNearFar(
const vec3 sunPosition, const vec3 rayDirection, out float rayNear, out float rayFar
) {
    vec4 firstIntersections = raySphereFirstIntersection(
    sunPosition, rayDirection, vec3(0.0), bottomRadius + vec4(shadowTopHeight, shadowBottomHeight, 0.0, 0.0)
    );
    rayNear = max(0.0, firstIntersections.x);
    rayFar = firstIntersections.y;
    if (rayFar < 0.0) {
        rayFar = 1e6;
    }

}
void cascade(
const int cascadeIndex, const float mipLevel, out vec4 outputColor, out vec3 outputDepthVelocity
) {
    vec2 clip = vUv * 2.0 - 1.0;
    vec4 point = inverseShadowMatrices[cascadeIndex] * vec4(clip.xy, -1.0, 1.0);
    point /= point.w;
    vec3 sunPosition = mat3(inverseEllipsoidMatrix) * point.xyz - vEllipsoidCenter;
    
    // The sun direction is in ECEF. Since the view matrix is constructed with the
    
    // ellipsoid matrix already applied, there's no need to apply the inverse
    // matrix here.
    vec3 rayDirection = normalize(-sunDirection);
    float rayNear;
    float rayFar;
    getRayNearFar(sunPosition, rayDirection, rayNear, rayFar);
    vec3 rayOrigin = rayNear * rayDirection + sunPosition;
    // Prefilter noise to the shadow texel footprint so moving subpixel detail cannot pop.
    vec3 shapeDx = dFdx(rayOrigin * shapeRepeat);
    vec3 shapeDy = dFdy(rayOrigin * shapeRepeat);
    shadowTexelsPerPixel = max(length(shapeDx), length(shapeDy)) * float(textureSize(shapeTexture, 0).x);
    // Keep structured sample planes and detail LOD stable between frames.
    float stbn = 0.5;
    vec4 color = marchClouds(rayOrigin, rayDirection, rayFar - rayNear, stbn, mipLevel);
    outputColor = color;
    
    // Velocity for temporal resolution.
    
    #ifdef TEMPORAL_PASS
        vec3 frontPosition = color.x * rayDirection + rayOrigin;
        vec3 frontPositionWorld = mat3(ellipsoidMatrix) * (frontPosition + vEllipsoidCenter);
        vec4 prevClip = reprojectionMatrices[cascadeIndex] * vec4(frontPositionWorld, 1.0);
        prevClip /= prevClip.w;
        vec2 prevUv = prevClip.xy * 0.5 + 0.5;
        vec2 velocity = (vUv - prevUv) * resolution;
        outputDepthVelocity = vec3(color.x, velocity);
    #else // TEMPORAL_PASS
        outputDepthVelocity = vec3(0.0);
    #endif // TEMPORAL_PASS
}
// TODO: Calculate from the main camera frustum perhaps?
const float mipLevels[4] = float[4](0.0, 0.5, 1.0, 2.0);
void main() {
    #if 0 < CASCADE_COUNT
        cascade(0, mipLevels[0], outputColor[0], outputDepthVelocity[0]);
    #endif // 0 < CASCADE_COUNT
    
    #if 1 < CASCADE_COUNT
        cascade(1, mipLevels[1], outputColor[1], outputDepthVelocity[1]);
    #endif // 1 < CASCADE_COUNT
    
    #if 2 < CASCADE_COUNT
        cascade(2, mipLevels[2], outputColor[2], outputDepthVelocity[2]);
    #endif // 2 < CASCADE_COUNT
    
    #if 3 < CASCADE_COUNT
        cascade(3, mipLevels[3], outputColor[3], outputDepthVelocity[3]);
    #endif // 3 < CASCADE_COUNT
}
