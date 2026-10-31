#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
in vec3 vFogCamera;
in vec3 vFogRay;
layout(location = 0) out vec4 outputBefore;
layout(location = 1) out vec4 outputAfter;
layout(location = 2) out vec4 outputDepth;

uniform sampler2D u_volumetricLightCurrentBefore;
uniform sampler2D u_volumetricLightCurrentAfter;
uniform sampler2D u_volumetricLightCurrentDepth;
uniform sampler2D u_volumetricLightHistoryBefore;
uniform sampler2D u_volumetricLightHistoryAfter;
uniform sampler2D u_volumetricLightHistoryDepth;
uniform mat4 u_volumetricLightPreviousViewProjection;
uniform mat4 u_volumetricLightEllipsoid;
uniform vec3 u_volumetricLightCenter;
uniform vec3 u_volumetricLightPreviousCamera;
uniform vec2 u_volumetricLightTexelSize;
uniform float u_volumetricLightMaxDistance;
uniform float u_volumetricLightTemporalAlpha;
uniform bool u_volumetricLightHistoryValid;

float fogLuminance(vec3 value) {
    return dot(value, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
    vec4 currentBefore = texture(u_volumetricLightCurrentBefore, vUv);
    vec4 currentAfter = texture(u_volumetricLightCurrentAfter, vUv);
    vec4 currentDepth = texture(u_volumetricLightCurrentDepth, vUv);
    outputBefore = currentBefore;
    outputAfter = currentAfter;
    outputDepth = currentDepth;
    if (!u_volumetricLightHistoryValid || currentDepth.x <= 0.0) return;

    vec3 ray = normalize(vFogRay);
    vec3 world = mat3(u_volumetricLightEllipsoid) * (vFogCamera + ray * currentDepth.x + u_volumetricLightCenter);
    vec4 previousClip = u_volumetricLightPreviousViewProjection * vec4(world, 1.0);
    if (previousClip.w <= 0.0) return;
    vec2 previousUv = previousClip.xy / previousClip.w * 0.5 + 0.5;
    vec2 margin = u_volumetricLightTexelSize * 0.5;
    if (any(lessThan(previousUv, margin)) || any(greaterThan(previousUv, 1.0 - margin))) return;
    vec4 previousDepth = texture(u_volumetricLightHistoryDepth, previousUv);
    float expectedDistance = length(world - u_volumetricLightPreviousCamera);
    if (previousDepth.x <= 0.0 || abs(previousDepth.x - expectedDistance) > max(80.0, expectedDistance * 0.06)) return;

    // Reject newly revealed terrain and cloud silhouettes before filtering any
    // history. Neither cloud reprojection nor cloud opacity is used as fog history.
    bool currentSky = currentDepth.y >= u_volumetricLightMaxDistance;
    bool previousSky = previousDepth.y >= u_volumetricLightMaxDistance;
    if (currentSky != previousSky) return;
    if (!currentSky && abs(currentDepth.y - previousDepth.y) > max(60.0, currentDepth.y * 0.025)) return;
    bool currentCloud = currentDepth.w > 0.001;
    bool previousCloud = previousDepth.w > 0.001;
    if (currentCloud != previousCloud || abs(currentDepth.w - previousDepth.w) > 0.12) return;
    if (currentCloud && abs(currentDepth.z - previousDepth.z) > max(80.0, currentDepth.z * 0.025)) return;

    vec4 minimumBefore = currentBefore;
    vec4 maximumBefore = currentBefore;
    vec4 minimumAfter = currentAfter;
    vec4 maximumAfter = currentAfter;
    for (int y = -1; y <= 1; ++y) {
        for (int x = -1; x <= 1; ++x) {
            vec2 uv = clamp(vUv + vec2(x, y) * u_volumetricLightTexelSize, margin, 1.0 - margin);
            vec4 neighborDepth = texture(u_volumetricLightCurrentDepth, uv);
            if (abs(neighborDepth.y - currentDepth.y) > max(60.0, currentDepth.y * 0.025)) continue;
            if (abs(neighborDepth.z - currentDepth.z) > max(80.0, currentDepth.z * 0.025)) continue;
            vec4 before = texture(u_volumetricLightCurrentBefore, uv);
            vec4 after = texture(u_volumetricLightCurrentAfter, uv);
            minimumBefore = min(minimumBefore, before);
            maximumBefore = max(maximumBefore, before);
            minimumAfter = min(minimumAfter, after);
            maximumAfter = max(maximumAfter, after);
        }
    }
    vec4 historyBefore = texture(u_volumetricLightHistoryBefore, previousUv);
    vec4 historyAfter = texture(u_volumetricLightHistoryAfter, previousUv);
    float currentLuminance = fogLuminance(currentBefore.rgb + currentAfter.rgb);
    float previousLuminance = fogLuminance(historyBefore.rgb + historyAfter.rgb);
    // Moving cloud shadows can change while geometry stays fixed; discard their
    // old radiance instead of leaving bright/dark trails behind the light shafts.
    if (abs(currentLuminance - previousLuminance) > max(0.002, currentLuminance * 0.45)) return;
    historyBefore = clamp(historyBefore, minimumBefore, maximumBefore);
    historyAfter = clamp(historyAfter, minimumAfter, maximumAfter);
    outputBefore = mix(historyBefore, currentBefore, u_volumetricLightTemporalAlpha);
    outputAfter = mix(historyAfter, currentAfter, u_volumetricLightTemporalAlpha);
}
