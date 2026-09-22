import { Cartesian2, Color, Material } from 'cesium'
import { RIVER_WATER_VERTEX_SHADER } from './water-material'

/**
 * 动态流向箭头层。
 *
 * 箭头不依赖任何几何体或实体：它复用与水面完全相同的一份网格，
 * 在片元着色器里按公里坐标程序化地铺满「车道」，并让每个箭头沿
 * 逐顶点自动判定的流向连续滚动，因此：
 * - 完全在 GPU 上推进，帧率稳定、运动连续平滑，没有逐帧重建实体的抖动；
 * - 箭头方向严格跟随河道流向（包括弯道处方向的连续旋转）；
 * - 箭头密度、长度、宽度、速度、亮度、颜色都可以实时调整。
 *
 * 着色原理：取局部流向 dir 与其法向 side，把公里坐标分解为
 * 顺流坐标 along = dot(km, dir) 与横向坐标 across = dot(km, side)；
 * 横向按 spacing 划分车道，顺流方向用 fract 生成首尾相接的箭头周期，
 * 再叠加时间偏移即可得到连续滚动的动态箭头。
 *
 * 提供多种样式（彗星 / 箭头 / 人字 / 短划 / 光点），
 * 都在同一段着色器里按样式编号分支绘制，切换样式无需重建网格。
 */
export type FlowArrowStyle = 'comet' | 'arrow' | 'chevron' | 'dash' | 'dot'

export const FLOW_ARROW_STYLES: Array<{ value: FlowArrowStyle; label: string }> = [
  { value: 'comet', label: '彗星' },
  { value: 'arrow', label: '箭头' },
  { value: 'chevron', label: '人字' },
  { value: 'dash', label: '短划' },
  { value: 'dot', label: '光点' }
]

const FLOW_STYLE_INDEX: Record<FlowArrowStyle, number> = {
  comet: 0,
  arrow: 1,
  chevron: 2,
  dash: 3,
  dot: 4
}

export type RiverFlowArrowParams = {
  /** 箭头样式 */
  style: FlowArrowStyle
  /** 箭头间距（公里），同时是顺流方向的滚动周期 */
  spacing: number
  /** 箭头长度，占间距的比例 */
  length: number
  /** 箭头最大宽度（公里） */
  width: number
  /** 滚动速度 */
  speed: number
  /** 亮度（不透明度） */
  intensity: number
  /** 箭头颜色 */
  color: string
}

/** 与水层共用顶点着色器（同样的 st / aDepth / aFlow 属性）。 */
export const RIVER_FLOW_VERTEX_SHADER = RIVER_WATER_VERTEX_SHADER

/** 箭头层的片元着色器：调用材质源码里的 rwFlowArrows。 */
export const RIVER_FLOW_FRAGMENT_SHADER = `
in vec3 v_positionEC;
in vec2 v_st;
in float v_depth;
in vec2 v_flow;

void main() {
  float time = mod(float(czm_frameNumber), 20000.0) * 0.016;
  vec4 arrow = rwFlowArrows(v_st, v_depth, v_flow, time);
  if (arrow.a <= 0.002) {
    discard;
  }
  out_FragColor = arrow;
}
`

const RIVER_FLOW_MATERIAL_SOURCE = `
float rwFlowHash(float p) {
  vec2 p2 = fract(vec2(p) * vec2(4.438975, 3.972973));
  p2 += dot(p2.yx, p2.xy + 19.19);
  return fract(p2.x * p2.y);
}

vec4 rwFlowArrows(vec2 st, float depth, vec2 flow, float time) {
  if (depth <= 0.4) {
    return vec4(0.0);
  }
  float flowLength = length(flow);
  if (flowLength < 0.5) {
    return vec4(0.0);
  }
  vec2 dir = flow / flowLength;
  vec2 side = vec2(-dir.y, dir.x);

  vec2 km = st * u_flowUvScale;
  float along = dot(km, dir);
  float across = dot(km, side);

  float spacing = max(u_flowSpacing, 0.08);
  float lane = floor(across / spacing) + 0.5;
  float shift = across - lane * spacing;
  // 每条车道错开相位，避免所有箭头排成一条直线
  float offset = rwFlowHash(lane) * 0.87;
  float phase = fract(along / spacing - time * u_flowSpeed * 0.003 + offset);

  float travel = clamp(u_flowLength, 0.05, 0.95);
  if (phase >= travel) {
    return vec4(0.0);
  }
  float head = phase / travel;
  float halfWidth = max(u_flowWidth, 0.005) * 0.5;
  float lateral = abs(shift);

  float alpha = 0.0;
  vec3 tint = u_flowColor.rgb;

  if (u_flowStyle < 0.5) {
    // 彗星：尾部细、头部粗，两端淡出
    float width = halfWidth * (0.08 + 0.92 * pow(head, 2.5));
    alpha = 1.0 - smoothstep(0.5, 1.0, lateral / max(width, 1e-4));
    alpha *= smoothstep(0.0, 0.35, head) * (1.0 - smoothstep(0.86, 1.0, head));
    tint *= 0.7 + 0.6 * head;
  } else if (u_flowStyle < 1.5) {
    // 箭头：细杆 + 三角箭头
    float shaft = head < 0.7 ? 1.0 - smoothstep(0.5, 1.0, lateral / max(halfWidth * 0.3, 1e-4)) : 0.0;
    float tip = max(1.0 - (head - 0.58) / 0.42, 0.0);
    float triangle = head > 0.56 ? 1.0 - smoothstep(0.6, 1.0, lateral / max(halfWidth * tip, 1e-4)) : 0.0;
    alpha = max(shaft, triangle) * smoothstep(0.0, 0.2, head);
    tint *= 0.75 + 0.45 * head;
  } else if (u_flowStyle < 2.5) {
    // 人字：两撇由张开收敛到下游尖点
    float v = lateral / max(halfWidth, 1e-4);
    float armCenter = 1.0 - head;
    float arm = 1.0 - smoothstep(0.35, 0.85, abs(v - armCenter) / 0.45);
    alpha = arm * smoothstep(0.0, 0.15, head) * (1.0 - smoothstep(0.9, 1.0, head));
  } else if (u_flowStyle < 3.5) {
    // 短划：等宽细划，首尾淡出
    float v = lateral / max(halfWidth * 0.35, 1e-4);
    alpha = (1.0 - smoothstep(0.5, 1.0, v)) * smoothstep(0.0, 0.18, head) * (1.0 - smoothstep(0.82, 1.0, head));
  } else {
    // 光点：公里尺度上的圆形光斑顺流漂移
    float dashLength = travel * spacing;
    vec2 q = vec2((head - 0.5) * dashLength, shift) / max(halfWidth * 0.8, 1e-4);
    float radius = length(q);
    alpha = 1.0 - smoothstep(0.5, 1.0, radius);
    tint *= 0.8 + 0.5 * (1.0 - smoothstep(0.0, 1.2, radius));
  }

  alpha *= u_flowIntensity;
  alpha *= smoothstep(0.4, 2.5, depth);
  if (alpha <= 0.002) {
    return vec4(0.0);
  }
  return vec4(tint, clamp(alpha, 0.0, 1.0));
}
`

const DEFAULT_UV_SCALE = new Cartesian2(1, 1)

export function createRiverFlowMaterial(params: RiverFlowArrowParams): Material {
  return new Material({
    fabric: {
      type: 'RiverChannelFlow',
      uniforms: {
        u_flowStyle: FLOW_STYLE_INDEX[params.style] ?? 0,
        u_flowSpacing: params.spacing,
        u_flowLength: params.length,
        u_flowWidth: params.width,
        u_flowSpeed: params.speed,
        u_flowIntensity: params.intensity,
        u_flowColor: Color.fromCssColorString(params.color),
        u_flowUvScale: Cartesian2.clone(DEFAULT_UV_SCALE)
      },
      source: RIVER_FLOW_MATERIAL_SOURCE
    }
  })
}

/** 把最新的箭头参数写回材质 uniforms。 */
export function updateRiverFlowMaterial(material: Material, params: RiverFlowArrowParams): void {
  const uniforms = material.uniforms
  if (!uniforms) return
  Color.fromCssColorString(params.color, uniforms.u_flowColor)
  uniforms.u_flowStyle = FLOW_STYLE_INDEX[params.style] ?? 0
  uniforms.u_flowSpacing = params.spacing
  uniforms.u_flowLength = params.length
  uniforms.u_flowWidth = params.width
  uniforms.u_flowSpeed = params.speed
  uniforms.u_flowIntensity = params.intensity
}

/** 让箭头密度与河段真实尺寸匹配（公里坐标）。 */
export function setRiverFlowUvScale(material: Material, widthMeters: number, heightMeters: number): void {
  const uniforms = material.uniforms
  if (!uniforms?.u_flowUvScale) return
  uniforms.u_flowUvScale.x = Math.max(widthMeters / 1000, 0.05)
  uniforms.u_flowUvScale.y = Math.max(heightMeters / 1000, 0.05)
}
