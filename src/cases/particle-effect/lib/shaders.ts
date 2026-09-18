export const updateVelocityShader = `#version 300 es
precision highp float;

uniform sampler2D positionTexture;
uniform sampler2D velocityTexture;

uniform float deltaTime;
uniform float gravity;
uniform float turbulence;
uniform float drag;
uniform float lift;
uniform vec2 initialSpeed;
uniform vec2 lifetime;
uniform float coneAngle;
uniform float emissionRate;
uniform bool continuous;
uniform float seedTime;

in vec2 v_textureCoordinates;
out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = v_textureCoordinates;
  vec4 pos = texture(positionTexture, uv);
  vec4 vel = texture(velocityTexture, uv);
  float life = pos.a;
  float seed = vel.a;

  if (life > 0.0) {
    vec3 v = vel.xyz;
    v.z += lift * deltaTime;
    v.z -= gravity * deltaTime;
    v *= max(0.0, 1.0 - drag * deltaTime);
    v.x += (hash(uv * 31.7 + seedTime * 3.0) - 0.5) * turbulence * deltaTime * 2.0;
    v.y += (hash(uv * 41.3 + seedTime * 5.0) - 0.5) * turbulence * deltaTime * 2.0;
    v.z += (hash(uv * 51.1 + seedTime * 7.0) - 0.5) * turbulence * deltaTime * 2.0;
    fragColor = vec4(v, seed);
  } else {
    float p = continuous ? emissionRate : 0.0;
    if (hash(uv * 61.9 + seedTime * 11.0) < p) {
      float newSeed = hash(uv * 71.7 + seedTime * 13.0);
      vec3 dir;
      if (coneAngle > 3.0) {
        float z = 2.0 * hash(uv * 81.3 + seedTime * 17.0) - 1.0;
        float a = hash(uv * 91.7 + seedTime * 19.0) * 6.28318530718;
        float r = sqrt(max(0.0, 1.0 - z * z));
        dir = vec3(r * cos(a), r * sin(a), z);
      } else {
        float theta = newSeed * coneAngle;
        float phi = hash(uv * 101.3 + seedTime * 23.0) * 6.28318530718;
        dir = vec3(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta));
      }
      float sp = mix(initialSpeed.x, initialSpeed.y, hash(uv * 111.9 + seedTime * 29.0));
      fragColor = vec4(dir * sp, newSeed);
    } else {
      fragColor = vec4(0.0, 0.0, 0.0, seed);
    }
  }
}
`

export const updatePositionShader = `#version 300 es
precision highp float;

uniform sampler2D positionTexture;
uniform sampler2D velocityTexture;
uniform float deltaTime;
uniform vec2 lifetime;
uniform float emitterRadius;
uniform float emissionRate;
uniform bool continuous;
uniform float seedTime;

in vec2 v_textureCoordinates;
out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = v_textureCoordinates;
  vec4 pos = texture(positionTexture, uv);
  vec4 vel = texture(velocityTexture, uv);
  float life = pos.a;
  float seed = vel.a;

  if (life > 0.0) {
    vec3 p = pos.xyz + vel.xyz * deltaTime;
    float lt = mix(lifetime.x, lifetime.y, hash(uv * 13.7 + seed * 7.0));
    float newLife = life - deltaTime / max(lt, 0.001);
    if (newLife < 0.0) newLife = 0.0;
    fragColor = vec4(p, newLife);
  } else {
    float pr = continuous ? emissionRate : 0.0;
    if (hash(uv * 61.9 + seedTime * 11.0) < pr) {
      float r = emitterRadius * sqrt(hash(uv * 71.3 + seedTime * 31.0));
      float a = hash(uv * 81.7 + seedTime * 37.0) * 6.28318530718;
      fragColor = vec4(r * cos(a), r * sin(a), 0.0, 1.0);
    } else {
      fragColor = vec4(0.0, 0.0, 0.0, 0.0);
    }
  }
}
`

export const renderParticlesVertexShader = `#version 300 es
precision highp float;

in vec2 st;

uniform sampler2D positionTexture;
uniform sampler2D velocityTexture;
uniform vec3 emitterOrigin;
uniform vec3 east;
uniform vec3 north;
uniform vec3 up;
uniform float pointSize;
uniform float pointGrowth;
uniform float heightScale;

out float v_life;
out float v_speed;
out float v_seed;

void main() {
  vec2 flippedIndex = vec2(st.x, 1.0 - st.y);
  vec4 pos = texture(positionTexture, flippedIndex);
  vec4 speed = texture(velocityTexture, flippedIndex);
  float life = pos.a;
  v_life = life;
  v_speed = length(speed.xyz);
  v_seed = speed.w;

  if (life <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 1.0;
    return;
  }

  vec3 local = pos.xyz;
  local.z *= heightScale;
  vec3 world = emitterOrigin + east * local.x + north * local.y + up * local.z;
  vec4 mvPos = czm_modelViewProjection * vec4(world, 1.0);
  gl_Position = mvPos;

  float distScale = czm_viewport.w * 0.5 / max(mvPos.w, 1.0);
  float size = pointSize + pointGrowth * (1.0 - life);
  gl_PointSize = clamp(size * distScale, 1.0, 1024.0);
}
`

export const renderParticlesFragmentShader = `#version 300 es
precision highp float;

uniform sampler2D colorTable;
uniform vec2 displayRange;
uniform float particleStyle;
uniform float noiseScale;
uniform float noiseDetail;
uniform float cloudDensity;
uniform float smokeAmount;
uniform float cloudRadius;
uniform float edgeSoftness;
uniform float colorFrequency;
uniform float cloudTime;

in float v_life;
in float v_speed;
in float v_seed;

out vec4 fragColor;

float gyroid(vec3 p) {
  return dot(cos(p), sin(p.yzx));
}

float noiseCloud(vec3 p) {
  float result = 0.0;
  float amplitude = 0.5;
  for (float octave = 0.0; octave < 8.0; octave += 1.0) {
    if (octave >= noiseDetail) break;
    p.z += result * 0.1;
    result += abs(gyroid(p / amplitude) * amplitude);
    amplitude /= 1.7;
  }
  return result;
}

void main() {
  if (v_life <= 0.0) discard;

  vec2 coord = gl_PointCoord * 2.0 - 1.0;
  float dist = length(coord);
  if (particleStyle <= 0.5 && dist > 1.0) discard;

  float t = 1.0 - v_life;
  vec4 color = texture(colorTable, vec2(t, 0.5));
  float soft = smoothstep(1.0, 0.3, dist);
  float fadeOut = 1.0 - smoothstep(0.6, 1.0, t);
  float alpha = color.a * soft * fadeOut;

  if (particleStyle > 0.5) {
    // Bim Boom Bam 的单团爆炸版本：固定实例编号，消除多实例平铺和切分线。
    float cycle = fract(cloudTime / 3.0 + 0.5);
    float frame = floor(cloudTime / 3.0 + 0.5);
    float growth = pow(cycle, 0.2);
    float burn = 1.0 - pow(cycle, 0.4);
    float cloudFade = 1.0 - pow(cycle, 9.0);
    float speed = pow(cycle, 0.4);
    vec3 ray = normalize(vec3(coord, 0.01 + cycle));
    ray.z += speed + frame + 0.5 * 196.128;
    float noise = noiseCloud(ray * noiseScale);
    vec3 e = vec3(0.1, 0.0, 0.0);
    vec3 normal = normalize(noise - vec3(
      noiseCloud((ray + e.xzz) * noiseScale),
      noiseCloud((ray + e.zyz) * noiseScale),
      1.0
    ));
    color.rgb = 0.2 + cos(vec3(1.0, 2.0, 3.0) * colorFrequency + normal.y);
    float smoke = noise - 2.0 * burn;
    float shade = normal.y * 0.5 + 0.5;
    float smokeMask = clamp(smoothstep(0.0, 0.1, smoke) * smokeAmount, 0.0, 1.0);
    color.rgb = mix(color.rgb, vec3(smoke * shade), smokeMask);
    float radius = cloudRadius * noise * growth;
    float shape = smoothstep(edgeSoftness, 0.0, dist - radius);
    float cloudAlpha = shape * cloudFade * cloudDensity;
    if (cloudAlpha < 0.003) discard;
    fragColor = vec4(color.rgb, cloudAlpha);
    return;
  }

  if (alpha < 0.003) discard;
  fragColor = vec4(color.rgb, alpha);
}
`
