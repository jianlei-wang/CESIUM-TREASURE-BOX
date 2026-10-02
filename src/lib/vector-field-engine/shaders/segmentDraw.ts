export const renderParticlesVertexShader = `#version 300 es
precision highp float;

in vec2 st;
in vec3 normal;

uniform sampler2D previousParticlesPosition;
uniform sampler2D currentParticlesPosition;
uniform sampler2D postProcessingPosition;
uniform sampler2D particlesSpeed;

uniform float frameRateAdjustment;
uniform float minHeight;
uniform float maxHeight;
uniform float heightScale;
uniform float aspect;
uniform float pixelSize;
uniform vec2 lineWidth;
uniform vec2 lineLength;
uniform vec2 domain;
uniform bool is3D;

out vec4 speed;
out float v_segmentPosition;
out vec2 textureCoordinate;

struct adjacentPoints {
  vec4 previous;
  vec4 current;
  vec4 next;
};

vec3 convertCoordinate(vec3 lonLatZ) {
  float a = 6378137.0;
  float b = 6356752.3142;
  float e2 = 6.69437999014e-3;

  float latitude = radians(lonLatZ.y);
  float longitude = radians(lonLatZ.x);
  float h = mix(minHeight, maxHeight, lonLatZ.z) * heightScale;

  float cosLat = cos(latitude);
  float sinLat = sin(latitude);
  float N = a / sqrt(1.0 - e2 * sinLat * sinLat);
  return vec3(
    (N + h) * cosLat * cos(longitude),
    (N + h) * cosLat * sin(longitude),
    ((b * b) / (a * a) * N + h) * sinLat
  );
}

vec4 calculateProjectedCoordinate(vec3 lonLatZ) {
  if (is3D) {
    vec3 p = convertCoordinate(lonLatZ);
    return czm_modelViewProjection * vec4(p, 1.0);
  } else {
    vec3 p2d = vec3(radians(lonLatZ.x), radians(lonLatZ.y), 0.0);
    return czm_modelViewProjection * vec4(p2d, 1.0);
  }
}

vec4 calculateOffsetOnNormalDirection(vec4 pointA, vec4 pointB, float offsetSign, float widthFactor) {
  vec2 aspectVec2 = vec2(aspect, 1.0);
  vec2 pointA_XY = (pointA.xy / pointA.w) * aspectVec2;
  vec2 pointB_XY = (pointB.xy / pointB.w) * aspectVec2;
  vec2 direction = normalize(pointB_XY - pointA_XY);
  vec2 normalVector = vec2(-direction.y, direction.x);
  normalVector.x = normalVector.x / aspect;
  float offsetLength = (widthFactor * lineWidth.y) / (czm_viewport.w * 0.5);
  normalVector = offsetLength * normalVector;
  return vec4(offsetSign * normalVector, 0.0, 0.0);
}

void main() {
  vec2 flippedIndex = vec2(st.x, 1.0 - st.y);
  vec2 particleIndex = flippedIndex;
  speed = texture(particlesSpeed, particleIndex);

  vec3 previousPosition = texture(previousParticlesPosition, particleIndex).rgb;
  vec3 currentPosition = texture(currentParticlesPosition, particleIndex).rgb;
  vec3 nextPosition = texture(postProcessingPosition, particleIndex).rgb;

  float isAnyRandomPointUsed = texture(postProcessingPosition, particleIndex).a
    + texture(currentParticlesPosition, particleIndex).a
    + texture(previousParticlesPosition, particleIndex).a;

  adjacentPoints projectedCoordinates;
  if (isAnyRandomPointUsed > 0.0) {
    projectedCoordinates.previous = calculateProjectedCoordinate(previousPosition);
    projectedCoordinates.current = projectedCoordinates.previous;
    projectedCoordinates.next = projectedCoordinates.previous;
  } else {
    projectedCoordinates.previous = calculateProjectedCoordinate(previousPosition);
    projectedCoordinates.current = calculateProjectedCoordinate(currentPosition);
    projectedCoordinates.next = calculateProjectedCoordinate(nextPosition);
  }

  int pointToUse = int(normal.x);
  float offsetSign = normal.y;
  vec4 offset = vec4(0.0);

  float magnitude = clamp(speed.a, domain.x, domain.y);
  float normalizedSpeed = (magnitude - domain.x) / (domain.y - domain.x);

  float widthFactor = mix(lineWidth.x, lineWidth.y, normalizedSpeed);
  widthFactor *= (pointToUse < 0 ? 1.0 : 0.5);

  float lengthFactor = mix(lineLength.x, lineLength.y, normalizedSpeed) * pixelSize;

  if (pointToUse == 1) {
    offset = calculateOffsetOnNormalDirection(
      projectedCoordinates.previous, projectedCoordinates.current, offsetSign, widthFactor);
    gl_Position = projectedCoordinates.previous + projectedCoordinates.previous.w * offset;
    v_segmentPosition = 0.0;
  } else if (pointToUse == -1) {
    vec4 direction = normalize(projectedCoordinates.next - projectedCoordinates.current);
    vec4 extendedPosition = projectedCoordinates.current + direction * lengthFactor;
    offset = calculateOffsetOnNormalDirection(
      projectedCoordinates.current, extendedPosition, offsetSign, widthFactor);
    gl_Position = extendedPosition + extendedPosition.w * offset;
    v_segmentPosition = 1.0;
  }

  textureCoordinate = st;
}
`

export const renderParticlesFragmentShader = `#version 300 es
precision highp float;

in vec4 speed;
in float v_segmentPosition;
in vec2 textureCoordinate;

uniform vec2 domain;
uniform vec2 displayRange;
uniform sampler2D colorTable;
uniform sampler2D segmentsDepthTexture;

out vec4 fragColor;

void main() {
  const float zero = 0.0;
  if (speed.a > zero && speed.a > displayRange.x && speed.a < displayRange.y) {
    float magnitude = clamp(speed.a, domain.x, domain.y);
    float normalizedSpeed = (magnitude - domain.x) / (domain.y - domain.x);
    vec4 baseColor = texture(colorTable, vec2(normalizedSpeed, zero));

    float alpha = smoothstep(0.0, 1.0, v_segmentPosition);
    alpha = pow(alpha, 1.5);
    float speedAlpha = mix(0.3, 1.0, normalizedSpeed);
    fragColor = vec4(baseColor.rgb, baseColor.a * alpha * speedAlpha);
  } else {
    fragColor = vec4(zero);
  }

  float segmentsDepth = texture(segmentsDepthTexture, textureCoordinate).r;
  float globeDepth = czm_unpackDepth(texture(czm_globeDepthTexture, textureCoordinate));
  if (segmentsDepth < globeDepth) {
    fragColor = vec4(zero);
  }
}
`
