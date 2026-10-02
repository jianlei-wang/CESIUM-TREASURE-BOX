export const postProcessingPositionFragmentShader = `#version 300 es
precision highp float;

uniform sampler2D nextParticlesPosition;
uniform sampler2D particlesSpeed;

uniform vec2 lonRange;
uniform vec2 latRange;
uniform vec2 dataLonRange;
uniform vec2 dataLatRange;
uniform vec2 speedRange;

uniform float randomCoefficient;
uniform float dropRate;
uniform float dropRateBump;
uniform bool useViewerBounds;

in vec2 v_textureCoordinates;
out vec4 fragColor;

const vec3 randomConstants = vec3(12.9898, 78.233, 4375.85453);
const vec2 normalRange = vec2(0.0, 1.0);

float rand(vec2 seed, vec2 range) {
  vec2 randomSeed = randomCoefficient * seed;
  float temp = dot(randomConstants.xy, randomSeed);
  temp = fract(sin(temp) * (randomConstants.z + temp));
  return temp * (range.y - range.x) + range.x;
}

vec3 generateRandomParticle(vec2 seed) {
  float randomLon, randomLat, randomZ;
  if (useViewerBounds) {
    randomLon = rand(seed, lonRange);
    randomLat = rand(-seed, latRange);
  } else {
    randomLon = rand(seed, dataLonRange);
    randomLat = rand(-seed, dataLatRange);
  }
  randomZ = rand(seed.yx, normalRange);
  return vec3(randomLon, randomLat, randomZ);
}

bool particleOutbound(vec3 particle) {
  return particle.y < dataLatRange.x || particle.y > dataLatRange.y
      || particle.x < dataLonRange.x || particle.x > dataLonRange.y
      || particle.z < 0.0 || particle.z > 1.0;
}

void main() {
  vec3 nextParticle = texture(nextParticlesPosition, v_textureCoordinates).rgb;
  vec4 nextSpeed = texture(particlesSpeed, v_textureCoordinates);
  float magnitude = nextSpeed.a;
  float speedNorm = clamp((magnitude - speedRange.x) / (speedRange.y - speedRange.x), 0.0, 1.0);
  float particleDropRate = dropRate + dropRateBump * speedNorm;

  vec2 seed1 = nextParticle.xy + v_textureCoordinates;
  vec2 seed2 = nextSpeed.rg + v_textureCoordinates;
  vec3 randomParticle = generateRandomParticle(seed1);
  float randomNumber = rand(seed2, normalRange);

  if (randomNumber < particleDropRate || particleOutbound(nextParticle)) {
    fragColor = vec4(randomParticle, 1.0);
  } else {
    fragColor = vec4(nextParticle, 0.0);
  }
}
`
