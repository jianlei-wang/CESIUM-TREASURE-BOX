uniform sampler2D u_volumetricShadowTexture;
uniform mat4 u_volumetricShadowMatrix;
uniform mat4 u_volumetricShadowEllipsoidMatrix;
uniform vec3 u_volumetricShadowCenter;
uniform vec3 u_volumetricShadowSunDirection;
uniform float u_volumetricShadowTopRadius;
uniform vec2 u_volumetricShadowTexelSize;
uniform bool u_volumetricShadowReady;
uniform float u_volumetricShadowSunAngularRadius;
uniform float u_volumetricShadowWorldTexelSize;

float readVolumetricLightSunlight(const vec2 uv, const float distanceToTop) {
    // Focused Beer shadow distances use kilometres and extinction per kilometre
    // so low-angle solar paths remain representable in RGBA16F.
    vec4 shadow = texture(u_volumetricShadowTexture, uv);
    float distanceToFront = max(0.0, distanceToTop * 0.001 - shadow.r);
    float opticalDepth = min(max(0.0, shadow.b + shadow.a), max(0.0, shadow.g) * distanceToFront);
    return exp(-opticalDepth);
}

float sampleVolumetricLightSunlight(const vec3 positionECEF) {
    if (!u_volumetricShadowReady) {
        return 1.0;
    }
    vec3 worldPosition = mat3(u_volumetricShadowEllipsoidMatrix) *
        (positionECEF + u_volumetricShadowCenter);
    vec4 clip = u_volumetricShadowMatrix * vec4(worldPosition, 1.0);
    vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
        return 1.0;
    }

    // The distance is measured from the illuminated cloud shell, as in the
    // tracing pass. Positions above that shell receive unobstructed sunlight.
    float b = dot(positionECEF, u_volumetricShadowSunDirection);
    float c = dot(positionECEF, positionECEF) -
        u_volumetricShadowTopRadius * u_volumetricShadowTopRadius;
    float discriminant = b * b - c;
    if (discriminant < 0.0 || (c > 0.0 && b >= 0.0)) {
        return 1.0;
    }
    float distanceToTop = max(0.0, -b + sqrt(max(0.0, discriminant)));
    vec4 centerShadow = texture(u_volumetricShadowTexture, uv);
    float distanceBehindCloud = max(0.0, distanceToTop - centerShadow.r * 1000.0);
    float penumbraRadius = tan(u_volumetricShadowSunAngularRadius) * distanceBehindCloud;
    float filterRadius = clamp(penumbraRadius / max(1.0, u_volumetricShadowWorldTexelSize), 0.35, 2.0);
    vec2 filterOffset = u_volumetricShadowTexelSize * filterRadius * 0.70710678;
    float sunlight = readVolumetricLightSunlight(uv + filterOffset, distanceToTop);
    sunlight += readVolumetricLightSunlight(uv - filterOffset, distanceToTop);
    sunlight += readVolumetricLightSunlight(uv + vec2(filterOffset.x, -filterOffset.y), distanceToTop);
    sunlight += readVolumetricLightSunlight(uv + vec2(-filterOffset.x, filterOffset.y), distanceToTop);
    float edgeDistance = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y));
    float edgeWeight = smoothstep(0.0, max(u_volumetricShadowTexelSize.x,
        u_volumetricShadowTexelSize.y) * 2.0, edgeDistance);
    return mix(1.0, sunlight * 0.25, edgeWeight);
}
