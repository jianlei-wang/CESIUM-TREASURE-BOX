
#version 300 es
#define SHADER_TYPE RawShaderMaterial
#define SHADER_NAME CloudsResolveMaterial
#define TEMPORAL_UPSCALE 1
#define FRAMEBUFFER_PRECISION_HIGH 1
#define SHADOW_LENGTH 1
precision highp float;
precision highp sampler2DArray;

// A fifth-order polynomial approximation of Turbo color map.

// See: https://observablehq.com/@mbostock/turbo
// prettier-ignore
vec3 turbo(const float x) {
    float r = 0.1357 + x * (4.5974 - x * (42.3277 - x * (130.5887 - x * (150.5666 - x * 58.1375))));
    float g = 0.0914 + x * (2.1856 + x * (4.8052 - x * (14.0195 - x * (4.2109 + x * 2.7747))));
    float b = 0.1067 + x * (12.5925 - x * (60.1097 - x * (109.0745 - x * (88.5066 - x * 26.8183))));
    return vec3(r, g, b);
}
// Taken from https://gist.github.com/TheRealMJP/c83b8c0f46b63f3a88a5986f4fa982b1
// TODO: Use 5-taps version: https://www.shadertoy.com/view/MtVGWz
// Or even 4 taps (requires preprocessing in the input buffer):
// https://www.shadertoy.com/view/4tyGDD

/**
* MIT License
*
* Copyright (c) 2019 MJP
*
* Permission is hereby granted, free of charge, to any person obtaining a copy
* of this software and associated documentation files (the "Software"), to deal
* in the Software without restriction, including without limitation the rights
* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
* copies of the Software, and to permit persons to whom the Software is
* furnished to do so, subject to the following conditions:
*
* The above copyright notice and this permission notice shall be included in all
* copies or substantial portions of the Software.
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
* SOFTWARE.
*/

vec4 textureCatmullRom(sampler2D tex, vec2 uv) {
    vec2 texSize = vec2(textureSize(tex, 0));
    
    // We're going to sample a a 4x4 grid of texels surrounding the target UV
    
    // coordinate. We'll do this by rounding down the sample location to get the
    // exact center of our "starting" texel. The starting texel will be at
    // location [1, 1] in the grid, where [0, 0] is the top left corner.
    vec2 samplePos = uv * texSize;
    vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
    
    // Compute the fractional offset from our starting texel to our original
    
    // sample location, which we'll feed into the Catmull-Rom spline function to
    // get our filter weights.
    vec2 f = samplePos - texPos1;
    
    // Compute the Catmull-Rom weights using the fractional offset that we
    
    // calculated earlier. These equations are pre-expanded based on our knowledge
    // of where the texels will be located, which lets us avoid having to evaluate
    // a piece-wise function.
    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    vec2 w3 = f * f * (-0.5 + 0.5 * f);
    
    // Work out weighting factors and sampling offsets that will let us use
    
    // bilinear filtering to simultaneously evaluate the middle 2 samples from the
    // 4x4 grid.
    vec2 w12 = w1 + w2;
    vec2 offset12 = w2 / (w1 + w2);
    
    // Compute the final UV coordinates we'll use for sampling the texture
    
    vec2 texPos0 = texPos1 - 1.0;
    vec2 texPos3 = texPos1 + 2.0;
    vec2 texPos12 = texPos1 + offset12;
    texPos0 /= texSize;
    texPos3 /= texSize;
    texPos12 /= texSize;
    vec4 result = vec4(0.0);
    result += texture(tex, vec2(texPos0.x, texPos0.y)) * w0.x * w0.y;
    result += texture(tex, vec2(texPos12.x, texPos0.y)) * w12.x * w0.y;
    result += texture(tex, vec2(texPos3.x, texPos0.y)) * w3.x * w0.y;
    result += texture(tex, vec2(texPos0.x, texPos12.y)) * w0.x * w12.y;
    result += texture(tex, vec2(texPos12.x, texPos12.y)) * w12.x * w12.y;
    result += texture(tex, vec2(texPos3.x, texPos12.y)) * w3.x * w12.y;
    result += texture(tex, vec2(texPos0.x, texPos3.y)) * w0.x * w3.y;
    result += texture(tex, vec2(texPos12.x, texPos3.y)) * w12.x * w3.y;
    result += texture(tex, vec2(texPos3.x, texPos3.y)) * w3.x * w3.y;
    return result;
}
vec4 textureCatmullRom(sampler2DArray tex, vec3 uv) {
    vec2 texSize = vec2(textureSize(tex, 0));
    vec2 samplePos = uv.xy * texSize;
    vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
    vec2 f = samplePos - texPos1;
    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    vec2 w3 = f * f * (-0.5 + 0.5 * f);
    vec2 w12 = w1 + w2;
    vec2 offset12 = w2 / (w1 + w2);
    vec2 texPos0 = texPos1 - 1.0;
    vec2 texPos3 = texPos1 + 2.0;
    vec2 texPos12 = texPos1 + offset12;
    texPos0 /= texSize;
    texPos3 /= texSize;
    texPos12 /= texSize;
    vec4 result = vec4(0.0);
    result += texture(tex, vec3(texPos0.x, texPos0.y, uv.z)) * w0.x * w0.y;
    result += texture(tex, vec3(texPos12.x, texPos0.y, uv.z)) * w12.x * w0.y;
    result += texture(tex, vec3(texPos3.x, texPos0.y, uv.z)) * w3.x * w0.y;
    result += texture(tex, vec3(texPos0.x, texPos12.y, uv.z)) * w0.x * w12.y;
    result += texture(tex, vec3(texPos12.x, texPos12.y, uv.z)) * w12.x * w12.y;
    result += texture(tex, vec3(texPos3.x, texPos12.y, uv.z)) * w3.x * w12.y;
    result += texture(tex, vec3(texPos0.x, texPos3.y, uv.z)) * w0.x * w3.y;
    result += texture(tex, vec3(texPos12.x, texPos3.y, uv.z)) * w12.x * w3.y;
    result += texture(tex, vec3(texPos3.x, texPos3.y, uv.z)) * w3.x * w3.y;
    return result;
}
#ifdef VARIANCE_9_SAMPLES
    #define VARIANCE_OFFSET_COUNT (8)
    const ivec2 varianceOffsets[8] = ivec2[8](
    ivec2(-1, -1), ivec2(-1, 1), ivec2(1, -1), ivec2(1, 1), ivec2(1, 0), ivec2(0, -1), ivec2(0, 1), ivec2(-1, 0)
    );
#else // VARIANCE_9_SAMPLES
    #define VARIANCE_OFFSET_COUNT (4)
    const ivec2 varianceOffsets[4] = ivec2[4](ivec2(1, 0), ivec2(0, -1), ivec2(0, 1), ivec2(-1, 0));
#endif // VARIANCE_9_SAMPLES

// Reference: https://github.com/playdeadgames/temporal
vec4 clipAABB(const vec4 current, const vec4 history, const vec4 minColor, const vec4 maxColor) {
    // Opacity must be clipped too, otherwise old silhouettes survive RGB clipping.
    vec4 pClip = 0.5 * (maxColor + minColor);
    vec4 eClip = 0.5 * (maxColor - minColor) + 1e-7;
    vec4 vClip = history - pClip;
    vec4 aUnit = abs(vClip / eClip);
    float maUnit = max(max(aUnit.x, aUnit.y), max(aUnit.z, aUnit.w));
    if (maUnit > 1.0) {
        return pClip + vClip / maUnit;
    }
    return history;
}
#ifdef VARIANCE_SAMPLER_ARRAY
    #define VARIANCE_SAMPLER sampler2DArray
    #define VARIANCE_SAMPLER_COORD ivec3
#else // VARIANCE_SAMPLER_ARRAY
    #define VARIANCE_SAMPLER sampler2D
    #define VARIANCE_SAMPLER_COORD ivec2
#endif // VARIANCE_SAMPLER_ARRAY
// Variance clipping
// Reference: https://developer.download.nvidia.com/gameworks/events/GDC2016/msalvi_temporal_supersampling.pdf
vec4 varianceClipping(
const VARIANCE_SAMPLER inputBuffer, const VARIANCE_SAMPLER_COORD coord, const vec4 current, const vec4 history, const float gamma
) {
    vec4 moment1 = current;
    vec4 moment2 = current * current;
    vec4 neighbor;
    #if 0 < VARIANCE_OFFSET_COUNT
        neighbor = texelFetchOffset(inputBuffer, coord, 0, varianceOffsets[0]);
        moment1 += neighbor;
        moment2 += neighbor * neighbor;
    #endif // 0 < VARIANCE_OFFSET_COUNT
    
    #if 1 < VARIANCE_OFFSET_COUNT
        neighbor = texelFetchOffset(inputBuffer, coord, 0, varianceOffsets[1]);
        moment1 += neighbor;
        moment2 += neighbor * neighbor;
    #endif // 1 < VARIANCE_OFFSET_COUNT
    
    #if 2 < VARIANCE_OFFSET_COUNT
        neighbor = texelFetchOffset(inputBuffer, coord, 0, varianceOffsets[2]);
        moment1 += neighbor;
        moment2 += neighbor * neighbor;
    #endif // 2 < VARIANCE_OFFSET_COUNT
    
    #if 3 < VARIANCE_OFFSET_COUNT
        neighbor = texelFetchOffset(inputBuffer, coord, 0, varianceOffsets[3]);
        moment1 += neighbor;
        moment2 += neighbor * neighbor;
    #endif // 3 < VARIANCE_OFFSET_COUNT
    
    #if 4 < VARIANCE_OFFSET_COUNT
        neighbor = texelFetchOffset(inputBuffer, coord, 0, varianceOffsets[4]);
        moment1 += neighbor;
        moment2 += neighbor * neighbor;
    #endif // 4 < VARIANCE_OFFSET_COUNT
    
    #if 5 < VARIANCE_OFFSET_COUNT
        neighbor = texelFetchOffset(inputBuffer, coord, 0, varianceOffsets[5]);
        moment1 += neighbor;
        moment2 += neighbor * neighbor;
    #endif // 5 < VARIANCE_OFFSET_COUNT
    
    #if 6 < VARIANCE_OFFSET_COUNT
        neighbor = texelFetchOffset(inputBuffer, coord, 0, varianceOffsets[6]);
        moment1 += neighbor;
        moment2 += neighbor * neighbor;
    #endif // 6 < VARIANCE_OFFSET_COUNT
    
    #if 7 < VARIANCE_OFFSET_COUNT
        neighbor = texelFetchOffset(inputBuffer, coord, 0, varianceOffsets[7]);
        moment1 += neighbor;
        moment2 += neighbor * neighbor;
    #endif // 7 < VARIANCE_OFFSET_COUNT
    
    
    const float N = float(VARIANCE_OFFSET_COUNT + 1);
    vec4 mean = moment1 / N;
    vec4 varianceGamma = sqrt(max(moment2 / N - mean * mean, 0.0)) * gamma;
    vec4 minColor = mean - varianceGamma;
    vec4 maxColor = mean + varianceGamma;
    return clipAABB(clamp(mean, minColor, maxColor), history, minColor, maxColor);
}
vec4 varianceClipping(
const VARIANCE_SAMPLER inputBuffer, const VARIANCE_SAMPLER_COORD coord, const vec4 current, const vec4 history
) {
    return varianceClipping(inputBuffer, coord, current, history, 1.0);
}
vec4 varianceClipping(
const sampler2D inputBuffer, const vec2 coord, const vec4 current, const vec4 history, const float gamma
) {
    vec4 moment1 = current;
    vec4 moment2 = current * current;
    vec4 neighbor;
    #if 0 < VARIANCE_OFFSET_COUNT
        neighbor = textureOffset(inputBuffer, coord, varianceOffsets[0]);
        moment1 += neighbor;
        moment2 += neighbor * neighbor;
    #endif // 0 < VARIANCE_OFFSET_COUNT
    
    #if 1 < VARIANCE_OFFSET_COUNT
        neighbor = textureOffset(inputBuffer, coord, varianceOffsets[1]);
        moment1 += neighbor;
        moment2 += neighbor * neighbor;
    #endif // 1 < VARIANCE_OFFSET_COUNT
    
    #if 2 < VARIANCE_OFFSET_COUNT
        neighbor = textureOffset(inputBuffer, coord, varianceOffsets[2]);
        moment1 += neighbor;
        moment2 += neighbor * neighbor;
    #endif // 2 < VARIANCE_OFFSET_COUNT
    
    #if 3 < VARIANCE_OFFSET_COUNT
        neighbor = textureOffset(inputBuffer, coord, varianceOffsets[3]);
        moment1 += neighbor;
        moment2 += neighbor * neighbor;
    #endif // 3 < VARIANCE_OFFSET_COUNT
    
    #if 4 < VARIANCE_OFFSET_COUNT
        neighbor = textureOffset(inputBuffer, coord, varianceOffsets[4]);
        moment1 += neighbor;
        moment2 += neighbor * neighbor;
    #endif // 4 < VARIANCE_OFFSET_COUNT
    
    #if 5 < VARIANCE_OFFSET_COUNT
        neighbor = textureOffset(inputBuffer, coord, varianceOffsets[5]);
        moment1 += neighbor;
        moment2 += neighbor * neighbor;
    #endif // 5 < VARIANCE_OFFSET_COUNT
    
    #if 6 < VARIANCE_OFFSET_COUNT
        neighbor = textureOffset(inputBuffer, coord, varianceOffsets[6]);
        moment1 += neighbor;
        moment2 += neighbor * neighbor;
    #endif // 6 < VARIANCE_OFFSET_COUNT
    
    #if 7 < VARIANCE_OFFSET_COUNT
        neighbor = textureOffset(inputBuffer, coord, varianceOffsets[7]);
        moment1 += neighbor;
        moment2 += neighbor * neighbor;
    #endif // 7 < VARIANCE_OFFSET_COUNT
    
    
    const float N = float(VARIANCE_OFFSET_COUNT + 1);
    vec4 mean = moment1 / N;
    vec4 varianceGamma = sqrt(max(moment2 / N - mean * mean, 0.0)) * gamma;
    vec4 minColor = mean - varianceGamma;
    vec4 maxColor = mean + varianceGamma;
    return clipAABB(clamp(mean, minColor, maxColor), history, minColor, maxColor);
}
vec4 varianceClipping(
const sampler2D inputBuffer, const vec2 coord, const vec4 current, const vec4 history
) {
    return varianceClipping(inputBuffer, coord, current, history, 1.0);
}
uniform sampler2D colorBuffer;
uniform sampler2D depthVelocityBuffer;
uniform sampler2D colorHistoryBuffer;
#ifdef SHADOW_LENGTH
    uniform sampler2D shadowLengthBuffer;
    uniform sampler2D shadowLengthHistoryBuffer;
#endif // SHADOW_LENGTH

uniform vec2 texelSize;
uniform int frame;
uniform float varianceGamma;
uniform float temporalAlpha;
uniform float currentFrameAlpha;
uniform float spatialFilterStrength;
uniform bool historyValid;
uniform bool cameraMoving;
uniform int historyFrames;
uniform sampler2D depthHistoryBuffer;
uniform sampler2D sceneDepthBuffer;
uniform vec2 targetUvScale;
uniform vec2 jitterOffset;
in vec2 vUv;
layout(location = 0) out vec4 outputColor;
layout(location = 2) out float outputCloudDepth;
#ifdef SHADOW_LENGTH
    layout(location = 1) out float outputShadowLength;
#endif // SHADOW_LENGTH

const ivec2 neighborOffsets[9] = ivec2[9](
ivec2(-1, -1), ivec2(-1, 0), ivec2(-1, 1), ivec2(0, -1), ivec2(0, 0), ivec2(0, 1), ivec2(1, -1), ivec2(1, 0), ivec2(1, 1)
);
const ivec4[4] bayerIndices = ivec4[4](
ivec4(0, 12, 3, 15), ivec4(8, 4, 11, 7), ivec4(2, 14, 1, 13), ivec4(10, 6, 9, 5)
);
vec2 getUnjitteredUv(ivec2 coord) {
    return (vec2(coord) + 0.5 - jitterOffset) * texelSize / targetUvScale;
}
vec4 getClosestFragment(const vec2 uv) {
    ivec2 size = textureSize(depthVelocityBuffer, 0);
    ivec2 coord = ivec2(uv * vec2(size));
    vec4 result = vec4(0.0);
    for (int i = 0; i < 9; ++i) {
        ivec2 sampleCoord = clamp(coord + neighborOffsets[i], ivec2(0), size - 1);
        vec4 neighbor = texelFetch(depthVelocityBuffer, sampleCoord, 0);
        if (neighbor.r > 0.0 && neighbor.r < 1e7 &&
            (result.r <= 0.0 || neighbor.r < result.r)) {
            result = neighbor;
        }
    }
    return result;
}
vec4 getClosestFragment(const ivec2 coord) {
    return getClosestFragment((vec2(coord) + 0.5) / vec2(textureSize(depthVelocityBuffer, 0)));
}
vec4 reconstructCloud(const vec2 uv, out float centerDepth) {
    ivec2 size = textureSize(colorBuffer, 0);
    ivec2 coord = clamp(ivec2(uv * vec2(size)), ivec2(0), size - 1);
    vec4 center = texelFetch(colorBuffer, coord, 0);
    centerDepth = texelFetch(depthVelocityBuffer, coord, 0).r;
    if (!(centerDepth > 0.0 && centerDepth < 1e7)) return texture(colorBuffer, uv);
    vec4 current = texture(colorBuffer, uv);
    if (spatialFilterStrength <= 0.0 || center.a < 0.01) return current;
    float distanceWeight = smoothstep(5000.0, 25000.0, centerDepth);
    vec4 sum = current * 2.0;
    float weightSum = 2.0;
    for (int i = 0; i < 9; ++i) {
        ivec2 offset = neighborOffsets[i];
        if (all(equal(offset, ivec2(0)))) continue;
        bool diagonal = offset.x != 0 && offset.y != 0;
        if (diagonal && distanceWeight <= 0.0) continue;
        ivec2 sampleCoord = clamp(coord + offset, ivec2(0), size - 1);
        float depth = texelFetch(depthVelocityBuffer, sampleCoord, 0).r;
        if (!(depth > 0.0 && depth < 1e7)) continue;
        vec4 neighbor = texelFetch(colorBuffer, sampleCoord, 0);
        float depthDelta = abs(depth - centerDepth) / max(centerDepth, 1.0);
        float alphaDelta = abs(neighbor.a - center.a);
        float weight = (1.0 - smoothstep(0.02, 0.1, depthDelta)) *
            (1.0 - smoothstep(0.05, 0.2, alphaDelta));
        weight *= diagonal ? 0.5 * distanceWeight : 1.0;
        sum += neighbor * weight;
        weightSum += weight;
    }
    float strength = mix(spatialFilterStrength, max(spatialFilterStrength, 0.9), distanceWeight) *
        smoothstep(0.01, 0.1, center.a);
    return mix(current, sum / weightSum, strength);
}
// Resolve terrain silhouettes with full-resolution depth, never interpolate sky across a ridge.
float terrainDistance(vec2 uv) {
    float depth = czm_unpackDepth(texture(sceneDepthBuffer, uv));
    if (depth >= 1.0 - 1e-7) return 1e10;
    vec4 eye = czm_windowToEyeCoordinates(uv / texelSize, depth);
    return length(eye.xyz / eye.w);
}
float getHistoryCloudDepth(vec2 uv) {
    ivec2 size = textureSize(depthHistoryBuffer, 0);
    ivec2 coord = clamp(ivec2(uv * vec2(size)), ivec2(0), size - 1);
    return texelFetch(depthHistoryBuffer, coord, 0).r;
}
bool validCloudDepth(float depth) {
    return depth > 0.0 && depth < 1e7;
}
float blendCloudDepth(float currentDepth, float historyDepth, vec4 current, vec4 history, float alpha) {
    // Invalid depth is missing metadata, not a cloud at the camera. Weight by retained opacity.
    float currentWeight = validCloudDepth(currentDepth) ? current.a * alpha : 0.0;
    float historyWeight = validCloudDepth(historyDepth) ? history.a * (1.0 - alpha) : 0.0;
    float total = currentWeight + historyWeight;
    float currentDistance = currentWeight > 0.0 ? currentDepth * currentWeight : 0.0;
    float historyDistance = historyWeight > 0.0 ? historyDepth * historyWeight : 0.0;
    return total > 1e-5 ? (currentDistance + historyDistance) / total : 0.0;
}
bool resolveTerrainBoundary(vec2 uv, inout vec4 color, inout float cloudDepth, out float targetDepth) {
    ivec2 size = textureSize(colorBuffer, 0);
    ivec2 center = clamp(ivec2(uv * vec2(size)), ivec2(0), size - 1);
    targetDepth = terrainDistance(vUv);
    vec4 sum = vec4(0.0);
    float total = 0.0;
    float nearestCloud = 1e10;
    bool boundary = false;
    for (int i = 0; i < 9; ++i) {
        ivec2 coord = clamp(center + neighborOffsets[i], ivec2(0), size - 1);
        vec2 sampleUv = (vec2(coord) + 0.5) / vec2(size) * targetUvScale + jitterOffset * texelSize;
        float sampleDepth = terrainDistance(sampleUv);
        float depth = texelFetch(depthVelocityBuffer, coord, 0).r;
        bool foregroundCloud = depth > 0.0 && depth < 1e7 && depth < min(sampleDepth, targetDepth);
        bool differentSurface = (sampleDepth > 1e9) != (targetDepth > 1e9);
        float delta = abs(sampleDepth - targetDepth) / max(targetDepth, 1.0);
        bool occluded = depth > targetDepth + max(20.0, targetDepth * 0.002);
        boundary = boundary || (!foregroundCloud && (differentSurface || occluded));
        float weight = foregroundCloud ? 1.0 : (1.0 - smoothstep(0.02, 0.05, delta));
        vec2 offset = (sampleUv - vUv) / (texelSize * 4.0);
        weight *= exp(-dot(offset, offset) * 2.0);
        if (occluded) weight = 0.0;
        sum += texelFetch(colorBuffer, coord, 0) * weight;
        total += weight;
        if (weight > 0.01 && depth > 0.0) nearestCloud = min(nearestCloud, depth);
    }
    if (boundary) {
        color = total > 1e-5 ? sum / total : vec4(0.0);
        cloudDepth = nearestCloud;
    }
    return boundary;
}
void temporalUpscale(
const ivec2 coord, const bool currentFrame, out vec4 outputColor, out float outputShadowLength
) {
    vec2 unjitteredUv = getUnjitteredUv(coord);
    float centerDepth;
    vec4 currentColor = reconstructCloud(unjitteredUv, centerDepth);
    float targetDepth;
    bool terrainBoundary = resolveTerrainBoundary(unjitteredUv, currentColor, centerDepth, targetDepth);
    outputColor = currentColor;
    outputCloudDepth = validCloudDepth(centerDepth) && currentColor.a > 1e-5 ? centerDepth : 0.0;
    #ifdef SHADOW_LENGTH
        vec4 currentShadowLength = vec4(texture(shadowLengthBuffer, unjitteredUv).rgb, 1.0);
        outputShadowLength = currentShadowLength.r;
    #endif // SHADOW_LENGTH
    if (!historyValid) return;
    ivec2 lowSize = textureSize(depthVelocityBuffer, 0);
    ivec2 lowCoord = clamp(ivec2(unjitteredUv * vec2(lowSize)), ivec2(0), lowSize - 1);
    vec4 depthVelocity = texelFetch(depthVelocityBuffer, lowCoord, 0);
    float visibleDepthLimit = targetDepth - max(20.0, targetDepth * 0.002);
    // Missing a Bayer phase is not an occlusion if the historical cloud is still in front of terrain.
    if (!(centerDepth > 0.0 && centerDepth < 1e7) || !(depthVelocity.r > 0.0 && depthVelocity.r < 1e7)) {
        if (!cameraMoving) {
            float historyDepth = getHistoryCloudDepth(vUv);
            bool visibleHistory = historyDepth > 0.0 && historyDepth < min(1e7, visibleDepthLimit);
            // Terrain tiles may change while the camera is still, beyond the boundary neighborhood.
            if (validCloudDepth(historyDepth) && !visibleHistory) return;
            if (!terrainBoundary || visibleHistory) {
                vec4 history = texture(colorHistoryBuffer, vUv);
                if (any(isnan(history)) || any(isinf(history))) return;
                // A terrain-blocked Bayer sample contains no new information about visible sky.
                if (terrainBoundary && visibleHistory && currentColor.a <= 1e-5) {
                    outputColor = history;
                    outputCloudDepth = history.a > 1e-5 ? historyDepth : 0.0;
                    return;
                }
                float distanceWeight = visibleHistory ? smoothstep(20000.0, 60000.0, historyDepth) : 0.0;
                float distantAlpha = (currentFrame ? currentFrameAlpha : temporalAlpha) * 0.35;
                float alpha = mix(max(temporalAlpha, 0.08), distantAlpha, distanceWeight);
                alpha = max(alpha, 1.0 / float(historyFrames + 1));
                outputColor = mix(history, currentColor, alpha);
                outputCloudDepth = blendCloudDepth(centerDepth, historyDepth, currentColor, history, alpha);
            }
        }
        return;
    }
    
    // Use the same cloud sample for color, motion and depth. Nearest-depth
    // dilation can borrow another cloud's velocity during camera translation.
    vec2 velocity = depthVelocity.gb * texelSize;
    vec2 prevUv = vUv - velocity;
    if (any(isnan(prevUv)) || any(isinf(prevUv)) ||
        any(lessThan(prevUv, texelSize * 0.5)) ||
        any(greaterThan(prevUv, vec2(1.0) - texelSize * 0.5))) return;
    vec4 historyColor = texture(colorHistoryBuffer, prevUv);
    if (any(isnan(historyColor)) || any(isinf(historyColor))) return;
    float historyDepth = getHistoryCloudDepth(prevUv);
    bool visibleHistory = historyDepth > 0.0 && historyDepth < min(1e7, visibleDepthLimit);
    if (!cameraMoving && !visibleHistory && (terrainBoundary || validCloudDepth(historyDepth))) return;
    vec4 clippedColor = varianceClipping(colorBuffer, unjitteredUv, currentColor, historyColor, varianceGamma);
    // Stationary distant silhouettes must survive missing Bayer phases, not be clipped to empty sky.
    float stationaryHistoryWeight = cameraMoving || (terrainBoundary && !visibleHistory) ? 0.0 : smoothstep(20000.0, 60000.0, centerDepth);
    // The variance neighborhood includes terrain-clipped samples; they cannot bound sky history.
    if (!cameraMoving && terrainBoundary && visibleHistory) stationaryHistoryWeight = 1.0;
    clippedColor = mix(clippedColor, historyColor, stationaryHistoryWeight);
    float alpha = currentFrame ? currentFrameAlpha : temporalAlpha;
    // Distant subpixel clouds need longer accumulation; motion rejection below
    // still replaces history quickly while the camera moves.
    alpha *= mix(1.0, 0.35, smoothstep(5000.0, 25000.0, centerDepth));
    // Preserve accumulation at ridges; replacing it every frame exposes Bayer jitter.
    if (terrainBoundary) alpha = max(alpha, cameraMoving ? 0.4 : temporalAlpha);
    alpha = max(alpha, 1.0 / float(historyFrames + 1));
    // Opacity noise alone must not discard history while the camera is still.
    float motionRejection = smoothstep(0.5, 8.0, length(depthVelocity.gb));
    float depthDifference = abs(historyDepth - depthVelocity.a) / max(depthVelocity.a, 100.0);
    float depthRejection = smoothstep(0.04, 0.15, depthDifference);
    float opacityRejection = smoothstep(0.05, 0.25, abs(historyColor.a - currentColor.a));
    alpha = max(alpha, depthRejection * opacityRejection * motionRejection);
    // Retain valid reprojected samples while moving instead of exposing raw noise.
    alpha = max(alpha, 0.12 * motionRejection);
    if (currentColor.a < 0.01) alpha = max(alpha, motionRejection);
    outputColor = mix(clippedColor, currentColor, alpha);
    // Moving history is in the previous camera's distance space; use current metadata until still.
    if (!cameraMoving) outputCloudDepth = blendCloudDepth(centerDepth, historyDepth, currentColor, clippedColor, alpha);
    #ifdef DEBUG_SHOW_VELOCITY
        outputColor.rgb = outputColor.rgb + vec3(abs(velocity), 0.0);
    #endif // DEBUG_SHOW_VELOCITY
    
    #ifdef SHADOW_LENGTH
        vec4 historyShadowLength = vec4(texture(shadowLengthHistoryBuffer, prevUv).r, 0.0, 0.0, 1.0);
        vec4 clippedShadowLength = varianceClipping(
        shadowLengthBuffer, unjitteredUv, currentShadowLength, historyShadowLength, varianceGamma
        );
        outputShadowLength = mix(clippedShadowLength.r, currentShadowLength.r, max(alpha, 0.25));
    #endif // SHADOW_LENGTH
}
void temporalAntialiasing(const ivec2 coord, out vec4 outputColor, out float outputShadowLength) {
    vec4 currentColor = texelFetch(colorBuffer, coord, 0);
    float currentDepth = texelFetch(depthVelocityBuffer, coord, 0).r;
    outputCloudDepth = validCloudDepth(currentDepth) && currentColor.a > 1e-5 ? currentDepth : 0.0;
    #ifdef SHADOW_LENGTH
        vec4 currentShadowLength = vec4(texelFetch(shadowLengthBuffer, coord, 0).rgb, 1.0);
    #endif // SHADOW_LENGTH
    
    vec4 depthVelocity = getClosestFragment(coord);
    vec2 velocity = depthVelocity.gb * texelSize;
    vec2 prevUv = vUv - velocity;
    if (prevUv.x < 0.0 || prevUv.x > 1.0 || prevUv.y < 0.0 || prevUv.y > 1.0) {
        outputColor = currentColor;
        #ifdef SHADOW_LENGTH
            outputShadowLength = currentShadowLength.r;
        #endif // SHADOW_LENGTH
        return; // Rejection
    }
    vec4 historyColor = texture(colorHistoryBuffer, prevUv);
    vec4 clippedColor = varianceClipping(colorBuffer, coord, currentColor, historyColor);
    outputColor = mix(clippedColor, currentColor, temporalAlpha);
    #ifdef DEBUG_SHOW_VELOCITY
        outputColor.rgb = outputColor.rgb + vec3(abs(velocity), 0.0);
    #endif // DEBUG_SHOW_VELOCITY
    
    #ifdef SHADOW_LENGTH
        vec4 historyShadowLength = vec4(texture(shadowLengthHistoryBuffer, prevUv).r, 0.0, 0.0, 1.0);
        vec4 clippedShadowLength = varianceClipping(
        shadowLengthBuffer, coord, currentShadowLength, historyShadowLength
        );
        outputShadowLength = mix(clippedShadowLength.r, currentShadowLength.r, temporalAlpha);
    #endif // SHADOW_LENGTH
}
void main() {
    ivec2 coord = ivec2(gl_FragCoord.xy);
    outputCloudDepth = 0.0;
    #if !defined(SHADOW_LENGTH)
        float outputShadowLength;
    #endif // !defined(SHADOW_LENGTH)
    
    #ifdef TEMPORAL_UPSCALE
        int bayerValue = bayerIndices[coord.x % 4][coord.y % 4];
        bool currentFrame = bayerValue == frame % 16;
        temporalUpscale(coord, currentFrame, outputColor, outputShadowLength);
    #else // TEMPORAL_UPSCALE
        temporalAntialiasing(coord, outputColor, outputShadowLength);
    #endif // TEMPORAL_UPSCALE
    
    #if defined(SHADOW_LENGTH) && defined(DEBUG_SHOW_SHADOW_LENGTH)
        outputColor = vec4(turbo(outputShadowLength * 0.05), 1.0);
    #endif // defined(SHADOW_LENGTH) && defined(DEBUG_SHOW_SHADOW_LENGTH)
}
