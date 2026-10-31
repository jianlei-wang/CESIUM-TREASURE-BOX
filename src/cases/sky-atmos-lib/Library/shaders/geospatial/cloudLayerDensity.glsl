
uniform vec4 cloudLayerTypes;
uniform vec2 cloudLodRange;
float cloudDistanceLod(const float distance) {
    if (cloudLodRange.y <= cloudLodRange.x) return 0.0;
    return smoothstep(cloudLodRange.x, cloudLodRange.y, distance);
}
vec4 cloudHeightBias(const vec4 bias) {
    vec4 result = bias;
    for (int i = 0; i < 3; ++i) {
        int type = int(cloudLayerTypes[i]);
        float scale = type == 1 ? 1.35 : (type == 2 ? 2.25 : (type == 3 ? 1.6 : 1.0));
        if (type > 0) {
            float value = clamp(bias[i] * scale, 0.01, 1.0);
            if (i == 0) result.x = value;
            else if (i == 1) result.y = value;
            else result.z = value;
        }
    }
    return result;
}
vec4 sampleCloudLayerShape(const vec3 position, const vec4 weatherDensity, const float lod, out int samples) {
    samples = 0;
    if (all(equal(cloudLayerTypes.xyz, vec3(0.0)))) {
        samples = 1;
        return vec4(textureLod(shapeTexture, position, lod).r);
    }
    vec4 result = vec4(1.0);
    for (int i = 0; i < 3; ++i) {
        if (weatherDensity[i] <= 0.0 || densityScales[i] <= 0.0) continue;
        int type = int(cloudLayerTypes[i]);
        vec3 coord = position;
        float lodBias = 0.0;
        if (type == 1) {
            coord *= vec3(0.8, 0.8, 1.05);
            lodBias = log2(1.05);
        } else if (type == 2) {
            // ECEF Z is not local altitude; unequal axis scales stretch the cloud horizontally.
            // Slightly larger altocumulus cells reduce the fine, granular appearance.
            float scale = length(vec2(1.5, 0.3));
            coord = vec3(position.x * 1.5 - position.y * 0.3, position.y * 1.5 + position.x * 0.3, position.z * scale) + vec3(0.37, 0.11, 0.53);
            lodBias = log2(scale);
        } else if (type == 3) {
            coord = vec3(position.x * 0.08 + position.y * 0.12, position.y * 2.5 - position.x * 0.4, position.z * 0.35) + vec3(0.19, 0.61, 0.43);
            lodBias = log2(2.55);
        }
        float filteredLod = max(0.0, lod + lodBias);
        float noise = textureLod(shapeTexture, coord, filteredLod).r;
        if (type == 3) {
            float ridge = 1.0 - abs(noise * 2.0 - 1.0);
            float width = clamp(0.06 + lod * 0.02, 0.06, 0.2);
            float fibre = smoothstep(0.68 - width, 0.68 + width, ridge);
            // Removing unresolved fibres must not remove the mip-averaged cloud mass.
            noise = mix(noise, fibre, 0.75 * (1.0 - smoothstep(1.0, 5.0, filteredLod)));
        }
        if (i == 0) result.x = noise;
        else if (i == 1) result.y = noise;
        else result.z = noise;
        ++samples;
    }
    return result;
}
