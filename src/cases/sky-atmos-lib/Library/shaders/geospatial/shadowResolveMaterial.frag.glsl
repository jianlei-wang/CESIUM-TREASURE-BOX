
#version 300 es
#define SHADER_TYPE RawShaderMaterial
#define SHADER_NAME ShadowResolveMaterial
#define CASCADE_COUNT 3
#define FRAMEBUFFER_PRECISION_HIGH 1
precision highp float;
precision highp sampler2DArray;
#define VARIANCE_9_SAMPLES (1)
#define VARIANCE_SAMPLER_ARRAY (1)

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
    vec3 pClip = 0.5 * (maxColor.rgb + minColor.rgb);
    vec3 eClip = 0.5 * (maxColor.rgb - minColor.rgb) + 1e-7;
    vec4 vClip = history - vec4(pClip, current.a);
    vec3 vUnit = vClip.xyz / eClip;
    vec3 aUnit = abs(vUnit);
    float maUnit = max(aUnit.x, max(aUnit.y, aUnit.z));
    if (maUnit > 1.0) {
        return vec4(pClip, current.a) + vClip / maUnit;
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
uniform sampler2DArray inputBuffer;
uniform sampler2DArray historyBuffer;
uniform vec2 texelSize;
uniform float varianceGamma;
uniform float temporalAlpha;
uniform bool historyValid;
in vec2 vUv;
layout(location = 0) out vec4 outputColor[CASCADE_COUNT];
const ivec2 neighborOffsets[9] = ivec2[9](
ivec2(-1, -1), ivec2(-1, 0), ivec2(-1, 1), ivec2(0, -1), ivec2(0, 0), ivec2(0, 1), ivec2(1, -1), ivec2(1, 0), ivec2(1, 1)
);
vec4 getClosestFragment(const ivec3 coord) {
    vec4 result = vec4(1e7, 0.0, 0.0, 0.0);
    vec4 neighbor;
    neighbor = texelFetchOffset(
    inputBuffer, coord + ivec3(0, 0, CASCADE_COUNT), 0, neighborOffsets[0]
    );
    if (neighbor.r < result.r) {
        result = neighbor;
    }
    neighbor = texelFetchOffset(
    inputBuffer, coord + ivec3(0, 0, CASCADE_COUNT), 0, neighborOffsets[1]
    );
    if (neighbor.r < result.r) {
        result = neighbor;
    }
    neighbor = texelFetchOffset(
    inputBuffer, coord + ivec3(0, 0, CASCADE_COUNT), 0, neighborOffsets[2]
    );
    if (neighbor.r < result.r) {
        result = neighbor;
    }
    neighbor = texelFetchOffset(
    inputBuffer, coord + ivec3(0, 0, CASCADE_COUNT), 0, neighborOffsets[3]
    );
    if (neighbor.r < result.r) {
        result = neighbor;
    }
    neighbor = texelFetchOffset(
    inputBuffer, coord + ivec3(0, 0, CASCADE_COUNT), 0, neighborOffsets[4]
    );
    if (neighbor.r < result.r) {
        result = neighbor;
    }
    neighbor = texelFetchOffset(
    inputBuffer, coord + ivec3(0, 0, CASCADE_COUNT), 0, neighborOffsets[5]
    );
    if (neighbor.r < result.r) {
        result = neighbor;
    }
    neighbor = texelFetchOffset(
    inputBuffer, coord + ivec3(0, 0, CASCADE_COUNT), 0, neighborOffsets[6]
    );
    if (neighbor.r < result.r) {
        result = neighbor;
    }
    neighbor = texelFetchOffset(
    inputBuffer, coord + ivec3(0, 0, CASCADE_COUNT), 0, neighborOffsets[7]
    );
    if (neighbor.r < result.r) {
        result = neighbor;
    }
    neighbor = texelFetchOffset(
    inputBuffer, coord + ivec3(0, 0, CASCADE_COUNT), 0, neighborOffsets[8]
    );
    if (neighbor.r < result.r) {
        result = neighbor;
    }
    return result;
}
void cascade(const int cascadeIndex, out vec4 outputColor) {
    ivec3 coord = ivec3(gl_FragCoord.xy, cascadeIndex);
    vec4 current = texelFetch(inputBuffer, coord, 0);
    if (!historyValid) {
        outputColor = current;
        return;
    }
    vec4 depthVelocity = getClosestFragment(coord);
    vec2 velocity = depthVelocity.gb * texelSize;
    vec2 prevUv = vUv - velocity;
    if (prevUv.x < 0.0 || prevUv.x > 1.0 || prevUv.y < 0.0 || prevUv.y > 1.0) {
        outputColor = current;
        return; // Rejection
    }
    vec4 history = texture(historyBuffer, vec3(prevUv, float(cascadeIndex)));
    vec4 clippedHistory = varianceClipping(inputBuffer, coord, current, history, varianceGamma);
    outputColor = mix(clippedHistory, current, temporalAlpha);
}
void main() {
    #if 0 < CASCADE_COUNT
        cascade(0, outputColor[0]);
    #endif // 0 < CASCADE_COUNT
    
    #if 1 < CASCADE_COUNT
        cascade(1, outputColor[1]);
    #endif // 1 < CASCADE_COUNT
    
    #if 2 < CASCADE_COUNT
        cascade(2, outputColor[2]);
    #endif // 2 < CASCADE_COUNT
    
    #if 3 < CASCADE_COUNT
        cascade(3, outputColor[3]);
    #endif // 3 < CASCADE_COUNT
}
