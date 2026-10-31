#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
in vec3 vFogCamera;
in vec3 vFogRay;
layout(location = 0) out vec4 outputBefore;
layout(location = 1) out vec4 outputAfter;
// x: radiance centroid, y: terrain distance, z: cloud front distance, w: cloud opacity.
layout(location = 2) out vec4 outputDepth;

uniform sampler2D u_volumetricLightSceneDepth;
uniform sampler2D u_volumetricLightCloudDepth;
uniform sampler2D u_volumetricLightCloudColor;
uniform float u_volumetricLightCloudVisibility;
uniform sampler2D u_volumetricLightAtmosphereTransmittance;
uniform float u_volumetricLightBottomRadius;
uniform float u_volumetricLightTopRadius;
uniform float u_volumetricLightLayerBottom;
uniform float u_volumetricLightLayerTop;
uniform float u_volumetricLightDensity;
uniform float u_volumetricLightIntensity;
uniform float u_volumetricLightMaxDistance;
uniform float u_volumetricLightAnisotropy;
uniform float u_volumetricLightSunAngularRadius;
uniform vec3 u_volumetricLightSolarIrradiance;
uniform vec3 u_volumetricLightSunRadianceToRelativeLuminance;
uniform vec3 u_volumetricLightSunDirection;
uniform int u_volumetricLightStepCount;
uniform int u_volumetricLightFrame;
uniform vec2 u_volumetricLightTexelSize;

/*__VOLUMETRIC_LIGHT_SUNLIGHT__*/

const float FOG_PI = 3.141592653589793;

vec2 fogSphereInterval(vec3 origin, vec3 direction, float radius) {
    float b = dot(origin, direction);
    float originRadius = length(origin);
    float discriminant = b * b - (originRadius - radius) * (originRadius + radius);
    if (discriminant < 0.0) return vec2(-1.0);
    float root = sqrt(max(discriminant, 0.0));
    return vec2(-b - root, -b + root);
}

float fogSceneDistance(vec2 uv) {
    float depth = czm_unpackDepth(texture(u_volumetricLightSceneDepth, uv));
    if (depth >= 1.0 - 1e-7) return u_volumetricLightMaxDistance + 1.0;
    // This helper decodes Cesium logarithmic depth using the full-resolution viewport.
    vec4 eye = czm_windowToEyeCoordinates(uv * czm_viewport.zw, depth);
    return min(length(eye.xyz / eye.w), u_volumetricLightMaxDistance + 1.0);
}

// Bruneton's transmittance-LUT coordinates, in metres. Only the solar term is
// needed by this independent single-scattering medium (no sky fill or floor).
// Original algorithm: https://github.com/ebruneton/precomputed_atmospheric_scattering
vec3 fogSolarIrradiance(vec3 point) {
    float r = clamp(length(point), u_volumetricLightBottomRadius, u_volumetricLightTopRadius);
    float mu = clamp(dot(normalize(point), u_volumetricLightSunDirection), -1.0, 1.0);
    float bottom = u_volumetricLightBottomRadius;
    float top = u_volumetricLightTopRadius;
    float h = sqrt(max(top * top - bottom * bottom, 0.0));
    float rho = sqrt(max(r * r - bottom * bottom, 0.0));
    float distanceToTop = max(-r * mu + sqrt(max(r * r * (mu * mu - 1.0) + top * top, 0.0)), 0.0);
    float minimumDistance = top - r;
    vec2 unitUv = vec2((distanceToTop - minimumDistance) / max(rho + h - minimumDistance, 1.0), rho / max(h, 1.0));
    vec2 lutSize = vec2(textureSize(u_volumetricLightAtmosphereTransmittance, 0));
    vec2 uv = 0.5 / lutSize + clamp(unitUv, 0.0, 1.0) * (1.0 - 1.0 / lutSize);
    float horizonMu = -sqrt(max(1.0 - (bottom * bottom) / (r * r), 0.0));
    float sunDisk = smoothstep(horizonMu - u_volumetricLightSunAngularRadius,
        horizonMu + u_volumetricLightSunAngularRadius, mu);
    return u_volumetricLightSolarIrradiance * texture(u_volumetricLightAtmosphereTransmittance, uv).rgb
        * u_volumetricLightSunRadianceToRelativeLuminance * sunDisk;
}

void accumulateFog(inout vec4 integral, float extinction, float lengthInStep, vec3 incidentLight) {
    float transmittance = exp(-extinction * max(lengthInStep, 0.0));
    integral.rgb += integral.a * (1.0 - transmittance) * incidentLight;
    integral.a *= transmittance;
}

void main() {
    outputBefore = vec4(0.0, 0.0, 0.0, 1.0);
    outputAfter = outputBefore;
    float terrainDistance = fogSceneDistance(vUv);
    vec4 cloud = texture(u_volumetricLightCloudColor, vUv);
    cloud.a *= u_volumetricLightCloudVisibility;
    float cloudDistance = texture(u_volumetricLightCloudDepth, vUv).r;
    bool hasCloud = cloud.a > 0.001 && cloudDistance > 0.0;
    float splitDistance = hasCloud ? cloudDistance : u_volumetricLightMaxDistance + 1.0;
    outputDepth = vec4(0.0, terrainDistance, splitDistance, hasCloud ? cloud.a : 0.0);
    if (u_volumetricLightDensity <= 0.0 || u_volumetricLightLayerTop <= u_volumetricLightLayerBottom) return;

    vec3 ray = normalize(vFogRay);
    vec2 outer = fogSphereInterval(vFogCamera, ray, u_volumetricLightBottomRadius + u_volumetricLightLayerTop);
    float rayStart = max(outer.x, 0.0);
    float rayEnd = min(outer.y, min(terrainDistance, u_volumetricLightMaxDistance));
    // The solid planet also clips the ray when terrain depth is unavailable.
    vec2 ground = fogSphereInterval(vFogCamera, ray, u_volumetricLightBottomRadius);
    if (ground.x > 0.0) rayEnd = min(rayEnd, ground.x);
    if (outer.y <= 0.0 || rayEnd <= rayStart) return;
    if (cloud.a >= 0.999 && cloudDistance <= rayStart) {
        // Skip fully hidden fog only in opaque-cloud interiors. Keep tracing near
        // cloud edges so the upsampler can recover fog in adjacent clear pixels.
        float neighborOpacity = 1.0;
        for (int y = -1; y <= 1; y += 2) {
            for (int x = -1; x <= 1; x += 2) {
                neighborOpacity = min(neighborOpacity, texture(u_volumetricLightCloudColor,
                    clamp(vUv + vec2(x, y) * u_volumetricLightTexelSize, 0.0, 1.0)).a * u_volumetricLightCloudVisibility);
            }
        }
        if (neighborOpacity >= 0.999) {
            outputDepth.x = -1.0; // Hidden, untraced fog must not guide clear-sky neighbors.
            return;
        }
    }

    vec2 inner = fogSphereInterval(vFogCamera, ray, u_volumetricLightBottomRadius + u_volumetricLightLayerBottom);
    vec2 first = vec2(rayStart, rayEnd);
    vec2 second = vec2(rayEnd);
    if (inner.y > rayStart && inner.x < rayEnd && inner.y > inner.x) {
        first.y = clamp(inner.x, rayStart, rayEnd);
        second = vec2(clamp(inner.y, rayStart, rayEnd), rayEnd);
    }
    float firstLength = max(first.y - first.x, 0.0);
    float totalLength = firstLength + max(second.y - second.x, 0.0);
    if (totalLength <= 0.0) return;

    float g = u_volumetricLightAnisotropy;
    float mu = dot(ray, u_volumetricLightSunDirection);
    float phase = (1.0 - g * g) / (4.0 * FOG_PI * pow(max(1.0 + g * g - 2.0 * g * mu, 1e-3), 1.5));
    float stepLength = totalLength / float(u_volumetricLightStepCount);
    // Every pixel traces the whole envelope each frame, with an independent scalar
    // jitter. Cloud Bayer phases never decide whether this medium exists.
    float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + float(u_volumetricLightFrame) * 0.754877666) * 43758.5453);
    float centroidDistanceSum = 0.0;
    float centroidWeight = 0.0;
    for (int i = 0; i < 64; ++i) {
        if (i >= u_volumetricLightStepCount) break;
        float packedStart = float(i) * stepLength;
        float packedEnd = packedStart + stepLength;
        // A sample straddling the inner shell is split so that no step bridges
        // the inactive space between the two valid shell intervals.
        for (int part = 0; part < 2; ++part) {
            float segmentStart = part == 0 ? max(packedStart, 0.0) : max(packedStart, firstLength);
            float segmentEnd = part == 0 ? min(packedEnd, firstLength) : min(packedEnd, totalLength);
            if (segmentEnd <= segmentStart) continue;
            float offset = part == 0 ? first.x : second.x - firstLength;
            float distanceStart = offset + segmentStart;
            float distanceEnd = offset + segmentEnd;
            float sampleDistance = mix(distanceStart, distanceEnd, 0.25 + 0.5 * jitter);
            vec3 point = vFogCamera + ray * sampleDistance;
            float height = length(point) - u_volumetricLightBottomRadius;
            // Keep the lower part sparse so nearby air does not wash out the
            // cloud-gap shadows carried by the denser medium near cloud base.
            float fadeWidth = max((u_volumetricLightLayerTop - u_volumetricLightLayerBottom) * 0.65, 1.0);
            float envelope = smoothstep(u_volumetricLightLayerBottom, u_volumetricLightLayerBottom + fadeWidth, height);
            // No weather, cloud coverage, or local cloud density gates this medium.
            // Taper the local medium before its range boundary without shortening
            // the integration intervals or leaving a visible distant fog wall.
            float distanceFade = 1.0 - smoothstep(u_volumetricLightMaxDistance * 0.65,
                u_volumetricLightMaxDistance, sampleDistance);
            float extinction = u_volumetricLightDensity * envelope * distanceFade;
            vec3 incident = fogSolarIrradiance(point) * sampleVolumetricLightSunlight(point)
                * phase * u_volumetricLightIntensity;
            float weight = (outputBefore.a * outputAfter.a) * (1.0 - exp(-extinction * (distanceEnd - distanceStart)))
                * max(dot(incident, vec3(0.2126, 0.7152, 0.0722)), 1e-8);
            centroidDistanceSum += sampleDistance * weight;
            centroidWeight += weight;
            accumulateFog(outputBefore, extinction, max(min(distanceEnd, splitDistance) - distanceStart, 0.0), incident);
            accumulateFog(outputAfter, extinction, max(distanceEnd - max(distanceStart, splitDistance), 0.0), incident);
        }
    }
    outputDepth.x = centroidWeight > 0.0 ? centroidDistanceSum / centroidWeight : 0.0;
}
