import { BoxGeometry, Cartesian3, ComponentDatatype, Geometry, GeometryAttribute, GeometryAttributes, Matrix3, Matrix4, PrimitiveType, VertexFormat, Transforms, Math as CesiumMath } from 'cesium'

export type Extent = [number, number, number, number]

// SPH 公共内核与常量（compute 与体积渲染共用；命名避开其它案例 prelude，避免重复声明）
export const SPH_COMMON_GLSL = `
#define Bi(p) ivec2(mod(p, vec2(float(textureSize))))
#define texel(a, p) texelFetch(a, Bi(p), 0)

#define range(i,a,b) for(int i = a; i <= b; i++)

const int textureSize = 1024;
#define dt 1.0
uniform float gravity;
#define dist 1.00
#define dif 0.3
#define difd 0.0
uniform float initialMass;

uniform vec2 waterSource;
uniform float waterSourceRadius;
uniform float waterAddRate;

#define border_h 5.

uniform sampler2D heightMap;

float terrainHeight(vec2 pos) {
    vec2 uv = pos / float(textureSize);
    uv = clamp(uv, 0.0, 1.0);
    float h = texture(heightMap, uv).r;
    return h * 4.0;
}

vec2 terrainGrad(vec2 pos) {
    const float eps = 1.0;
    vec2 n = vec2(
        terrainHeight(pos + vec2(eps, 0.0)) - terrainHeight(pos - vec2(eps, 0.0)),
        terrainHeight(pos + vec2(0.0, eps)) - terrainHeight(pos - vec2(0.0, eps))
    ) / (2.0 * eps);
    return n;
}

vec2 destimator(vec2 dx, float M) {
    return dist * clamp(1.0 - difd * abs(dx), 0.002, 1.0) + dif * dt;
}

float sdBox(in vec2 p, in vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float border(vec2 p) {
    vec2 R = vec2(float(textureSize));
    float bound = -sdBox(p - R * 0.5, R * vec2(0.5, 0.5));
    return bound;
}

const float BORDER_STEP = 1.0;
vec3 bN(vec2 p) {
    vec3 dx = vec3(-BORDER_STEP, 0.0, BORDER_STEP);
    vec4 idx = vec4(-1.0 / BORDER_STEP, 0.0, 1.0 / BORDER_STEP, 0.25);
    vec3 r = idx.zyw * border(p + dx.zy) + idx.xyw * border(p + dx.xy) + idx.yzw * border(p + dx.yz) + idx.yxw * border(p + dx.yx);
    return vec3(normalize(r.xy), r.z + 1e-4);
}

vec2 decode(float x) {
    uint X = floatBitsToUint(x);
    return unpackSnorm2x16(X);
}

float encode(vec2 x) {
    uint X = packSnorm2x16(clamp(x, vec2(-1.0), vec2(1.0)));
    return uintBitsToFloat(X);
}

struct particle {
    vec2 X;
    vec2 V;
    vec2 M;
};

particle getParticle(vec4 data, vec2 pos) {
    particle P;
    P.X = decode(data.x) + pos;
    P.V = decode(data.y);
    P.M = data.zw;
    return P;
}

vec4 saveParticle(particle P, vec2 pos) {
    P.X = clamp(P.X - pos, vec2(-0.5), vec2(0.5));
    return vec4(encode(P.X), encode(P.V), P.M);
}

vec3 hash32(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yzz) * p3.zyx);
}

float G(vec2 x) {
    return exp(-dot(x, x));
}

vec3 distribution(vec2 x, vec2 p, vec2 K) {
    vec4 aabb0 = vec4(p - 0.5, p + 0.5);
    vec4 aabb1 = vec4(x - K * 0.5, x + K * 0.5);
    vec4 aabbX = vec4(max(aabb0.xy, aabb1.xy), min(aabb0.zw, aabb1.zw));
    vec2 center = 0.5 * (aabbX.xy + aabbX.zw);
    vec2 size = max(aabbX.zw - aabbX.xy, 0.0);
    float m = size.x * size.y / (K.x * K.y);
    return vec3(center, m);
}

void Reintegration(sampler2D ch, inout particle P, vec2 pos) {
    range(i, -2, 2) range(j, -2, 2) {
        vec2 tpos = pos + vec2(i, j);
        vec4 data = texel(ch, tpos);

        particle P0 = getParticle(data, tpos);

        vec2 dx0 = P0.X - tpos;
        vec2 difR = destimator(dx0, P0.M.x);
        P0.X += P0.V * dt;

        vec3 D = distribution(P0.X, pos, difR);
        float m = P0.M.x * D.z;

        P.X += D.xy * m;
        P.V += P0.V * m;
        P.M.y += P0.M.y * m;
        P.M.x += m;
    }

    if(P.M.x != 0.0) {
        P.X /= P.M.x;
        P.V /= P.M.x;
        P.M.y /= P.M.x;
    }
}

void Simulation(sampler2D ch, inout particle P, vec2 pos) {
    vec2 F = vec2(0.0);
    vec3 avgV = vec3(0.0);

    range(i, -2, 2) range(j, -2, 2) {
        vec2 tpos = pos + vec2(i, j);
        vec4 data = texel(ch, tpos);
        particle P0 = getParticle(data, tpos);
        vec2 dx = P0.X - P.X;
        float avgP = gravity * 0.1 * P0.M.x * (P.M.x + P0.M.x);
        F -= 0.5 * G(1.0 * dx) * avgP * dx;
        avgV += P0.M.x * G(1.0 * dx) * vec3(P0.V, 1.0);
    }

    F -= gravity * 0.232 * P.M.x * terrainGrad(pos);
    avgV.xy /= avgV.z;

    float srcDist = distance(pos / float(textureSize), waterSource);
    if(srcDist < waterSourceRadius) {
        P.M.x += waterAddRate * dt;
    }

    F -= P.V * 0.0005;
    P.V += F * dt / P.M.x;

    vec3 N = bN(P.X);
    float vdotN = step(N.z, border_h) * dot(-N.xy, P.V);
    P.V += 0.5 * (N.xy * vdotN + N.xy * abs(vdotN));

    if(N.z < 0.0)
        P.V = vec2(0.0);

    float v = length(P.V);
    P.V /= (v > 1.0) ? v : 1.0;
}

vec2 hitBox(vec3 orig, vec3 dir) {
   const vec3 box_min = vec3(-0.5);
   const vec3 box_max = vec3(0.5);
   vec3 inv_dir = 1.0 / dir;
   vec3 tmin_tmp = (box_min - orig) * inv_dir;
   vec3 tmax_tmp = (box_max - orig) * inv_dir;
   vec3 tmin = min(tmin_tmp, tmax_tmp);
   vec3 tmax = max(tmin_tmp, tmax_tmp);
   float t0 = max(tmin.x, max(tmin.y, tmin.z));
   float t1 = min(tmax.x, min(tmax.y, tmax.z));
   return vec2(t0, t1);
}
`

export const SPH_PRELUDE_GLSL = `
layout(location = 0) out vec4 outputColor;
`

// Buffer A：粒子重积分（含首帧随机初始化）
export const PARTICLE_INTEGRATION_GLSL = `
uniform sampler2D iChannel0;
uniform int iFrame;

void main() {
    vec2 pos = gl_FragCoord.xy;

    if(max(pos.x, pos.y) > float(textureSize))
       discard;

    vec4 data = texel(iChannel0, pos);
    particle P;
    P.X = vec2(0.0);
    P.V = vec2(0.0);
    P.M = vec2(0.0);

    Reintegration(iChannel0, P, pos);

    if(iFrame < 1) {
        vec3 rand = hash32(pos + vec2(0.0, 1.0) + 0.28);
        if(rand.z < 0.6) {
            P.X = pos + 0.3 * (rand.yz - 0.5);
            P.V = 0.65 * (rand.xy - 0.5) + vec2(0.0, 0.0);
            P.M = vec2(initialMass, 0.0);
        } else {
            P.X = pos;
            P.V = vec2(0.0);
            P.M = vec2(1e-6);
        }
    }

    outputColor = saveParticle(P, pos);
}
`

// Buffer B：SPH 物理模拟
export const PARTICLE_SIMULATION_GLSL = `
uniform sampler2D iChannel0;

void main() {
    vec2 pos = gl_FragCoord.xy;

    if(max(pos.x, pos.y) > float(textureSize))
       discard;

    vec4 data = texel(iChannel0, pos);
    particle P = getParticle(data, pos);

    if(P.M.x != 0.0) {
        Simulation(iChannel0, P, pos);
    }

    outputColor = saveParticle(P, pos);
}
`

// Buffer C：平滑高度场（供渲染读取）
export const SURFACE_SMOOTHING_GLSL = `
uniform sampler2D iChannel0;

void main() {
    vec2 pos = gl_FragCoord.xy;

    if(max(pos.x, pos.y) > float(textureSize))
       discard;

    float rho = 0.;
    float hei = 0.;
    float weight = 0.0;
    vec2 vel = vec2(0.0);

    range(i, -2, 2) range(j, -2, 2) {
        vec2 pos0 = pos + vec2(float(i), float(j));
        vec4 data = texel(iChannel0, pos0);
        particle P0 = getParticle(data, pos0);
        vec2 dx = pos - pos0;
        float w = G(0.75 * dx);
        weight += w;
        rho += P0.M.x * w;
        vel += P0.V * w;
        hei += terrainHeight(pos0) * w;
    }

    vec4 outValue = vec4(rho / weight, hei / weight, vel.x / weight, vel.y / weight);
    outputColor = outValue;
}
`

// 体积渲染：光线步进水面与地形、Fresnel 反射与水下颜色衰减
export const FLUID_VOLUME_GLSL = `
uniform sampler2D iChannel0;
uniform int depth;
uniform vec3 shallow;
uniform vec3 deep;
uniform float waterAlpha;
in vec3 vo;
in vec3 vd;

const vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
const float heightScale = 0.15;

uniform float flowVisible;
uniform float arrowRatio;
uniform float arrowCount;

float sdSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

float flowArrowMask(vec2 uv) {
    vec2 counts = vec2(max(arrowCount, 1.0), max(arrowCount * arrowRatio, 1.0));
    vec2 p = uv * counts;
    if (p.x < 0.0 || p.y < 0.0 || p.x > counts.x || p.y > counts.y) return 0.0;
    vec2 g = floor(p);
    vec2 center = (g + 0.5) / counts;
    vec4 sd = texture(iChannel0, clamp(center, 0.0, 1.0));
    float rho = sd.x;
    if (rho < 1e-4) return 0.0;
    vec2 dirv = vec2(sd.z, sd.w);
    float spd = length(dirv);
    if (spd < 1e-3) return 0.0;
    vec2 dir = dirv / spd;
    vec2 perp = vec2(-dir.y, dir.x);
    vec2 q = fract(p) - 0.5;
    vec2 ql = vec2(dot(q, dir), dot(q, perp));
    float body = sdSegment(ql, vec2(-0.30, 0.0), vec2(0.12, 0.0));
    float mask = 1.0 - smoothstep(0.05, 0.11, body);
    float wing = min(
        sdSegment(ql, vec2(0.40, 0.0), vec2(0.10, 0.20)),
        sdSegment(ql, vec2(0.40, 0.0), vec2(0.10, -0.20))
    );
    mask = max(mask, 1.0 - smoothstep(0.05, 0.11, wing));
    return mask;
}

vec2 getHeight(in vec3 p) {
    vec2 uv = p.xz + 0.5;
    uv = clamp(uv, 0.0, 1.0);
    vec4 data = texture(iChannel0, uv);
    float terrainH = data.y * heightScale;
    float waterH = (data.y + data.x) * heightScale;
    return vec2(terrainH - 0.5, waterH - 0.5);
}

float getWaterDepth(in vec3 p) {
    vec2 uv = p.xz + 0.5;
    uv = clamp(uv, 0.0, 1.0);
    vec4 data = texture(iChannel0, uv);
    return data.x * heightScale;
}

vec3 getNormal(in vec3 p, int comp) {
    float d = 2.0 / float(textureSize);
    float hMid = (comp == 0) ? getHeight(p).x : getHeight(p).y;
    float hRight = (comp == 0) ? getHeight(p + vec3(d, 0, 0)).x : getHeight(p + vec3(d, 0, 0)).y;
    float hTop = (comp == 0) ? getHeight(p + vec3(0, 0, d)).x : getHeight(p + vec3(0, 0, d)).y;
    return normalize(cross(vec3(0, hTop - hMid, d), vec3(d, hRight - hMid, 0)));
}

float fresnel(vec3 viewDir, vec3 normal) {
    float cosTheta = max(dot(-viewDir, normal), 0.0);
    float F0 = 0.02;
    return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

vec4 Render(in vec3 ro, in vec3 rd) {
    vec3 rayDir = normalize(rd);
    vec2 ret = hitBox(ro, rayDir);
    if (ret.x > ret.y) discard;

    ret.x = max(ret.x, 0.0);

    float tt = ret.x;
    for (int i = 0; i < depth; i++) {
        vec3 p = ro + rd * tt;
        float h = p.y - getHeight(p).x;
        if (h < 0.0002 || tt > ret.y)
            break;
        tt += h * 0.4;
    }

    float wt = ret.x;
    for (int i = 0; i < depth; i++) {
        vec3 p = ro + rd * wt;
        float h = p.y - getHeight(p).y;
        if (h < 0.0002 || wt > min(tt, ret.y))
            break;
        wt += h * 0.4;
    }

    vec3 tc = vec3(0.0);
    float alpha = 0.0;

    if (wt < ret.y) {
        vec3 waterPos = ro + rd * wt;
        float waterDepth = getWaterDepth(waterPos);

        if (waterDepth > 0.001) {
            vec3 waterNormal = getNormal(waterPos, 1);

            float F = fresnel(rayDir, waterNormal);

            vec3 reflectDir = reflect(rayDir, waterNormal);

            vec3 skyColor = mix(
                czm_gammaCorrect(vec3(0.5, 0.7, 1.0)),
                czm_gammaCorrect(vec3(0.2, 0.4, 0.8)),
                reflectDir.y * 0.5 + 0.5
            );

            float underwaterDist = min(tt - wt, 0.3);
            vec3 underwaterColor = exp(-0.18 * vec3(1.0, 0.467, 0.180) * max(underwaterDist * 100.0, 0.0));

            vec3 waterColor = mix(
                czm_gammaCorrect(shallow),
                czm_gammaCorrect(deep),
                smoothstep(0.0, 0.1, waterDepth)
            );

            float spec = pow(max(dot(lightDir, reflectDir), 0.0), 64.0);

            tc = mix(waterColor * underwaterColor, skyColor, F * 0.5);
            tc += spec * vec3(1.0) * 0.8;

            alpha = mix(0.3, waterAlpha, smoothstep(0.0, 0.05, waterDepth));
            alpha = mix(alpha, 1.0, F * 0.3 + spec * 0.5);

            if (flowVisible > 0.5) {
                float am = flowArrowMask(waterPos.xz + 0.5);
                if (am > 0.02) {
                    tc = mix(tc, vec3(1.0, 0.97, 0.85), am * 0.85);
                    alpha = max(alpha, am * 0.95);
                }
            }
        }
    }

    if (alpha < 0.01 && tt < ret.y) {
        discard;
    }

    return vec4(tc, alpha);
}

void main() {
    vec3 rayDir = normalize(vd);
    vec4 col = Render(vo, rayDir);
    if (col.a < 0.01) {
        discard;
    }
    outputColor = col;
}
`

export const SPH_VOLUME_VERTEX_GLSL = `
in vec3 position;
in vec2 st;

out vec3 vo;
out vec3 vd;

void main() {
    vo = czm_encodedCameraPositionMCHigh + czm_encodedCameraPositionMCLow;
    vd = position - vo;
    gl_Position = czm_modelViewProjection * vec4(position, 1.0);
}
`

export function getFullscreenQuad(): Geometry {
  const attributes = new GeometryAttributes()
  attributes.position = new GeometryAttribute({
    componentDatatype: ComponentDatatype.FLOAT,
    componentsPerAttribute: 3,
    values: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0])
  })
  attributes.st = new GeometryAttribute({
    componentDatatype: ComponentDatatype.FLOAT,
    componentsPerAttribute: 2,
    values: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
  })
  return new Geometry({ attributes, indices: new Uint32Array([3, 2, 0, 0, 2, 1]) })
}

export function generateModelMatrix(
  position: [number, number, number],
  rotation: [number, number, number],
  scale: [number, number, number]
): Matrix4 {
  const rotationX = Matrix4.fromRotationTranslation(Matrix3.fromRotationX(CesiumMath.toRadians(rotation[0])))
  const rotationY = Matrix4.fromRotationTranslation(Matrix3.fromRotationY(CesiumMath.toRadians(rotation[1])))
  const rotationZ = Matrix4.fromRotationTranslation(Matrix3.fromRotationZ(CesiumMath.toRadians(rotation[2])))
  const pos = position instanceof Cartesian3 ? position : Cartesian3.fromDegrees(position[0], position[1], position[2])
  const enuMatrix = Transforms.eastNorthUpToFixedFrame(pos)
  Matrix4.multiply(enuMatrix, rotationX, enuMatrix)
  Matrix4.multiply(enuMatrix, rotationY, enuMatrix)
  Matrix4.multiply(enuMatrix, rotationZ, enuMatrix)
  const scaleMatrix = Matrix4.fromScale(new Cartesian3(...scale))
  return Matrix4.multiply(enuMatrix, scaleMatrix, new Matrix4())
}

export function getBoxGeometry(): Geometry {
  const boxGeometry = BoxGeometry.fromDimensions({
    vertexFormat: VertexFormat.POSITION_AND_ST,
    dimensions: new Cartesian3(1, 1, 1)
  })
  return BoxGeometry.createGeometry(boxGeometry) as Geometry
}

export { PrimitiveType }
