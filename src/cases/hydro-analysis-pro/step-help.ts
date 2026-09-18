export type StepHelp = {
  key: number
  title: string
  principle: string
  implementation: string
  outputs: string
}

export const STEP_HELP: StepHelp[] = [
  {
    key: 1,
    title: 'DEM 采样',
    principle: 'DEM（数字高程模型）把区域地形离散为规则网格，每格记录一个高程值，是后续填洼、流向、汇流等水文分析的基础输入。',
    implementation: '本步骤通过 Cesium 的 sampleTerrainMostDetailed 对 Cesium World Terrain 逐格请求真实高程，按“列数/行数”或“设定间距”两种方式决定网格密度，分批采样并交还主线程更新进度。',
    outputs: '产出：原始 DEM 高程栅格（Float32，可直接导出 GeoTIFF 用于 GIS）。'
  },
  {
    key: 2,
    title: '洼地填平',
    principle: '洼地（sink）是比四周都低的封闭单元，水流无法流出。真实 DEM 常含噪声洼地，若不填平会阻断流向计算；填平把内部低点抬升到能流出区域的高程，边界最低点仍可作合法出水口。',
    implementation: '采用“边界播种 + 优先级队列”的 priority-flood 算法：从边界向内部逐级抬升被淹没的洼地单元，同时统计抬升格数与最大抬升量。',
    outputs: '产出：填洼后 DEM 栅格与抬升量栅格，均可导出 GeoTIFF。'
  },
  {
    key: 3,
    title: 'D8 流向',
    principle: 'D8 单流向法把每个格子的水流分配给 8 邻域中坡度最陡的邻格。当相邻格无法再下降时视为流出；平坦区借助已确定的低邻方向回溯来消歧。',
    implementation: '对每格计算 8 个方向的加权最大坡降（对角距离按 √2 折算），得到 0~7 的方向编码；平坦单元向已解析且更低的方向回溯取流，保证除边界出口外不存在内部死点。',
    outputs: '产出：D8 流向编码栅格（0~7 对 8 方位）与图上彩色流向箭头。'
  },
  {
    key: 4,
    title: '汇流累积量',
    principle: '汇流累积量表示每格上游汇入的格子数量，数值越大的格越接近河谷，是提取河网的依据。',
    implementation: '先按 D8 拓扑统计每格上游数目，再用队列自上游向下游归并累加，一次性得到全区域的累积量（最大值为整片区域的总格数）。',
    outputs: '产出：汇流累积栅格（对数配色展示），数值可直接导出 GeoTIFF 做阈值分析。'
  },
  {
    key: 5,
    title: '提取栅格河网',
    principle: '设定累积量阈值，累积量不小于阈值的格子被判定为河道像元，从而在栅格上刻画河网拓扑与链段连接关系。',
    implementation: '按当前阈值在累积栅格上二值化，再沿 D8 方向把首尾相接的河道像元聚成“链段”，并记录每条链段的像元序列，供下一步矢量化与统计。',
    outputs: '产出：栅格河网二值栅格（0/1 掩膜）与链段统计，掩膜可导出 GeoTIFF。'
  },
  {
    key: 6,
    title: '河网矢量化',
    principle: '把栅格河网从像元网格转成矢量线要素，输出每段河道的折线坐标并携带属性，便于在 GIS 中编辑、量算与出图。',
    implementation: '把每条链段的中心点序列按顺序展开为折线顶点，生成带 id、链段像元数等属性的矢量河段列表。',
    outputs: '产出：矢量河段（每条含 id、顶点数与长度属性），可导出 GeoJSON 或 SHP（shp+dbf，压缩为 zip）。'
  },
  {
    key: 7,
    title: '拾取倾泻点与汇水流域',
    principle: '倾泻点是流域出口；给定出口后，沿 D8 流向反向往上游回溯，凡能汇入该出口的格子共同构成该点上游的汇水（集水）区域。',
    implementation: '地图单击后取最近的高累积像元吸附为倾泻点，从该点沿 D8 反向做深度优先回溯生成流域掩膜，再用“网格边平面图 + 最长闭合环”提取流域边界轮廓，地图上以半透明色块、描边多边形与编号标注呈现。',
    outputs: '产出：每个倾泻点一个流域（含像元数、轮廓点数属性）与倾泻点位置，可导出为栅格掩膜（tif）或矢量多边形（GeoJSON / SHP）。'
  }
]

export function stepHelpByKey(key: number): StepHelp | undefined {
  return STEP_HELP.find((item) => item.key === key)
}
