export const updatePositionShader = `#version 300 es
precision highp float;

uniform sampler2D currentParticlesPosition;
uniform sampler2D particlesSpeed;

in vec2 v_textureCoordinates;
out vec4 fragColor;

void main() {
  vec3 currentPos = texture(currentParticlesPosition, v_textureCoordinates).rgb;
  vec3 speed = texture(particlesSpeed, v_textureCoordinates).rgb;
  vec3 nextPos = currentPos + speed;
  fragColor = vec4(nextPos, 1.0);
}
`
