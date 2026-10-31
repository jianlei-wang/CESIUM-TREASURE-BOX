
#version 300 es
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
in vec2 v_textureCoordinates;
uniform sampler2D depthTexture;
uniform sampler2D colorTexture;
uniform sampler2D positionTexture;
uniform vec2 resolution;
uniform float cameraNear;
uniform vec3 globeNormal;
uniform float cameraHeight;
uniform float aerialPerspectiveStrength;
uniform float cloudVisibility;
uniform vec4 u_customDarkParam;
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
float getViewZ(const in float depth) {
    // float near = czm_depthRange.near;
    // float far = czm_depthRange.far;
    // return (2.0 * depth - near - far) / (far - near);
    float near = czm_currentFrustum.x;
    float far = czm_currentFrustum.y;
    return ( near * far ) / ( ( far - near ) * depth - far );
}
precision highp sampler2DArray;

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
vec3 hash32(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
    p3 += dot(p3, p3.yxz+33.33);
    return fract((p3.xxy+p3.yzz)*p3.zyx);
}
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
  const float x,
  const float min1,
  const float max1,
  const float min2,
  const float max2
) {
  return clamp(min2 + (x - min1) / (max1 - min1) * (max2 - min2), min2, max2);
}

vec2 remapClamped(
  const vec2 x,
  const vec2 min1,
  const vec2 max1,
  const vec2 min2,
  const vec2 max2
) {
  return clamp(min2 + (x - min1) / (max1 - min1) * (max2 - min2), min2, max2);
}

vec3 remapClamped(
  const vec3 x,
  const vec3 min1,
  const vec3 max1,
  const vec3 min2,
  const vec3 max2
) {
  return clamp(min2 + (x - min1) / (max1 - min1) * (max2 - min2), min2, max2);
}

vec4 remapClamped(
  const vec4 x,
  const vec4 min1,
  const vec4 max1,
  const vec4 min2,
  const vec4 max2
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

// Reference: https://jcgt.org/published/0003/02/01/paper.pdf

vec2 signNotZero(vec2 v) {
  return vec2(v.x >= 0.0 ? 1.0 : -1.0, v.y >= 0.0 ? 1.0 : -1.0);
}

vec2 packNormalToVec2(vec3 v) {
  vec2 p = v.xy * (1.0 / (abs(v.x) + abs(v.y) + abs(v.z)));
  return v.z <= 0.0
    ? (1.0 - abs(p.yx)) * signNotZero(p)
    : p;
}

vec3 unpackVec2ToNormal(vec2 e) {
  vec3 v = vec3(e.xy, 1.0 - abs(e.x) - abs(e.y));
  if (v.z < 0.0) {
    v.xy = (1.0 - abs(v.yx)) * signNotZero(v.xy);
  }
  return normalize(v);
}
 vec4 clipToEye(vec2 uv, float depth) {
    vec2 xy = vec2((uv.x * 2.0 - 1.0), ((1.0 - uv.y) * 2.0 - 1.0));
    vec4 posEC = czm_inverseProjection * vec4(xy, depth, 1.0);
    posEC = posEC / posEC.w;
    return posEC;
}
vec3 screenToView(
  const vec2 uv,
  const float depth,
  const float viewZ,
  const mat4 projectionMatrix,
  const mat4 inverseProjectionMatrix
) {
  vec4 clip = vec4(vec3(uv, depth) * 2.0 - 1.0, 1.0);
  float clipW = projectionMatrix[2][3] * viewZ + projectionMatrix[3][3];
  clip *= clipW;
  return (inverseProjectionMatrix * clip).xyz;
}

#ifdef HAS_SHADOW
float raySphereFirstIntersection(
  const vec3 origin,
  const vec3 direction,
  const vec3 center,
  const float radius
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
  const vec3 origin,
  const vec3 direction,
  const vec3 center,
  const vec4 radius
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
  const vec3 origin,
  const vec3 direction,
  const vec3 center,
  const float radius
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
  const vec3 origin,
  const vec3 direction,
  const vec3 center,
  const vec4 radius
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
  const vec3 origin,
  const vec3 direction,
  const vec3 center,
  const float radius,
  out float intersection1,
  out float intersection2
) {
  vec3 a = origin - center;
  float b = 2.0 * dot(direction, a);
  float c = dot(a, a) - radius * radius;
  float discriminant = b * b - 4.0 * c;
  if (discriminant < 0.0) {
    intersection1 = -1.0;
    intersection2 = -1.0;
    return;
  } else {
    float Q = sqrt(discriminant);
    intersection1 = (-b - Q) * 0.5;
    intersection2 = (-b + Q) * 0.5;
  }
}

void raySphereIntersections(
  const vec3 origin,
  const vec3 direction,
  const float radius,
  out float intersection1,
  out float intersection2
) {
  raySphereIntersections(origin, direction, vec3(0.0), radius, intersection1, intersection2);
}

void raySphereIntersections(
  const vec3 origin,
  const vec3 direction,
  const vec3 center,
  const vec4 radius,
  out vec4 intersection1,
  out vec4 intersection2
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
  const vec3 origin,
  const vec3 direction,
  const vec4 radius,
  out vec4 intersection1,
  out vec4 intersection2
) {
  raySphereIntersections(origin, direction, vec3(0.0), radius, intersection1, intersection2);
}

// Reference: https://github.com/mrdoob/three.js/blob/r171/examples/jsm/csm/CSMShader.js

#ifndef SHADOW_CASCADE_COUNT
#error "SHADOW_CASCADE_COUNT macro must be defined."
#endif // SHADOW_CASCADE_COUNT

int getCascadeIndex(
  const mat4 viewMatrix,
  const vec3 worldPosition,
  const vec2 intervals[SHADOW_CASCADE_COUNT],
  const float near,
  const float far
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

vec3 getCascadeBlend(
  const mat4 viewMatrix,
  const vec3 worldPosition,
  const vec2 intervals[SHADOW_CASCADE_COUNT],
  const float near,
  const float far
) {
  vec4 viewPosition = viewMatrix * vec4(worldPosition, 1.0);
  float depth = viewZToOrthographicDepth(viewPosition.z, near, far);

  vec2 interval;
  float intervalCenter;
  float closestEdge;
  float margin;
  int nextIndex = -1;
  int prevIndex = -1;
  float alpha = 0.0;

  
    #if 0 < SHADOW_CASCADE_COUNT
    interval = intervals[0];
    intervalCenter = (interval.x + interval.y) * 0.5;
    closestEdge = depth < intervalCenter ? interval.x : interval.y;
    margin = max(closestEdge * closestEdge * 0.5, 1e-6);
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
    margin = max(closestEdge * closestEdge * 0.5, 1e-6);
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
    margin = max(closestEdge * closestEdge * 0.5, 1e-6);
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
    margin = max(closestEdge * closestEdge * 0.5, 1e-6);
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
  

  return vec3(float(nextIndex), float(prevIndex), alpha);
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

#endif // HAS_SHADOW
uniform vec3 u_solar_irradiance;
uniform float u_sun_angular_radius;
uniform float u_bottom_radius;
uniform float u_top_radius;
uniform vec3 u_rayleigh_scattering;
uniform vec3 u_mie_scattering;
uniform float u_mie_phase_function_g;
uniform float u_mu_s_min;
uniform float u_max_rayleigh_shadow_length;

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

float DistanceToBottomAtmosphereBoundary(const float r, const float mu) {
  float discriminant = r * r * (mu * mu - 1.0) + u_bottom_radius * u_bottom_radius;
  return ClampDistance(-r * mu - SafeSqrt(discriminant));
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
    GetTextureCoordFromUnitRange(x_mu, TRANSMITTANCE_TEXTURE_WIDTH),
    GetTextureCoordFromUnitRange(x_r, TRANSMITTANCE_TEXTURE_HEIGHT)
  );
}

vec3 GetTransmittanceToTopAtmosphereBoundary(
  const sampler2D u_transmittance_texture,
  float r,
  float mu
) {
  vec2 uv = GetTransmittanceTextureUvFromRMu(r, mu);
  return vec3(texture(u_transmittance_texture, uv));
}

vec3 GetTransmittance(
  const sampler2D u_transmittance_texture,
  float r,
  float mu,
  float d,
  bool ray_r_mu_intersects_ground
) {
  float r_d = ClampRadius(sqrt(d * d + 2.0 * r * mu * d + r * r));
  float mu_d = ClampCosine((r * mu + d) / r_d);
  if (ray_r_mu_intersects_ground) {
    return min(
      GetTransmittanceToTopAtmosphereBoundary(u_transmittance_texture, r_d, -mu_d) /
        GetTransmittanceToTopAtmosphereBoundary(u_transmittance_texture, r, -mu),
      vec3(1.0)
    );
  } else {
    return min(
      GetTransmittanceToTopAtmosphereBoundary(u_transmittance_texture, r, mu) /
        GetTransmittanceToTopAtmosphereBoundary(u_transmittance_texture, r_d, mu_d),
      vec3(1.0)
    );
  }
}

vec3 GetTransmittanceToSun(const sampler2D u_transmittance_texture, float r, float mu_s) {
  float sin_theta_h = u_bottom_radius / r;
  float cos_theta_h = -sqrt(max(1.0 - sin_theta_h * sin_theta_h, 0.0));
  return GetTransmittanceToTopAtmosphereBoundary(u_transmittance_texture, r, mu_s) *
  smoothstep(
    -sin_theta_h * u_sun_angular_radius,
    sin_theta_h * u_sun_angular_radius,
    mu_s - cos_theta_h
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
  float r,
  float mu,
  float mu_s,
  float nu,
  bool ray_r_mu_intersects_ground
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
    u_mu =
      0.5 -
      0.5 *
        GetTextureCoordFromUnitRange(
          d_max == d_min
            ? 0.0
            : (d - d_min) / (d_max - d_min),
          SCATTERING_TEXTURE_MU_SIZE / 2
        );
  } else {
    float d = -r_mu + SafeSqrt(discriminant + H * H);
    float d_min = u_top_radius - r;
    float d_max = rho + H;
    u_mu =
      0.5 +
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
    max(1.0 - a / A, 0.0) / (1.0 + a),
    SCATTERING_TEXTURE_MU_S_SIZE
  );
  float u_nu = (nu + 1.0) / 2.0;
  return vec4(u_nu, u_mu_s, u_mu, u_r);
}

vec2 GetIrradianceTextureUvFromRMuS(float r, float mu_s) {
  float x_r = (r - u_bottom_radius) / (u_top_radius - u_bottom_radius);
  float x_mu_s = mu_s * 0.5 + 0.5;
  return vec2(
    GetTextureCoordFromUnitRange(x_mu_s, IRRADIANCE_TEXTURE_WIDTH),
    GetTextureCoordFromUnitRange(x_r, IRRADIANCE_TEXTURE_HEIGHT)
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
  const sampler3D u_scattering_texture,
  const sampler3D u_single_mie_scattering_texture,
  float r,
  float mu,
  float mu_s,
  float nu,
  bool ray_r_mu_intersects_ground,
  out vec3 single_mie_scattering
) {
  vec4 uvwz = GetScatteringTextureUvwzFromRMuMuSNu(r, mu, mu_s, nu, ray_r_mu_intersects_ground);
  float tex_coord_x = uvwz.x * float(SCATTERING_TEXTURE_NU_SIZE - 1);
  float tex_x = floor(tex_coord_x);
  float lerp = tex_coord_x - tex_x;
  vec3 uvw0 = vec3((tex_x + uvwz.y) / float(SCATTERING_TEXTURE_NU_SIZE), uvwz.z, uvwz.w);
  vec3 uvw1 = vec3((tex_x + 1.0 + uvwz.y) / float(SCATTERING_TEXTURE_NU_SIZE), uvwz.z, uvwz.w);
  vec4 combined_scattering =
    texture(u_scattering_texture, uvw0) * (1.0 - lerp) + texture(u_scattering_texture, uvw1) * lerp;
  vec3 scattering = vec3(combined_scattering);
  single_mie_scattering = GetExtrapolatedSingleMieScattering(combined_scattering);
  return scattering;
}

vec3 GetSkyRadiance(
  const sampler2D u_transmittance_texture,
  const sampler3D u_scattering_texture,
  const sampler3D u_single_mie_scattering_texture,
  vec3 camera,
  const vec3 view_ray,
  float shadow_length,
  const vec3 sun_direction,
  out vec3 transmittance
) {
  float r = length(camera);
  float rmu = dot(camera, view_ray);
  float distance_to_top_atmosphere_boundary =
    -rmu - SafeSqrt(rmu * rmu - r * r + u_top_radius * u_top_radius);
  if (distance_to_top_atmosphere_boundary > 0.0) {
    camera = camera + view_ray * distance_to_top_atmosphere_boundary;
    r = u_top_radius;
    rmu += distance_to_top_atmosphere_boundary;
  } else if (r > u_top_radius) {
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
      u_scattering_texture,
      u_single_mie_scattering_texture,
      r,
      mu,
      mu_s,
      nu,
      ray_r_mu_intersects_ground,
      single_mie_scattering
    );
  } else {
    // 5.31 start
    // float d = shadow_length;
    // Use different points for Rayleigh and Mie scattering since a large shadowAdd commentMore actions
    // length for Rayleigh scattering leads to an overly orange tint, which
    // doesn't work well with the clouds seemingly because their in-scattering
    // is an approximation for terrain.
    float rayleigh_shadow_length = min(shadow_length, u_max_rayleigh_shadow_length);
    float d = rayleigh_shadow_length;
    // 5.31 end
    float r_p = ClampRadius(sqrt(d * d + 2.0 * r * mu * d + r * r));
    float mu_p = (r * mu + d) / r_p;
    float mu_s_p = (r * mu_s + d * nu) / r_p;
    scattering = GetCombinedScattering(
      u_scattering_texture,
      u_single_mie_scattering_texture,
      r_p,
      mu_p,
      mu_s_p,
      nu,
      ray_r_mu_intersects_ground,
      single_mie_scattering
    );
    // 5.31 start
    // vec3 shadow_transmittance = GetTransmittance(
    vec3 rayleigh_transmittance = GetTransmittance(
      u_transmittance_texture,
      r,
      mu,
      rayleigh_shadow_length,
      ray_r_mu_intersects_ground
    );

    d = shadow_length;
    r_p = ClampRadius(sqrt(d * d + 2.0 * r * mu * d + r * r));
    mu_p = (r * mu + d) / r_p;
    mu_s_p = (r * mu_s + d * nu) / r_p;
    GetCombinedScattering(
      u_scattering_texture,
      u_single_mie_scattering_texture,
      r_p,
      mu_p,
      mu_s_p,
      nu,
      ray_r_mu_intersects_ground,
      single_mie_scattering
    );
    vec3 mie_transmittance = GetTransmittance(
    // 5.31 end
      u_transmittance_texture,
      r,
      mu,
      shadow_length,
      ray_r_mu_intersects_ground
    );
    // 5.31
    // scattering = scattering * shadow_transmittance;
    // single_mie_scattering = single_mie_scattering * shadow_transmittance;
    scattering = scattering * rayleigh_transmittance;
    single_mie_scattering = single_mie_scattering * mie_transmittance;
  }
  return scattering * RayleighPhaseFunction(nu) +
  single_mie_scattering * MiePhaseFunction(u_mie_phase_function_g, nu);
}

vec3 GetSkyRadianceToPoint(
  const sampler2D u_transmittance_texture,
  const sampler3D u_scattering_texture,
  const sampler3D u_single_mie_scattering_texture,
  vec3 camera,
  const vec3 point,
  float shadow_length,
  const vec3 sun_direction,
  out vec3 transmittance
) {
  vec3 view_ray = normalize(point - camera);
  float r = length(camera);
  float rmu = dot(camera, view_ray);
  float distance_to_top_atmosphere_boundary =
    -rmu - sqrt(rmu * rmu - r * r + u_top_radius * u_top_radius);
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
    u_scattering_texture,
    u_single_mie_scattering_texture,
    r,
    mu,
    mu_s,
    nu,
    ray_r_mu_intersects_ground,
    single_mie_scattering
  );
  d = max(d - shadow_length, 0.0);
  float r_p = ClampRadius(sqrt(d * d + 2.0 * r * mu * d + r * r));
  float mu_p = (r * mu + d) / r_p;
  float mu_s_p = (r * mu_s + d * nu) / r_p;
  vec3 single_mie_scattering_p;
  vec3 scattering_p = GetCombinedScattering(
    u_scattering_texture,
    u_single_mie_scattering_texture,
    r_p,
    mu_p,
    mu_s_p,
    nu,
    ray_r_mu_intersects_ground,
    single_mie_scattering_p
  );
  vec3 shadow_transmittance = transmittance;
  if (shadow_length > 0.0) {
    shadow_transmittance = GetTransmittance(
      u_transmittance_texture,
      r,
      mu,
      d,
      ray_r_mu_intersects_ground
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
  const sampler2D u_transmittance_texture,
  const sampler2D u_irradiance_texture,
  const vec3 point,
  const vec3 sun_direction,
  out vec3 sky_irradiance
) {
  float r = length(point);
  float mu_s = dot(point, sun_direction) / r;
  sky_irradiance = GetIrradiance(u_irradiance_texture, r, mu_s);
  return u_solar_irradiance * GetTransmittanceToSun(u_transmittance_texture, r, mu_s);
}

vec3 GetSunAndSkyIrradiance(
  const sampler2D u_transmittance_texture,
  const sampler2D u_irradiance_texture,
  const vec3 point,
  const vec3 normal,
  const vec3 sun_direction,
  out vec3 sky_irradiance
) {
  float r = length(point);
  float mu_s = dot(point, sun_direction) / r;
  sky_irradiance =
    GetIrradiance(u_irradiance_texture, r, mu_s) * (1.0 + dot(normal, point) / r) * 0.5;
  // 修改
  #ifdef SUNLIGHT_CULL
    vec3 sun_irradiance = u_solar_irradiance * GetTransmittanceToSun(u_transmittance_texture, r, mu_s);
  #else
    vec3 sun_irradiance = u_solar_irradiance * GetTransmittanceToSun(u_transmittance_texture, r, mu_s) * max(dot(normal, sun_direction), 0.0);
  #endif
  #ifdef DARKLIGHT
    return max(sun_irradiance, u_solar_irradiance* u_customDarkParam.y) ;
  #else 
    return sun_irradiance;
  #endif
}

vec3 GetSolarRadiance() {
  vec3 radiance = u_solar_irradiance / (PI * u_sun_angular_radius * u_sun_angular_radius);
  #ifdef PHOTOMETRIC
  radiance *= SUN_SPECTRAL_RADIANCE_TO_LUMINANCE;
  #endif // PHOTOMETRIC
  return radiance;
}

vec3 GetSkyRadiance(
  vec3 camera,
  vec3 view_ray,
  float shadow_length,
  vec3 sun_direction,
  out vec3 transmittance
) {
  vec3 radiance = GetSkyRadiance(
    u_transmittance_texture,
    u_scattering_texture,
    u_single_mie_scattering_texture,
    camera,
    view_ray,
    shadow_length,
    sun_direction,
    transmittance
  );
  // 修改
  #ifdef DARKLIGHT
     radiance = mix(radiance * u_customDarkParam.x, radiance, step(-0.09, dot(normalize(camera), sun_direction)));
  #endif
  #ifdef PHOTOMETRIC
  radiance *= SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;
  #endif // PHOTOMETRIC
  return radiance;
}

vec3 GetSkyRadianceToPoint(
  vec3 camera,
  vec3 point,
  float shadow_length,
  vec3 sun_direction,
  out vec3 transmittance
) {
  vec3 inscatter = GetSkyRadianceToPoint(
    u_transmittance_texture,
    u_scattering_texture,
    u_single_mie_scattering_texture,
    camera,
    point,
    shadow_length,
    sun_direction,
    transmittance
  );
  #ifdef PHOTOMETRIC
  inscatter *= SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;
  #endif // PHOTOMETRIC
  return inscatter;
}

vec3 GetSunAndSkyIrradiance(vec3 point, vec3 sun_direction, out vec3 sky_irradiance) {
  vec3 sun_irradiance = GetSunAndSkyIrradiance(
    u_transmittance_texture,
    u_irradiance_texture,
    point,
    sun_direction,
    sky_irradiance
  );
  #ifdef PHOTOMETRIC
  sun_irradiance *= SUN_SPECTRAL_RADIANCE_TO_LUMINANCE;
  sky_irradiance *= SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;
  #endif // PHOTOMETRIC
  return sun_irradiance;
}

vec3 GetSunAndSkyIrradiance(vec3 point, vec3 normal, vec3 sun_direction, out vec3 sky_irradiance) {
  vec3 sun_irradiance = GetSunAndSkyIrradiance(
    u_transmittance_texture,
    u_irradiance_texture,
    point,
    normal,
    sun_direction,
    sky_irradiance
  );
  #ifdef PHOTOMETRIC
  sun_irradiance *= SUN_SPECTRAL_RADIANCE_TO_LUMINANCE;
  sky_irradiance *= SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;
  #endif // PHOTOMETRIC
  return sun_irradiance;
}

vec3 getLunarRadiance(const float moonAngularRadius) {
  // Not a physical number but the order of 10^-6 relative to the sun may fit.
  vec3 radiance = u_solar_irradiance * 0.000002 / (PI * moonAngularRadius * moonAngularRadius);
  #ifdef PHOTOMETRIC
  radiance *= SUN_SPECTRAL_RADIANCE_TO_LUMINANCE;
  #endif // PHOTOMETRIC
  return radiance;
}

float intersectSphere(const vec3 ray, const vec3 point, const float radius) {
  vec3 P = -point;
  float PoR = dot(P, ray);
  float D = dot(P, P) - radius * radius;
  return -PoR - sqrt(PoR * PoR - D);
}

float orenNayarDiffuse(const vec3 L, const vec3 V, const vec3 N) {
  float NoL = dot(N, L);
  float NoV = dot(N, V);
  float s = dot(L, V) - NoL * NoV;
  float t = mix(1.0, max(NoL, NoV), step(0.0, s));
  return max(0.0, NoL) * (0.62406015 + 0.41284404 * s / t);
}

vec3 getSkyRadiance(
  const vec3 cameraPosition,
  const vec3 rayDirection,
  float shadowLength,
  const vec3 sunDirection,
  const vec3 moonDirection,
  const float moonAngularRadius,
  const float lunarRadianceScale
) {
  vec3 transmittance;
  vec3 radiance = GetSkyRadiance(
    cameraPosition,
    rayDirection,
    shadowLength,
    sunDirection,
    transmittance
  );

  // Rendering celestial objects without perspective doesn't make sense.
  #ifdef PERSPECTIVE_CAMERA

  #if defined(SUN) || defined(MOON)
  vec3 ddx = dFdx(rayDirection);
  vec3 ddy = dFdy(rayDirection);
  float fragmentAngle = length(ddx + ddy) / length(rayDirection);
  #endif // defined(SUN) || defined(MOON)

  #ifdef SUN
  // Compute disk coverage without a divergent angular branch or reversed smoothstep.
  float viewDotSun = clamp(dot(rayDirection, sunDirection), -1.0, 1.0);
  float sunEdgeWidth = max(fwidth(viewDotSun), 1e-7);
  float solarVisibility = smoothstep(
    cos(u_sun_angular_radius) - sunEdgeWidth,
    cos(u_sun_angular_radius) + sunEdgeWidth,
    viewDotSun
  );
  radiance += transmittance * GetSolarRadiance() * solarVisibility;
  #endif // SUN

  #ifdef MOON
  float intersection = intersectSphere(rayDirection, moonDirection, moonAngularRadius);
  if (intersection > 0.0) {
    vec3 normal = normalize(moonDirection - rayDirection * intersection);
    float diffuse = orenNayarDiffuse(-sunDirection, rayDirection, normal);
    float viewDotMoon = dot(rayDirection, moonDirection);
    float angle = acos(clamp(viewDotMoon, -1.0, 1.0));
    float antialias = smoothstep(moonAngularRadius, moonAngularRadius - fragmentAngle, angle);
    radiance +=
      transmittance *
      getLunarRadiance(moonAngularRadius) *
      lunarRadianceScale *
      diffuse *
      antialias;
  }
  #endif // MOON

  #endif // PERSPECTIVE_CAMERA

  return radiance;
}


uniform sampler2D normalBuffer;

uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat4 inverseProjectionMatrix;
uniform mat4 inverseViewMatrix;
uniform float bottomRadius;
uniform vec3 ellipsoidCenter;
uniform mat4 inverseEllipsoidMatrix;
uniform vec3 sunDirection;
vec3 moonDirection;
uniform float moonAngularRadius;
uniform float lunarRadianceScale;
uniform float irradianceScale;
uniform float idealSphereAlpha;

#ifdef HAS_OVERLAY
uniform sampler2D overlayBuffer;
#endif // HAS_OVERLAY

#ifdef HAS_SHADOW
uniform sampler2DArray shadowBuffer;
uniform vec2 shadowIntervals[SHADOW_CASCADE_COUNT];
uniform mat4 shadowMatrices[SHADOW_CASCADE_COUNT];
uniform mat4 inverseShadowMatrices[SHADOW_CASCADE_COUNT];
uniform float shadowFar;
uniform float shadowTopHeight;
uniform float shadowRadius;
uniform sampler3D stbnTexture;
uniform int frame;
#endif // HAS_SHADOW

#ifdef HAS_SHADOW_LENGTH
uniform sampler2D shadowLengthBuffer;
#endif // HAS_SHADOW_LENGTH

in vec3 vCameraPosition;
in vec3 vRayDirection;
in vec3 vEllipsoidCenter;
in vec3 vGeometryEllipsoidCenter;
in vec3 vEllipsoidRadiiSquared;

vec3 readNormal(const vec2 uv) {
  #ifdef OCT_ENCODED_NORMAL
    return unpackVec2ToNormal(texture(normalBuffer, uv).xy);
  #else // OCT_ENCODED_NORMAL
    return 2.0 * texture(normalBuffer, uv).xyz - 1.0;
  #endif // OCT_ENCODED_NORMAL
}

void correctGeometricError(inout vec3 positionECEF, inout vec3 normalECEF) {
  // TODO: The error is pronounced at the edge of the ellipsoid due to the
  // large difference between the sphere position and the unprojected position
  // at the current fragment. Calculating the sphere position from the fragment
  // UV may resolve this.

  // Correct way is slerp, but this will be small-angle interpolation anyways.
  vec3 sphereNormal = normalize(positionECEF / vEllipsoidRadiiSquared);
  vec3 spherePosition = u_bottom_radius * sphereNormal;
  normalECEF = mix(normalECEF, sphereNormal, idealSphereAlpha);
  // positionECEF = mix(positionECEF, spherePosition, idealSphereAlpha);
  positionECEF = mix(positionECEF, spherePosition, idealSphereAlpha);
}

#if defined(SUN_IRRADIANCE) || defined(SKY_IRRADIANCE)

vec3 getSunSkyIrradiance(
  const vec3 positionECEF,
  const vec3 normal,
  const vec3 inputColor,
  const float sunTransmittance
) {
  // Assume lambertian BRDF. If both SUN_IRRADIANCE and SKY_IRRADIANCE are not
  // defined, regard the inputColor as radiance at the texel.
  vec3 albedo = inputColor * irradianceScale * RECIPROCAL_PI;
  vec3 skyIrradiance;
  vec3 sunIrradiance = GetSunAndSkyIrradiance(positionECEF, normal, sunDirection, skyIrradiance);

  #ifdef HAS_SHADOW
  sunIrradiance *= sunTransmittance;
  #endif // HAS_SHADOW

  #if defined(SUN_IRRADIANCE) && defined(SKY_IRRADIANCE)
  return albedo * (sunIrradiance + skyIrradiance);
  #elif defined(SUN_IRRADIANCE)
  return albedo * sunIrradiance;
  #elif defined(SKY_IRRADIANCE)
  return albedo * skyIrradiance;
  #endif // defined(SUN_IRRADIANCE) && defined(SKY_IRRADIANCE)
}

#endif // defined(SUN_IRRADIANCE) || defined(SKY_IRRADIANCE)

#if defined(TRANSMITTANCE) || defined(INSCATTER)

void applyTransmittanceInscatter(const vec3 positionECEF, float shadowLength, inout vec3 radiance) {
  vec3 transmittance;
  vec3 inscatter = GetSkyRadianceToPoint(
    vCameraPosition - vGeometryEllipsoidCenter,
    positionECEF,
    shadowLength,
    sunDirection,
    transmittance
  );
  #ifdef TRANSMITTANCE
  radiance = radiance * mix(vec3(1.0), transmittance, aerialPerspectiveStrength);
  #endif // TRANSMITTANCE
  #ifdef INSCATTER
  radiance = radiance + inscatter * aerialPerspectiveStrength;
  #endif // INSCATTER
}

#endif // defined(TRANSMITTANCE) || defined(INSCATTER)

#ifdef HAS_SHADOW

float getSTBN() {
  ivec3 size = textureSize(stbnTexture, 0);
  vec3 scale = 1.0 / vec3(size);
  return texture(stbnTexture, vec3(gl_FragCoord.xy, float(frame % size.z)) * scale).r;
}

vec2 getShadowUv(const vec3 worldPosition, const int cascadeIndex) {
  vec4 clip = shadowMatrices[cascadeIndex] * vec4(worldPosition, 1.0);
  clip /= clip.w;
  return clip.xy * 0.5 + 0.5;
}

float getDistanceToShadowTop(const vec3 positionECEF) {
  // Distance to the top of the shadows along the sun direction, which matches
  // the ray origin of BSM.
  return raySphereSecondIntersection(
    positionECEF / METER_TO_LENGTH_UNIT, // TODO: Make units consistent
    sunDirection,
    vec3(0.0),
    bottomRadius + shadowTopHeight
  );
}

float readShadowOpticalDepth(const vec2 uv, const float distanceToTop, const int cascadeIndex) {
  // r: frontDepth, g: meanExtinction, b: maxOpticalDepth, a: maxOpticalDepthTail
  vec4 shadow = texture(shadowBuffer, vec3(uv, float(cascadeIndex)));
  // Omit adding maxOpticalDepthTail to avoid pronounced aliasing. Ground
  // shadow will be attenuated by inscatter anyways.
  return min(shadow.b, shadow.g * max(0.0, distanceToTop - shadow.r));
}

float sampleShadowOpticalDepthPCF(
  const vec3 worldPosition,
  const float distanceToTop,
  const float radius,
  const int cascadeIndex
) {
  vec2 uv = getShadowUv(worldPosition, cascadeIndex);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    return 0.0;
  }

  vec2 texelSize = vec2(1.0) / vec2(textureSize(shadowBuffer, 0).xy);
  float sum = 0.0;
  // A fixed disk avoids screen-space noise crawling as the camera moves.
  vec2 offset;
  
    #if 0 < SHADOW_SAMPLE_COUNT
    offset = vogelDisk(
      0,
      SHADOW_SAMPLE_COUNT,
      0.0
    );
    sum += exp(-max(readShadowOpticalDepth(uv + offset * radius * texelSize, distanceToTop, cascadeIndex), 0.0));
    #endif // 0 < SHADOW_SAMPLE_COUNT
  
    #if 1 < SHADOW_SAMPLE_COUNT
    offset = vogelDisk(
      1,
      SHADOW_SAMPLE_COUNT,
      0.0
    );
    sum += exp(-max(readShadowOpticalDepth(uv + offset * radius * texelSize, distanceToTop, cascadeIndex), 0.0));
    #endif // 1 < SHADOW_SAMPLE_COUNT
  
    #if 2 < SHADOW_SAMPLE_COUNT
    offset = vogelDisk(
      2,
      SHADOW_SAMPLE_COUNT,
      0.0
    );
    sum += exp(-max(readShadowOpticalDepth(uv + offset * radius * texelSize, distanceToTop, cascadeIndex), 0.0));
    #endif // 2 < SHADOW_SAMPLE_COUNT
  
    #if 3 < SHADOW_SAMPLE_COUNT
    offset = vogelDisk(
      3,
      SHADOW_SAMPLE_COUNT,
      0.0
    );
    sum += exp(-max(readShadowOpticalDepth(uv + offset * radius * texelSize, distanceToTop, cascadeIndex), 0.0));
    #endif // 3 < SHADOW_SAMPLE_COUNT
  
    #if 4 < SHADOW_SAMPLE_COUNT
    offset = vogelDisk(
      4,
      SHADOW_SAMPLE_COUNT,
      0.0
    );
    sum += exp(-max(readShadowOpticalDepth(uv + offset * radius * texelSize, distanceToTop, cascadeIndex), 0.0));
    #endif // 4 < SHADOW_SAMPLE_COUNT
  
    #if 5 < SHADOW_SAMPLE_COUNT
    offset = vogelDisk(
      5,
      SHADOW_SAMPLE_COUNT,
      0.0
    );
    sum += exp(-max(readShadowOpticalDepth(uv + offset * radius * texelSize, distanceToTop, cascadeIndex), 0.0));
    #endif // 5 < SHADOW_SAMPLE_COUNT
  
    #if 6 < SHADOW_SAMPLE_COUNT
    offset = vogelDisk(
      6,
      SHADOW_SAMPLE_COUNT,
      0.0
    );
    sum += exp(-max(readShadowOpticalDepth(uv + offset * radius * texelSize, distanceToTop, cascadeIndex), 0.0));
    #endif // 6 < SHADOW_SAMPLE_COUNT
  
    #if 7 < SHADOW_SAMPLE_COUNT
    offset = vogelDisk(
      7,
      SHADOW_SAMPLE_COUNT,
      0.0
    );
    sum += exp(-max(readShadowOpticalDepth(uv + offset * radius * texelSize, distanceToTop, cascadeIndex), 0.0));
    #endif // 7 < SHADOW_SAMPLE_COUNT
  
    #if 8 < SHADOW_SAMPLE_COUNT
    offset = vogelDisk(
      8,
      SHADOW_SAMPLE_COUNT,
      0.0
    );
    sum += exp(-max(readShadowOpticalDepth(uv + offset * radius * texelSize, distanceToTop, cascadeIndex), 0.0));
    #endif // 8 < SHADOW_SAMPLE_COUNT
  
    #if 9 < SHADOW_SAMPLE_COUNT
    offset = vogelDisk(
      9,
      SHADOW_SAMPLE_COUNT,
      0.0
    );
    sum += exp(-max(readShadowOpticalDepth(uv + offset * radius * texelSize, distanceToTop, cascadeIndex), 0.0));
    #endif // 9 < SHADOW_SAMPLE_COUNT
  
    #if 10 < SHADOW_SAMPLE_COUNT
    offset = vogelDisk(
      10,
      SHADOW_SAMPLE_COUNT,
      0.0
    );
    sum += exp(-max(readShadowOpticalDepth(uv + offset * radius * texelSize, distanceToTop, cascadeIndex), 0.0));
    #endif // 10 < SHADOW_SAMPLE_COUNT
  
    #if 11 < SHADOW_SAMPLE_COUNT
    offset = vogelDisk(
      11,
      SHADOW_SAMPLE_COUNT,
      0.0
    );
    sum += exp(-max(readShadowOpticalDepth(uv + offset * radius * texelSize, distanceToTop, cascadeIndex), 0.0));
    #endif // 11 < SHADOW_SAMPLE_COUNT
  
    #if 12 < SHADOW_SAMPLE_COUNT
    offset = vogelDisk(
      12,
      SHADOW_SAMPLE_COUNT,
      0.0
    );
    sum += exp(-max(readShadowOpticalDepth(uv + offset * radius * texelSize, distanceToTop, cascadeIndex), 0.0));
    #endif // 12 < SHADOW_SAMPLE_COUNT
  
    #if 13 < SHADOW_SAMPLE_COUNT
    offset = vogelDisk(
      13,
      SHADOW_SAMPLE_COUNT,
      0.0
    );
    sum += exp(-max(readShadowOpticalDepth(uv + offset * radius * texelSize, distanceToTop, cascadeIndex), 0.0));
    #endif // 13 < SHADOW_SAMPLE_COUNT
  
    #if 14 < SHADOW_SAMPLE_COUNT
    offset = vogelDisk(
      14,
      SHADOW_SAMPLE_COUNT,
      0.0
    );
    sum += exp(-max(readShadowOpticalDepth(uv + offset * radius * texelSize, distanceToTop, cascadeIndex), 0.0));
    #endif // 14 < SHADOW_SAMPLE_COUNT
  
    #if 15 < SHADOW_SAMPLE_COUNT
    offset = vogelDisk(
      15,
      SHADOW_SAMPLE_COUNT,
      0.0
    );
    sum += exp(-max(readShadowOpticalDepth(uv + offset * radius * texelSize, distanceToTop, cascadeIndex), 0.0));
    #endif // 15 < SHADOW_SAMPLE_COUNT
  
  // Filter transmitted light: averaging optical depth makes mixed edge samples nearly black.
  return -log(max(sum / float(SHADOW_SAMPLE_COUNT), 1e-6));
}

float sampleShadowOpticalDepth(
  const vec3 worldPosition,
  const vec3 positionECEF,
  const float radius
) {
  float distanceToTop = getDistanceToShadowTop(positionECEF);
  if (distanceToTop <= 0.0) {
    return 0.0;
  }
  // Ground shading has no temporal resolve: blend cascades instead of
  // randomly switching between their different shadow resolutions each frame.
  vec3 cascadeBlend = getCascadeBlend(
    viewMatrix, worldPosition, shadowIntervals, cameraNear, shadowFar
  );
  int nextIndex = int(cascadeBlend.x);
  int prevIndex = int(cascadeBlend.y);
  float alpha = cascadeBlend.z;
  float nextDepth = nextIndex >= 0 && alpha > 0.0
    ? sampleShadowOpticalDepthPCF(worldPosition, distanceToTop, radius, nextIndex)
    : 0.0;
  if (alpha >= 1.0) return nextDepth;
  float prevDepth = prevIndex >= 0
    ? sampleShadowOpticalDepthPCF(worldPosition, distanceToTop, radius, prevIndex)
    : 0.0;
  // Blend transmitted light, then return optical depth to the lighting pass.
  return -log(max(mix(exp(-prevDepth), exp(-nextDepth), alpha), 1e-6));
}

float getShadowRadius(const vec3 worldPosition) {
  vec4 clip = shadowMatrices[0] * vec4(worldPosition, 1.0);
  clip /= clip.w;

  // Offset by 1px in each direction in shadow's clip coordinates.
  vec2 shadowSize = vec2(textureSize(shadowBuffer, 0));
  vec3 offset = vec3(2.0 / shadowSize, 0.0);
  vec4 clipX = clip + offset.xzzz;
  vec4 clipY = clip + offset.zyzz;

  // Convert back to world space.
  vec4 worldX = inverseShadowMatrices[0] * clipX;
  vec4 worldY = inverseShadowMatrices[0] * clipY;

  // Project into the main camera's clip space.
  mat4 viewProjectionMatrix = projectionMatrix * viewMatrix;
  vec4 projected = viewProjectionMatrix * vec4(worldPosition, 1.0);
  vec4 projectedX = viewProjectionMatrix * worldX;
  vec4 projectedY = viewProjectionMatrix * worldY;
  projected /= projected.w;
  projectedX /= projectedX.w;
  projectedY /= projectedY.w;

  // Take the mean of pixel sizes.
  vec2 center = (projected.xy * 0.5 + 0.5) * resolution;
  vec2 offsetX = (projectedX.xy * 0.5 + 0.5) * resolution;
  vec2 offsetY = (projectedY.xy * 0.5 + 0.5) * resolution;
  float size = max(length(offsetX - center), length(offsetY - center));

  return remapClamped(size, 10.0, 50.0, 1.5, max(1.5, shadowRadius));
}

#endif // HAS_SHADOW
#ifdef ENABLE_SNOWEFFECT
    uniform sampler2D snowCoverMaskMap;
    uniform vec4 snowCoverParam;
    float calcSnowCoverage(float snow_coverage,float max_snow_coverage,vec3 normalWC,float z_mask){
        float normal_z=normalWC.z;
        normal_z=clamp(normal_z*1.01,0.,1.);
        float final_snow_coverage=clamp(snow_coverage,0.,max_snow_coverage);
        final_snow_coverage=clamp(final_snow_coverage*normal_z,0.,1.);
        return final_snow_coverage;
    }
    float calcSnowCoverageWithMaskTexture(float finalSnowCoverage,float heightValue,float snow_scatter_value,float snow_scatter_alpha,float tighten_value){
        float scatter_value=mix(heightValue,snow_scatter_value,snow_scatter_alpha);
        return clamp((tighten_value+1.)*finalSnowCoverage-tighten_value*scatter_value,0.,1.);
    }
    float calcSnowAlpha(vec3 normalWC,float snow_coverage,float z_mask){
        return clamp((normalWC.z+z_mask)*5.,0.,1.)*snow_coverage;
    }
    vec3 calcFinalBaseColor(vec3 baseColor,vec3 snow_baseColor,float snowAlpha){
        return mix(baseColor,snow_baseColor,snowAlpha);
    }
    vec3 renderSnowEffect(vec2 uv, in vec3 normalWC, in vec3 diffuse) {
        uv = uv*snowCoverParam.z;
        vec3 snowMaskValue = texture(snowCoverMaskMap, uv).rgb;
        const float max_snow_coverage = 1.;
        const float z_mask = 0.;
        float snowCoverage = calcSnowCoverage(snowCoverParam.x, max_snow_coverage, normalWC, z_mask);
        const float heightValue = .5;
        float snow_scatter_value = snowMaskValue.g;
        const float snow_scatter_alpha = .5;
        snowCoverage = calcSnowCoverageWithMaskTexture(snowCoverage, heightValue, snow_scatter_value, snow_scatter_alpha, snowCoverParam.y);
        float snow_alpha = calcSnowAlpha(normalWC, snowCoverage, z_mask);
        // snow_alpha = (1.0 - step(elevation, snowCoverParam.w)) * snow_alpha;
        return calcFinalBaseColor(diffuse, vec3(snowMaskValue.r), snow_alpha);
    }
#endif
#ifdef ENABLE_THUNDERCLOUDS
uniform vec4 weatherParam;
uniform vec4 weatherParam2;
const vec3 innerLightColor = vec3(0.7, 0.4, 1.0) * 4.0;
float hash1(float x){
    return fract(sin(x*23.3)*13.13);
}
float hash11(float p) {
    p = fract((p+1.0)*0.1031);
    p *= p+33.33;
    return fract(p*p*2.0);
}
vec3 hash31(float p)
{
   vec3 p3 = fract(vec3(p) * vec3(.1031, .1030, .0973));
   p3 += dot(p3, p3.yzx + 33.33);
   return fract((p3.xxy + p3.yzz) * p3.zyx); 
}
vec4 innerLight;
vec4 innerLightPositionAndIntensity() {
    float scaledTime = float(frame) * 0.1;
    float hashInput = floor(scaledTime) * 0.1;
    
    if (hash11(hashInput) < 0.8) return vec4(0.); // mask out most of the flashes
        
    vec3 hash = hash31(hashInput);
    float theta = hash.x * 6.283;
    float z = hash.y * 2. - 1.;
    float sinPhi = sin(acos(z));
    vec3 position = vec3(sinPhi * cos(theta), sinPhi * sin(theta), z) * (0.6 + hash.z * 0.2);
    
    float intensity = sin(fract(scaledTime) * 3.142);
    
    return vec4(position, intensity);
}
#endif

/*__VOLUMETRIC_LIGHT_COMPOSITE__*/

void SkyMain(in vec4 inputColor, const vec2 uv, out vec4 outputColor) {
  outputColor = vec4(0.0);
  float shadowLength = 0.0;
  float depth = czm_unpackDepth(texture(depthTexture, v_textureCoordinates));
  // Evaluate derivatives before sky/cloud early returns to keep each fragment quad coherent.
  vec4 positionEC = czm_windowToEyeCoordinates(gl_FragCoord.xy, depth);

  vec3 viewNormal;
  #ifdef RECONSTRUCT_NORMAL
    vec3 dx = dFdx(positionEC.xyz);
    vec3 dy = dFdy(positionEC.xyz);
    vec3 normal = cross(dx, dy);
    viewNormal = normal / max(length(normal), 1e-10);
  #else // RECONSTRUCT_NORMAL
    viewNormal = texture(normalBuffer, uv).xyz;
  #endif // RECONSTRUCT_NORMAL

  #ifdef HAS_SHADOW_LENGTH
    shadowLength = cloudVisibility > 0.0 ? texture(shadowLengthBuffer, uv).r * cloudVisibility : 0.0;
  #endif // HAS_SHADOW_LENGTH
  #ifdef HAS_GS_MASK
    vec4 gsMask = texture(czm_gsMaskTexture, uv);
    if (gsMask.a > 0.5) {
        outputColor.rgb = getSunSkyIrradiance(vec3(1.), vec3(0.5), inputColor.rgb, 1.) * 0.5;
        return;
    }
  #endif 
  #ifdef HAS_OVERLAY
    vec4 overlay = cloudVisibility > 0.0 ? texture(overlayBuffer, uv) * cloudVisibility : vec4(0.0);
    if (overlay.a == 1.0) {
      outputColor = vec4(compositeVolumetricLight(uv, vec3(0.0), overlay), overlay.a);
      return;
    }
  #endif // HAS_OVERLAY
  moonDirection = normalize(czm_inverseViewRotation * czm_moonDirectionEC);
  if (depth >= 1.0 - 1e-7) {
    #ifdef SKY
        vec3 rayDirection = normalize(vRayDirection);
        outputColor.rgb = getSkyRadiance(
        vCameraPosition - vEllipsoidCenter,
        rayDirection,
        shadowLength,
        sunDirection,
        moonDirection,
        moonAngularRadius,
        lunarRadianceScale
        );
        outputColor.a = 1.0;
    #else // SKY
        outputColor = inputColor;
    #endif // SKY
    #ifdef ENABLE_STARS
        vec2 starCellF = gl_FragCoord.xy / 4.0;
        uvec2 starCell = uvec2(floor(starCellF));
        starCellF = fract(starCellF);
        vec3 starHash = hash32(vec2(starCell));
        vec3 stars = (1.0 - smoothstep(0.0, 0.1, length(starCellF - starHash.xy))) * vec3(pow(starHash.z, 10.0)) * 5e-3;
        float sunElevation = dot(normalize(vCameraPosition - vEllipsoidCenter), sunDirection);
        float starVisibility = 1.0 - smoothstep(-0.12, 0.02, sunElevation);
        outputColor.rgb += stars * 2.0 * starVisibility;
    #endif
    #ifdef HAS_OVERLAY
        vec3 overColor = compositeVolumetricLight(uv, outputColor.rgb, overlay);
        outputColor.rgb = mix(overColor, outputColor.rgb, step(500000.0, cameraHeight));
    #endif // HAS_OVERLAY
    return;
  }

  // vec4 positionEC = vec4(texture(positionTexture, uv).xyz,1.0);
  vec4 worldCoordinate = inverseViewMatrix * positionEC;
  vec3 worldPosition = worldCoordinate.xyz / worldCoordinate.w;
  vec3 worldNormal = (czm_inverseViewRotation * viewNormal);

  mat3 rotation = mat3(inverseEllipsoidMatrix);
  vec3 positionECEF = rotation * worldPosition * METER_TO_LENGTH_UNIT - vGeometryEllipsoidCenter;
  vec3 normalECEF = rotation * worldNormal;
  #ifdef ENABLE_SNOWEFFECT
    // Official Cesium has no camera-ENU automatic uniform. Snow only needs
    // the normal's up component in the local ellipsoid frame.
    vec3 snowNormal = vec3(0.0, 0.0, dot(normalize(worldNormal), normalize(globeNormal)));
    inputColor.rgb = renderSnowEffect(worldPosition.xz, snowNormal, inputColor.rgb);
  #endif
  #ifdef ENABLE_THUNDERCLOUDS
      innerLight = innerLightPositionAndIntensity();
      float time =  float(frame) * 0.1;
      vec2 resolution = czm_viewport.zw;
      vec2 uv2=(gl_FragCoord.xy*2.-resolution.xy)/min(resolution.x,resolution.y);
      vec3 c=vec3(.5,.5,.5);
      float a=0.;
      float si=sin(a),co=cos(a);
      uv2*=mat2(co,-si,si,co);
      uv2*=length(uv2+vec2(0,-10.))*weatherParam.z+1.;
      float v=1.-sin(hash1(floor(uv2.x*100.))*2.);
      float b=clamp(abs(sin(weatherParam.w*time*v+uv2.y*(5./(2.+v))))-.95,0.,1.)*20.;
      c*=v*b;
      c*=(innerLight.w * 0.3 + 0.1) * weatherParam2.x;
      inputColor.rgb+=c;
  #endif

  #ifdef CORRECT_GEOMETRIC_ERROR
    correctGeometricError(positionECEF, normalECEF);
  #endif // CORRECT_GEOMETRIC_ERROR

  #ifdef HAS_SHADOW
    float radius = getShadowRadius(worldPosition);
    float opticalDepth = cloudVisibility > 0.0 ? sampleShadowOpticalDepth(worldPosition, positionECEF, radius) * cloudVisibility : 0.0;
    // Retain soft fill on the ground without weakening cloud self-shadow or light shafts.
    float sunTransmittance = mix(0.3, 1.0, exp(-max(opticalDepth, 0.0)));
  #else // HAS_SHADOW
    float sunTransmittance = 1.0;
  #endif // HAS_SHADOW

  vec3 radiance;
  #if defined(SUN_IRRADIANCE) || defined(SKY_IRRADIANCE)
    radiance = getSunSkyIrradiance(positionECEF, normalECEF, inputColor.rgb, sunTransmittance);
  #else // defined(SUN_IRRADIANCE) || defined(SKY_IRRADIANCE)
    radiance = inputColor.rgb;
  #endif // defined(SUN_IRRADIANCE) || defined(SKY_IRRADIANCE)
  #ifdef ENABLE_THUNDERCLOUDS
    if (innerLight.w > 0.0001) {   radiance *=innerLightColor;   }
  #endif

  #if defined(TRANSMITTANCE) || defined(INSCATTER)
    applyTransmittanceInscatter(positionECEF, shadowLength, radiance);
  #endif // defined(TRANSMITTANCE) || defined(INSCATTER)

  outputColor = vec4(radiance, inputColor.a);

  #ifdef HAS_OVERLAY
   vec3 overColor = compositeVolumetricLight(uv, outputColor.rgb, overlay);
   outputColor.rgb = mix(overColor, outputColor.rgb, step(500000.0, cameraHeight));
  #endif // HAS_OVERLAY
}

vec4 blend23(const in vec4 x, const in vec4 y, const in float opacity) {
    return mix(x, y, opacity);
}
    
// uniform sampler2D CloudsBuffer;
void CloudMain(const vec4 inputColor, const vec2 uv, out vec4 outputColor) {
    outputColor = inputColor;    
    // #ifdef SKIP_RENDERING
    //     outputColor = inputColor;
    // #else // e0SKIP_RENDERING
    //     vec4 clouds = texture(CloudsBuffer, uv);
    //     outputColor.rgb = inputColor.rgb * (1.0 - clouds.a) + clouds.rgb;
    //     outputColor.a = inputColor.a * (1.0 - clouds.a) + clouds.a;
    // #endif // SKIP_RENDERING
}
void main() {
    vec2 uv = v_textureCoordinates;
    vec4 color0 = texture(colorTexture, uv);
    // Official Cesium post-process input has already been gamma encoded.
    color0.rgb = pow(max(color0.rgb, vec3(0.0)), vec3(czm_gamma));
    vec4 color1 = vec4(0.0);

    CloudMain(color0, uv, color1);
    color0 = blend23(color0, color1, 1.0);
    color0.a = clamp(color0.a, 0.0, 1.0);

    SkyMain(color0, uv, color1);
    color0 = blend23(color0, color1, 1.0);
    color0.a = clamp(color0.a, 0.0, 1.0);
    out_FragColor = color0;
    #ifdef ENCODE_OUTPUT
        out_FragColor = linearToOutputTexel( out_FragColor );
    #endif
    #ifdef DITHERING
        out_FragColor.rgb = dithering( out_FragColor.rgb );
    #endif
}
