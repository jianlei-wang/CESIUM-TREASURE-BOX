/**
 * 「数据转换-矢量数据转换」案例的功能实现说明文案。
 */

export type HelpItem = {
  key: string
  title: string
  summary: string
  detail: string[]
}

export const VECTOR_CONVERTER_HELP: HelpItem[] = [
  {
    key: 'format',
    title: '多格式自动识别与解析',
    summary: '按扩展名与文件头嗅探识别 GeoJSON、KML、KMZ、奥维、GPX、WKT、CSV、SHP 等格式。',
    detail: [
      '导入时先按扩展名判断，再对文本文件做内容嗅探：JSON 判断 FeatureCollection / Topology / ObjItems，XML 判断 gpx 或 kml，纯文本匹配 WKT 关键字。',
      '所有格式统一解析为 WGS84 的 GeoJSON 中间模型（含几何、属性与分组路径），实现 N+N 的转换，避免两两适配。',
      'ZIP 包自动解压：KMZ / OVKMZ 读取其中的 doc.kml，SHP 压缩包交给 shapefile 解析器自动关联 .shp/.dbf/.shx/.prj。'
    ]
  },
  {
    key: 'crs',
    title: '坐标系转换',
    summary: '在 WGS84、CGCS2000、GCJ02、BD09 与投影坐标系之间转换。',
    detail: [
      '导入时按所选源坐标系把坐标统一纠偏到 WGS84，导出时再转换为目标坐标系，保证专题数据与底图套合准确。',
      'GCJ02 / BD09 采用国测局加密算法及其逆算法转换；投影坐标系（Web 墨卡托、高斯投影）通过 proj4 定义进行投影正反算。',
      'CGCS2000 与 WGS84 差异小于 0.1mm，工程上近似等同；奥维数据默认为 GCJ02，导入后需做纠偏以免出现百米级偏移。'
    ]
  },
  {
    key: 'ov',
    title: '奥维数据解析与分组',
    summary: '解析奥维 OVJSN / OVOBJ（JSON 形态）并保留分组层级。',
    detail: [
      '按 Type 编码识别对象：标签(7) 为点、轨迹(8) 与路线(10) 为线、图形(9) 为面、分组(30) 为容器，递归处理 ObjChildren。',
      '分组结构映射为中间模型的分组树与要素的分组路径，导出奥维格式时再还原为嵌套的 ObjItems。',
      '早期二进制形态的 OVOBJ 未公开结构，导入时会提示在奥维中「另存为 OVJSN」后重新导入。'
    ]
  },
  {
    key: 'preview',
    title: '三维预览',
    summary: '解析结果实时上图，支持缩放定位与开关显示。',
    detail: [
      '解析完成后用 GeoJsonDataSource 将中间模型加载到 Cesium 场景，按点/线/面分别着色，并自动缩放到数据范围。',
      '要素数量超过阈值时提示大数据量场景的性能影响；切换数据时及时释放旧数据源，避免 GPU 资源堆积。',
      '可控制图层显示与透明度，便于与影像、地形叠加核对数据的空间位置。'
    ]
  },
  {
    key: 'export',
    title: '格式导出与点位表格',
    summary: '导出为 GeoJSON、KML/KMZ、奥维、GPX、WKT、CSV、SHP，点位矢量可导出为表格。',
    detail: [
      '导出前按目标坐标系转换坐标；面要素导出 SHP 时按点/线/面分组打包为 ZIP，包含 .shp/.shx/.dbf/.prj 伴生文件。',
      '当数据包含点位要素时，额外提供「导出为表格」：输出含名称、经纬度、高程及全部属性列的 Excel(.xlsx) 表格。',
      'CSV 导出同样仅针对点位矢量，便于与表格数据源互相转换；非点位要素会被忽略并给出提示。'
    ]
  }
]
