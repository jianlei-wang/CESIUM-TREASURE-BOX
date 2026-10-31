uniform sampler2D u_volumetricLightBefore;
uniform sampler2D u_volumetricLightAfter;
uniform sampler2D u_volumetricLightDepth;
uniform sampler2D u_volumetricLightSceneDepth;
uniform sampler2D u_volumetricLightCloudDepth;
uniform bool u_volumetricLightEnabled;
uniform float u_volumetricLightMaxDistance;
uniform mat4 u_volumetricLightInverseProjection;
uniform mat4 u_volumetricLightInverseView;
uniform mat4 u_volumetricLightInverseEllipsoid;
uniform vec3 u_volumetricLightCamera;
uniform vec3 u_volumetricLightCenter;
uniform float u_volumetricLightBottomRadius;
uniform float u_volumetricLightLayerBottom;
uniform float u_volumetricLightLayerTop;

float volumetricLightCompositeSceneDistance(vec2 uv) {
    float depth = czm_unpackDepth(texture(u_volumetricLightSceneDepth, uv));
    if (depth >= 1.0 - 1e-7) return u_volumetricLightMaxDistance + 1.0;
    vec4 eye = czm_windowToEyeCoordinates(uv * czm_viewport.zw, depth);
    return min(length(eye.xyz / eye.w), u_volumetricLightMaxDistance + 1.0);
}

vec2 volumetricLightCompositeSphere(vec3 origin, vec3 ray, float radius) {
    float b = dot(origin, ray);
    float originRadius = length(origin);
    float discriminant = b * b - (originRadius - radius) * (originRadius + radius);
    if (discriminant < 0.0) return vec2(-1.0);
    float root = sqrt(max(discriminant, 0.0));
    return vec2(-b - root, -b + root);
}

float volumetricLightCompositeFrontFraction(vec2 uv, float sceneDistance, float cloudDistance) {
    if (cloudDistance >= u_volumetricLightMaxDistance) return 1.0;
    vec4 eyeRay = u_volumetricLightInverseProjection * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
    mat3 rotation = mat3(u_volumetricLightInverseEllipsoid);
    vec3 ray = normalize(rotation * (u_volumetricLightInverseView * vec4(eyeRay.xyz, 0.0)).xyz);
    vec3 camera = rotation * u_volumetricLightCamera - u_volumetricLightCenter;
    vec2 outer = volumetricLightCompositeSphere(camera, ray, u_volumetricLightBottomRadius + u_volumetricLightLayerTop);
    float rayStart = max(outer.x, 0.0);
    float rayEnd = min(outer.y, min(sceneDistance, u_volumetricLightMaxDistance));
    if (outer.y <= 0.0 || rayEnd <= rayStart || cloudDistance <= rayStart) return 0.0;
    if (cloudDistance >= rayEnd) return 1.0;
    vec2 inner = volumetricLightCompositeSphere(camera, ray, u_volumetricLightBottomRadius + u_volumetricLightLayerBottom);
    vec2 first = vec2(rayStart, rayEnd);
    vec2 second = vec2(rayEnd);
    if (inner.y > rayStart && inner.x < rayEnd && inner.y > inner.x) {
        first.y = clamp(inner.x, rayStart, rayEnd);
        second = vec2(clamp(inner.y, rayStart, rayEnd), rayEnd);
    }
    float totalOpticalLength = 0.0;
    float frontOpticalLength = 0.0;
    float fadeWidth = max((u_volumetricLightLayerTop - u_volumetricLightLayerBottom) * 0.65, 1.0);
    for (int segment = 0; segment < 2; ++segment) {
        vec2 interval = segment == 0 ? first : second;
        float stepLength = max(interval.y - interval.x, 0.0) * 0.125;
        for (int i = 0; i < 8; ++i) {
            float distanceStart = interval.x + float(i) * stepLength;
            float sampleDistance = distanceStart + stepLength * 0.5;
            float height = length(camera + ray * sampleDistance) - u_volumetricLightBottomRadius;
            float envelope = smoothstep(u_volumetricLightLayerBottom, u_volumetricLightLayerBottom + fadeWidth, height);
            envelope *= 1.0 - smoothstep(u_volumetricLightMaxDistance * 0.65,
                u_volumetricLightMaxDistance, sampleDistance);
            totalOpticalLength += envelope * stepLength;
            frontOpticalLength += envelope * clamp(cloudDistance - distanceStart, 0.0, stepLength);
        }
    }
    return totalOpticalLength > 0.0 ? frontOpticalLength / totalOpticalLength : 0.0;
}

// Call with the atmosphere/terrain BEFORE clouds are composited. RGB contains
// premultiplied scattering; alpha in both fog textures stores transmittance.
vec3 compositeVolumetricLight(vec2 uv, vec3 baseAtmosphere, vec4 cloud) {
    if (!u_volumetricLightEnabled) return cloud.rgb + (1.0 - cloud.a) * baseAtmosphere;
    float sceneDistance = volumetricLightCompositeSceneDistance(uv);
    float cloudDistance = texture(u_volumetricLightCloudDepth, uv).r;
    bool hasCloud = cloud.a > 0.001 && cloudDistance > 0.0;
    if (!hasCloud) cloudDistance = u_volumetricLightMaxDistance + 1.0;
    float frontFraction = volumetricLightCompositeFrontFraction(uv, sceneDistance, cloudDistance);
    vec2 dimensions = vec2(textureSize(u_volumetricLightBefore, 0));
    vec2 grid = uv * dimensions - 0.5;
    vec2 anchor = floor(grid);
    vec2 fraction = fract(grid);
    vec4 before = vec4(0.0);
    vec4 after = vec4(0.0);
    float weightSum = 0.0;
    // Terrain chooses compatible taps; cloud edges are handled continuously by
    // relocating each tap's fog integral around this full-resolution cloud depth.
    // This avoids a hard no-fog outline where all four coarse cloud tags disagree.
    vec3 reference = vec3(0.0);
    float bestError = 1e30;
    for (int tap = 0; tap < 4; ++tap) {
        vec2 offset = vec2(tap % 2, tap / 2);
        vec2 sampleUv = clamp((anchor + offset + 0.5) / dimensions, 0.5 / dimensions, 1.0 - 0.5 / dimensions);
        vec4 geometry = texture(u_volumetricLightDepth, sampleUv);
        if (geometry.x < 0.0) continue;
        float error = abs(geometry.y - sceneDistance);
        if (error < bestError) {
            bestError = error;
            vec4 referenceBefore = texture(u_volumetricLightBefore, sampleUv);
            reference = referenceBefore.rgb + referenceBefore.a * texture(u_volumetricLightAfter, sampleUv).rgb;
        }
    }
    float referenceLuminance = dot(reference, vec3(0.2126, 0.7152, 0.0722));
    for (int tap = 0; tap < 4; ++tap) {
        vec2 offset = vec2(tap % 2, tap / 2);
        vec2 sampleUv = clamp((anchor + offset + 0.5) / dimensions, 0.5 / dimensions, 1.0 - 0.5 / dimensions);
        vec4 geometry = texture(u_volumetricLightDepth, sampleUv);
        if (geometry.x < 0.0) continue;
        if ((geometry.y >= u_volumetricLightMaxDistance) != (sceneDistance >= u_volumetricLightMaxDistance)) continue;
        if (geometry.x > sceneDistance + max(5.0, sceneDistance * 0.002)) continue;
        float sceneError = abs(geometry.y - sceneDistance) / max(30.0, sceneDistance * 0.015);
        if (sceneError > 3.0) continue;
        vec4 sampleBefore = texture(u_volumetricLightBefore, sampleUv);
        vec4 sampleAfter = texture(u_volumetricLightAfter, sampleUv);
        vec3 totalScattering = sampleBefore.rgb + sampleBefore.a * sampleAfter.rgb;
        float totalTransmittance = sampleBefore.a * sampleAfter.a;
        float cloudError = abs(geometry.z - cloudDistance) / max(60.0, cloudDistance * 0.02);
        if ((geometry.w > 0.001) != hasCloud || cloudError > 1.0 || abs(geometry.w - cloud.a) > 0.12) {
            // A coarse neighbor may have a different cloud front. Preserve its
            // whole medium, split its optical depth at the target cloud, and
            // apply the target cloud opacity only after the spatial rebuild.
            float frontTransmittance = pow(max(totalTransmittance, 1e-6), frontFraction);
            float backTransmittance = pow(max(totalTransmittance, 1e-6), 1.0 - frontFraction);
            vec3 source = totalScattering / max(1.0 - totalTransmittance, 1e-6);
            sampleBefore = vec4(source * (1.0 - frontTransmittance), frontTransmittance);
            sampleAfter = vec4(source * (1.0 - backTransmittance), backTransmittance);
        }
        float luminance = dot(totalScattering, vec3(0.2126, 0.7152, 0.0722));
        float brightnessWeight = 1.0 / (1.0 + abs(luminance - referenceLuminance) / max(0.002, referenceLuminance * 0.5));
        vec2 bilinear = mix(1.0 - fraction, fraction, offset);
        float weight = max(bilinear.x * bilinear.y, 1e-5) * exp(-sceneError * sceneError) * brightnessWeight;
        before += sampleBefore * weight;
        after += sampleAfter * weight;
        weightSum += weight;
    }
    if (weightSum <= 1e-6) return cloud.rgb + (1.0 - cloud.a) * baseAtmosphere;
    before /= weightSum;
    after /= weightSum;
    return before.rgb + before.a * (cloud.rgb + (1.0 - cloud.a) * (after.rgb + after.a * baseAtmosphere));
}
