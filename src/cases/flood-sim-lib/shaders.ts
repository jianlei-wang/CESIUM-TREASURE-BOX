import {
  BoxGeometry,
  Cartesian2,
  Cartesian3,
  ComponentDatatype,
  Geometry,
  GeometryAttribute,
  GeometryAttributes,
  Matrix3,
  Matrix4,
  PrimitiveType,
  VertexFormat,
  Transforms,
  Math as CesiumMath
} from 'cesium'

export type Extent = [number, number, number, number]

export const COMMAND_SHADER = `
layout(location = 0) out vec4 outputColor;
uniform vec2 waterSource;
uniform float waterSourceRadius;
uniform float waterAddRate;
uniform float evaporationRate;
const int textureSize = 1024;
const vec3 backgroundColor = vec3(0.2);
const float transitionTime = 5.0;
const float transitionPercent = 0.3;
const int octaves = 7;
uniform float attenuation;
uniform float strenght;
uniform float minTotalFlow;
uniform float initialWaterLevel;

mat2 rot(in float ang)
{
  return mat2(
           cos(ang), -sin(ang),
           sin(ang),  cos(ang));
}

float hash12(vec2 p)
{
   vec3 p3  = fract(vec3(p.xyx) * .1031);
   p3 += dot(p3, p3.yzx + 33.33);
   return fract((p3.x + p3.y) * p3.z);
}

float hash13(vec3 p3)
{
   p3  = fract(p3 * .1031);
   p3 += dot(p3, p3.zyx + 31.32);
   return fract((p3.x + p3.y) * p3.z);
}

vec2 boxIntersection( in vec3 ro, in vec3 rd, in vec3 rad, out vec3 oN )
{
   vec3 m = 1.0 / rd;
   vec3 n = m * ro;
   vec3 k = abs(m) * rad;
   vec3 t1 = -n - k;
   vec3 t2 = -n + k;

   float tN = max( max( t1.x, t1.y ), t1.z );
   float tF = min( min( t2.x, t2.y ), t2.z );

   if( tN > tF || tF < 0.0) return vec2(-1.0);

   oN = -sign(rd)*step(t1.yzx, t1.xyz) * step(t1.zxy, t1.xyz);

   return vec2( tN, tF );
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

vec3 applyFog( in vec3  rgb, vec3 fogColor, in float distance)
{
   float fogAmount = exp( -distance );
   return mix( fogColor, rgb, fogAmount );
}
`

export const BUFFER_A_SHADER = `
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D heightMap;
uniform float iTime;
uniform int iFrame;
uniform vec2 damStart;
uniform vec2 damEnd;
uniform float damHeight;
float boxNoise( in vec2 p, in float z )
{
   vec2 fl = floor(p);
   vec2 fr = fract(p);
   fr = smoothstep(0.0, 1.0, fr);
   float res = mix(mix( hash13(vec3(fl, z)),             hash13(vec3(fl + vec2(1,0), z)),fr.x),
                   mix( hash13(vec3(fl + vec2(0,1), z)), hash13(vec3(fl + vec2(1,1), z)),fr.x),fr.y);
   return res;
}

vec2 readHeight(vec2 p)
{
   p = clamp(p, vec2(0.0), vec2(float(textureSize - 1)));
   return texture(iChannel0, p / float(textureSize)).xy;
}

vec4 readOutFlow(vec2 p)
{
   if(p.x < 0.0 || p.y < 0.0 || p.x >= float(textureSize) || p.y >= float(textureSize))
       return vec4(0.0);
   return texture(iChannel1, p / float(textureSize));
}

bool intersectsDam(vec2 uv) {
    vec2 damDir = damEnd - damStart;
    vec2 pointDir = uv - damStart;
    float t = clamp(dot(pointDir, damDir) / dot(damDir, damDir), 0.0, 1.0);
    vec2 closestPoint = damStart + t * damDir;
    float dist = length(uv - closestPoint);
    return dist < 0.001;
}

void main( )
{
   if( max(gl_FragCoord.x, gl_FragCoord.y) > float(textureSize) )
       discard;

   vec2 uv = gl_FragCoord.xy / float(textureSize);
   float t = transitionTime;

   float terrainElevation = texture(heightMap,uv).r;

   if (intersectsDam(uv)) {
        terrainElevation = max(terrainElevation, damHeight);
    }

   float waterDept = initialWaterLevel;
   if(iFrame != 0)
   {
        vec2 p = gl_FragCoord.xy;
        vec2 height = readHeight(p);
        vec4 OutFlow = texture(iChannel1, p / float(textureSize));
        float totalOutFlow = OutFlow.x + OutFlow.y + OutFlow.z + OutFlow.w;
        float totalInFlow = 0.0;
        totalInFlow += readOutFlow(p + vec2( 1.0,  0.0)).z;
        totalInFlow += readOutFlow(p + vec2( 0.0,  1.0)).w;
        totalInFlow += readOutFlow(p + vec2(-1.0,  0.0)).x;
        totalInFlow += readOutFlow(p + vec2( 0.0, -1.0)).y;
        waterDept = height.y - totalOutFlow + totalInFlow;
        if(distance(uv, waterSource) < waterSourceRadius) {
            waterDept += waterAddRate;
        }
        waterDept = max(0.0, waterDept - evaporationRate);
   }
   outputColor = vec4(terrainElevation, waterDept, 0, 1);
}
`

export const BUFFER_B_SHADER = `
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform float iTime;
uniform int iFrame;
vec2 readHeight(vec2 p)
{
   p = clamp(p, vec2(0.0), vec2(float(textureSize - 1)));
   return texture(iChannel0, p / float(textureSize)).xy;
}

float computeOutFlowDir(vec2 centerHeight, vec2 pos)
{
   vec2 dirHeight = readHeight(pos);
   if(distance(pos / float(textureSize), waterSource) < waterSourceRadius) {
        return max(0.0, centerHeight.y - dirHeight.y);
    }
   return max(0.0, (centerHeight.x + centerHeight.y) - (dirHeight.x + dirHeight.y));
}

void main()
{
   vec2 p = gl_FragCoord.xy;
   if(iFrame == 0)
   {
       outputColor = vec4(0);
       return;
   }

   if( max(p.x, p.y) > float(textureSize) )
       discard;

   vec4 oOutFlow = texture(iChannel1, p / float(textureSize));
   vec2 height = readHeight(p);
   vec4 nOutFlow;
   nOutFlow.x = computeOutFlowDir(height, p + vec2( 1.0,  0.0));
   nOutFlow.y = computeOutFlowDir(height, p + vec2( 0.0,  1.0));
   nOutFlow.z = computeOutFlowDir(height, p + vec2(-1.0,  0.0));
   nOutFlow.w = computeOutFlowDir(height, p + vec2( 0.0, -1.0));
   nOutFlow = attenuation * oOutFlow + strenght * nOutFlow;
   float totalFlow = nOutFlow.x + nOutFlow.y + nOutFlow.z + nOutFlow.w;
   if(totalFlow > minTotalFlow)
   {
       if(height.y < totalFlow)
       {
           nOutFlow = nOutFlow * (height.y / totalFlow);
       }
   }
   else
   {
       nOutFlow = vec4(0);
   }

   outputColor = nOutFlow;
}
`

export const BUFFER_C_SHADER = `
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform float iTime;
uniform int iFrame;
vec2 readHeight(vec2 p)
{
   p = clamp(p, vec2(0.0), vec2(float(textureSize - 1)));
   return texture(iChannel0, p / float(textureSize)).xy;
}

vec4 readOutFlow(vec2 p)
{
   if(p.x < 0.0 || p.y < 0.0 || p.x >= float(textureSize) || p.y >= float(textureSize))
       return vec4(0.0);
   return texture(iChannel1, p / float(textureSize));
}

void main( )
{
   if( max(gl_FragCoord.x, gl_FragCoord.y) > float(textureSize) )
       discard;

   vec2 p = gl_FragCoord.xy;
   vec2 height = readHeight(p);
   vec4 OutFlow = texture(iChannel1, p / float(textureSize));
   float totalOutFlow = OutFlow.x + OutFlow.y + OutFlow.z + OutFlow.w;
   float totalInFlow = 0.0;
   totalInFlow += readOutFlow(p + vec2( 1.0,  0.0)).z;
   totalInFlow += readOutFlow(p + vec2( 0.0,  1.0)).w;
   totalInFlow += readOutFlow(p + vec2(-1.0,  0.0)).x;
   totalInFlow += readOutFlow(p + vec2( 0.0, -1.0)).y;
   float waterDept = height.y - totalOutFlow + totalInFlow;
   if(distance(gl_FragCoord.xy, waterSource) < waterSourceRadius) {
        waterDept = max(waterDept, initialWaterLevel + waterAddRate);
    }
   waterDept = max(0.0, waterDept - evaporationRate);
   outputColor = vec4(height.x, waterDept, 0, 1);
}
`

export const BUFFER_D_SHADER = `
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform float iTime;
uniform int iFrame;
vec2 readHeight(vec2 p)
{
   p = clamp(p, vec2(0.0), vec2(float(textureSize - 1)));
   return texture(iChannel0, p / float(textureSize)).xy;
}

float computeOutFlowDir(vec2 centerHeight, vec2 pos)
{
   vec2 dirHeight = readHeight(pos);
   if(distance(pos / float(textureSize), waterSource) < waterSourceRadius) {
        return max(0.0, centerHeight.y - dirHeight.y);
    }
   return max(0.0, (centerHeight.x + centerHeight.y) - (dirHeight.x + dirHeight.y));
}

void main( )
{
   vec2 p = gl_FragCoord.xy;

   if( max(p.x, p.y) > float(textureSize) )
       discard;

   vec4 oOutFlow = texture(iChannel1, p / float(textureSize));
   vec2 height = readHeight(p);
   vec4 nOutFlow;
   nOutFlow.x = computeOutFlowDir(height, p + vec2( 1.0,  0.0));
   nOutFlow.y = computeOutFlowDir(height, p + vec2( 0.0,  1.0));
   nOutFlow.z = computeOutFlowDir(height, p + vec2(-1.0,  0.0));
   nOutFlow.w = computeOutFlowDir(height, p + vec2( 0.0, -1.0));
   nOutFlow = attenuation * oOutFlow + strenght * nOutFlow;
   float totalFlow = nOutFlow.x + nOutFlow.y + nOutFlow.z + nOutFlow.w;
   if(totalFlow > minTotalFlow)
   {
       if(height.y < totalFlow)
       {
           nOutFlow = nOutFlow * (height.y / totalFlow);
       }
   }
   else
   {
       nOutFlow = vec4(0);
   }

   outputColor = nOutFlow;
}
`

export const RENDER_SHADER = `
uniform vec2 damStart;
uniform vec2 damEnd;
uniform float damHeight;
uniform vec3 shallow;
uniform vec3 deep;
uniform float gradientDepth;
uniform sampler2D iChannel0;
uniform vec2 iResolution;
uniform float iTime;
uniform int iFrame;
uniform int depth;
uniform float waterAlpha;
in vec3 vo;
in vec3 vd;
in vec2 v_st;
const vec3 light = vec3(0.,4.,2.);
const float boxHeight = .5;

bool intersectsDam(vec2 uv) {
    vec2 damDir = damEnd - damStart;
    vec2 pointDir = uv - damStart;
    float t = clamp(dot(pointDir, damDir) / dot(damDir, damDir), 0.0, 1.0);
    vec2 closestPoint = damStart + t * damDir;
    float dist = length(uv - closestPoint);
    return dist < 0.001;
}

vec2 getHeight(in vec3 p)
{
    vec2 uv = p.xz + 0.5;
    uv = clamp(uv, 0.0, 1.0);
    vec2 h = texture(iChannel0, uv).xy;
    h.y += h.x;
    return h - 0.5;
}

vec3 getNormal(in vec3 p, int comp)
{
    float d = 2.0 / float(textureSize);
    float hMid = 0.0;
    float hRight = 0.0;
    float hTop = 0.0;

    vec2 heightMid = getHeight(p);
    vec2 heightRight = getHeight(p + vec3(d, 0.0, 0.0));
    vec2 heightTop = getHeight(p + vec3(0.0, 0.0, d));

    if (comp == 0) {
        hMid = heightMid.x;
        hRight = heightRight.x;
        hTop = heightTop.x;
    } else if (comp == 1) {
        hMid = heightMid.y;
        hRight = heightRight.y;
        hTop = heightTop.y;
    }

    return normalize(cross(vec3(0.0, hTop - hMid, d), vec3(d, hRight - hMid, 0.0)));
}

bool intersects(in vec3 p){
    vec2 uv = p.xz + 0.5;
    uv = clamp(uv, 0.0, 1.0);
    return intersectsDam(uv);
}

vec4 Render(in vec3 ro, in vec3 rd) {
   vec3 n;
   vec3 rayDir = normalize(rd);
   vec2 ret = hitBox(ro, rayDir);
   if (ret.x > ret.y) discard;
   float alpha = 0.0;
   ret.x = max(ret.x, 0.0);
   vec3 p = ro + ret.x * rayDir;

   if(ret.x > 0.0) {
       vec3 pi = ro + rd * ret.x;
       vec3 tc;
       vec3 tn;
       float tt = ret.x;
       vec2 h = getHeight(pi);
       float spec;
       if(pi.y < h.x) {
           tn = getNormal(ro + rd * tt, 0);
           tc = vec3(0.8, 0.7, 0.6);
           alpha = 0.2;
       }
       else {
           for (int i = 0; i < 512; i++) {
               if (i >= depth) break;
               vec3 p = ro + rd * tt;
               float h = p.y - getHeight(p).x;
               if (h < 0.0002 || tt > ret.y)
               break;
               tt += h * 0.4;
           }
           tn = getNormal(ro + rd * tt, 1);
           tc = shallow;
           alpha = 0.0;
       }

       if(tt > ret.y) {
           tc = vec3(0, 0, 0.4);
           alpha = 0.0;
       }
       float wt = ret.x;
       h = getHeight(pi);
       vec3 waterNormal;
       if(pi.y < h.y) {
           waterNormal = n;
       }
       else {
           for (int i = 0; i < 512; i++) {
               if (i >= depth) break;
               vec3 p = ro + rd * wt;
               float h = p.y - getHeight(p).y;
               if (h < 0.0002 || wt > min(tt, ret.y))
               break;
               wt += h * 0.4;
           }
           waterNormal = getNormal(ro + rd * wt, 1);
       }
       if(wt < ret.y) {
           float dist = (min(tt, ret.y) - wt);
           vec3 p = ro + rd * wt;
           vec2 heights = getHeight(p);
           float waterDepth = heights.y - heights.x;
            if(waterDepth > 0.001) {
                vec3 lightDir = normalize(light - p);
                float spec = pow(max(0., dot(lightDir, reflect(rd, waterNormal))), 20.0);
                float grad = smoothstep(0.0, max(gradientDepth, 0.001), waterDepth);
                tc = mix(tc, deep, grad);
                alpha = mix(alpha, waterAlpha, grad);
                tc += 0.5 * spec * smoothstep(0.0, 0.1, dist);
                alpha = mix(alpha, 1.0, spec);
            }
       }
       return vec4(tc, alpha);
   }
   discard;
}

void main()
{
   vec3 rayDir = normalize(vd);
   vec4 col = Render(vo, rayDir);
   if(col.a < 0.01){
       discard;
   }
   outputColor = col;
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
  const rotationX = Matrix4.fromRotationTranslation(
    Matrix3.fromRotationX(CesiumMath.toRadians(rotation[0]))
  )
  const rotationY = Matrix4.fromRotationTranslation(
    Matrix3.fromRotationY(CesiumMath.toRadians(rotation[1]))
  )
  const rotationZ = Matrix4.fromRotationTranslation(
    Matrix3.fromRotationZ(CesiumMath.toRadians(rotation[2]))
  )
  const pos =
    position instanceof Cartesian3
      ? position
      : Cartesian3.fromDegrees(position[0], position[1], position[2])
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

export function getDamPos(lon: number, lat: number, extent: Extent): Cartesian2 {
  const [minLon, minLat, maxLon, maxLat] = extent
  const x = (lon - minLon) / (maxLon - minLon)
  const y = 1 - (lat - minLat) / (maxLat - minLat)
  return new Cartesian2(x, y)
}

export { PrimitiveType }
