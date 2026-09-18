# Cesium酱の百宝箱系统迭代记录

本文档记录系统从展示原型向可持续扩展的 Cesium 案例平台演进过程。每轮迭代记录目标、实施内容、验证结果和后续约定。

## 迭代总览

| 版本 | 日期 | 主题 | 状态 |
| --- | --- | --- | --- |
| V0.1 | 2026-08-21 | 展示型案例中心原型 | 已完成 |
| V0.2 | 2026-08-21 | 案例工程化、Cesium 初始化和数量联动 | 已完成 |
| V0.3 | 2026-08-21 | 初始化错误修复、完整案例入口和离线字体 | 已完成 |
| V0.4 | 2026-08-21 | 卡片直达完整案例与 Cesium 默认纹理隔离 | 已完成 |
| V0.5 | 2026-08-21 | 默认加载 ArcGIS 影像服务 | 已完成 |
| V0.6 | 2026-08-21 | 地图全屏自适应与影像服务降级 | 已完成 |
| V0.7 | 2026-08-21 | 默认底图切换为天地图 | 已完成 |
| V0.8 | 2026-08-21 | 仅保留天地图底图与依赖预构建修复 | 已完成 |
| V0.9 | 2026-08-21 | 地图初始化公共模块提炼 | 已完成 |
| V1.0 | 2026-08-21 | 卡片信息重构与性能监控面板 | 已完成 |
| V1.1 | 2026-08-21 | 案例截图 icon 参数与卡片缩略图 | 已完成 |
| V1.2 | 2026-08-21 | 整体代码清理与依赖精简 | 已完成 |
| V1.3 | 2026-08-22 | 本地矢量数据加载案例 | 已完成 |
| V1.4 | 2026-08-22 | 矢量图层清单与显隐移除 | 已完成 |
| V1.5 | 2026-08-22 | 图层显隐开关修复与要素属性拾取 | 已完成 |
| V1.6 | 2026-08-22 | 矢量卡片图标、天地图署名与属性面板位置 | 已完成 |
| V1.7 | 2026-08-22 | 隐藏 Cesium ion 默认署名 | 已完成 |
| V2.8 | 2026-08-23 | 地形加载提示与天气案例卡片统一 | 已完成 |
| V2.9 | 2026-08-23 | 本地表格点图层与 Cesium 内置动态水面 | 已完成 |
| V3.0 | 2026-08-23 | 表格点位多 Sheet 图层与属性面板优化 | 已完成 |
| V3.1 | 2026-08-23 | 多 Sheet 独立字段映射 | 已完成 |
| V3.2 | 2026-08-23 | 案例图标更新与全局滚动条优化 | 已完成 |
| V3.3 | 2026-08-23 | 首页案例滚动、最新排序与状态信息 | 已完成 |
| V3.4 | 2026-08-23 | 首页视口锁定、系统 Logo 与 Cesium 版本标识 | 已完成 |
| V3.5 | 2026-08-23 | 影像卷帘对比案例 | 已完成 |
| V3.6 | 2026-08-23 | 卷帘案例图标与手柄拖动 | 已完成 |
| V3.7 | 2026-08-23 | 动态多边形水面 Fabric 材质优化 | 已完成 |
| V3.8 | 2026-08-23 | 动态多边形水面案例图标更新 | 已完成 |
| V3.9 | 2026-08-23 | 相机参数与鼠标位置信息案例 | 已完成 |
| V3.10 | 2026-08-23 | 相机与鼠标案例十进制度与图标更新 | 已完成 |
| V3.11 | 2026-08-23 | GPU 粒子效果案例（火焰/烟雾/爆炸） | 已完成 |
| V3.12 | 2026-08-24 | 粒子效果案例卡片图标更新 | 已完成 |
| V3.13 | 2026-08-24 | 鼠标提示、HTML 弹窗与常规量测案例 | 已完成 |
| V3.14 | 2026-08-24 | 量测提示偏移与线段渲染错误修复 | 已完成 |
| V3.15 | 2026-08-24 | 提示/弹窗图标更新与距离量测交互重构 | 已完成 |
| V3.16 | 2026-08-24 | 空间测量-距离量测更名与四类量测交互统一 | 已完成 |
| V3.17 | 2026-08-24 | 量测可视化增强与三角量测重构 | 已完成 |
| V3.18 | 2026-08-24 | 四类量测更名与方位角/三角地形化改造 | 已完成 |
| V3.19 | 2026-08-24 | 量测图标更新与地形开关动态生效 | 已完成 |
| V3.20 | 2026-08-24 | 三角量测夹角标注位置修正 | 已完成 |
| V3.21 | 2026-08-24 | 双爆炸着色器特效案例（空间反转/噪声云团） | 已完成 |
| V3.22 | 2026-08-24 | 爆炸案例地图指定位置叠加与参数调节 | 已完成 |
| V3.23 | 2026-08-24 | 噪声云团单团地图火焰与坐标跟随修正 | 已完成 |
| V3.24 | 2026-08-24 | 噪声云团迁移为 Cesium GPU 世界坐标火焰 | 已完成 |
| V3.25 | 2026-08-24 | Shadertoy 噪声云团与 GPU 粒子融合 | 已完成 |
| V3.26 | 2026-08-24 | 噪声云团改为 Shadertoy 主导世界坐标公告牌 | 已完成 |
| V3.27 | 2026-08-24 | 消除噪声云团 GPU 状态纹理反馈回路 | 已完成 |
| V3.28 | 2026-08-24 | 基于单次 Bim Boom Bam 着色器重写噪声云团 | 已完成 |
| V3.29 | 2026-08-24 | 消除云团方形边界并开放着色器参数 | 已完成 |
| V3.30 | 2026-08-24 | 扩展云爆参数范围并改为单次生命周期 | 已完成 |
| V3.31 | 2026-08-24 | 统一双爆炸案例的生命周期与参数交互 | 已完成 |
| V3.32 | 2026-08-24 | 移除爆炸特效-空间反转案例 | 已完成 |
| V3.33 | 2026-08-25 | 动态水面倒影与矩形范围深度图 | 已完成 |
| V3.34 | 2026-08-25 | 水面动画参数与深度图交互增强 | 已完成 |
| V3.35 | 2026-08-25 | 参考水域与波动倒影视觉 | 已完成 |
| V3.36 | 2026-08-25 | 水面对象大小与高度控制 | 已完成 |
| V3.37 | 2026-08-25 | 水面对象高度范围调整 | 已完成 |
| V3.38 | 2026-08-25 | 水面边界视角与倒影可见性修复 | 已完成 |
| V3.39 | 2026-08-25 | Primitive 真实水面倒影案例 | 已完成 |
| V3.40 | 2026-08-25 | 真实倒影材质采样器初始化修复 | 已完成 |
| V3.41 | 2026-08-25 | 真实倒影帧缓冲深度纹理格式修复 | 已完成 |
| V3.42 | 2026-08-25 | 真实倒影顶点着色器 varyings 补齐 | 已完成 |
| V3.43 | 2026-08-25 | 真实倒影离屏渲染改用手动场景渲染流程 | 已完成 |
| V3.44 | 2026-08-25 | 真实倒影帧缓冲与材质纹理销毁冲突修复 | 已完成 |
| V3.45 | 2026-08-25 | 移除水面动态倒影与 Primitive 真实倒影案例 | 已完成 |
| V3.46 | 2026-08-25 | 动态水面-Primitive 真实倒影移植 | 已完成 |
| V3.47 | 2026-08-25 | 水面倒影图标替换与地形数据加载 | 已完成 |
| V3.48 | 2026-08-25 | 噪声云团案例图标替换 | 已完成 |
| V3.49 | 2026-08-25 | 深度图案例更名与图标替换 | 已完成 |
| V3.50 | 2026-08-26 | 3DTiles 加载/压平与地球自转案例移植 | 已完成 |
| V3.51 | 2026-08-26 | 3DTiles 加载案例检查器与阴影光源修复 | 已完成 |
| V3.52 | 2026-08-26 | 移除无真实案例的占位卡片 | 已完成 |
| V3.53 | 2026-08-26 | 标点/折线/多边形动态绘制三案例 | 已完成 |
| V3.54 | 2026-08-26 | 绘制案例图标替换与实时预览/开关修复 | 已完成 |
| V3.55 | 2026-08-26 | 点/线/面缓冲区分析三案例 | 已完成 |
| V3.56 | 2026-08-26 | 缓冲区案例图标、边框与端点/拐角样式修复 | 已完成 |
| V3.57 | 2026-08-26 | 动态体积水案例（多边形/矩形几何位移水面） | 已完成 |
| V3.58 | 2026-08-26 | 动态体积水面板精简、丽江默认边界、绘制坐标修复 | 已完成 |
| V3.59 | 2026-08-26 | 动态体积水默认加载 Cesium World Terrain | 已完成 |
| V3.60 | 2026-08-26 | 动态体积水卡片 icon 与三维水深热力案例 | 已完成 |
| V3.61 | 2026-08-26 | 三维水深热力改名与案例卡片 icon | 已完成 |
| V3.62 | 2026-08-27 | 热力图与三维热力图案例 | 已完成 |
| V3.63 | 2026-08-27 | 热力图/三维热力图 icon 与交互缺陷修复 | 已完成 |
| V3.64 | 2026-08-28 | 点位标记与清单、海量线/多边形加载三案例 | 已完成 |
| V3.65 | 2026-08-28 | 深度图提取支持输入四至生成 | 已完成 |
| V3.66 | 2026-08-28 | 深度图四至显示、1024爆栈修复与地图叠加 | 已完成 |
| V3.67 | 2026-08-28 | 深度图叠加报错定位：四至度数误作弧度导致矩形非法 | 已完成 |
| V3.68 | 2026-08-28 | 点位标记与清单：名称与属性字段编辑弹窗 | 已完成 |
| V3.69 | 2026-08-28 | 点位编辑提示改为自动消失的 toast | 已完成 |
| V3.70 | 2026-08-28 | 点位标记/海量线/海量多边形案例卡片 icon 更新 | 已完成 |
| V3.71 | 2026-08-28 | 新增「三维场景演示」Skyline Presentation 能力案例 | 已完成 |
| V3.72 | 2026-08-28 | 三维场景演示改名为基础版并更新卡片 icon | 已完成 |
| V3.73 | 2026-08-28 | 新增海量随机文字与海量随机立方体案例 | 已完成 |
| V3.74 | 2026-08-28 | 海量文字/立方体改名并归入数据可视化分类、更新 icon | 已完成 |
| V3.75 | 2026-08-28 | 新增点聚合（EntityCluster）与 Supercluster 高性能聚合案例 | 已完成 |
| V3.76 | 2026-08-28 | 点聚合基础版 icon 换 image-1；Supercluster 案例修复（层级/bbox 对齐） | 已完成 |
| V3.77 | 2026-08-28 | Supercluster 案例按 OpenThree html 完整移植（setClusterCollection 结构） | 已完成 |
| V3.78 | 2026-08-28 | 移除数据可视化-点聚合(Supercluster)案例及 supercluster 依赖 | 已完成 |
| V3.79 | 2026-08-28 | 新增地形开挖、透视分析、剖面分析三个空间分析案例 | 已完成 |
| V3.80 | 2026-08-28 | 三案例支持手动绘制，移除参考源表述 | 已完成 |
| V3.81 | 2026-08-28 | 修复三案例手动绘制/选点被提示遮罩拦截，剖面图右下显示与未渲染修复 | 已完成 |
| V3.82 | 2026-08-29 | 地形开挖改 ClippingPolygons 修复 depthTest=true 不可见；绘制预览改实时半透明面 | 已完成 |
| V3.83 | 2026-08-29 | 地形开挖改名「空间分析-地形开挖(支持凹边形)」，卡片 icon 换 image-1 | 已完成 |
| V3.84 | 2026-08-29 | 剖面分析支持多类型采样切换、修复起终点标记位置 | 已完成 |
| V3.85 | 2026-08-29 | 修正 icon：image-1 应用于透视分析，可视域分析恢复原图 | 已完成 |
| V3.86 | 2026-08-29 | 首页白屏深度优化：案例异步拆分、Cesium 非阻塞化；通视分析改名与剖面图标更新 | 已完成 |
| V3.87 | 2026-08-29 | Cesium 系统初始化异步预加载：dev 下 cesium 走全局 shim，消除案例打开等待 | 已完成 |
| V3.88 | 2026-08-29 | 新增「空间分析-填挖方分析」案例：多边形区域 TIN 网格采样，计算填挖面积/体积 | 已完成 |
| V3.89 | 2026-08-29 | 填挖方分析增强：新图标、边框贴地、标高线平面（显隐/透明度）、填挖单端显示、精度预设 | 已完成 |
| V3.90 | 2026-08-29 | 新增「数据可视化-ECharts图表」案例：ECharts 离屏渲染转图片，Billboard 叠加三维场景 | 已完成 |
| V3.91 | 2026-08-29 | ECharts 案例增强：换新图标、缩放联动、参数面板、Options 输入 + 坐标/点选动态添加 | 已完成 |
| V3.92 | 2026-08-29 | 新增「3DTiles-大雁塔模型」案例：本地内置模型，支持高度/透明度/着色/精度等参数调整 | 已完成 |
| V3.93 | 2026-08-29 | 修复大雁塔 tileset.json 废弃属性警告：content.url 全部迁移为 content.uri | 已完成 |
| V3.94 | 2026-08-29 | 修复大雁塔模型无法渲染：b3dm 内嵌 glTF 的 KHR_technique_webgl 材质批量转为标准 PBR | 已完成 |
| V3.95 | 2026-08-29 | 「3DTiles-大雁塔模型」案例卡片 icon 替换为上传的 image-1 | 已完成 |
| V3.96 | 2026-08-29 | 新增 Cesium 控件系列 10 案例（罗盘/右键菜单/比例尺/鹰眼/加载遮罩/位置栏/卷帘/气泡/提示/缩放） | 已完成 |
| V3.97 | 2026-08-29 | 右键菜单/比例尺控件案例换用上传图标；修复罗盘 dev 下 cesium shim 缺失 BoundingSphere 导出 | 已完成 |
| V3.98 | 2026-08-29 | 加载遮罩改名「初始化加载控件」并换图；位置栏/气泡换图；移除地图卷帘控件；修复罗盘 shim 缺失 HeadingPitchRange | 已完成 |
| V3.99 | 2026-08-30 | tooltip/zoom-controller 换上传图标；鹰眼改 Bing 街道图并修复 2D 鹰眼同步；修复罗盘内部漫游不可操作与内圈显示 | 已完成 |
| V4.0 | 2026-08-30 | 罗盘/鹰眼案例换上传图标；鹰眼定位改为 2D 范围矩形、低 2 级缩放并黄色矩形框标出主图视野范围 | 已完成 |
| V4.1 | 2026-08-30 | 移植 cesium-chart 桥接库为本地 lib；新增信息发送/模拟迁徙/PM2.5 三个 cesium-chart 样例案例；新增比例符号面案例（面积/半径正比、支持参数设定） | 已完成 |
| V4.2 | 2026-08-30 | 修复 cesium-chart 三案例 Cannot read properties of undefined (reading 'slice') 运行报错；比例符号面卡片换上传图标、边框改用 Polyline 实体（颜色/宽度生效）、数值标签修复为 FILL_AND_OUTLINE 可见 | 已完成 |
| V4.3 | 2026-08-30 | 去除三案例提示文案中的「参考 cesium-chart 仓库 xx 样例」原样例引用；信息发送/模拟迁徙/PM2.5 底图取消亮度/饱和度/对比度压暗调整，恢复正常显示 | 已完成 |
| V4.4 | 2026-08-30 | 信息发送/模拟迁徙/PM2.5 三个案例卡片图标分别更换为上传的 image-1/image-2/image-3 | 已完成 |
| V4.5 | 2026-08-30 | 功能导航菜单由 6 类细化为 11 类并重新归类全部案例；补注册漏收的 widget-map-split 案例；右上标题改为「在线案例库 - 共 X 个」实时计数；左下「持续更新中 · 2025」改为 2026；为右上 Document/Setting/头像三个图标实现使用帮助/界面设置/关于三个模态框 | 已完成 |
| V4.6 | 2026-08-30 | 地图卷帘控件左侧对比底图由 ArcGIS World 街道/影像图改为高德街道/影像图（style=7/6），移除全部 ArcGIS 相关服务引用 | 已完成 |
| V4.7 | 2026-08-30 | 地图卷帘控件案例卡片 icon 由 icon.svg 更换为上传的 image-1（icon.webp） | 已完成 |
| V4.8 | 2026-08-30 | 新增数据可视化案例「三维体素-地层体素数据」：手写 VoxelProvider 加载体素分层数据，支持网格密度/分层深度/体块尺寸/步长实时调整 | 已完成 |
| V4.9 | 2026-08-30 | 体素案例布局调整：参数调整面板移入界面右侧（与其他案例一致）；鼠标悬停地层的信息面板单独置于界面左上侧 | 已完成 |
| V5.0 | 2026-08-30 | 新增「三维地层-钻孔建模」案例：19 处钻孔 IDW 插值生成起伏嵌套地层体素，支持整体/分层显隐与展开合并；CesiumJS 卡顿排查 20 条清单融入首页（深色风格全屏文档） | 已完成 |
| V5.1 | 2026-08-30 | 修复钻孔案例 GL_INVALID_OPERATION 渲染错误与低帧率；排查清单页代码块去水平滚动条、目录移至左侧、版本改为 CesiumJS 1.144.0 | 已完成 |
| V5.2 | 2026-08-30 | 钻孔案例渲染引擎重构：体素由 VoxelPrimitive 光线步进改为 BoxGeometry 实例化几何光栅化，新增岩芯钻孔与显示隐藏、展开间距 0-10/0.1、步长含义说明、鼠标拾取位置高亮 | 已完成 |
| V5.3 | 2026-08-30 | 钻孔案例地层建模范围改为钻孔覆盖范围的最小外接矩形并四周外扩十分之一 | 已完成 |
| V5.4 | 2026-08-30 | 钻孔案例修复地层双倍缩放根因：范围回归钻孔外扩并相机对准可见 | 已完成 |
| V5.5 | 2026-08-30 | 钻孔案例地层渲染回归体素：每层一个 VoxelPrimitive 光线步进 | 已完成 |
| V5.6 | 2026-08-30 | 钻孔建模与体素地层案例卡片 icon 替换为用户上传图片 | 已完成 |
| V6.0 | 2026-08-31 | 洪水淹没模拟新案例：GPU 双缓冲流体模拟 + 光线步进水渲染 | 已完成 |
| V6.1 | 2026-08-31 | 洪水模拟增强地形数据 + 新增深度图提取与洪水模拟一体化案例（公共库抽取） | 已完成 |
| V6.1.1 | 2026-08-31 | 洪水模拟盒体高程对齐真实地形 + 就绪提示不阻塞地图操作 | 已完成 |
| V6.1.2 | 2026-08-31 | 修复洪水模拟三反馈：盒体四至弧度bug放大44倍 + 操作提示改非遮罩toast + 框选矩形实时预览与模拟范围一致 | 已完成 |
| V6.1.3 | 2026-08-31 | 修复洪水模拟不贴地根因：simParams 不随 ui 同步 minElevation/maxElevation，盒体悬浮于默认高程区间 | 已完成 |
| V6.1.4 | 2026-08-31 | 洪水反馈三连修：全局 70 案例状态提示统一非遮罩 + 深度图绘制矩形贴地/预览面板矩形显隐 + 修复深度图生成后出水点点击选择失效 | 已完成 |
| V6.1.5 | 2026-08-31 | 洪水水面按浅/深水区颜色梯度渐变渲染：渐变深度改为可调 uniform（默认0.3），两案例 UI 增加「颜色渐变深度」滑杆实时调节 | 已完成 |
| V6.1.6 | 2026-08-31 | 洪水淹没模拟卡片 icon 换 image-1、深度图洪水模拟卡片 icon 换 image-2（icon.webp，修复深度图案例缺图标） | 已完成 |
| V6.1.7 | 2026-08-31 | 新增 10 个 dc-sdk 动态效果案例（动画圆/消逝圆/模糊圆/扩散圆/螺旋圆/脉冲圆/多彩圆/雷达线/雷达图片/波纹雷达），共享材质库 dc-effects-lib 注册 9 种 Fabric 材质，全部归入三维特效分类 | 已完成 |
| V6.1.8 | 2026-08-31 | 消逝圆/模糊圆/扩散圆三个卡片 icon 换新图；修复动画圆静态问题（CircleRing shader 死变量 time 未参与渲染，重构为呼吸缩放）；雷达图片/波纹雷达新增 RadarOuter 同心圆环范围圈线并支持显隐开关 | 已完成 |
| V6.1.9 | 2026-08-31 | 动画圆/螺旋圆/脉冲圆三个卡片 icon 换新图（image-1/2/3），三维特效分类 10 个案例全部补齐图标 | 已完成 |
| V6.1.10 | 2026-08-31 | 雷达线 icon 换 image-1、雷达图片 icon 换 image-2、多彩圆 icon 换 image-3 | 已完成 |
| V6.1.11 | 2026-08-31 | 波纹雷达卡片 icon 换 image-1，三维特效分类 10 个案例图标全部更新为新图 | 已完成 |
| V6.2.0 | 2026-09-01 | 数据可视化-视频效果 3 案例（平面视频/视频融合/视频融合羽化） | 已完成 |
| V6.2.1 | 2026-09-01 | 视频效果 3 案例卡片 icon 换用户新图（image-2/1/3） | 已完成 |
| V6.3.0 | 2026-09-01 | 案例搜索升级为全局搜索（跨分类按名称与描述检索） | 已完成 |
| V6.4.0 | 2026-09-01 | 三维特效-墙体 3 案例（基础墙体/流动墙体/流动图片墙体） | 已完成 |
| V6.4.1 | 2026-09-01 | 墙体 3 案例 icon 采用用户上传图（基础=image-3/流动=image-2/流动图片=image-1） | 已完成 |
| V6.5.0 | 2026-09-01 | 三维特效-线 5 案例（材质线/图片轨迹线/流动线/闪烁线/发光轨迹线） | 已完成 |
| V6.5.1 | 2026-09-01 | 线 icon 替换（图片轨迹线=image-3/闪烁线=image-2/发光轨迹线=image-4）；材质线升级 10 种材质样例；流动线新增多色模式 | 已完成 |
| V6.5.2 | 2026-09-01 | 三维特效-电弧球体/光锥图元/扩散墙 3 案例（EllipsoidElectric/LightCylinderPrimitive/DiffuseWallPrimitive）；材质线/流动线 icon 换用户图 | 已完成 |
| V6.5.3 | 2026-09-01 | 光锥图元 icon → image-1、电弧球体 icon → image-2；全量清理案例中“基于XXX/参考XXX/移植XXX/仿照XXX”来源表述 | 已完成 |
| V6.5.4 | 2026-09-01 | 三维数据加载-城市建筑白模案例（3DBAG 荷兰全境建筑白模 3D Tiles，LOD 切换 + 渲染/性能参数 + 实时性能统计） | 已完成 |
| V6.5.5 | 2026-09-01 | 城市建筑白模 icon → 用户 image-1；新增自定义着色器/样式+着色器/点光源 3 案例（参考 dc-sdk CustomShader 用法，全部参数可调） | 已完成 |
| V6.5.6 | 2026-09-01 | 白模自定义着色器案例 icon → image-1、样式+着色器案例 icon → image-2 | 已完成 |
| V6.5.7 | 2026-09-01 | 样式+着色器/点光源案例 custom shader 失效修复（normalWC 禁用机制 + 管线顺序适配） | 已完成 |
| V6.6 | 2026-09-02 | 场景示例-国内地图底图 6 案例（高德/百度/谷歌/天地图/腾讯/星图，cesium-map 移植，双方案+坐标系切换，天地图/星图 Key 手动输入） | 已完成 |
| V6.6.1 | 2026-09-02 | 天地图/高德/百度 icon 换用户图；全量清理案例与库中“cesium-map/移植”来源表述；星图底图地址切换至 api.open.geovisearth.com | 已完成 |
| V6.6.2 | 2026-09-02 | 星图/腾讯/谷歌底图案例 icon 换用户图 | 已完成 |
| V6.7 | 2026-09-02 | 空间分析-自定义XYZ坐标轴-拖拽平移案例（红黄绿三轴、悬停高亮/按下加粗、拖动沿轴平移+console 打印+参数设置） | 已完成 |
| V6.7.1 | 2026-09-02 | XYZ 轴案例交互失效修复：轴拾取增加屏幕距离容差（非像素级压线）、拖出 canvas 释放/失焦的拖动结束兜底、hover 频率调优 | 已完成 |
| V6.7.2 | 2026-09-02 | XYZ 轴案例坐标系统误判修正：handler position / Scene.pick / worldToWindowCoordinates 三者统一为 canvas 相对坐标，删除误加的 getBoundingClientRect 偏移 | 已完成 |
| V6.8 | 2026-09-02 | 空间分析-自定义XYZ球形坐标轴-拖拽旋转案例（三轴线+端手柄+垂直旋转示意环，悬停高亮/按下加粗、拖动沿当前轴方向旋转+姿态角同步+console 打印+参数设置） | 已完成 |
| V6.8.1 | 2026-09-02 | XYZ 球形旋转案例视觉改造：移除直线轴与端手柄，仅保留三正交环形轴（环即轴，环法线即旋转轴）作为拾取/高亮/加粗主体 | 已完成 |
| V6.8.2 | 2026-09-02 | 空间分析-自定义XYZ编辑坐标轴-平移/旋转案例：融合 V6.7 平移（直线轴+端手柄）与 V6.8.1 旋转（环形轴）为单个编辑 gizmo，拖直线/手柄平移中心点、拖环形轴绕环法线旋转，操作互不干扰，坐标+姿态实时同步 | 已完成 |
| V6.8.3 | 2026-09-02 | 三个 XYZ 坐标轴系列案例卡片 icon 换用户新图：平移=image-1、球形旋转=image-2、编辑坐标轴=image-3 | 已完成 |
| V6.9 | 2026-09-02 | 空间分析-大雁塔模型XYZ编辑坐标轴-平移/旋转案例：把内置大雁塔 3D Tiles 模型绑定到 xyz 编辑 gizmo（V6.8.2 同款平移/旋转交互），模型 modelMatrix=T(中心)·R·T(-锚点) 与 gizmo 刚性联动，平移改中心、旋转改姿态互不干扰 | 已完成 |
| V6.9.1 | 2026-09-02 | 大雁塔模型XYZ编辑坐标轴-平移/旋转案例卡片 icon → 上传的 image-1（1234×638） | 已完成 |
| V6.10 | 2026-09-02 | 空间分析-多边形深度图与等高线案例（手动绘制多边形→地形采样→深度图+等高线，无 icon） | 已完成 |
| V6.10.1 | 2026-09-02 | 修复等高线断线：逐格短段改为首尾成链（chaining）并去除单段长度过滤 | 已完成 |
| V6.10.2 | 2026-09-02 | 多边形深度图与等高线案例卡片 icon → 上传的 image-1（1235×649） | 已完成 |
| V6.11 | 2026-09-03 | 空间分析-多边形坡度/坡向案例（手动绘制多边形→地形采样→坡度图+8 方向坡向箭头，无 icon） | 已完成 |
| V6.11.1 | 2026-09-03 | 多边形坡度/坡向案例卡片 icon → 上传的 image-1（1235×657） | 已完成 |
| V6.12 | 2026-09-03 | 空间分析-多边形地形压平案例（手动绘制多边形→地形采样→整平为水平面，无 icon） | 已废弃（视觉假面，V6.13 以真实地形数据压平重做） |
| V6.13 | 2026-09-03 | 地形压平改为「修改真实地形数据」实现：拦截 CesiumTerrainProvider.requestTileGeometry，将多边形内 quantized-mesh 顶点改写至同一整平高度（真正铲平地形，非覆盖贴面） | 已完成 |
| V6.14 | 2026-09-03 | 修复 V6.13 调参/撤销黑屏：terrain provider 改为单例包装（controller 可变 flatten state，不再整体替换 provider）+ 仅失效与多边形相交的已加载瓦片 | 已完成 |
| V6.15 | 2026-09-03 | 空间分析-水文分析全流程案例（真实地形采样→填洼→D8 流向→汇流累积→栅格/矢量河网→倾泻点→汇水流域，按步骤逐步执行，无 icon） | 已完成 |
| V6.15.1 | 2026-09-04 | 水文分析案例改名「空间分析-水文分析(基础版)」并换用上传的 image-1 作卡片 icon（icon.webp 复制入案例目录，不引用临时文件路径） | 已完成 |
| V6.16 | 2026-09-04 | 新增「空间分析-水文分析(升级版)」：采样支持按行列数 / 按间距(米)互斥切换；逐步成果集中到页面左上方「分析成果」面板（DEM/填洼/抬升/流向/累积/栅格河网/矢量河段/流域），栅格导出 GeoTIFF、矢量导出 GeoJSON 或 SHP(含属性)；每步带原理与实现说明帮助图标 | 已完成 |
| V6.17 | 2026-09-04 | 新增「洪水淹没·GPU SPH粒子流线」案例：自动示例采样真实地形→DEM 水位求淹深→GPU SPH 粒子→GPU 流线，叠加真实地形贴合；支持上传 GeoTIFF/PNG/JPG 栅格与矩形框选采样 | 已完成 |
| V6.19 | 2026-09-06 | 新增「三维数据加载-glTF/GLB 模型查看器」案例：远程 URL/本地文件/文件夹加载 Model.fromGltfAsync，支持位置/旋转/缩放/外观/阴影/日照/自动旋转/八城市视角与地形开关，无 icon | 已完成 |
| V6.19.1 | 2026-09-06 | glTF/GLB 模型查看器案例收尾：卡片 icon → 上传的 image-1（1235×647，icon.webp 复制入案例目录）；右侧面板样式对齐通用深蓝玻璃控制面板（compact 浮卡、去渐变标题栏、navy-glass 配色、按钮/滑块/输入通用 token）；移除「快捷位置」八城市视角 | 已完成 |
| V6.20 | 2026-09-07 | 新增「综合态势标绘控件」案例（category widgets 界面控件、id situation-plotting、卡片 icon=上传 image-1）：可复用库 src/cases/situation-plotting-lib/ 复用 military-plotting-lib 21 种几何绘制/编辑，叠加文本/图片/模型三类点标注（放置/选择/移动/旋转/缩放/属性实时修改），多坐标系导出 GeoJSON/SHP | 已完成 |
| V6.21 | 2026-09-07 | 新增 3 案例：天气特效分类「天气特效-沙尘暴」（PostProcessStage 全屏后处理，id weather-sandstorm）与界面控件分类「场景截图控件 / 区域截图控件」（widget-scene-shot / widget-region-shot，双建 preserveDrawingBuffer Viewer、resolutionScale 清晰度、PNG/JPG 下载，区域版两次左键框选→飞行至选区→截图），三者均无 icon | 已完成 |
| V6.21.1 | 2026-09-07 | 三案例卡片 icon 补充（image-1/image-2/image-3 → icon.webp）；区域截图控件按用户反馈重构为「页面遮罩拖拽框选」：全案例区覆盖 crop-mask 遮罩、鼠标拖拽拉出矩形、松开自动按所选区域导出 PNG/JPG「区域图鉴-*」并下载，去除两击+飞行流程 | 已完成 |
| V6.21.2 | 2026-09-08 | 修复区域截图控件地图场景不可见：`new Viewer` 误挂到外层 `.widget-shell` 导致 Cesium 布局注入把 canvas 挤出可视区，改回挂在 `.cesium-container` 地图容器 | 已完成 |
| V6.22 | 2026-09-08 | 首屏性能工程优化：案例目录自动扫描生成 manifest（新增案例不再改中央注册文件）、首页移除 Cesium.js 注入与 186 个 case 静态 import（主入口 218.3→184.8KB，首页不再下载 Cesium），Cesium 改为悬停卡片/点击案例时按需注入，dev+build 产物 index.html 均无 Cesium 引用 | 已完成 |
| V6.23 | 2026-09-08 | 新增「可视化大屏」分类与 demo0 样板屏（SC-DATAV 参考的 demos0-3 平移第一阶段）：独立 `src/datav/` 子树 + 原生 Three.js 命令式实现，案例桥接壳 datav-demo0 无 icon，全屏沉浸式 | 已完成(阶段一) |
| V6.23.1 | 2026-09-08 | 修复 demo0 顶面地图与侧壁轮廓不匹配：投影由等距经纬度改为墨卡托(等角)（参考工程与 sc_map 纹理均基于墨卡托制作，等距近似使平面宽高比 1.35 比纹理 1.168 横向多拉约 16%） | 已完成 |
| V6.23.2 | 2026-09-08 | 修复 demo0 顶面卫星图与地面黑色轮廓仍不一致：V6.23.1 手写北朝上墨卡托后再 Vector2(x,-y)，相对 d3 geoMercator 多翻了一次 Y。改为直接调用 d3-geo 的 geoMercator().center().translate([0,0])，与参考工程相同 | 已完成 |
| V6.24 | 2026-09-10 | 滑坡动态模拟去掉合成山谷，仅保留真实地形采样；框选交互对齐水文分析(升级版)：示例区域/框选区域、两点矩形、完成后清除旧采样区与源区并自动 DEM 采样分析 | 已完成 |
| V6.25 | 2026-09-10 | 滑坡动态模拟地形分析支持精度设定：对齐水文分析(升级版)的按行列数/按间距，网格随精度变化并自动重采样 | 已完成 |
| V6.26 | 2026-09-10 | 新增「温度曲面可视化」案例（测温点 IDW 插值三维曲面，参数可调，无 icon）；滑坡动态模拟卡片 icon 采用上传 image-1 | 已完成 |
| V6.27 | 2026-09-10 | 新增「自定义时间轴控件」案例（界面控件，无 icon）：绑定 viewer.clock，覆盖播放/暂停/反向、倍率、点击跳转、指针刮擦、时间窗平移与滚轮缩放、循环/钳制/自由、实时模式，提供极光丝带/日晷环轨/胶片光轨三种样式与光照/阴影开关；温度曲面案例卡片 icon 采用上传 image-1 | 已完成 |
| V6.28 | 2026-09-10 | 时间轴控件的光照/阴影/实时开关图标化内嵌至播放条，实时模式跳转当前时刻并居中时间窗 | 已完成 |
| V6.29 | 2026-09-10 | 新增「标准图层树控件」案例（界面控件，无 icon）：按设计文档实现框架无关的图层树核心（LayerTreeModel + Adapter 注册表 + LayerTreeControl）与可选 Vue 面板 LayerTreePanel，统一管理影像/地形/3D Tiles/数据源/实体/图元/模型/粒子图层，支持分组、显隐三态、透明度、拖拽排序、搜索高亮、右键菜单、快捷键、定位飞行、序列化导出 | 已完成 |
| V6.30 | 2026-09-10 | 图层树控件交互优化：新增控件使用说明（数据类型 + 关键方法）；新增图层改为「选类型(可关闭弹窗) → 填表单 → 完成」并保留快捷模板；修复部分类型定位报错（模型/图元/粒子改用相机飞行）；修复拖动透明度滑块误触发图层移动；右键「图层设置」改名「样式设置」并实现通用样式表单；「展开全部/收起全部」合并为双态单按钮 | 已完成 |
| V6.31 | 2026-09-10 | 标准图层树控件卡片 icon 采用上传 image-1；自定义时间轴控件卡片 icon 采用上传 image-2；修复从案例返回列表时因 viewer 已销毁仍访问 `viewer.scene` 导致的 `Cannot read properties of undefined (reading 'scene')` | 已完成 |
| V6.32 | 2026-09-12 | 新增「GPU 泥石流地形侵蚀」案例（analysis 分类，无 icon）：Cesium World Terrain 真实高程 + 512×512 RGBA32F 双缓冲 RTT，二维浅水方程（MacCormack 预测-校正 + Well-Balanced 静水重构）+ HBP 本构 + 超额剪切应力侵蚀沉积 MRT 等 GPU Pass，CFL 自适应多子步，笔刷注入水/沙/障碍，水深/流速/侵蚀/复合四模式可视化 | 已完成 |
| V6.33 | 2026-09-12 | 修复泥石流案例运行时片元着色器编译错误（OIT 重写输出导致 `outColor` 缺少 location）；新增中国山区预设区域（甘肃舟曲/四川汶川/云南蒋家沟）与自定义矩形框选重建模拟区域 | 已完成 |
| V6.33.1 | 2026-09-12 | 修复泥石流案例相机跳转错误：`domain.rectangle` 边界为弧度却被当作度传入 `Rectangle.fromDegrees`，导致初始、预设与自定义框选全部飞到错误经纬度；改为 `CesiumMath.toDegrees` 换算后按度数四边外扩再飞行 | 已完成 |
| V6.34 | 2026-09-12 | 泥石流案例：新增贴地青色模拟区域边界 Entity 并在每次重建区域后刷新；相机改用 `flyToBoundingSphere` 对准范围对象避免跳转出界；新增笔刷覆盖网格虚影（鼠标实时显示，可开关）；自定义框选后支持切换网格精度（256～1024）并重建区域 | 已完成 |
| V6.35 | 2026-09-12 | 泥石流案例体验与能力升级：笔刷半径收窄至 1～10 格；虚影支持不透明度（默认 0.6）与障碍品红可视化；覆盖层细分/抬升/polygonOffset + 拾取回退修复局部侵蚀不可见；物源改为注水沙混合物、降雨加增益并新增全域开关；新增时间轴历史回溯（GPU 降采样关键帧）、侵蚀范围矢量化（GeoJSON 预览/导出）与侵蚀分析报告 PDF 预览/导出 | 已完成 |
| V6.36 | 2026-09-12 | 泥石流案例显示与交互修复：定位并修复虚影与侵蚀结果被同一区域遮盖（覆盖层 depthTest 与粗 DEM 插值被高精地形深度遮挡），改为覆盖层不参与深度测试；侵蚀着色改用阈值归一化基准，使毫米级侵蚀可见；开始/停止改为开始/暂停（保留状态）；历史关键帧新增停止/继续记录按钮并持续记录；矢量检测改用床面下切深度、阈值改为毫米量级，修复一直「未检测到侵蚀范围」；新增结果图例与说明 | 已完成 |
| V6.37 | 2026-09-12 | 泥石流案例：历史关键帧取消 180 帧上限，未重置前持续滚动记录；新增「整体影响范围」矢量预览与导出（侵蚀/淤积/积水影响的网格按块聚合并纵向合并为矩形多边形），导出属性含区域、时间、面积、最大侵蚀/淤积、平均床面变化、积水格点等；侵蚀矢量导出同步补充面积与下切深度属性 | 已完成 |
| V6.38 | 2026-09-12 | 泥石流案例卡片图标采用上传图一、实时三维 CFD 仿真案例卡片图标采用上传图二；深度定位并修复泥石流案例长时间运行越来越卡直至卡死：历史关键帧无上限增长导致内存爆涨，改为固定内存预算的滚动窗口（约 256 帧，超出覆盖最早帧），移除逐帧多余拷贝并改用轻量计数接口，解除 Vue 时间轴对全量帧对象的响应式依赖，速度箭头改为对象池复用并降低重建频率 | 已完成 |
| V6.39 | 2026-09-16 | 新增「边坡 GNSS 位移预警与三级影响区」分析案例：纯 TS 算法库实现 GNSS 监测网时序仿真（斋藤三阶段 + Fukuzono 反速率）、速率/改进切线角/累计位移/降雨耦合四类判据与升级确认-降级滞回状态机，叠加 IDW 各向异性变形场与能量线（Fahrböschung + Corominas）滑距推演生成核心区/重点区/影响区三级贴地范围，支持阈值与分区参数在线率定、时间轴回放与 PDF/Word 报告导出；案例不配置专属图标 | 已完成 |

| V6.40 | 2026-09-16 | 三案例卡片图标接入 + 参数提示体系：新增通用 `InfoTip.vue` 提示按钮组件；边坡 GNSS 案例新增地图图例（三级分区/坡体边界/监测点/基准站/位移矢量）与 42 处参数指标提示、左侧面板补「业务场景/技术路线/技术方案」说明；海量点聚合与大气案例补齐参数与指标提示；定位并修复大气动态光照案例天空大气未创建（Viewer 硬编码 `skyAtmosphere:false`）导致全部天空大气参数无效 | 已完成 |
| V6.41 | 2026-09-16 | 光照效果 13 案例参数提示与失效修复：为 bloom/color-grading/directional/fxaa/hemisphere/point/rect/shadow/spot/ssao/sun/tonemapping/volumetric 补齐 135 处参数与指标提示；用状态快照探针逐控件验证全部实际生效，并修复太阳光死滑杆、色调映射缺标签、颜色分级与体积光数组型 uniform 报错、实时阴影未启用、SSAO 三个虚构 uniform 改为 Cesium 1.144 实际参数 | 已完成 |
| V6.42 | 2026-09-17 | 三案例图标接入 + 返回列表报错修复：Bloom 泛光/颜色分级/平行光分别接入上传图；定位并修复颜色分级（及同族的体积光）案例返回列表抛 `DeveloperError` —— `PostProcessStageCollection.remove()` 内部已销毁 stage，案例卸载时重复 `destroy()`，改为只调 `remove()` | 已完成 |
| V6.43 | 2026-09-17 | 三案例图标接入 + 半球光（及点/聚光/矩形光）参数不生效根因修复：抗锯齿/半球光/点光源分别接入上传图；定位「参数调整看不出效果」根因为白模 glTF 未给 `metallicFactor`，glTF 默认 metallic=1.0 使 Cesium `MaterialStageFS.setMetallicRoughness()` 把 `material.diffuse` 置 0，而光照库以 `material.diffuse` 作基色导致照明项恒为 0；改用 `material.baseColor` 后强度/基础环境/天空色等参数全部可见 | 已完成 |
| V6.44 | 2026-09-17 | 三案例图标接入 + 实时阴影「法线偏移」失效根因修复：矩形面光源/实时阴影/聚光灯分别接入上传图；定位 `normalOffset` 不参与接收着色器关键字、且 `applyNormalOffset()` 的偏移代码只在编译期按 `bias.normalOffset` 生成，运行期改动恒无效；曾用「手动删除并销毁阴影接收着色器缓存项」强行重建，却因破坏 `ShaderCache` 记账（`derivedKeywords`/`_shadersToRelease`）在后续帧抛 `This object was destroyed`；最终改为 `normalOffset` 常驻编译、用 `_terrainBias/_primitiveBias.normalOffsetScale`（0.5/0.1→0）这一运行期 uniform 控制强度 | 已完成 |
| V6.45 | 2026-09-17 | 三案例图标接入续：SSAO 环境光遮蔽（image-1）、自定义光源-太阳光（image-2）、HDR 色调映射（image-3）分别接入上传图，`npm run sync` 重建 manifest（229 项），全量回归 0 pageerror | 已完成 |
| V6.46 | 2026-09-17 | 体积光图标接入 + 海量点实时聚合「地平线剔除」修复：倾斜拉近视角时，被地球本体遮挡却在视锥内的散点与聚合点仍被绘制（80km/俯角20° 下 87 个聚合点中有 20 个位于地平线外，可见计数把 4214 个点误判为可见）；在 Worker 中改为椭球缩放空间（单位球）地平面判据 `camScaled·pointScaled < 1` 剔除，并对单元格均值同样判定；修复后同一视角可见点数 4214→1634、地平线外绘制数 20→0 | 已完成 |
| V6.47 | 2026-09-18 | 新增六个「CesiumJS 地形高度场提取」分析案例（五种方案各一 + 五方案对比，均不配 icon）：共享 `terrain-height-lib` 落地可插拔 `TerrainExtractor` 接口与统一高度场契约（row0=北/col0=西、NaN 空洞）；依赖相机 LOD 的方案统一走「瞬移顶视→等瓦片稳定→采样→还原相机」精化协议；修复开发环境 cesium 全局 shim 缺 `OrthographicFrustum/PassState/Renderbuffer/RenderbufferFormat` 导致模块导入失败，以及 `Cartesian3.copy` 不存在导致的 pick 深度方案崩溃 | 已完成 |
| V6.47.1 | 2026-09-18 | 修复六个地形案例「绘制多边形后结果全为 NaN」：`gridLonLat` 返回弧度，而多边形顶点与 `pointInPolygon` 使用度，单位不一致使射线法把全部格点判为区域外，预览整幅品红、色标 `— m`；改为 `gridLonLat` 输出度后掩膜恢复正常 | 已完成 |
| V6.47.2 | 2026-09-18 | 五个单独地形案例新增「多边形掩膜 / 外接矩形」区域模式、GeoTIFF（EPSG:4326 + 正确经纬度范围）/ PNG 下载与叠加透明度滑条；自写单波段 Float32 GeoTIFF 编码器（`geotiff` 2.x `writeArrayBuffer` 仅支持 8 位整数），并修复 ASCII ≤4 字节标签未按 TIFF 规范内联导致 `GDAL_NODATA` 解析错误 | 已完成 |
| V6.47.3 | 2026-09-18 | 为三个地形案例接入上传图标：`terrain-height-globe`（getHeight同步查询）用 image-1、`terrain-height-mesh`（自请瓦片光栅化）用 image-2、`terrain-height-pick`（拾取深度反投影）用 image-3；其余地形案例保持「暂无截图」占位 | 已完成 |
| V6.47.4 | 2026-09-18 | 补齐其余三个地形案例图标：`terrain-height-sample`（服务端采样）用 image-1、`terrain-height-shader`（派生着色器）用 image-2、`terrain-height-compare`（五方案对比）用 image-3；六个地形案例图标全部就位 | 已完成 |

## V6.47.4 补齐其余三个地形案例图标

**用户要求**：①「地形高度场·服务端采样」卡片 icon 用上传 image-1；②「地形高度场·派生着色器」用 image-2；③「地形高度场·五方案对比」用 image-3。

**实施内容**：

1. 图标文件：`.monkeycode-tmp-files/52448faf-image-1.webp` → `src/cases/terrain-height-sample/icon.webp`；`a091d7f0-image-2.webp` → `src/cases/terrain-height-shader/icon.webp`；`25dce3f3-image-3.webp` → `src/cases/terrain-height-compare/icon.webp`。
2. 三个 `index.ts` 按既有约定新增 `import icon from './icon.webp'` 并在 `DemoCard` 写入 `icon,` 字段。
3. `npm run sync` 重建清单。

**验证标准**：

- 首页搜索六个地形案例标题：六张卡片 `.thumbnail img` 的 `naturalWidth` 全部大于 0（webp 已加载），均不出现「暂无截图」占位；至此六个案例图标全部就位。
- 探针 0 条 pageerror；`npx vue-tsc -b --force` 与 `NODE_OPTIONS=--max-old-space-size=3072 npm run build` 通过。

## V6.47.3 三个地形案例接入上传图标

**用户要求**：①「地形高度场·getHeight同步查询」卡片 icon 用上传 image-1；②「地形高度场·自请瓦片光栅化」用 image-2；③「地形高度场·拾取深度反投影」用 image-3。

**实施内容**：

1. 图标文件：`.monkeycode-tmp-files/91967d41-image-1.webp` → `src/cases/terrain-height-globe/icon.webp`；`f71eb731-image-2.webp` → `src/cases/terrain-height-mesh/icon.webp`；`1a717108-image-3.webp` → `src/cases/terrain-height-pick/icon.webp`。
2. 三个 `index.ts` 按既有约定新增 `import icon from './icon.webp'` 并在 `DemoCard` 写入 `icon,` 字段。
3. `npm run sync` 重建 `src/cases/manifest.ts`（条目仍为 235，图标字段由各案例 `index.ts` 在运行期提供）。

**验证标准**：

- 首页搜索三个案例标题：卡片 `.thumbnail img` 的 `naturalWidth` 分别为 1234/1235/1233（非 0，证明 webp 已加载），均不出现「暂无截图」占位。
- 同一分类下未配置图标的「服务端采样」「派生着色器」仍显示「暂无截图」占位，回归不受影响。
- 探针 0 条 pageerror；`npx vue-tsc -b --force` 与 `NODE_OPTIONS=--max-old-space-size=3072 npm run build` 通过。

## V6.47.2 地形案例区域模式、GeoTIFF 下载与叠加透明度

**用户要求**：五个单独地形高度场案例（不含对比案例）需支持 —— ①可绘制多边形掩膜区域，也可按多边形外接矩形提取；②提取成果可下载为 TIF / PNG，且 TIF 的 CRS 与坐标范围必须正确；③成果叠加到地图时支持透明度设置。

**实施内容**：

1. `src/cases/terrain-height-lib/geotiff.ts`（新增）：自写单波段 Float32 GeoTIFF 编码器 `encodeTerrainGeoTiff(heights, size, bounds)`。小端、单 IFD、单条带、North-up；`ModelTiepoint=[0,0,0,west,north,0]` 与 `ModelPixelScale=[(east-west)/size,(north-south)/size,0]` 使影像范围精确为 `[west,east]×[south,north]`；`GeoKeyDirectory` 写入 1024/1025/2048(EPSG:4326)/2049/2054(度)，`GDAL_NODATA='nan'`。
   - 不采用 `geotiff` 的 `writeArrayBuffer`：实测 2.1.3 仅支持 8 位整数，写出浮点会因 `BitsPerSample` 仍是 `[8]` 而抛 `Offset is outside the bounds of the DataView`。
   - 按 TIFF 规范对总长 ≤4 字节的 ASCII 标签（如 `GDAL_NODATA`）直接写入值字段，避免 geotiff 读取端按内联解析时拿到偏移字节。
2. `grid.ts`：`heightsToImageData` 增加 `transparentNoData` 参数（NaN → 全透明，供贴图叠加）；新增 `rectangleToDegreesBounds(rectangle)`（矩形弧度 → 经纬度边界，供 TIF 元数据）。
3. `TerrainHeightDemo.vue`：
   - 新增 `regionMode`（默认 `mask`）：`mask` 模式把多边形传给提取器按掩膜填充 `NaN`；`bbox` 模式不传多边形、改提取多边形外接矩形（`activeRectangle()` 已按 `polygonToRectangle` 生效），并随模式更新区域提示。
   - 新增 `overlayOpacity`（默认 70%）滑条，仅在「贴回地球」勾选时显示；`applyOverlayAlpha` 同步 `ImageryLayer.alpha`。
   - 「导出 PNG」改为按当前结果即时生成（`heightsToImageData(...,true)` 透明底），「导出 GeoTIFF」调用编码器后经 `downloadBlob` 下载；保留「导出 .f32」。

**验证标准**：

- 五案例浏览器探针（绘制同一多边形，网格 48²，逐案例独立浏览器，0 条 pageerror）：
  - `bbox` 模式：`掩膜 = 0`、`有效 = 2304`（= 48²）全部成立，证明外接矩形模式不再应用掩膜。
  - `mask` 模式：`有效 + 掩膜 = 2304`，各方案掩膜数 —— sample/globe 784、mesh 1172、shader 1859、pick 785。
  - 下载：五案例 GeoTIFF 均 9552 B、PNG 均正常生成；「贴回地球」后影像图层数 2（底图 + 叠加层）且 `rectangle` 存在，透明度 70% → 40% 同步反映到 `layer.alpha`。
- GeoTIFF 解析核验（geotiff.js 读取）：5 份文件均为 48×48、1 波段、32 位 IEEE Float（`SampleFormat=3`）、`EPSG:4326`、角度单位 9102；`bbox` 与 `ModelPixelScale/ModelTiepoint` 自洽（`(east-west)/48 = pixelScale[0]`、`(north-south)/48 = pixelScale[1]`、tiepoint 落在西北角）；`NaN` 像元数与该次提取的掩膜数逐一相等，`min/max` 与面板统计一致。
- `npx vue-tsc -b --force` 退出 0；`NODE_OPTIONS=--max-old-space-size=3072 npm run build` 成功。

## V6.47.1 地形案例「绘制多边形后结果全为 NaN」修复

**用户反馈**：六个地形高度场提取案例的提取结果全部不正常——预览为纯品红方块、色标两端为 `— m`。

**根因**：纯品红是 `heightsToImageData` 对 `NaN` 的约定色，说明**全部格点被判为无效**。复现绘制多边形流程后确认 `掩膜（区域外）= 16384`（= 网格总数），而 `originalRaw min/max` 仍有有效地形值，即地形数据正常、问题出在掩膜。`grid.ts` 的 `gridLonLat` 直接使用 `Rectangle.west/east/south/north`（Cesium `Rectangle` 内部为**弧度**）生成网格经纬度，而多边形顶点在 `TerrainHeightDemo`/`TerrainCompareDemo` 里由 `CesiumMath.toDegrees` 转成**度**，`pointInPolygon` 又按度比较，两者单位不一致使射线法对每个格点都判为区域外 → `applyMask` 把全部高度写成 `NaN`。未绘制多边形时 `buildMask` 直接返回全 1，因此默认区域不受影响。

**实施内容**：

1. `src/cases/terrain-height-lib/grid.ts`：`gridLonLat` 改为输出**度**（对 `rectangle` 四边先 `CesiumMath.toDegrees`），并在注释中明确坐标系约定，与 `pointInPolygon`、`polygonToRectangle`（均为度）保持一致。

**验证标准**：

- 绘制多边形后 `sampleTerrainMostDetailed` 方案：`掩膜 6601 / 16384`、`有效 9783`、范围 1180.9~2786.6 m，预览 canvas 品红像素占比 0.403 与掩膜占比一致（此前为 1.0）。
- `derived-shader` 方案：掩膜 13202 / 16384，品红占比 0.806，范围 1688.0~2704.5 m。
- 对比案例五方案同一多边形下范围收敛：sample 1690~2709、globe 1692~2709、mesh 1690~2709、shader 1689~2708、pick 1692~2709（均 0 空洞），基准 sample vs shader MAE 9.28 m / RMSE 11.82 m。
- 默认区域（不绘制多边形）回归不受影响（sample 128² 1180.7~2556.2 m，16384/0）。
- 六案例浏览器探针 0 条 pageerror；类型检查与生产构建通过。

## V6.47 六个地形高度场提取案例（五方案 + 对比）

**用户要求**：依据调研报告新增 6 个 CesiumJS 地形高度场提取案例 —— 五种提取方案（服务端采样、`globe.getHeight`、自请瓦片光栅化、派生着色器、pick 深度反投影）各 1 个，外加 1 个五方案对比案例；每个案例含技术说明与适用情况说明，支持自定义绘制多边形区域与参数设置；本批案例不配置卡片图标。

**实施内容**：

1. 共享库 `src/cases/terrain-height-lib/`：
   - `types.ts`：`TerrainMethodId` 五方案标识、`TerrainExtractParams`（rectangle/size/polygon/tileLevel/renderFrames/cameraMargin/maxObjectHeight/onProgress）、`TerrainExtractResult`、`TerrainExtractor` 可插拔接口。
   - `grid.ts`：统一高度场契约 `heights[row*N+col]`（row0=北、col0=西，取格子中心，无数据填 `NaN`）；`makeGridCartographics`、`buildMask/applyMask`、`computeStats`、`heightsToImageData`（NaN 渲染为品红）、`diffToImageData/diffStats`、导出 PNG/.f32。
   - `camera.ts`：`snapshotCamera/restoreCamera`、`waitForTilesLoaded`、`refineOverhead`（瞬移正交顶视 + 锁输入 + 等瓦片稳定 + 还原用户相机）、`placeOrthoTopDown`（`OrthographicFrustum.width` 取东西向全宽，`aspectRatio = width/height`）。
   - `extractors.ts`：五方案实现 + `terrainExtractorList`。方案一 `sampleTerrainMostDetailed` 写回 `Cartographic.height`（精度基准）；方案二 `globe.getHeight` 同步查询；方案三枚举瓦片 `requestTileGeometry`→`createMesh` 后自写光栅化（不依赖场景/相机）；方案四对 GLOBE pass 片元着色器做 `ShaderSource.replaceMain` 派生，正交顶视渲染到 RGBA+FLOAT FBO（需挂 `DEPTH_COMPONENT16` 深度 Renderbuffer）后 `readPixels` 并翻转行序；方案五复用 `scene._picking.getPickDepth`/`view.pickDepths` 的打包深度反投影回世界坐标。
   - `methodInfo.ts`：每方案的标题、简述、技术要点与适用情况。
   - `TerrainHeightDemo.vue` / `TerrainCompareDemo.vue`：共享演示组件，含绘制多边形（左键采点、右键/双击结束）、参数控件、结果统计、灰度预览、贴回地球与导出；对比组件依次运行五方案并用 `diffToImageData/diffStats` 给出 MAE/RMSE 与差异图。
2. 六个案例目录（分类 `analysis`，目录名即 id，均不配置 `icon`）：`terrain-height-sample`、`terrain-height-globe`、`terrain-height-mesh`、`terrain-height-shader`、`terrain-height-pick`、`terrain-height-compare`，各自 `Demo.vue` 仅透传 `methodId`。
3. 缺陷修复（开发环境）：
   - `vite.config.ts` 的 cesium 全局 shim 白名单缺少 `OrthographicFrustum`、`PassState`、`Renderbuffer`、`RenderbufferFormat`，导致 dev 下 `does not provide an export named 'OrthographicFrustum'`，模块加载即失败；补齐四个符号。
   - `extractors.ts` 方案五误用不存在的 `Cartesian3.copy`，改为 `Cartesian3.clone(positionWC, origin)`，否则 pick 深度反投影必然抛错。
   - 顺带消除因内部 API 未在 cesium 类型声明中导出的类型错误（PassState/Renderbuffer/RenderbufferFormat 改为从命名空间取值并显式标注、`DrawCommand.shallowClone`/`ShaderSource.replaceMain`/`Framebuffer` 选项与 `ClearCommand.execute` 做局部断言/转换）。
4. `npm run sync` 重建 `src/cases/manifest.ts`，条目 235（新增 6）。

**验证标准**：

- `npx vue-tsc -b --force` 退出 0；`NODE_OPTIONS=--max-old-space-size=3072 npm run build` 成功（约 1m41s）。
- 浏览器回归（逐案例独立 context，网格大小 32²）：六案例均可进入、完成提取、渲染灰度预览并正常返回列表，0 条 pageerror/console error。实测 ——
  - 方案一 1137 ms，范围 1180.7~2551.8 m，有效 1024/空洞 0；
  - 方案二 2920 ms，1181.0~2545.4 m，1024/0；
  - 方案三 14484 ms（L14、25 瓦片、0 失败），1180.6~2551.8 m，1024/0；
  - 方案四 4307 ms，1180.0~2545.0 m，1024/0，命中 4 条 GLOBE 命令；
  - 方案五 4182 ms，1181.0~2519.5 m，1020/4（深度量化）；
  - 对比案例 5 行结果齐全，基准方案一 vs 方案四 MAE 4.25 m、RMSE 5.70 m（1024 像素）。
- 五方案在 1180~2552 m 量程内收敛，验证了统一契约与精化协议的正确性。

## V6.46 体积光图标接入与海量点聚合「地平线剔除」修复

**用户要求**：① 光照效果-体积光案例 icon 用上传 image-1；② 数据可视化-海量点实时聚合案例在拉近视角后，不在视角内的数据（单点与聚合点）都不应显示。

**实施内容**：

1. 图标接入：`722b2b01-image-1.webp` → `src/cases/light-volumetric/icon.webp`，`index.ts` 加 `import icon from './icon.webp'` 与 `icon,` 字段（沿用既有约定）。
2. 聚合案例缺陷定位（`src/cases/mass-point-cluster/`）：原 `cluster-worker-source.ts` 只做了「裁剪空间 NDC 在 [-1,1] 内」的视锥剔除与 `clipW <= 0` 的相机背后剔除，缺失**地球本体遮挡**判据。拉近并带俯角观察时，位于地平线之外（被地球曲面挡住）的点仍在视锥内，于是被当作可见点参与聚合并绘制在天空区域——实测 80km 高度 / 俯角 -20° 时，绘制的 87 个聚合点中有 20 个地面距离 1074~1264 km（当地地平线 1013 km），画面顶部出现 179/185/208/227 等大聚合图标悬在天际线以上；同时「可见」指标把 4214 个点误计为可见。
3. 修复：在 Worker 中新增地平线剔除——
   - 主线程 `getCameraParams()` 额外下发 `cameraPosition`（`camera.positionWC`）与 `ellipsoidRadii`（`scene.globe.ellipsoid.radii`）。
   - Worker 将相机与点换算到椭球缩放空间（除以三轴半径，得到单位球），判据 `camScaled · pointScaled >= 1` 视为可见；小于 1 即位于地平线之外，单点直接 `continue`，不参与 `visibleCount` 与聚合。
   - 聚合点的单元格在累加经纬度均值的同时累加缩放空间均值，`cells.forEach` 中对均值再做一次同判据，避免跨天际线的单元格把图标放到地球背面。
   - `radii` 缺失时自动降级为仅视锥剔除（`horizonCulling=false`），不引入硬依赖。
4. 面板「可见」InfoTip 文案补充说明：已剔除视锥之外、相机背后与被地球遮挡在地平线之外的点。

**验证标准**：

- `npx vue-tsc -b --force` 退出 0（`TSC_OK`）；`NODE_OPTIONS=--max-old-space-size=3072 npm run build` 成功（`BUILD_OK`）。
- 分组视角探针（逐点用「缩放空间地平线 + 视锥」双重判定，N=绘制图元总数）：修复前 80km/俯角 20° 为 87 绘制 / 20 超地平线；修复后 10km/-30° 42+118 全部 0 超限、30km/-25° 47+42 全部 0 超限、80km/-20° 35+79 全部 0 超限，同一视角可见点数 4214→1634。
- 滚轮真实交互复测：从广域视角连续 `wheel` 拉近后指标正常刷新（可见 99593 → 459m 高度时 0），场景内无任何图元残留，说明 `camera.changed`/`moveEnd` 触发重聚合链路正常。
- 图标回归：light-volumetric 图标 1236×657、mass-point-cluster 1238×639，进入案例后返回列表卡片数=1，两条均 0 条 pageerror。

## V6.45 三案例图标接入续（SSAO / 太阳光 / HDR 色调映射）

**用户要求**：① 光照效果-SSAO 环境光遮蔽案例 icon 用上传 image-1；② 自定义光源-太阳光案例 icon 用上传 image-2；③ 光照效果-HDR 色调映射案例 icon 用上传 image-3。

**实施内容**：按既有图标接入约定（V6.42/V6.44 同款流程）执行——

1. 图片落位：`.monkeycode-tmp-files/e66f07a9-image-1.webp` → `src/cases/light-ssao/icon.webp`（53,096 B）、`2dc1b675-image-2.webp` → `src/cases/light-sun/icon.webp`（127,722 B）、`a42c4ab1-image-3.webp` → `src/cases/light-tonemapping/icon.webp`（114,238 B）。
2. 三个 `index.ts` 各加 `import icon from './icon.webp'` 与 `icon,` 字段（渲染于卡片 `.thumbnail img`）。
3. `npm run sync` 重建 `src/cases/manifest.ts`，条目数 229（未增删案例，仅图标字段变化，`fog` 目录名与 id 不一致的既有 warn 与本次无关）。

**验证标准**：

- `npx vue-tsc -b --force` 退出 0（输出 `TSC_OK`）。
- `NODE_OPTIONS=--max-old-space-size=3072 npm run build` 成功（`BUILD_OK`）。
- 浏览器回归（1280×800，逐案例独立 context）：light-ssao 图标 1236×652、light-sun 1238×638、light-tonemapping 1237×638 且 `src` 均指向各自 `icon.webp`，进入案例后点「返回列表」卡片数=1，三条均为 0 条 pageerror / console error，汇总「全部通过」。

## V6.44 三案例图标接入与实时阴影「法线偏移」失效根因修复

**用户要求**：① 局部光源-矩形面光源案例 icon 用上传 image-1；② 光照效果-实时阴影案例 icon 用上传 image-2；③ 局部光源-聚光灯案例 icon 用上传 image-3；④（延续 V6.41 的失效核查）实时阴影面板每个参数都必须真实生效。

**实施内容**：

1. 图标接入：`20cdbcda-image-1.webp` → `src/cases/light-rect/icon.webp`、`c24db0e1-image-2.webp` → `src/cases/light-shadow/icon.webp`、`609090dd-image-3.webp` → `src/cases/light-spot/icon.webp`，三个 `index.ts` 各加 `import icon from './icon.webp'` 与 `icon,` 字段（卡片缩略图 `.thumbnail img`）。
2. 失效根因定位（Cesium 1.144 构建版源码）：
   - `getShadowReceiveShaderKeyword()` 只拼接 `receiveShadow <usesDepthTexture><polygonOffsetSupported><isPointLight><isSpotLight><hasCascades><debugCascadeColors><softShadows><castShadows><isTerrain><hasTerrainNormal>`，**不含 `normalOffset`**；而 `createShadowReceiveFragmentShader()` 生成的 `applyNormalOffset()` 函数体只在 `bias.normalOffset && hasNormalVarying` 时写入偏移语句。改动 `shadowMap.normalOffset` 仅置 `dirty`，重建时 `getDerivedShaderProgram()` 命中旧关键字缓存 → 偏移代码永远保持首次编译时的形态 → 开关恒定无效。
   - `combineUniforms()` 中 `shadowMap_normalOffsetScaleDistanceMaxDistanceAndDarkness.x` 恒取 `bias.normalOffsetScale`（地形 0.5、模型 0.1、点光 0），与 `normalOffset` 布尔值无关，因此「直接改 `normalOffset` 让 uniform 归零」也不成立。
   - 还定位到「最大距离」步骤稳定抛 `DeveloperError: This object was destroyed`（`ShaderProgram.throwOnDestroyed` ← `Context.draw`，随后 Rendering has stopped）的原因：早期方案在 `apply()` 中遍历 `context.shaderCache._shaders` 删除所有 `receiveShadow ` 前缀项并 `finalDestroy()`，破坏了 Cesium 的缓存记账（父项 `derivedKeywords` 仍记录已删关键字、`_shadersToRelease` 未清理、`k7()` 递归销毁按关键字命中后新建的活跃程序）。A/B 对照（用 `window.__noEvict` 禁用该重建）可稳定复现/消除，确认根因。
3. 最终修复（`src/cases/light-shadow/LightShadowDemo.vue`）：删除 `invalidateShadowReceiveShaders()` 与手动销毁逻辑；`shadowMap.normalOffset` 恒为 `true`（偏移代码常驻），新增 `applyNormalOffset()` 在首次调用时记录 `_terrainBias/_primitiveBias.normalOffsetScale` 基线，之后按 UI 开关写入基线值或 `0` —— 该系数每帧由 `combineUniforms()` 的 uniform getter 实时读取，属于运行期 uniform，无着色器重建、无缓存副作用。`参数提示` 文案同步说明「代码常驻 + 系数控制强度」。
4. 其余参数复测全部生效：`enabled`（差异 6.99）、`darkness`（4.22）、`normalOffset` 系数（0.23）、`maximumDistance`（6.98）、`size`（2.67）、`fadingEnabled`（高度角 1° 时 `_darkness` 0.35 → 0.886）；`softShadows` 在本机 `_usesDepthTexture=true` 路径下 Cesium 未实现 PCF，按钮置灰并在提示中说明原因。

**验证标准**：

- `npx vue-tsc -b --force` 退出 0；`NODE_OPTIONS=--max-old-space-size=3072 npm run build` 成功（约 1 分 31 秒）。
- 900m 默认视角逐控件探针：上述各控件像素均值差异均 > 0，软阴影按设备置灰，**0 条 pageerror / console error**（修复前「最大距离」步骤稳定抛 `This object was destroyed`）。
- 图标回归：light-rect（1236×655）、light-shadow（1238×637）、light-spot（1230×652）卡片缩略图均加载成功，进入案例后点「返回列表」0 条报错；首次并发跑生产构建时 light-rect 出现一次 60s 超时、light-shadow 出现一次图标未解码，均为探针时序问题，串行复跑后全部通过。

## V6.42 三案例图标接入与返回列表报错修复

**用户要求**：① 光照效果-Bloom 泛光案例 icon 用上传 image-1；② 光照效果-颜色分级案例返回列表报错，且 icon 用上传 image-2；③ 自定义光源-平行光案例 icon 用上传 image-3。

**实施内容**：
- 图标接入：`.monkeycode-tmp-files/18abe377-image-1.webp` → `src/cases/light-bloom/icon.webp`、`f4267640-image-2.webp` → `src/cases/light-color-grading/icon.webp`、`47dead84-image-3.webp` → `src/cases/light-directional/icon.webp`，三个 `index.ts` 各自加 `import icon from './icon.webp'` 与 `icon,` 字段。
- 返回列表报错根因：Cesium 1.144 的 `PostProcessStageCollection.remove(stage)` 内部已调用 `stage.destroy()`（源码 `PostProcessStageCollection.js` 中 `remove` 末尾 `stage.destroy()`），而案例卸载时又显式 `current.destroy()`，第二次销毁抛 `DeveloperError: This object was destroyed`，表现为点「返回列表」时报错。
- 修复：`LightColorGradingDemo.vue` 与 `LightVolumetricDemo.vue`（同族缺陷，未在反馈中提及但复现相同报错）的 `onBeforeUnmount` 均改为只调用 `viewer.scene.postProcessStages.remove(current)`，去掉多余 `destroy()`。
- 同类排查：全项目另有 7 个使用 `postProcessStages` 的案例（weather-sandstorm、volume-cloud、weather-rain、weather-snow、lightning、integral-height-fog、fog）卸载时均只 `remove` 不 `destroy`，无此问题；`volume-cloud` 的 `remove` → 新建 stage → `add` 是参数切换的正确用法。

**验证标准**：
- `npm run sync` 生成 manifest（entries 229）；`npx vue-tsc -b --force` 退出 0；`npm run build` 成功。
- 浏览器回归（1280×800）：三案例进入后点击「返回列表」无 `pageerror` 且卡片列表正常渲染（修复前 color-grading 与 volumetric 均稳定复现 `DeveloperError`）；三张图标在卡片缩略图中加载成功（自然尺寸 1237×653 / 1236×655 / 1235×657）；体积光案例同样不再报错（本轮未分配图标，属预期）。

## V6.43 三案例图标接入与半球光参数失效根因修复

**用户要求**：① 光照效果-抗锯齿 / 环境光-半球光 / 局部光源-点光源三个案例 icon 用上传图；② 半球光案例「参数调整看不出效果」，需定位并修复。

**实施内容**：
- 图标接入：`.monkeycode-tmp-files/75bd6bb6-image-1.webp` → `src/cases/light-fxaa/icon.webp`、`c87537be-image-2.webp` → `src/cases/light-hemisphere/icon.webp`、`d529b13e-image-3.webp` → `src/cases/light-point/icon.webp`，三个 `index.ts` 各自加 `import icon from './icon.webp'` 与 `icon,` 字段。
- 参数失效根因：白模 3DBAG glTF 未提供 `pbrMetallicRoughness.metallicFactor`，按 glTF 规范默认 metallic = 1.0；Cesium 1.144 `MaterialStageFS.setMetallicRoughness()` 在既无 metallic 纹理也无 metallic 因子时取 `metalness = 1.0`，并执行 `material.diffuse = mix(material.baseColor.rgb, vec3(0.0), metalness)`，即所有片元进入 `fragmentMain` 时 `material.diffuse` 恒为 0。光照库 `LOCAL_LIGHT_FRAGMENT` 以 `base = material.diffuse` 作为基色，`base * (ambient + diffuse)` 恒为 0；同时案例 `viewer.scene.light = new SunLight({ intensity: 0 })`，`material.diffuse` 也无法靠场景光照显亮，故强度/基础环境/天空色/地面色/局部光全部不可见。基色实际保存在 `material.baseColor`（`czm_modelMaterial` 首字段 `vec4 baseColor`，由 `materialStage` 写入）。
- 修复：`src/lib/lighting.ts` 的 `fragmentMain` 改为 `vec3 base = material.baseColor.rgb;`（仍保持 `material.diffuse = vec3(0.0)`、`material.specular = vec3(0.0)`，照明结果写入 `material.emissive`）。该库为 point / spot / rect / hemisphere 等全部局部光案例共用，一处修复全部恢复可见。
- Cesium 模型 PBR 片元管线顺序（本次定位依据）：`defaultModelMaterial()`（diffuse=0）→ `materialStage()`（写 `baseColor` / `diffuse` / `specular`，metallic 时 `diffuse=0`）→ `customShaderStage()`（即 `fragmentMain`）→ `lightingStage()`（`color = directColor + material.emissive`，最终 `out_FragColor` 取 `material.diffuse`）。

**验证标准**：
- `npm run sync` 生成 manifest（entries 229）；`npx vue-tsc -b --force` 退出 0；`npm run build` 成功（首次直接 `npm run build` 触发 node 默认堆上限 OOM，改以 `NODE_OPTIONS=--max-old-space-size=3072` 后 1m49s 构建成功）。
- 半球光实测（900×620，探针相机 700 m，`numberOfTilesWithContentReady` 稳定 9）：`强度 0→2` 全画面均值 40.89 → 73.26（差异 33.19，修复前 0.19）；`基础环境 0→0.5` 差异 4.41（修复前 0.15）；`天空色 红→蓝` 差异 11.46（修复前 0.37）；控制台错误 0。
- 点光源实测（同条件）：`强度 0→4` 差异 12.80；`影响范围 200→3000` 差异 15.51；`天空色 红→蓝` 差异 2.19；控制台错误 0。
- UI 链路独立确认：拖动控件后 `tileset.customShader.uniforms` 中 `u_hemiIntensity` 0.9→0→2、`u_ambient` 0.05→0.5→0 同步变化，排除「控件事件未触发」这一层。
- 图标与返回列表回归（1280×800）：三案例卡片图标均加载成功（自然尺寸 1238×654 / 1240×656 / 1238×638），进入案例后点「返回列表」卡片列表正常且 `pageerror` 与页面异常均为 0。
- 诊断方法（可复用）：「常量替代法」——把着色器中的可疑输入逐段换成常量（`ambient` 表达式 → `vec3(0.5)`，`base` → `vec3(1.0)`，`emissive` → `vec3(0.5)`），若换常量后画面变化而原表达式无变化，即可判定该输入通道取值为 0，而非通道本身无效。

## V6.41 光照效果 13 案例参数提示与控件失效修复

**用户要求**：除「光照效果-大气动态光照」外的 13 个光照/光源案例，每个参数与指标都要有 hover 提示按钮；同时逐个排查并修复「参数控制不生效」的问题。

**实施内容**：
- 提示补齐（沿用 V6.40 的通用 `InfoTip.vue` ? 按钮）：13 案例分组标题、滑块、颜色选择、开关、预设按钮与 HUD 指标行全部接入提示，浏览器实测渲染数 bloom 9 / color-grading 14 / directional 8 / fxaa 3 / hemisphere 5 / point 16 / rect 17 / shadow 12 / spot 20 / ssao 8 / sun 12 / tonemapping 5 / volumetric 6（sun 另有 1 个提示位于「动画」开关打开后才出现的行内）；文案统一为「控件作用 + 对应 Cesium API + 取值与观察建议」。
- 修复 light-sun「年份」死滑杆：`min=2026 max=2026` 范围退化导致拖动无效，改为 `2024–2030`。
- 修复 light-tonemapping 映射曲线下拉缺标签：补 `<span class="lgt-label">映射曲线</span>`，与其它案例面板结构一致。
- 修复 light-color-grading 数组型 vec3 uniform 抛错（渲染中断，控制台 `Invalid vec3 value for uniform`）：`src/lib/lighting.ts` 新增 `toCartesian3([n,n,n])`，`createColorGradingStage` / `updateColorGradingStage` 的 `u_slope` / `u_offset` / `u_power` 由裸数组改为 Cartesian3。
- 修复 light-volumetric 数组型 vec2 uniform：`u_lightScreenPos` 改为 `Cartesian2.fromElements(x, y, new Cartesian2())`。
- 修复 light-shadow 实时阴影不生效：`onTilesetReady` 内把 `viewer.shadows` 误置为 `false`，改为调用 `apply()` 按 UI 状态写入；`src/lib/cesium-scene.ts` 的 Viewer 构造改为 `shadows: false`，由案例自行开启。
- 修复 light-ssao 三个不存在的 uniform：Cesium 1.144 的 `createAmbientOcclusionStage` 并无 `stepSize` / `blurStepSize` / `intensityCap`（实际内层 stage 为 `intensity` / `bias` / `lengthCap` / `directionCount` / `stepCount` / `randomTexture`，合成 stage 为 `ambientOcclusionOnly`），`SsaoConfig` / `DEFAULT_SSAO` / `applySsao` 与案例 UI 改为「采样步数」`stepCount`（4–64，默认 32）与「采样方向数」`directionCount`（2–16，默认 8），提示文案同步更新。

**验证标准**：
- `npm run sync` 生成 manifest（entries 229）；`npx vue-tsc -b --force` 退出 0；`npm run build` 成功。
- 控件有效性：以「状态快照探针」逐控件切换后 diff Cesium 引擎状态（postProcessStages 及内置 `bloom` / `ambientOcclusion` / `fxaa` / `tonemapper`、3D Tiles `shaderUniforms`、`entities`、`imageryLayers`、`scene` / `globe` / `shadowMap` / `clock`），修复后 13 案例所有控件的目标状态均随交互变化，仅个别「预设」按钮在参数已处于目标状态时无状态差异（属预期）。
- 提示回归（1280×800）：13 案例按钮计数与上述一致，每案例抽样 5 个（fxaa 全量 3 个）hover 后 tooltip 均非空、完整落在视口内，移开后无残留；非 404 控制台错误与页面异常为 0。
- 探针方法论与陷阱（可复用）：像素差判定被白模瓦片加载抖动污染（相机位移使全画面均值漂移），改用引擎状态快照；探针须按案例独立启动浏览器（swiftshader 连续多案例易崩，需崩溃续跑）、等案例自带 `flyTo` 相机稳定后再 `setView` 到近距约 700 m，否则瓦片不加载；`Tonemapper` 是字符串枚举而非函数，快照需对非对象值单独取值，且读取 `PostProcessStage.uniforms` 必须用 `getOwnPropertyNames`（getter 返回内部 `_uniforms`）。

## V6.40 三案例图标接入、参数提示体系与大气参数失效修复

**用户要求**：① 边坡 GNSS 位移预警案例卡片 icon 用上传图一、地图增加图例、每个参数与指标加 hover 提示按钮、左侧面板补从业务角度出发的案例说明（技术路线与技术方案）；② 海量点实时聚合案例卡片 icon 用上传图二；③ 大气动态光照案例卡片 icon 用上传图三、每个参数与指标加提示按钮，并修复「大气色调 / Mie 各向异性 / 大气光强度」调整后不生效。

**实施内容**：
- 图标：三张上传图分别写为 `src/cases/slope-gnss-warning/icon.webp`、`src/cases/mass-point-cluster/icon.webp`、`src/cases/light-atmosphere/icon.webp`，并在各自 `index.ts` 中 `import icon from './icon.webp'` 写入 `DemoCard.icon`。
- 通用提示组件 `src/components/InfoTip.vue`：`?` 圆按钮（sm/md 两种尺寸），hover/focus 触发，`Teleport to="body"` + `getBoundingClientRect` 定位（scroll/resize 重定位、自动翻转避让视口边缘），`role="tooltip"`，`aria-label` 取 title。
- 大气参数失效根因与修复：`src/lib/cesium-scene.ts` 的 Viewer 构造硬编码 `skyAtmosphere: false, skyBox: false`，导致 `scene.skyAtmosphere` 恒为 null，所有天空大气参数写入无效（地面 `globe` 大气参数正常）。新增 `MapSceneOptions { skyAtmosphere?, skyBox? }`，`createMapScene(container, callbacks, options)` 在有需求时传 `undefined`（走 CesiumWidget 默认创建路径；传 `true` 会因 `setDynamicLighting` 不存在而报错），`useWhiteModelTileset(sceneOptions)` 同步透传。
- 大气案例 `LightAtmosphereDemo.vue`：大气光强度由绝对值改为倍率（默认 1.00x），同时驱动 `skyAtmosphere`（基准 50）与 `globe`（基准 10）；新增「观测视角」按钮区（看向地平线 / 俯视城市）与场景时刻 HUD；全部参数与指标接入 `InfoTip`。
- 大气参数有效区间的实测结论（此前误判为「不生效」）：`hueShift` 沿色环循环，±1 等于整圈旋转故视觉无变化；Mie 相位函数含 `(1 − G²)` 因子，`G = ±1` 时 Mie 项恒为 0，故两端点亦无变化。据此把滑块范围收敛为 Mie `-0.9~0.9`、大气色调 `-0.3~0.3`，并在提示文案中说明取值与观察方式（Mie 需朝太阳方向观察日周光晕）。
- 边坡案例：地图顶部新增图例条（核心区/重点区/影响区面色块、坡体边界线、监测点、基准站、位移矢量），图例标题带等级配色与数据质量说明提示；为回放、显示选项、预警阈值率定、分区推演全部滑块与开关补齐提示按钮，并为「当前时次/分区面积/推演滑距/滑体体积/地形摩擦 f/分区置信度」等指标加提示；左侧面板新增 `case-intro` 区块，按「业务场景 / 技术路线 / 技术方案」三段（每段带详解提示）说明业务价值与实现路径。
- 海量点聚合案例：数量、聚合参数、渲染三个分组标题与像素范围、最小聚合数、散点大小、显示散点补齐提示，实时指标行补「可见/聚合/散点/聚合耗时」释义提示；`.section-title`、`.row-label` 改为 flex 对齐以适配提示按钮。

**验证标准**：
- `npm run sync` 生成 manifest（entries 229）；`npx vue-tsc -b --force` 退出 0；`npm run build` 成功。
- 浏览器回归（1280×800）：三案例提示按钮计数 slope 43 / mass-point 9 / light-atmosphere 8，hover 后 tooltip 均完整落在视口内；边坡图例单行显示且与态势面板、控制面板、图表面板均无重叠（图例 x 271~955，态势面板止于 259，控制面板起于 961）。
- 大气案例：色相滑块置于 0 / +0.3 / -0.3 时天空区域像素均值分别为 `107.8,149.2,186.6` / `175.7,106.8,160.8` / `117.5,162.0,100.3`，三者互不相同且 `skyAtmosphere.hueShift` 与 `globe.atmosphereHueShift` 同步写入；Mie 各向异性 `G=0 / 0.9 / -0.9` 的日周区域均值为 `16.9,44.6,69.0` / `19.2,45.3,69.4` / `16.9,44.5,69.0`；大气光强度 0→3 差异 39.9。
- 三案例均无非 404 控制台错误与页面异常。

## V6.39 边坡 GNSS 位移预警与三级影响区案例

**用户要求**：按技术路线文档新增边坡 GNSS 位移预警与三级影响区案例（CesiumJS 1.144）：红/橙/黄三色半透明贴地三级影响区、GNSS 时序仿真、预警判据、时间轴回放、报告导出（Word/PDF），阈值可率定；案例不生成专门 icon。

**实施内容**：
- 结构：算法集中在 `src/cases/slope-gnss-warning-lib/`（目录名以 `-lib` 结尾，不参与案例扫描），案例入口为 `src/cases/slope-gnss-warning/`；`npm run sync` 自动生成 `src/cases/manifest.ts`，`category: 'analysis'`、`tag: '地灾预警'`，`icon` 留空。
- 类型与配置 `types.ts`：五级 `WarningLevel`；`ThresholdConfig`（速率 mm/d、改进切线角、累计位移、质量门限、升级确认/降级滞回、降雨耦合）；`ZoneConfig`（变形场格网、IDW 参数、三级缓冲、Fahrböschung 系数、扇形角/扩散角/堆积扇角、Corominas 系数、滑距上限）；`DEFAULT_SLOPE_PROFILE` 与沙镇溪 / 舟曲 / 汶川三套 `SCENARIO_PRESETS`。
- 时序仿真 `simulate.ts`：`buildScenario` 生成 12 个监测点 + 1 个基准站；`simulateNetwork` 以斋藤三阶段 + Fukuzono 反速率生成累计位移，叠加白噪声、随机游走多路径、粗差跳变与质量退化窗口；指标含 16 历元滑窗速率、加速度、改进切线角、1/v 与破坏时刻预测；`evaluateRawLevel` + `applyFsm` 输出单站等级；`recomputeLevels` 支持阈值率定后免重新仿真回算等级。
- 空间推演 `zones.ts`：局部米制投影 + jsts 布尔运算；IDW 各向异性插值 + marching squares 提取红/橙等值线；核心区 = 红等值线 ∩ 滑坡边界 ∪ 红警站缓冲；重点区 = (橙等值线 ∪ 核心外扩) − 核心；影响区 = D8 流路能量线（Fahrböschung 与 Corominas 取包络，受滑距上限约束）走廊 + 坡脚堆积扇，再扣除前两级区域。新增 `closeRing` 修复未闭合环导致 jsts `GeoJSONReader` 抛 “Points of LinearRing do not form a closed linestring”。
- 报告 `report.ts`：`buildReportBodyHtml` 装配工程概况、时次指标、判据率定、三级范围、承灾体与处置建议、态势截图；`renderReportPdf` 用 html2canvas + jsPDF 分页切片导出 PDF；`buildWordBlob` 导出 HTML `.doc`。
- 案例页 `SlopeGnssWarningDemo.vue`：`createMapScene` + Bing 影像；`GroundPrimitive` + `PerInstanceColorAppearance` 绘制红/橙/黄贴地多边形及描边；监测点按等级着色并绘制位移矢量箭头（mm→m 比例可调）；`loadWorldTerrain` 就绪后重采样真实高程刷新分区，采样不可用或高差过小时回退带坡脚平台的合成地形；时间轴回放、echarts 位移/速率/雨量曲线、阈值与分区参数滑块（防抖重算）、分区面积/滑距/体积/摩擦/置信度面板、场景截图与报告弹窗。
- 依赖：`jsts@2.7.1`（已有，打包为独立 chunk）、`html2canvas`、`jspdf`、`echarts`，未新增依赖。

**验证标准**：
- 算法自测（esbuild 打包后 node 运行）：第 0/120/240 时次分区均可计算；末时次网络等级为红色警报，核心区 0.88 ha、重点区 0.07 ha、影响区约 120 万 m²、推演滑距约 1120 m；`recomputeLevels` 在极高阈值下全部回落至正常、恢复默认后回升。
- 浏览器验证：卡片「边坡 GNSS 位移预警与三级影响区」可打开；末时次态势面板显示红色警报级与三级面积；时间轴回放推进正常；下调红色速率阈值后等级由正常升至黄色；切换舟曲场景后时次复位；报告弹窗 7 个章节、PDF/Word 导出按钮可用；非 404 控制台错误为 0。
- `npx vue-tsc -b --force` 退出 0；`npm run build` 成功。

## V6.38 案例图标接入与泥石流案例长时运行卡死优化

**用户要求**：① GPU 泥石流地形侵蚀案例卡片 icon 采用上传图一，并深度分析“随时间推演越来越卡、最终完全卡死”的原因并优化；② 实时三维 CFD 仿真案例卡片 icon 采用上传图二。

**实施内容**：
- 图标：将上传图片分别写入 `src/cases/debris-flow-sim/icon.webp` 与 `src/cases/cfd-realtime/icon.webp`，并在两个案例的 `index.ts` 中 import 后通过 `DemoCard.icon` 注册。
- 卡死根因分析：V6.37 取消历史关键帧 180 帧上限后，`historyFrames` 在运行期间持续 push 且从不释放。每帧保存 terrain/flux/sed 三张 128×128 RGBA32F 回读结果（约 768 KB/帧），按约每秒一帧计，数十分钟后可达 GB 级，最终触发浏览器内存耗尽与长时间 GC 卡死；同时 Vue 每 300 ms 将全量帧对象写入响应式数组 `timeline.frames`，随帧数增长逐次变慢。
- 优化措施：
  - 历史关键帧改为固定内存预算的滚动窗口：新增 `HISTORY_MEMORY_BUDGET_BYTES = 192 MB`，按 `HISTORY_BYTES_PER_FRAME` 反推 `HISTORY_MAX_FRAMES ≈ 256` 帧，超出后丢弃最早帧，运行期间内存占用恒定（较原 180 帧上限保留更多历史）。
  - 移除 `readHistoryFrame()` 中 `Float32Array.from(readPixels(...))` 的冗余拷贝，`readPixels` 返回 Float32Array 时直接使用，降低每次采集的瞬时内存与 GC 压力。
  - 新增 `getHistoryLimit()` 与轻量 `getHistoryCount()`；前端时间轴改用计数驱动（`timeline.count` / `timeline.limit`），不再把全量帧对象放进响应式状态，消除每 300 ms 的 O(n) 映射与响应式包装开销。
  - 箭头（BillboardCollection）由“每次 `removeAll()` 后全量重新 `add`”改为对象池复用：按需扩容并原位更新已存在的 billboard，多余的置 `show=false`；重建频率由每 6 帧降至每 12 帧，并在暂停或历史回溯模式下跳过。避免反复创建/销毁 N 个 billboard 及其贴图造成的 GC 与 GPU 抖动。
  - UI 文案更新为“滚动保留最近 N 帧，超出自动覆盖最早帧”，并在启动时读取容量上限展示。

**验证标准**：`npx vue-tsc -b --force` 退出 0；`npm run build` 成功（产物 `DebrisFlowDemo-Dt5tI531.js` / `CfdRealtimeDemo-CO1ewB0t.js`）；dev server 下相关模块转换返回 200。

## V6.37 泥石流案例无上限历史记录与整体影响范围矢量

**用户要求**：历史关键帧不设 180 帧上限，只要模拟过程中未重置就持续滚动记录；新增支持「整体影响范围」的矢量预览与导出，且导出需携带属性。

**实施内容**：
- 无上限历史记录：`gpu-sim.ts` 移除 `HISTORY_MAX` 常量及 `readHistoryFrame()` 中的 `historyFrames.shift()` 截断逻辑，`setHistoryRecording` 仅在 `reset()` 时清空；`DebrisFlowDemo.vue` 历史提示更新为「持续记录无帧数上限（仅重置时清空）」，并提示帧数多时内存随之增加。
- 整体影响范围：`gpu-sim.ts` 的 `exportSnapshot()` 已返回 `terrain/flux/sediment`，`DebrisFlowDemo.vue` 新增 `buildImpactGeoJson()`：
  - 以 `|base - current| > impactThreshold` 或 `h > minDepth` 判定受影响网格，并先将网格按 `block = round(width / 64)` 聚合为块级掩膜，降低多边形数量。
  - 对块掩膜按行求连续游程并与上一行相同游程纵向合并为矩形，再把块索引换算为 WGS84 经纬度多边形环。
  - 每个多边形携带属性：`kind`、`region`、`time_s`、`threshold_m`、`area_m2`、`grid_cells`、`wet_cells`、`max_erosion_m`、`max_deposition_m`、`mean_abs_change_m`、`has_erosion`、`has_deposition`、`has_inundation`。
  - 新增 `impactDataSource`、`impactInfo`、`previewImpactVectors()`（橙色叠加预览）、`exportImpactGeoJson()`（导出 `debris-impact-<时间戳>.geojson`）、`clearImpactPreview()`，并在区域切换、重置、卸载时清理。
  - 侵蚀矢量导出同步补充属性：`area_m2`、`grid_cells`、`max_lowering_m`、`mean_lowering_m`、`threshold_m`、`region`、`time_s`。
- 交互与报告：`DebrisFlowDemo.vue` 新增「影响阈值」滑杆（0.01～2 mm）与「预览影响 / 导出影响 / 清除」按钮；分析报告「侵蚀范围矢量化」章节补充影响阈值与整体影响多边形数及属性说明。

**验证标准**：`npx vue-tsc -b --force` 通过；`npm run build` 成功（产物 `DebrisFlowDemo-S8YWSGZ4.js`）；dev server 下 `DebrisFlowDemo.vue`、`gpu-sim.ts` 模块转换均返回 200。

## V6.36 泥石流案例遮盖修复、暂停语义、持续记录与侵蚀矢量化

**用户要求**：修复鼠标移动时网格虚影被遮盖，以及部分区域侵蚀结果被遮盖、且被遮盖区域与虚影一致的问题；「开始/停止」改为「开始/暂停」；历史关键帧新增停止按钮，未点击停止则持续记录；修复矢量预览与导出始终提示「未检测到侵蚀范围」；增加结果显示图例或说明。

**深度分析（遮盖根因）**：
- 覆盖层网格的顶点高程来自模拟网格纹理 `u_terrain`，而该纹理由 `sampleTerrainMostDetailed` 以 `demSamples = 65` 采样后双线性插值得到（约 46 m 间距），再叠到 `overlaySegments = 192` 的平面网格上。
- 实际渲染的地形为 Cesium World Terrain 高精度瓦片。在山脊/凸起处，真实地形高于「粗 DEM 双线性插值 + 三角面线性插值」得到的覆盖层表面，深度测试下地形片元深度更近，将覆盖层整片遮挡。
- 虚影与侵蚀结果由同一顶点着色器与同一网格绘制，因此被遮挡的网格单元完全一致——这正是「两者被遮盖区域一样」的原因；原 `polygonOffset(-2,-2)` 与 `+1.6 m` 抬升不足以抵消数十米量级的高程插值误差。
- 侵蚀结果不可见还有第二个叠加原因：`OVERLAY_FS` 中侵蚀/淤积的透明度与颜色用原始米值归一化（`alpha = abs(net) * 0.5`），而默认 `erosionCoeff = 5e-5` 下累积侵蚀仅为亚毫米级，`alpha < 0.004` 被 `discard`，即使未被遮挡也几乎不可见。

**修复实施**：
- 覆盖层深度：`gpu-sim.ts` 的 `createOverlay` 将 `renderState.depthTest` 由 `{ enabled: true }` 改为 `{ enabled: false }`（同时移除仅对深度测试有意义的 `polygonOffset`），使贴地覆盖层始终绘制在地形之上，彻底消除山脊对虚影与侵蚀结果的深度遮挡；仍保留 `depthMask: false` 与原有 alpha 混合。
- 侵蚀可见性：`OVERLAY_FS` 新增 `uniform float u_erosionRef`，侵蚀/淤积的着色与透明度改用相对该基准的归一化值（`clamp(net / u_erosionRef)`），使毫米级床面变化也能显色；`gpu-sim.ts` 新增 `erosionRef` 字段与 `setErosionReference/getErosionReference`，overlay uniformMap 增加 `u_erosionRef`；`DebrisFlowDemo.vue` watch `ui.erosionThreshold` 同步该基准。
- 开始/暂停：`DebrisFlowDemo.vue` 的 `toggle()` 改为在 `sim` 已存在时调用 `sim.pause()/play()`（保留模拟状态），仅无实例时 `start()`；按钮文案由「停止」改为「暂停」；区域切换与卸载仍走 `stop()` 销毁。
- 持续记录：`gpu-sim.ts` 新增 `historyRecording` 字段与 `isHistoryRecording/setHistoryRecording`，历史采集条件加入 `this.historyRecording`，`HISTORY_MAX` 由 48 提升至 180（滚动保留最近约 3 分钟）；`DebrisFlowDemo.vue` 新增 `recording` 状态与「停止记录/继续记录」按钮及提示。
- 侵蚀矢量化：`buildErosionGeoJson()` 改用「床面下切深度」`terrain[base] - terrain[current]`（即地形纹理通道 1 减通道 0）判定，替代原有的泥沙累积通道差，语义更直观；阈值默认由 `0.05 m` 改为 `0.0005 m`，滑杆范围改为 `0.00005～0.005 m`（即 0.05～5 mm）并以毫米显示；预览/导出失败提示附带当前阈值读数。
- 结果图例：`DebrisFlowDemo.vue` 左下角新增随可视化模式切换的图例面板——水深模式显示浅→深蓝渐变（含 `maxDepth`），流速模式显示蓝→绿→红渐变（含 `maxSpeed`），复合/侵蚀模式显示红（侵蚀）—白—绿（淤积）渐变并标注水流、障碍、笔刷虚影色块，同时说明颜色按当前阈值归一化。

**验证标准**：`npx vue-tsc -b --force` 通过；`npm run build` 成功（产物 `DebrisFlowDemo-CHZH5yI5.js`）；dev server 下 `DebrisFlowDemo.vue`、`gpu-sim.ts`、`shaders.ts` 模块转换均返回 200。

## V6.35 泥石流案例笔刷、降雨、时间轴回溯与侵蚀报告

**用户要求**：笔刷半径可 1～10 格调节；笔刷虚影支持调节不透明度，并修复局部侵蚀/覆盖显示被地形遮挡的问题；参数旁给出中文说明提示；物源、障碍、降雨需实际生效；新增时间轴回溯、侵蚀范围矢量化与侵蚀分析报告导出。

**实施内容**：
- 笔刷与虚影：`DebrisFlowDemo.vue` 将半径上下限改为 `BRUSH_RADIUS_MIN=1`/`MAX=10`（默认 4）；新增虚影不透明度滑块 `ghostOpacity`（默认 0.6），`gpu-sim.ts` 新增 `setGhostOpacity()` 与 overlay uniform `u_ghostOpacity`，`OVERLAY_FS` 按该值混合虚影，并新增障碍格品红色带可视化。
- 遮挡修复：`shaders.ts` `OVERLAY_VS` 抬升量 `0.8→1.6`；`gpu-sim.ts` overlay 渲染状态新增 `polygonOffset{enabled:true, factor:-2, units:-2}`、细分默认 `overlaySegments 96→192`；`DebrisFlowDemo.vue` 新增 `pickCartesian()` 拾取回退链（`scene.pickPosition` → `getPickRay`+`globe.pick` → `camera.pickEllipsoid`），解决局部区域覆盖缺失与拾取失败。
- 参数说明：`types.ts` 新增 `PARAMETER_HINTS`（15 项参数中文说明），更新 `BRUSH_LABELS` 的 rain/obstacle/erase 提示；`DebrisFlowDemo.vue` 参数面板改为 `parameterControls` 驱动并内联显示提示。
- 生效修复：`gpu-sim.ts` `injectSediment` 附带 `strength*0.35` 的水源 stroke 使物源真正参与流动；`setRainfall(rateMmPerHour)` 乘 `RAIN_GAIN=1200`（mm/h→m/s 可见径流）并新增 `getRainfall`；UI 将降雨改为 `ui.rainOn` 开关并 watch `[ui.rainOn, ui.rainfall]`，关闭时关闭降雨源。
- 时间轴回溯：`gpu-sim.ts` 新增 `HISTORY_FS`（3 路 MRT：terrain/flux/sed，`u_block` 块采样）、`HISTORY_RES=128`/`HISTORY_MAX=48`/`HISTORY_INTERVAL=36`，新增 `createHistory/queueHistoryCapture/readHistoryFrame/getHistoryInfo/isHistoryMode/setHistoryFrame/resumeLive/clearHistory`；仅在 `historyActive<0` 时采集关键帧并在 `update()` 内回读 `stats`；`destroy()/reset()` 清理历史资源。`DebrisFlowDemo.vue` 新增时间轴滑杆 `scrubTimeline` 与 `goLive`，回溯时覆盖层切换到 `historyDisplay` 并暂停物理。
- 侵蚀矢量化与报告：`DebrisFlowDemo.vue` 新增 `buildErosionGeoJson()`（按行游程合并净侵蚀 > `ui.erosionThreshold` 的网格为多边形）、`previewErosionVectors()`/`exportErosionGeoJson()`（`GeoJsonDataSource` 叠加预览 + GeoJSON 下载）；新增 `buildReportModel()`（模拟区域/运行统计/侵蚀时间序列/侵蚀范围矢量化/本构与侵蚀参数五节）；新增 `report.ts`（`buildReportBodyHtml`、`renderReportPdf` 动态 import html2canvas+jspdf 按 A4 分页、`downloadBlob`、`nowStamp`）与报告预览弹窗 `openReport`/`exportReportPdf`。
- 类型补丁：`cesium-render.d.ts` 为 `Texture` 增补 `copyFrom({xOffset?,yOffset?,source})`，用于历史帧上传。

**验证标准**：`npx vue-tsc -b --force` 通过；`npm run build` 成功（产物 `DebrisFlowDemo-ROLbwCJo.js`）；dev server 下 `DebrisFlowDemo.vue`/`report.ts`/`gpu-sim.ts`/`shaders.ts`/`types.ts` 模块转换均返回 200。

## V6.34 泥石流案例区域边界、范围相机与笔刷虚影

**用户要求**：显示当前演示区域范围边界（自定义框选后同样显示，Entity 贴地），跳转时对准范围对象避免按四至飞出范围；根据笔刷半径支持鼠标移动实时显示笔刷覆盖的网格虚影（可开关）；自定义框选后支持设置精度。

**实施内容**：
- 区域边界：`DebrisFlowDemo.vue` 新增 `domainCorners()` 与 `updateRegionBoundary()`，用 `viewer.entities.add` 添加 `clampToGround: true` 的青色 polyline，四条边界线组成闭环；在初始加载与 `applyRegion()` 中每次重建区域后刷新。
- 相机对准：`flyToDomain()` 改用 `camera.flyToBoundingSphere(sphere, { offset: new HeadingPitchRange(0, -58°, range) })`，球心取区域中心 ENU 原点、半径取对角线×0.62+800，`range = radius / tan(30°)`，使视角始终以范围对象为中心，替代原先的四至 `Rectangle` + 手动 pitch（后者会把范围转出视野）。
- 笔刷虚影：`gpu-sim.ts` 新增 `ghostCenter/ghostRadius/ghostActive` 字段与 `setBrushGhost()` API，overlay uniformMap 增加 `u_gridDim/u_ghostCenter/u_ghostRadius/u_ghostActive`；`OVERLAY_FS` 按 `v_st * u_gridDim` 计算网格坐标，在半径范围内绘制网格线（`fract` 边带）与淡色填充，即使干地不丢弃也可显示；`DebrisFlowDemo.vue` 在 `MOUSE_MOVE`/`LEFT_CLICK` 用 `pickPosition` 反算连续网格坐标更新虚影，仅对水域/物源/障碍/溃坝笔刷生效，新增「显示笔刷覆盖网格虚影」复选框。
- 精度设置：`ui.gridRes` 改为响应式，新增 `GRID_RES_OPTIONS = [256, 384, 512, 768, 1024]` 按钮组；`applyRegion()`/`start()`/初始 domain 均改用 `ui.gridRes`，`positionToGrid()` 边界判定改用 `domain.gridResX/Y`；`watch(ui.gridRes)` 触发当前区域重建。

**验证标准**：`npx vue-tsc -b --force` 通过；`npm run build` 成功（产物 `DebrisFlowDemo-CFO5wjtc.js`）；dev server 下 `DebrisFlowDemo.vue`、`shaders.ts`、`gpu-sim.ts` 模块转换均返回 200。

## V6.33 泥石流案例着色器 OIT 修复与区域选择

**用户要求**：修复案例运行时错误 `ERROR: 0:11: 'outColor' : when EXT_blend_func_extended extension is not enabled, must explicitly specify all locations when using multiple fragment outputs`；初始场景区域改为中国山区某范围，并支持自定义绘制矩形区域。

**实施内容**：
- 根因定位：覆盖层命令为 `Pass.TRANSLUCENT`，Cesium 的 OIT（顺序无关半透明）`getTranslucentShaderProgram2` 会把片元源码中的 `out_FragColor` 重命名为 `czm_out_FragColor` 并追加 `out_FragData_0/out_FragData_1` MRT 输出；而 `OVERLAY_FS` 使用了自定义输出名 `outColor`，OIT 无法识别与重写，最终程序同时存在未指定 location 的 `outColor` 与两个 MRT 输出，触发 ANGLE 多输出缺 location 报错。
- 修复：`src/cases/debris-flow-lib/shaders.ts` 中 `OVERLAY_FS` 删除自定义 `out vec4 outColor;` 声明，输出改用 Cesium 约定名 `out_FragColor`，由 Cesium 在合成时自动注入 `layout(location = 0) out vec4 out_FragColor;`，从而同时兼容基础 Pass、OIT 派生与 log-depth/depth-only 派生程序。
- 区域选择：`DebrisFlowDemo.vue` 新增 `REGION_PRESETS`（甘肃舟曲 104.37/33.79、四川汶川 103.60/31.45、云南蒋家沟 103.13/26.24），抽取 `applyRegion()` 停止旧模拟、按新中心与尺寸重建 `SimulationDomain`、相机飞行并重启模拟；`selectPreset()` 切换预设。
- 自定义框选：新增 `enterDrawMode/cancelDraw/handleDrawClick/finishDraw`，进入绘制模式后在地图依次点击矩形对角两点，用 `globe.pick` 拾取地形坐标，`CallbackProperty` + `clampToGround` 折线实时预览，完成后按经纬度跨度换算米制宽高（800–12000m 限幅）并重建区域；绘制期间屏蔽笔刷交互。

**验证标准**：`npx vue-tsc -b --force` 通过；`npm run build` 成功（产物 `DebrisFlowDemo-BgEp5TZl.js`）；dev server 下 `shaders.ts`/`domain.ts`/`gpu-sim.ts`/`DebrisFlowDemo.vue`/`index.ts` 模块转换均返回 200。

## V6.33.1 泥石流案例相机定位修复

**用户要求**：初始位置与甘肃舟曲、四川汶川、云南蒋家沟预设实际跳转位置均错误，地图上看不到场景效果；自定义框选后相机跳到的位置同样不对。

**实施内容**：
- 根因：`SimulationDomain.rectangle` 的 `west/south/east/north` 是 Cesium `Rectangle` 内部单位弧度，原代码直接把 `domain.rectangle.west + 0.004` 等弧度值传给 `Rectangle.fromDegrees(...)`，被当成度使用（舟曲 104.37° 的弧度约 1.82，被解释为 1.82° 经度，相机飞到几内亚湾附近）；同时 `west + 0.004`、`east - 0.004` 使西边界反超东边界，矩形跨反子午线，进一步放大错误。
- 修复：`DebrisFlowDemo.vue` 新增 `flyToDomain(target)`，用 `CesiumMath.toDegrees` 将边界换成度，按 `west - pad / south - pad / east + pad / north + pad`（pad = 0.004°）四边外扩后传入 `Rectangle.fromDegrees`；初始加载与 `applyRegion` 两处调用统一改用该函数。
- 可见性：`OVERLAY_VS` 顶点高度增加 0.8m 常数抬升，避免水面与地形共面时深度测试导致 z-fighting 遮挡。

**验证标准**：`npx vue-tsc -b --force` 通过；`npm run build` 成功（产物 `DebrisFlowDemo-DBqPKkRK.js`）；dev server 下 `DebrisFlowDemo.vue`、`shaders.ts` 模块转换均返回 200。

## V6.32 新增「GPU 泥石流地形侵蚀」案例（analysis，无 icon）

**用户要求**：依照设计文档（v2.0 确定版）新增一个完整的 Cesium GPU 泥石流地形侵蚀案例；该案例不生成专门 icon。

**实施内容**：
- 新增模拟库 `src/cases/debris-flow-lib/`（`-lib` 结尾不参与案例扫描）：
  - `types.ts`：`DebrisFlowParameters` 锁定参数与默认值、`VisualMode`、`BrushKind`、`SimStats`、`DomainOptions`、`BRUSH_LABELS`、`VISUAL_MODE_LABELS`。
  - `domain.ts`：`SimulationDomain`，实现经纬度矩形推导、`gridToENU/enuToGrid/ecefToENU/enuToCartesian` 与 `eastNorthUpToFixedFrame` 的 ENU 原点矩阵。
  - `shaders.ts`：GLSL 源码池（COMMON 共享 uniform、Well-Balanced Rusanov `interfaceFlux`、MacCormack 预测/校正、半拉格朗日浓度与泥沙平流、HBP 剪切应力、侵蚀沉积 MRT、源项/衰减、笔刷、障碍、归约/采样读取、可视化 overlay 顶点+片元）与 `buildGridMesh/createArrowImage`。
  - `gpu-sim.ts`：核心 `DebrisFlowSimulation`（Cesium Primitive 接口）。RTT ping-pong RGBA32F 状态纹理；计算 Pass 用 `Context.createViewportQuadCommand` 全屏四边形 + `gl_FragCoord`/`texelFetch`；侵蚀 Pass 需 3 个颜色输出，封装为 `pass = Pass.COMPUTE` 的自定义命令，在 compute 调度中用 `createViewportQuadCommand` 渲染 MRT Framebuffer（`draw._framebuffer`）后交换三张纹理；`preExecute` 设 `outputTexture`、`postExecute` 完成 swap；CFL 自适应多子步；开放边界；`reduce`/`sampleFlow` 32 分辨率回读统计与流速箭头；DEM 用 `sampleTerrainMostDetailed` 采样后双线性插值到网格。
- 新增案例入口 `src/cases/debris-flow-sim/`（`index.ts` + `DebrisFlowDemo.vue`）：category=analysis，无 icon；面板含开始/步进/重置、六类笔刷、四类可视化模式、时间倍率与本构/侵蚀参数滑块、运行统计；`onMounted` 中 `createMapScene` + Bing 影像 + World Terrain，点击地形 `pickPosition` 反算网格坐标后注入笔刷。
- `src/cesium-render.d.ts`：`DrawCommand` / `createViewportQuadCommand` 选项补充 `boundingVolume?: unknown`，以匹配 1.144 运行期字段。

**验证标准**：`npm run sync` 成功（manifest 206 条含 `debris-flow-sim`）；`npx vue-tsc -b --force` 通过；`npm run build` 成功；dev server 下 `DebrisFlowDemo.vue`、`gpu-sim.ts`、`shaders.ts`、`domain.ts`、`index.ts` 模块转换均返回 200。

## V6.31 图层树与时间轴控件卡片 icon 及销毁报错修复

**用户要求**：标准图层树控件案例卡片 icon 采用上传 image-1；点击返回列表报错 `TypeError: Cannot read properties of undefined (reading 'scene')`；自定义时间轴控件案例卡片 icon 采用上传 image-2。

**实施内容**：
- 新增 `src/cases/layer-tree/icon.webp`（取自上传 image-1）与 `src/cases/widget-timeline/icon.webp`（取自上传 image-2），并在两个案例入口 `index.ts` 中以 `import iconUrl from './icon.webp'` 写入 `icon` 字段。
- 销毁报错修复：案例 `Demo.vue` 的 viewer 销毁由 `onBeforeUnmount` 移至 `onUnmounted`，确保子组件 `LayerTreePanel` 先于 viewer 释放控件；`TerrainAdapter.destroy/setVisible` 增加 `viewerAlive` 判断，`AbstractAdapter` 新增 `viewerAlive` 保护；`LayerTreeControl.clear()` 对适配器释放逐一 try/catch，避免 viewer 已销毁时访问 `viewer.scene` 抛错。

**验证标准**：`npm run sync` 成功；`npx vue-tsc -b --force` 通过；`npm run build` 成功；两个案例卡片显示各自 icon；从案例返回列表不再抛出 `scene` 相关错误。

## V6.30 图层树控件交互优化

**用户要求**：为图层树控件补充详细使用说明（支持的数据类型与关键方法）；「新增图层」与图层树图标分开，修复新增图层弹窗无法关闭，并将流程改为选择类型后再弹表单完成新增；修复部分类型「定位到图层」报错；修复拖动透明度滑块时误触发图层移动；右键「图层设置」改为「样式设置」并实现其功能；将「展开全部/收起全部」合并为一个按钮。

**实施内容**：
- `LayerTreePanel.vue` 新增「使用说明」弹窗（标题栏问号图标），列出九类图层说明、`LayerTreeControl` 关键方法与面板交互快捷键。
- 新增图层流程改为两步：工具栏「新增图层」按钮打开类型选择弹窗（含关闭按钮与 Esc/遮罩关闭），选择类型后进入信息表单弹窗，按类型渲染 URL、服务类型、经纬度、颜色、文本等字段，校验名称后调用 `control.addLayer`；原快捷模板保留在类型弹窗底部。
- 透明度滑块所在容器增加 `@mousedown.stop`，`input[type=range]` 设 `draggable="false"`，并在 `onDragStart` 中排除来自 `input/button/.lt-opacity` 等控件的拖拽，拖动滑块不再移动图层。
- 标题栏「展开全部」「收起全部」合并为单个双态按钮，依据分组展开状态切换图标与行为（`toggleExpandAll`）。
- 右键菜单「图层设置」更名为「样式设置」，`handleAction` 中 `settings` 打开样式弹窗，渲染 `control.getStyleFields(id)` 并按字段类型生成表单，应用时调用 `control.applyStyle(id, values)`。
- 样式能力下沉到适配器：`types.ts` 新增 `StyleField` 系列类型与 `ILayerAdapter.getStyleFields/applyStyle`；影像、3D Tiles、模型、图元、粒子、实体、地形适配器实现样式字段与 `applyStyle`，`alpha` 统一交由 `model.setOpacity` 处理；`layer-tree-control.ts` 增加 `getStyleFields/applyStyle`，并仅在适配器提供样式字段时显示「样式设置」。
- 定位飞行修复：模型改用 `camera.flyToBoundingSphere(model.boundingSphere)`，图元按坐标/墙轮廓构造 `BoundingSphere` 后飞行，粒子飞至其上方；`LayerTreeControl.flyTo` 增加 try/catch，失败时触发 `layer:loading-error` 并记录日志。

**验证标准**：`npx vue-tsc -b --force` 通过；`npm run build` 成功；面板可打开使用说明，新增图层两步流程各弹窗均可正常关闭，透明度滑块拖动不移动图层，各类型「定位到图层」不再抛错，右键「样式设置」可调整并生效，「展开全部/收起全部」由单按钮切换。

## V6.29 标准图层树控件（界面控件，无 icon）

**用户要求**：开发一个案例，严格按照设计文档实现一个可复用的标准图层树控件；不需要为该案例生成专门 icon。

**实施内容**：
- 新增 `src/cases/layer-tree-lib/`，控件拆分为与渲染框架无关的核心与可选 Vue 视图：
  - `types.ts`：LayerType 枚举、LayerConfig / LayerTreeNode / ILayerAdapter / LayerTreeOptions / 事件映射等类型定义。
  - `layer-tree-model.ts` + `event-emitter.ts`：单一数据源，负责树结构、显隐三态、透明度、展开、选择、排序与序列化（toConfigs）。
  - `adapters/`：AbstractAdapter 基类与影像、地形、3D Tiles、数据源、实体、图元、模型、粒子、分组九类适配器，`AdapterRegistry` 静态注册并支持实例级自定义覆盖。
  - `layer-tree-control.ts`：统一操作 API（增删改、分组、显隐、透明度、排序、flyTo / zoomTo、右键菜单动作、reload、导出 / 导入、统计）与事件体系。
  - `LayerTreePanel.vue` + `LayerTypeIcon.vue`：搜索高亮、工具栏、树行、透明度滑杆、右键菜单、拖拽排序（before/after/inside）、键盘快捷键（空格显隐、F2 重命名、Delete 删除、Enter 定位、方向键导航、Ctrl+A/D/Z）、状态栏与属性 / 删除 / 地形夸张弹窗。
- 新增案例入口 `src/cases/layer-tree/`（category=widgets，无 icon；`Demo.vue` 通过 `createMapScene` 建场景，挂载 `LayerTreePanel` 并用预置图层演示影像、地形、3D Tiles、模型、实体、数据源、图元等类型）。
- 补齐 `vite.config.ts` CESIUM_SYMBOLS：新增 GridImageryProvider、IonImageryProvider、OpenStreetMapImageryProvider、TileMapServiceImageryProvider、LabelCollection、ArcGISTiledElevationTerrainProvider、CesiumTerrainProvider、ParticleSystem、CircleEmitter。
- 修复类型错误：`GridImageryProvider({})`、`Model.flyTo` 断言、`ParticleSystem` 粒子数读取、3D Tiles 瓦片总数读取、`EntityConfig` 形状与实体适配器保持一致、`exportConfig` 空值返回。

**验证标准**：`npx vue-tsc -b --force` 通过；案例卡片出现在「界面控件」分类，图层树可分组、显隐、调透明度、拖拽排序、搜索、定位、右键操作并能导出配置。

## V6.28 时间轴组件内嵌光照/阴影/实时图标，实时跳转当前时刻

**用户要求**：光照和阴影控制图标化放入时间轴组件；实时模式图标化放入时间轴组件，点击后时间轴自动定位并跳转到当前时间。

**实施内容**：
- 左侧面板移除光照、阴影、实时开关，改为时间轴播放条上的图标按钮（日照、体块阴影、时钟）。
- 点击实时：时钟跳到系统当前时刻，时间窗以当前时刻居中定位；若当前时刻落在起止范围外则扩展范围。
- 实时开启后指针随系统时钟跟窗。

## V6.27 温度曲面卡片 icon + 自定义时间轴控件

**用户要求**：温度曲面可视化案例卡片 icon 采用上传 image-1；新增自定义时间轴控件案例，完美复刻 Cesium 自身时间轴能力，至少 3 种新颖美观样式可切换，并追加光照/阴影开关；不为该案例生成专门 icon。

**实施内容**：
- 温度曲面 `icon.webp` 取自上传 image-1，并写入案例入口。
- 新增 `src/cases/widget-timeline/`（界面控件，无 icon）：绑定 `viewer.clock`，覆盖播放/暂停/反向、倍率、点击跳转、指针刮擦、时间窗平移与滚轮缩放、循环/钳制/自由、实时模式。
- 三种样式：极光丝带、日晷环轨、胶片光轨；场景为建筑体块 + 巡航体，用于展示日照与阴影随时间变化。
- 面板提供光照、阴影独立开关。

## V6.26 温度曲面可视化案例 + 滑坡动态模拟卡片 icon

**用户要求**：参考温度曲面 HTML 新增案例，支持参数调整，不为该案例生成专门 icon；滑坡动态模拟案例卡片 icon 采用上传 image-1。

**实施内容**：
- 新增 `src/cases/temperature-surface/`：离散测温点 IDW 插值生成单网格三维温度曲面（相对参考 HTML 的逐格 PolygonInstance，改为一次 Primitive 网格，避免上万实例）。
- 面板可调采样点数、网格密度、区域半径、中心经纬度、温度上下限、基准高度、高度拉伸、透明度，以及测温点显隐 / 随机生成 / 定位。
- 鼠标悬停显示经纬与插值温度；色带与参考 HTML 一致（高温红 → 低温蓝）。
- 滑坡动态模拟 `icon.webp` 取自上传 image-1，并写入案例入口。

## V6.25 滑坡动态模拟地形分析支持精度设定

**用户要求**：滑坡动态模拟案例的地形分析支持精度设定。

**实施内容**：
- 选择区域面板增加与水文分析升级版同形的精度控件：按行列数（40/60/80/120/160）或按间距（米）。
- 采样与 SWE 求解网格由固定 80×80 改为随精度和区域宽高比计算，上限 160 以保持实时求解稳定。
- 已有采样区时切换精度会保留源区并自动重采样；框选新区域仍清除源区。

## V6.24 滑坡动态模拟改为仅真实采样，框选对齐水文分析升级版

**用户要求**：滑坡动态模拟案例移除合成山谷，只保留真实采样；框选采样区域参考水文分析(升级版)的形式；框选完成后移除之前的采样区与源区，并自动进行采样分析。

**实施内容**：
- 删除合成山谷 DEM、数据源切换按钮，以及地形失败时回退合成山谷的逻辑。
- 选择区域面板改为「示例区域 / 框选区域 + 范围显示」，框选交互为单击第一角 → 移动预览 → 再单击完成，右键取消。
- 框选完成后清除旧采样区、源区、影响范围与山体网格，按新矩形四至重建 80×80 网格并自动采样 Cesium World Terrain。
- 自定义框选不再沿用旧源区；需重新绘制源区后再播放。示例区域仍加载默认源区。

## V6.23.1 修复 demo0 地图与轮廓不匹配（投影方式）

**现象**：用户验收 demo0 反馈「地图与轮廓不匹配」——顶面彩图(sc_map)内部的行政边界/图案与城市块边缘、发光侧壁轮廓出现横向错位。

**根因**：数值定位（不靠截图）——参考工程（sc-datav demo0）用 d3 `geoMercator` 投影把四川 11.196°×8.267° 的地理范围投到平面；其投影平面宽高比 = lonSpan/merYspan = **1.1691**，与 sc_map 纹理宽高比（1617×1384=**1.1684**）几乎一致，因此贴图内容与形状天然贴合。而本项目 demo0 初版用「等距经纬度乘常数」近似投影，平面宽高比 = 11.196/8.267 = **1.3546**，比纹理多横向拉伸约 16%，把墨卡托形态的地图画面拉到等距形态的城市块上，边缘自然错位。

**实施内容**：
- `src/datav/demo0/geo.ts` 的 `makeProjector` 改为墨卡托(等角)公式：
  - `x = (λ - λc) * K`（λ 取弧度经差）
  - `y = (ln(tan(π/4 + φ/2)) - ln(tan(π/4 + φc/2))) * K`，使中心纬度 φc 落在原点
- city 与 outline 复用同一 projector，顶面/侧壁/飞线/城市名全部自动对齐。

**验证结果**：
- 投影平面宽高比验证脚本：mercator lonSpan 0.19541 / merYspan 0.16714 / aspect 1.1691 ≈ 纹理 1.1684。
- `npx vue-tsc -b --force` EXIT=0；headless 冒烟（/tmp/opencode/verify_datav_demo0.cjs）通过：引擎 canvas 1917×880、像素非背景比 0.184、3 张 ECharts、0 pageerror。

**后续约定**：
- `src/datav/` 内所有按经纬度生成的地图几何与纹理贴图必须使用**墨卡托(等角)投影**并复用统一 projector（不要再用等距度近似）；参考工程用的是 d3 geoMercator，texture 素材按同一投影平面制作，二者宽高比需吻合（本项目四川 ≈1.169）。
  - demo1~3 平移沿用 geo.ts 的墨卡托 projector 约定。


## V6.23.2 修复 demo0 顶面贴图与地面轮廓 Y 轴翻转

**现象**：V6.23.1 改墨卡托后宽高比已对齐，但顶面 `sc_map` 卫星图与地面黑色挤出轮廓外形仍对不齐。

**根因**：参考工程 `geoMercator()` 的 y 朝南，再 `new Vector2(x, -y)` 得到北朝上平面，UV `v=(y-minY)/h` 的 v=0 落在南缘，与北向上 PNG（Three.js 默认 flipY）吻合。V6.23.1 手写公式把 y 写成北朝上，调用处仍取 `-y`，几何变成南朝上，纹理内容相对黑色轮廓竖直翻转。

**实施内容**：
- `makeProjector` 改为 `geoMercator().center(centroid).translate([0, 0])`（项目已有 `d3-geo`），`projectV2` 统一 `Vector2(x, -y)`。
- 轮廓侧壁与飞线只使用 `sc_outline.json` MultiPolygon 的 `coordinates[0]` 主环，对齐参考工程 `outline.tsx` / `flyLine.tsx`。
- `displacementMap` 仅在「切换样式」后启用，对齐 `baseMap.tsx` 的 newStyle 分支。

**后续约定**：datav 地图几何投影直接复用 d3 `geoMercator` + `Vector2(x,-y)`，不要手写北朝上公式后再取反。



## V6.23 可视化大屏模块：基建与 demo0 样板屏（datav 分类）

**背景**：新增「可视化大屏」功能导航分类（category `datav`，图标 DataBoard），将参考工程 SC-DATAV 的 demos0-3 一一对应平移为原生 Vue + Three.js 命令式实现。demo0 先行并完成 headless 冒烟后，再依次平移 demo1~3。

**实施内容**：
- 依赖：新增 `three` 0.185.1 / `@types/three` 0.185.4；不引入 React/R3F/leva/gsap/zustand 等 React 生态包。
- 目录约束：模块代码/数据/素材置于独立 `src/datav/` 子树（自包含，`sync-cases.mjs` 仅扫描 `src/cases/`，天然不被 case 扫描影响）；`src/cases/` 仅放 4 个桥接壳案例（本项目 datav-demo0）。
- 公共层 `src/datav/common/`：`engine.ts`（DatavEngine：WebGLRenderer/scene/PerspectiveCamera/OrbitControls/帧循环/入场相机动画/introMove/resize/dispose 遍历；renderer 开 preserveDrawingBuffer 便于像素级冒烟断言）；`stage.ts`（FitStage：1920×1080 等比缩放 + ResizeObserver）；`textSprite.ts`（Canvas 文字 Sprite，替代 drei Billboard/Text，避免远程字体）；`effects.ts`（程序化网格地面 + 星空 Points，近似 drei Grid/Stars）；`echartBox.vue`（echarts 全量 init/resize/setOption/dispose 通用封装）。
- demo0 数据/场景 `src/datav/demo0/`：`geo.ts`（墨卡托近似投影 + `buildDemo0Scene`：21 城市顶面区域 + sc 轮廓挤出侧壁 MeshPhysicalMaterial.onBeforeCompile 注入「上升扫光」+ 边缘行走流光点带 + 城市名 Sprite 标签 + 新样式切换）；`charts.ts`（全省/成都双折线、进出口 dataZoom、三产渐变柱、滚动表格 100 行）；`Datav0Screen.vue`（全屏遮罩大屏：网格星空场景、顶栏「经济运行监测」、左右图表面板、底部「切换样式 / 纯净模式」，两个 setInterval 驱动图表滚动/柱状高亮）。
- 案例桥接：`src/cases/datav-demo0/index.ts`（defineAsyncComponent 动态 import `../../datav/demo0/Datav0Screen.vue`，无 icon）；`src/cases/index.ts` categories 增加 `{ id: 'datav', label: '可视化大屏', icon: DataBoard }`。

**关键修复（headless 验证驱动）**：
- `parseGeo` 未按 geometry.type 归一化 ring 层级：sc.json 是 21 个 Polygon 要素、sc_outline.json 是单要素 MultiPolygon，统一处理后 `CatmullRomCurve3` 才拿到合法轮廓点，修复前 flyLine 构建抛 `Cannot read properties of undefined (reading 'x')`（geo.ts CatmullRomCurve3.getSpacedPoints）。
- 清理历史 hack：删除 Datav0Screen 中为跨脚本引用 THREE 的第二个 `<script>` 块（THREE_VEC0），改为 script setup 顶部直接 `import * as THREE from 'three'`；geo.ts 重复导出的 `DemoT0Scene` interface 已合并。

**验证结果**：
- `npx vue-tsc -b --force` EXIT=0。
- `npm run sync` 重新生成 manifest：entries 187，`datav-demo0` 已注册（id/category/tag/available:true 均正确）。
- headless SwiftShader 冒烟（/tmp/opencode/verify_datav_demo0.cjs + debug_datav0.cjs）：点击「可视化大屏」分类 → 卡片可见 → 进入后 `.datav-root canvas` 渲染、顶栏「经济运行监测」与 4 面板 DOM 呈现（3 张 ECharts canvas）、像素采样非空、FPS 面板 Tri>0，全程 0 pageerror / 0 console error。

**后续约定**：
- datav 模块代码一律进 `src/datav/`；`src/cases/datav-*` 仅放桥接壳 + Meta（无 icon、description/tag 面向用户正向表述）。
- datav 场景自绘/着色器能力优先补充到 `src/datav/common/`（heatmapCanvas、数字滚动 hook 等），供 demo1~3 复用。
- 新增 datav 图表若超过首页首屏优化边界时，`optimizeDeps.include`/异步 chunk 处理参照 V6.22。
- demo1~3 平移前先对照参考工程各自的素材需求，逐案例拷贝进 `src/datav/assets/`，避免目录提前膨胀。



## V6.22 首屏性能工程优化（案例数增长解耦）

**背景**：案例已增至约 186 个，首页加载链路存在三个随案例数量线性膨胀的耦合点：
1. `vite-plugin-cesium` 在 dev 与 build 均向首页 HTML 注入 `<script src="/cesium/Cesium.js">`（dev 未压缩 15.6MB / build min ~1.1MB），首屏渲染即开始下载解析。
2. `src/cases/index.ts` 静态 import 全部 186 个 case 条目与入口组件（405 行、~223.5KB），Vite dev 首次请求时要把 186 条 import 链全部 transform，build 时首页 HTML 因此被链路拉长。
3. 卡片列表由 `demos` 元数据一次性渲染，图标走 case 内部静态资源，随案例数线性增长。

**实施内容**：
- 新增 `scripts/sync-cases.mjs`（`npm run sync`，接入 predev/prebuild）：
  - 自动扫描 `src/cases/` 下含 index.ts 且不以 `-lib` 结尾的目录（当前 186 个），用 TypeScript AST 解析 default export 的 id/title/category/description/tag/updatedAt/icon/available。
  - 输出自动生成文件 `src/cases/manifest.ts`：`caseLoaders`（按 id 动态 import `./<dir>/index.ts` 惰性加载）+ `demos: CaseMeta[]`，icon 静态 import（Vite 单独发 assets）。目录名与 id 不一致时（如 `fog` → `weather-fog`）仅 warn 不中断。
- `src/cases/index.ts` 重构（405→70 行）：保留 categories/demos 导出与 `loadCaseEntry(id)`（返回 `{meta, component}`），去除全部静态 case import。
- `src/App.vue`：卡片改用元数据；打开案例先 `ensureCesium()`（检测 `window.Cesium`，无则注入 `/cesium/Cesium.js` 并记录一次性等待 promise）→ `await loadCaseEntry(id)` → `defineAsyncComponent` 渲染 + `.case-loading` 遮罩 + caseOpenSeq 竞赛保护；空闲预取改为首次 `pointerover`（用户浏览卡片）时触发，首屏零 Cesium。
- `vite.config.ts`：dev+build transform 均删除 HTML 注入的 Cesium script 标签与 widgets.css；新增 `optimizeDeps.include`（echarts/xlsx/shpjs/shp-write/jsts/geotiff/jszip/proj4/element-plus）；保留 `exclude: ['cesium']` 与 /cesium 静态目录拷贝；`chunkSizeWarningLimit` 1600。
- `package.json`：sync/predev/prebuild 链路；`tsconfig.app.json` 增 `allowImportingTsExtensions`（配合 `.ts` 后缀动态 import）。

**验证结果**：
- `npm run build` EXIT=0（✓ built in 1m15s），最终产物 569 个 JS/CSS chunk、总 gzip 1.82MB。
- `dist/index.html` 干净：无 `/cesium/Cesium.js`、无 widgets.css、无残留 `</script>`；主入口 `index-elc_VwzM.js` raw 184.8KB / gzip 63.8KB（旧主入口 223.5KB），主 CSS 22.0KB（gzip 5.6KB）。
- `dist/cesium/Cesium.js` 仍在产物中，供运行时按需注入。
- headless SwiftShader 冒烟（/tmp/opencode/verify_perf_home.cjs）：首页 33 卡片渲染、`cesiumRequestedOnHome=false`、`hasCesiumBeforeClick=false`（首页全程零 Cesium 网络请求）；点击「影响区域-多层扩散光圈」注入 Cesium 并打开 `.case-stage canvas`，返回列表正常，全程 0 pageerror。
- vue-tsc 类型检查通过。

**后续约定**：
- 新增案例：放入 `src/cases/<dir>/index.ts`（目录名即 id，避免歧义）；每次增删案例后运行 `npm run sync`，无需再手工维护中央注册文件。
- 以 `-lib` 结尾的目录为共享代码，会被扫描自动排除。
- 案例组件体积走异步 chunk（build 时已拆分），首页加载不再随案例数量增长。
- 新增 dev 符号/依赖如需首屏预构建，补充 `optimizeDeps.include`。

## V6.6 国内地图底图 6 案例：cesium-map 移植

**目标**：
1. 解析 https://github.com/cesiumChina/cesium-map 仓库，为六个国内地图底图样例各新增一个方案（原样例 + 新增方案），天地图/星图支持 Key/token 手动输入后按参数加载底图。
2. 直接 TS 移植 cesium-map 源码到 `src/lib/cesium-map/`（不新增 npm 依赖），与本项目 Cesium 1.144 的 d.ts 核对兼容。

**实施内容**：
- 共享库 `src/lib/cesium-map/`（Apache 2.0，出处 @cesium-china/cesium-map）：`CoordTransform.ts`（WGS84/GCJ02/BD09 互转）、`GCJ02TilingScheme.ts`、`BD09Projection.ts`（百度 MC 投影多项式）、`BD09TilingScheme.ts`（resolutions 瓦片范围 + y 取负）、`AMapImageryProvider.ts`、`BaiduImageryProvider.ts`（唯一重写 requestImage，做瓦片行列号换算 + 子域固定 1）、`GoogleImageryProvider.ts`、`TdtImageryProvider.ts`（key 参数化）、`TencentImageryProvider.ts`（img 用 customTags 计算 sx/sy）、`GeoVisImageryProvider.ts`（key 参数化）、`index.ts` 汇总导出。
- 公共 composable `src/lib/use-map-provider-scene.ts`：`mount()`（无底图 Viewer，globe.baseColor #152b4c）、`applyProvider/applyProviders`（removeAll + addImageryProvider + errorEvent 累 3 次提示 + requestRender）、`flyToLonLat`、`teardown`。
- 6 个案例 `src/cases/map-{amap,baidu,google,tdt,tencent,geovis}/`：每个含方案一（原样例）/方案二（新增影像/注记叠加）切换 + 坐标系 select（高德/谷歌/腾讯 GCJ02|WGS84、百度 BD09|WGS84、天地图/星图无坐标系）；tdt/geovis 含 key 输入框 + 「加载底图」按钮，未输 key 时提示；各含 index.ts（category `scene`、tag `cesium-map`）与 AI 生成 icon.webp。
- `src/cases/index.ts` 注册 6 案例；`vite.config.ts` 的 `CESIUM_SYMBOLS` 白名单新增 `ImageryProvider`、`WebMercatorProjection`、`WebMercatorTilingScheme`（dev 模式 cesium 走全局 shim，缺失符号导致 `does not provide an export named ...`）。

**关键修复（headless 验证驱动）**：
- 百度分支写反：WGS84→WebMercatorTilingScheme、BD09→BD09TilingScheme 是原版语义，忠实移植（百度瓦片在 BD09 模式用超大 WebMercator 范围、WGS84 模式用 BD09 网格 resolutions）。
- `UrlTemplateImageryProvider` 构造内 `Rectangle.intersection(rect, rect)`：当经度范围略超 ±PI（如 -20037726.37 米反投影得 ±3.1416）时 `negativePiToPi` 翻转导致返回 undefined → `provider.rectangle` 为 undefined → 渲染抛 `DeveloperError: Expected rectangle to be typeof object`。修复：super 后显式 `this._rectangle = this._tilingScheme.rectangle`（与原版一致，TS 用 cast 访问私有字段）。
- TS 兼容：`this.projection.project/unproject` 覆盖函数签名按 d.ts 返回 Cartesian3/接收 Cartesian3；BD09 `positionToTileXY` 的 undefined 分支改返回 `new Cartesian2()` 以满足基类签名；`ImageryProvider.loadImage` 结果 cast 为 `Promise<ImageryTypes>`。

**验证结果**：
- `npm run build` EXIT=0（/tmp/build_v660_final2.log，✓ built in 43.05s）。
- headless SwiftShader（/tmp/opencode/verify_mapcases.js）：29/29 PASS —— 6 案例方案一切换/方案二切换/坐标系切换 ✓；amap 601 张、baidu 358 张、google 18 张、tencent 334 张瓦片 200 加载 ✓；tdt/geovis 空 key 提示「请先输入」+ 输入 key 后「已加载」✓；全程无 pageerror。
- 网络层资源错误（`Failed to load resource` 400/CORS 警告）为各瓦片源边缘瓦片固有行为，已从验证错误判定中过滤。

**后续约定**：
- dev 模式新增对 Cesium 符号的 import 时，须同步加入 `vite.config.ts` 的 `CESIUM_SYMBOLS`。
- 移植 cesium-map 类时忠实保留原版分支与私有字段语义，d.ts 类型不匹配用 cast 而非改逻辑。
- 天地图/星图案例 key 由用户手动输入，项目内不硬编码。

## V6.6.1 地图底图 icon 换用户图、来源表述清理与星图地址切换

**目标**：
1. 天地图/高德/百度三个底图案例卡片 icon 换为用户上传的 image-1/image-2/image-3。
2. 贯彻项目基本规则：案例展示中不出现其它仓库相关信息、不出现“移植”类表述（覆盖 6 个底图案例与共享库）。
3. 星图地图底图服务地址切换为开放平台 api.open.geovisearth.com（影像与矢量分别确认路径）。

**实施内容**：
- icon 替换（用户上传图，横向 1234x656 等）：天地图=`804c4b96-image-1.webp`、高德=`cec8c499-image-2.webp`、百度=`cc45eaee-image-3.webp`，cp 覆盖 `src/cases/map-{tdt,amap,baidu}/icon.webp`。
- 文案清理（贯穿项目基本）：
  - 6 案例 `index.ts`：description 去掉“基于 cesium-map XxxImageryProvider”前缀；`tag: 'cesium-map'` → `tag: '地图底图'`（与「场景工具」「测量」等中文分类一致）。
  - 6 案例 Vue：`panel-title` 去掉「（cesium-map）」后缀；hint 由“由 cesium-map 的 XxxImageryProvider 移植实现…”改写为“Xxx瓦片服务，…”正向描述。
  - 共享库 `src/lib/map-providers/`：删除注释中“（cesium-map 移植）”表述。
  - 库目录 `src/lib/cesium-map/` 重命名为 `src/lib/map-providers/`（模块路径不含仓库名），6 处 import 同步更新。
- 星图地址（GeoVisImageryProvider 重写，URL 模板带 `?token={key}`，无 token 服务端返回 `{"code":102,"msg":"token非法或不存在"}`）：
  - 矢量（style=vec）：`https://api.open.geovisearth.com/map/v1/vec/{z}/{x}/{y}?token={key}`
  - 影像（style=img）：`https://api.open.geovisearth.com/pj/base/v1/2025/{z}/{x}/{y}?token={key}`（用户确认路径；原 tiles{s}.geovisearth.com/base/v1 废弃）

**验证结果**：
- `npm run build` EXIT=0（/tmp/build_v661.log，✓ built in 1m 47s）。
- headless（/tmp/opencode/verify_mapcases.js 重跑）：29/29 PASS 无回归；`verify_icons.js` 6/6 —— 天地图 1234x656、高德 1235x653、百度 1235x658 新图加载 naturalWidth>0，其余 3 案例 512x512。

## V6.6.2 星图/腾讯/谷歌底图 icon 换用户图

**目标**：剩余三个底图案例卡片 icon 换为用户上传图，使 6 个地图底图案例全部使用正式图标。

**实施内容**：
- 星图=`67d1dbd5-image-1.webp`（1234x651）、腾讯=`50227a67-image-2.webp`（1233x648）、谷歌=`03d6638d-image-3.webp`（1235x650），cp 覆盖 `src/cases/map-{geovis,tencent,google}/icon.webp`。

**验证结果**：
- headless `verify_icons.js`：6/6 PASS —— 全部案例图标 naturalWidth>0（天地图/高德/百度/星图/腾讯/谷歌均用户上传图，尺寸 1233~1235 x 648~658；新图经 Vite 时间戳 `?t=` 确认热更新生效）。

## V6.7 空间分析-自定义XYZ坐标轴-拖拽平移案例

**目标**：新增一个空间分析案例：在指定中心点创建红黄绿三色 XYZ 坐标轴（X 红=东、Y 黄=北、Z 绿=上），悬停高亮为黄色、按下加粗，鼠标拖动使中心点沿当前轴方向平移、坐标同步显示并 console 打印平移信息；支持各类参数设置；无需专门 icon。

**实施内容**：
- 新增 `src/cases/xyz-axis/`（`XyzAxisDemo.vue` + `index.ts`），category=`analysis`，tag=`坐标轴`，无 icon（卡片显示占位图）。
- 三轴 Entity（line+handle+label，共 9 个 + 中心锚点 origin），位置用 `CallbackProperty` 动态跟随 `currentCenter`。
- 坐标轴方向由 `Transforms.eastNorthUpToFixedFrame(center)` 提取东/北/上单位向量；轴端与中心点均为可拾取对象。
- 交互（`ScreenSpaceEventHandler`）：MOUSE_MOVE 悬停拾取→该轴颜色变黄高亮且线宽增（base→hover）；LEFT_DOWN 命中轴→线宽增为 active 并禁用相机 rotate 进入拖动；MOUSE_MOVE 拖动期间用“屏幕每米像素向量”换算鼠标像素位移为沿轴米数，中心点直线平移并实时同步面板坐标；LEFT_UP 恢复 rotate 并打印汇总。
- console 打印：开始拖动、拖动中（节流）、平移完成三类信息，格式如 `[XYZ坐标轴] 平移完成：沿X（东）轴累计移动 +123.45m，中心点坐标：经度 xxx°，纬度 xxx°，高度 xxxm`。
- 参数面板：中心点经/纬/高（可应用重建）、轴长、基础/悬停/按下线宽、打印节流、轴颜色（三色 picker，默认红黄绿）、轴端标签/拖拽手柄/Bing 底图开关、回到中心点。

**踩坑修复**（本轮 headless 曾全过，但结论在 V6.7.2 被证伪并更正，见下）：
- 曾误判 `viewer.scene.pick` 与 `SceneTransforms.worldToWindowCoordinates` 需要 viewport（window）坐标，引入 `toWindowPos()` 加 `canvas.getBoundingClientRect()` 偏移。该结论已被 V6.7.2 像素取证推翻：三者统一为 canvas 相对坐标，此偏移导致真实用户“轴上无反应、空白区偶发拾取”。

**验证结果**：
- `npm run build` EXIT=0（`/tmp/build_v67.log`，0 TS 错误）。
- 当时的 headless `verify_xyzaxis.js` 12/12 PASS 为**巧合性假阳性**：旧脚本把 worldToWindow 的 canvas 相对输出直接当 Playwright viewport 鼠标坐标，代码又加 rect 偏移还原，双重反转恰好命中，无法代表真实用户。

## V6.7.1 XYZ 轴案例交互失效修复

**用户反馈**：交互不生效。

**根因分析**（headless 全过而真实环境失效的差异）：
1. 真实环境失效的**主因实为 V6.7 引入的坐标偏移**（`toWindowPos()` 加 `getBoundingClientRect`，判定点相对真实渲染轴错位整段 rect）——该定论在 V6.7.2 通过像素取证确认，V6.7.2 已删偏移。
2. **拾取目标过小**（独立成立的稳健性问题）：三轴为 3px 细线，真实鼠标需像素级压线才命中，轻微偏差即判定 miss；按下 miss 时左键被相机 rotate 接管，表现为“拖不动/没反应”。
2. **拖出边界释放状态残留**：`LEFT_UP` 只在 canvas 内触发；把轴拖出 canvas 后释放无法结束拖动，`enableRotate=false` 永久残留，后续左键旋转相机关闭、activeAxis 线宽卡住。
3. hover 节流 80ms 偏长。

**修复内容**：
- 拾取改为 `axisAt()`：先 `scene.pick` 精确命中；miss 时兜底按**屏幕距离**判定——把当前中心点与轴端点投影到屏幕成线段，鼠标到线段最短距离 ≤ 容差（默认 14px，面板可调 6~30）即视为命中该轴。真实用户贴近轴按下即可拖动。
- 拖动结束兜底：`finishDrag()` 统一结束逻辑；`canvas mouseleave`、`window mouseup`、`window blur` 都触发清理，避免 activeAxis/相机锁定残留。
- hover 节流 80ms→50ms，增加提示光标 grab/grabbing。

**验证结果**：
- `npm run build` EXIT=0（0 TS 错误）。
- 当轮 headless `verify_xyzaxis.js` 12/12 PASS（其中悬停与按下改在偏离轴线 8~12px 处触发，验证容差拾取）——但该脚本同样基于 V6.7 错误坐标假设，为假阳性；V6.7.2 已按 canvas 相对坐标重写物理鼠标落点并重新全绿。

## V6.7.2 XYZ 轴案例坐标系统误判修正（删除 getBoundingClientRect 偏移）

**用户反馈**：真实浏览器中「轴上按下无反应、空白区域偶发拾取/拖动」。

**定案过程（源码 + 像素取证，推翻 V6.7 的“viewport 坐标”结论）**：
- `@cesium/engine/Source/Core/ScreenSpaceEventHandler.js` `getPosition`（L19-21）：事件元素非 document 时 `clientX - rect.left` → **canvas 相对**。
- `Scene.pick` → `Picking.js pickBegin`（L305-309）经 `transformWindowToDrawingBuffer`（`SceneTransforms.js` L382 `windowPosition.x * xScale`，无偏移减法）→ **期望 canvas 相对**。
- `worldToWindowCoordinates` → `worldWithEyeOffsetToWindowCoordinates`（`SceneTransforms.js` L126-132 viewport 原点为 0、宽 = canvas.clientWidth）→ **输出 canvas 相对**。
- headless 实测：canvas rect=(127,216)；`worldToWindowCoordinates(X轴端)=(982.7,372.5)`；`scene.pick(982.7,372.5)` 命中 handle，`pick(+rect)` 与 `pick(-rect)` 均 none → pick 期望 canvas 相对。
- 截图像素取证：canvas 内 X 轴真实渲染横跨 `x[631..987] y[368..376]`、Y 轴 `x[618..627] y[8..363]`，与 worldToWindow 输出（原点 623,372、端 982.7,372）完全重合 → 轴真实渲染位置即 worldToWindow 的 canvas 相对坐标。
- 综合结论：`handler position/endPosition`、`Scene.pick`、`SceneTransforms.worldToWindowCoordinates` **三者统一 canvas 相对坐标（CSS px）**，判定/拾取/比较一律不加减 `getBoundingClientRect` 偏移。
- 旧 headless 12/12 通过全因**双重反转巧合**：旧脚本把 canvas 相对输出当 viewport 鼠标坐标，代码又加 rect 还原，数值恰好命中；真实用户鼠标位置与判定错位整段 rect，形成“轴上无反应、空白偶发拾取”。
- 拖拽平移量本不受影响（rect 常量偏移在 delta 中抵消），错位只影响 hover/pick/axisAt 命中判定。

**修复内容**（`src/cases/xyz-axis/XyzAxisDemo.vue`）：
- 删除 `toWindowPos()`；`onMouseMove/onLeftDown/dragMeters` 直接使用 `event.endPosition/event.position`（canvas 相对）比较 `pickedAxis/axisAt/dragStartWindow`。
- 保留 V6.7.1 的容差拾取（`hoverTolerance` + `nearestAxisByDistance` 线段投影）与拖动结束兜底，拾取顺序 `scene.pick → 屏幕距离兜底` 不变。
- 修正 headless 验证脚本：物理鼠标落点 = `scene.canvas.getBoundingClientRect().left/top + worldToWindow(...)`（canvas 相对坐标换算为 viewport 坐标才是真实鼠标位置）。

**验证结果**：
- `npm run build` EXIT=0（`/tmp/build_v672.log`，0 TS 错误）。
- headless 重写后 `verify_xyzaxis.js` 12/12 PASS：目标点换算页面坐标 (929.8,588.5) 元素栈顶层为 CANVAS（真实压在线渲染像素上），悬停 width 3→6、按下 width→12、拖动沿 X 轴平移 -667.24m（中心经度 116.3649→116.3571）、console 开始/过程/完成三类打印、无关键页面错误。

**后续约定**：
- Cesium 交互坐标系：canvas 相对（CSS px）是 handler / Scene.pick / worldToWindow 的统一坐标，禁止加页面偏移后再判定；只有「canvas 相对 → Playwright 物理鼠标/原生事件坐标」换算才加 `canvas.getBoundingClientRect()`。
- headless 验证坐标换算须与真实用户一致，不得把 worldToWindow 输出直接当鼠标坐标（这是 V6.7/V6.7.1 系列误判的根源）。

## V6.8 空间分析-自定义XYZ球形坐标轴-拖拽旋转案例

**目标**：新增「自定义XYZ球形坐标轴-拖拽旋转」案例：在指定中心点创建红（X=东）黄（Y=北）绿（Z=上）三轴组成的球形坐标系（三轴线 + 轴端拖拽手柄 + 垂直该轴的旋转示意环，形成球状视觉），悬停高亮为黄色、按下加粗，按住轴拖动使整个坐标系沿被拖轴的当前方向（body/局部轴）旋转；姿态角实时同步显示与输入框联动，控制台打印开始/过程/完成旋转信息；支持各类参数设置；无需专门 icon。

**实施内容**：
- 新增 `src/cases/xyz-rotate/`（`XyzRotateDemo.vue` + `index.ts`），category=`analysis`，tag=`坐标轴`，无 icon（卡片显示占位图），注册于 `src/cases/index.ts` `xyzRotateCase`。
- 实体：每轴 line + 轴端 handle 点 + 旋转示意环（48 段 polyline 圆，垂直该轴过原点）+ 轴端 X/Y/Z 标签（共 13 实体 + 原点半透明球心点）。
- **姿态模型**：姿态矩阵 `R = Rz(绕Z上角)·Ry(绕Y北角)·Rx(绕X东角)`，作用于当地 ENU 基得当前轴方向 `dir = R·basis`；本地（body）旋转 `R ← R·fromRotationX/Y/Z(δ)` 使坐标系沿“被拖轴的当前方向”旋转（绕自身 X 轴旋转时 Y/Z 绕 X 摆动、X 自身不动）。
- **拖动手感**：拖轴时以屏幕上的中心投影点为枢轴，把“鼠标相对枢轴的极角增量”换算为旋转角 δ（弧度自动 wrap ±π 后转度），保证任何视图下手感一致（圆弧式旋转）；旋转中每步更新姿态矩阵并反解回三个角度同步输入框/显示。
- 欧拉反解：从 `R` 三列提取（β=asin(-col0.z)、γ=atan2(col0.y,col0.x)、α=atan2(col1.z,col2.z)），闭环无漂移（提取角重组成 R 恒等）。
- 交互沿用坐标系统定案：`ScreenSpaceEventHandler` position/endPosition 即 canvas 相对坐标，直接交 `Scene.pick`/`axisAt`（scene.pick → 屏幕距离容差兜底），拖出 canvas 释放/失焦结束兜底、hover 节流 50ms 同 V6.7 系列。
- console 打印三类信息：`[XYZ坐标轴旋转] 开始拖动绕X（东）轴旋转，当前姿态…`、过程中节流打印累计角度与当前姿态、`旋转完成：累计 …°`。
- 参数面板：中心点（经/纬/高+应用）、姿态三角度输入（绕X/绕Y/绕Z，支持应用与重置 0）、实时姿态显示（拖动同步）、轴长、示意环半径比、基础/悬停/按下线宽、打印节流、拾取容差、三轴颜色、轴端标签/拖拽手柄/旋转示意环/Bing 底图开关。

**踩坑修复**：
- `axes` 记录若初始化为整个 `undefined` 元素（`x: undefined as unknown as {...}`），`rebuildAxes→removeAxes` 遍历 `axis.line` 崩溃（Cannot read properties of undefined）；须初始化为 `{ line: undefined as unknown as Entity, ... }` 结构的空实体对象。

**验证结果**：
- `npm run build` EXIT=0（`/tmp/build_v68_final.log`，vue-tsc + vite 0 error）。
- headless `verify_xyzrotate.js` 14/14 PASS：卡片存在、13 实体、三色 RGB、初始姿态 0°、拖拽起点 `elementsFromPoint` 顶层为 CANVAS（无遮挡）；拖 X 轴绕枢轴圆弧 75° 后悬停 width 3→6、按下→12、线 y/z 世界坐标变化（绕 X 轴 X 自身不动符合预期）、姿态显示精确 `绕X +75.0000°`（Y/Z 保持 0）、console 开始/过程(20 条)/完成三类打印、无关键页面错误。

## V6.8.1 XYZ 球形旋转案例视觉改造（仅保留环形轴）

**用户反馈**：球形坐标轴不需要再显示直线轴，只显示环形轴即可。

**实施内容**（`src/cases/xyz-rotate/XyzRotateDemo.vue`）：
- 移除直线轴 line 与轴端拖拽手柄 handle 的创建/样式/拾取；`axes` 记录改为 `{ ring, label }`（环形轴 + 环上 X/Y/Z 标识标签），实体由 13 个收敛为 7 个（3×ring + 3×label + origin 球心点）。
- 环形轴成为交互主体：环即“轴”，其法线方向即旋转轴（绕 X 环法线 → 绕 X 东方向 body 旋转，其余依此类推）。环的默认色 = 轴色，悬停高亮黄、按下加粗，宽度复用 base/hover/activeWidth。
- 轴端标签改挂到环上相位点（X 环 45°、Y 环 135°、Z 环 -45°），随环旋转；移除直线轴专属参数（环半径比并入环半径参数 ringRadius，直接米）。
- 拾取/容差兜底适配环：`scene.pick` 精确命中环/标签；miss 时把每环 72 段采样点投影到屏幕取“鼠标到环的最小距离”，容差内判定命中（替代原直线段投影兜底）。
- 面板文案与开关更新：环形轴半径(m)、环形轴显示、环形轴标识 X/Y/Z、环形轴颜色（X环红/Y环黄/Z环绿）。

**设计说明（环形轴拾取固有歧义）**：正俯视下 X/Y 环处于 edge-on（投影为过圆心的横/竖线），与水平 Z 环投影相交处存在“点到交点命中哪环”的不确定性，属三维线框 gizmo 正常现象；倾斜视角下各环呈椭圆可正常辨识拖拽。验证脚本取点时避开 0/90/180/270° 投影十字方向。

**验证结果**：
- `npm run build` EXIT=0（`/tmp/build_v681.log`，0 TS 错误）。
- headless `verify_xyzrotate.js` 14/14 PASS：卡片存在、实体恰为 7 个且不存在旧 line/handle、三环 RGB 正确、初始姿态 0°；取 Z 环干净点（屏幕角 -65° 避开十字投影）悬停 width 3→6、按下→12、拖 Z 环画弧后 ring-x/y 世界位置变化（绕 Z 旋转 X/Y 环随动，Z 环自身不动符合预期）、姿态 live 实时同步、console 开始/过程(22 条)/完成三类打印、无关键页面错误。

## V6.8.2 空间分析-自定义XYZ编辑坐标轴-平移/旋转案例（平移+旋转融合）

**目标**：新增「自定义XYZ编辑坐标轴-平移/旋转」案例：把 V6.7 平移坐标轴（直线轴 + 轴端手柄）与 V6.8.1 旋转坐标轴（环形轴）融合为**单个可编辑坐标轴 gizmo**——每轴由「直线轴 line + 端手柄 handle（平移部件）+ 环形轴 ring（旋转部件）+ X/Y/Z 标签」组成；拖直线轴/端手柄 → 中心点沿该轴方向平移，拖环形轴 → 坐标系绕环所在轴方向（body/局部轴）旋转；两操作在同一视图内独立切换、互不干扰，实时同步中心点坐标与三姿态角，console 打印开始/过程/完成信息，参数面板覆盖坐标/姿态/轴长/环半径/线宽/打印节流/拾取容差/颜色/显示开关。

**实施内容**：
- 新增 `src/cases/xyz-edit/`（`XyzEditDemo.vue` + `index.ts`），category=`analysis`，tag=`坐标轴`，无 icon；注册于 `src/cases/index.ts` `xyzEditCase`（紧邻 xyz-axis/xyz-rotate）。
- 实体：每轴 line + handle + ring + label 共 12 + origin 球心点 = **13**；三轴默认色红(X 东)/黄(Y 北)/绿(Z 上)，直线与环同色，悬停黄色高亮 `#ffe14d`、按下加粗，宽度复用 base/hover/activeWidth。
- **单 gizmo 分流模型**：`activeKind`（`translate`/`rotate`）+ `activeAxis` 显式拆分拖动态；`axisTargetOf` 将实体 id 分类——`line/handle/label → translate`、`ring → rotate`；`onLeftDown/onMouseMove/finishDrag` 依 activeKind 走两条互斥分支，一条交互链路内不可能同时平移又旋转。
- **平移路径（沿用 V6.7）**：`pickedTarget ?? targetAt` 命中 translate 部件后，以 `dragStartCenter + dragAxisDir` 的投影向量换算「屏幕每米像素」，把鼠标位移投影为沿轴米数，仅更新 `currentCenter`（经纬高 ref），姿态矩阵与三姿态角保持不变（验证断言拖动后仍 0°）。
- **旋转路径（沿用 V6.8/V6.8.1）**：以中心点屏幕投影为枢轴，把鼠标极角增量换算为 body 旋转角 δ，`R ← R·fromRotationX/Y/Z(δ)` 右乘后经欧拉反解（β=asin(-col0.z)、γ=atan2、α=atan2）同步回绕 X/Y/Z 输入框与姿态 live 显示；中心点不动（坐标 live 不变）。
- **拾取融合（指哪打哪）**：`scene.pick` 优先精确命中实际绘制对象判定 kind（避免 line 与 edge-on 环投影重叠时误判）；miss 时距离兜底在「直线段投影（平移）」与「每环 72 采样点投影（旋转）」间取全局最小，容差默认 14px 面板可调。容差兜底语义：距直线最近 → translate、距环最近 → rotate。
- 平移与旋转拾取共存时的环交叉：直线轴必穿过垂直环面（X 直线在 ±R 处与 Y/Z 环交点重叠），点击重合区域由 `scene.pick` 决定实际命中环还是线，行为一致不冲突；测试取点刻意避开重合区。
- 参数面板：中心点经/纬/高（应用+回到中心点）、姿态绕X/绕Y/绕Z（应用+重置）、当前坐标+姿态 live（拖动同步）、直线轴长度、环形轴半径、基础/悬停/按下线宽、打印节流、拾取容差、三轴颜色、轴端标签/手柄/环形轴/Bing 底图开关；hint 文案说明「拖直线=平移、拖环=旋转」。
- console 前缀 `[XYZ编辑轴]`，三类打印：`开始拖动沿X（东）轴平移…`、节流打印 `平移中 累计 ±xx.xxm…`、`平移完成：累计 …`；旋转对应 `…沿Z（上）轴旋转 / 旋转中 累计旋转 ±xx.xx° / 旋转完成`。
- 样式沿用系列 xyz 风格（control-panel / status-mask / live-coord / live-attitude / switch）。

**关键决策**：
- 平移与旋转在组件内以显式 kind 分流，单击命中即锁定本次语义（环→旋转、线/手柄→平移），互斥不需要额外模式切换 UI。
- 姿态旋转保持本地/body 右乘：拖 X 环时 Y/Z 环世界摆动、X 环平面保持自身；平移不改姿态，旋转不改中心，满足「坐标输入轴与姿态输入环」分离操控。
- 旋转中途线性叠加角度经 `extractAttitude` 回写面板，避免累计漂移；平移拖动结束后保留姿态，面板姿态值不受平移影响。
- 保留 V6.7 的拖动结束兜底（拖出 canvas mouseleave / 失焦 blur / 全局 mouseup 均 finishDrag）与 hover 节流 50ms。

**验证结果**：
- `npm run build` EXIT=0（`/tmp/build_xyzedit.log`，vue-tsc + vite 0 error）。
- headless `verify_xyzedit.js` 30/30 PASS：卡片存在、实体恰为 13（无旧案例遗留）、三直线+三环 RGB 正确、初始姿态 0°；平移流程取 X 直线 t=0.62 干净点（`scene.pick` 校验命中 line-x）悬停 width 3→6、按下→12，拖 -120px 后中心经度 116.3649→116.3559、坐标 live 更新、姿态保持 0°、console 平移开始/过程/完成；旋转流程取 Z 环干净点（屏幕角 -130° 避开十字且 pick 命中 ring-z）画弧 +80°，ring-x/y 世界位置变化、姿态 live 精确 `绕Z +80.0000°`、绕Z 输入回写 80、中心点与坐标 live 不变、console 旋转三类打印；旋转后再拖 X 直线中心仍可平移（融合共存）；无关键页面错误。

## V6.8.3 三个 XYZ 坐标轴系列案例卡片 icon 换用户新图

**用户要求**：
1. 自定义XYZ坐标轴-拖拽平移（xyz-axis）卡片 icon → 上传的 image-1。
2. 自定义XYZ球形坐标轴-拖拽旋转（xyz-rotate）卡片 icon → 上传的 image-2。
3. 自定义XYZ编辑坐标轴-平移/旋转（xyz-edit）卡片 icon → 上传的 image-3。

**实施内容**：
- 将用户上传图复制为案例目录 `icon.webp`：`src/cases/xyz-axis/icon.webp`（image-1，138530B）、`src/cases/xyz-rotate/icon.webp`（image-2，152184B）、`src/cases/xyz-edit/icon.webp`（image-3，144516B）；不得引用 `.monkeycode-tmp-files/` 内文件（构建后目录缺失会失败）。
- 三个 `index.ts` 各加 `import icon from './icon.webp'` 与 `icon,` 字段（此前均无 icon，卡片显示占位图）。

**验证结果**：
- `npm run build` EXIT=0（`/tmp/build_xyzicons.log`，vue-tsc + vite 0 error）。
- headless `verify_xyzicons.js` 7/7 PASS：三个卡片 `img.naturalWidth>0`（1232/1233/1239）且 src 为 icon.webp、complete=true；三个 icon.webp HTTP 200 且字节数与源文件一致；无关键页面错误。

## V6.9.1 大雁塔模型XYZ编辑坐标轴案例卡片 icon 换用户新图

**用户要求**：大雁塔模型XYZ编辑坐标轴-平移/旋转案例（dayanta-xyz）卡片 icon 采用上传的 image-1。

**实施内容**：
- 将用户上传图复制为 `src/cases/dayanta-xyz/icon.webp`（125414B，1234×638）；不得引用 `.monkeycode-tmp-files/` 内文件（构建后目录缺失会失败）。
- `src/cases/dayanta-xyz/index.ts` 加 `import icon from './icon.webp'` 与 `icon,` 字段（此前无 icon，卡片显示占位图）。

**验证结果**：
- `npm run build` EXIT=0（`/tmp/build_dayantaicon.log`，vue-tsc + vite 0 error）。
- headless `verify_dayanta_icon.js` 5/5 PASS：`icon.webp` HTTP 200 且字节数与上传源一致（125414）；空间分析分类下卡片存在；卡片 `img` 可解码（naturalWidth=1234/naturalHeight=638）且 src 指向 `dayanta-xyz/icon.webp`；无关键页面错误（常规 404 资源告警按系列脚本惯例过滤）。

## V6.18 「洪水淹没·GPU SPH粒子流线」案例改造为「水深图提取」（移除 SPH，只保留深度数据源 → 水深网格叠加 / 导出，贴地框选实时预览）

**用户要求（问卷确认）**：将 `flood-sph-simulation` 案例改造为新「水深图提取」案例，id 与目录改为 `water-depth-extraction`；只保留现有深度数据源部分（真实地形采样 + 水面高程 / GeoTIFF 作 DEM 或直接水深 / PNG·JPG 归一化水深 + 增益）；生成的矩形要贴地；点击起点后移动鼠标实时显示矩形范围；水深图支持在地图上叠加；支持结果 TIF / PNG 输出；不配置 icon。

**实施内容**：
- 案例重命名 `src/cases/flood-sph-simulation/` → `src/cases/water-depth-extraction/`，`FloodSphSimulationDemo.vue` → `WaterDepthExtractionDemo.vue`；删除 GPU SPH 引擎死代码 `gpu-sph-engine.ts`（701 行）及全部 SPH/流线 UI 与逐帧 `postRender` 驱动。
- `index.ts`：id `water-depth-extraction`，标题「水深图提取」，归入 `water`，tag「水深提取」，description 描述真实地形/上传栅格 → 水深网格 → 叠加/导出；不设 icon 字段。`src/cases/index.ts` import 与卡片列表同步改为 `waterDepthExtractionCase`。
- `WaterDepthExtractionDemo.vue`（重写，以 `flood-depth-simulation` 的贴地矩形/叠加章节为参照）：
  - 数据源：真实地形采样（四至输入 / 自动示例 / 框选，128 推荐）与上传栅格（GeoTIFF 高程 DEM / 直接水深，PNG·JPG 归一化水深 + 增益滑杆，@change 触发重算避免拖拽风暴）；DEM 源带水面高程滑杆重算水深；`ui.mode` 变更对已解析 GeoTIFF 即时切换 DEM/水深解释。
  - 贴地框选：矩形 Polygon `heightReference: CLAMP_TO_GROUND`（贴地）+ `clampToGround` 地面 Polyline 描边；点击第一角点后 MOUSE_MOVE 实时刷新矩形与终点预览标记，点击第二角点自动采样生成；`depthTestAgainstTerrain=true`，取点用 `measure-lib/pick` 地形拾取。
  - 叠加与导出：水深图渲染为透明底色彩色 PNG，`SingleTileImageryProvider` 叠加到范围矩形（tileWidth/tileHeight = 网格尺寸），支持图层显隐 / 透明度滑杆 / 范围矩形显隐；预览缩略图 + 数据/四至文本；导出 `water-depth-map.png`（彩色图）与 `water-depth-map.tif`（Float32 水深栅格 EPSG:4326）。
- 行序统一 north-first（网格 row0 = 北）：`raster-loader.ts` 下采样去垂直翻转（`downscaleAndFlip` 更名 `downscaleRaster`），`terrain-sampler.ts` 采样产物即 row0=北，渲染 canvas 顶层/叠加与 GeoTIFF 导出（tiepoint 西北角、负 lat 像元）同约定。
- 新增 `geotiff-export.ts`：本地 `writeDepthGeoTiffFloat32` 写 Float32 单波段无压缩 GeoTIFF（标签 256/257/258/259/262/273/277/278/279/284/339/33550/33922/34735，GeoKey 4326），参照 `hydro-analysis-pro/export-formats.ts` 已验证字节布局，案例内自包含不跨目录引用。

**验证结果**：
- `npx vue-tsc -b --force` 0 error；`npm run build` EXIT=0（产物含 `WaterDepthExtractionDemo-*.js`）。
- headless SwiftShader `verify_wde.js` **19/19 PASS**：水面效果分类下「水深图提取」卡片存在；打开后自动示例生成水深图（128×207 网格、最大水深 2401.17 m，state 标记 overlay/rect 可见）；无失败状态提示、无关键页面错误；「框选矩形范围」按钮可用；点击第一角点后 MOUSE_MOVE 实时显示矩形预览提示，点击第二角点自动重生成（框选区最大水深 832.8 m）；结果面板预览图与网格统计文本正常；下载 TIF 为合法 GeoTIFF（`II*\0` 头、size 23.8KB、文件名 `water-depth-map.tif`），下载 PNG 签名与体量正常（`water-depth-map.png`）；叠加图层开关可切换。
- 期间修复：`clearStatusSoon` 改为仅清除其排定的那条提示（令牌比较），避免 4.2s 延时误清实时框选预览文案；`window.__wdeState` 的 overlay/rect 可见性改为随开关实时更新，便于校验。

## V6.19 新增「三维数据加载-glTF/GLB 模型查看器」案例（远程 URL / 本地文件与文件夹加载，外观与动画控制，无 icon）

**用户要求（问卷确认）**：参考提供的 gltf_viewer 单页 HTML 实现，为 Cesium 案例中心新增一个 glTF/GLB 模型查看器案例：支持远程 URL 与本地 .glb/.gltf 文件（含带 .bin/纹理资源的文件夹）加载；可控制位置（经纬高）/旋转（航向/俯仰/翻滚）/缩放（统一或分轴）；显示包围盒、线框模式、透明度、色调、阴影、轮廓、日照光照；自动旋转；定位到模型与纽约/巴黎/东京/洛杉矶/北京/上海/郑州/深圳快捷相机位置；不配置专门 icon。

**实施内容**：
- 新案例 `src/cases/gltf-viewer/`（id `gltf-viewer`，title「glTF/GLB 模型查看器」，category `tiles`，tag「模型加载」，无 icon 字段，`GltfViewerDemo.vue` 1360 余行）；`src/cases/index.ts` import 并追加 `gltfViewerCase` 至卡片列表末尾。
- 场景生命周期复用公共库 `createMapScene`/`destroyScene`/`loadBingImagery`/`setTerrainEnabled`（`src/lib/cesium-scene.ts`），默认 Bing 影像；模型用 Cesium `Model.fromGltfAsync` 异步加载入 `scene.primitives`。
- 本地加载：.glb 经 `arrayBuffer`→blob（`model/gltf-binary`）；.gltf 解析 JSON 后递归遍历对象树，把 `uri`/`url`（非 data:/blob:）按相对路径/文件名匹配文件夹文件并替换为 `URL.createObjectURL` blob，规避本地相对资源 fetch 失败；支持 `webkitdirectory` 选择文件夹与 `webkitGetAsEntry` 递归遍历拖入目录；全部 blob URL 记录于 `blobUrls`，卸载时统一 revoke。
- 位置矩阵 `Transforms.headingPitchRollToFixedFrame`；统一缩放写 `model.scale`，分轴缩放 `Matrix4.multiply(base, fromScale)`；外观项 `debugShowBoundingVolume`/`debugWireframe`/`silhouetteSize`/`silhouetteColor`/`shadows`/`color`（色调 alpha 承载透明度）均 try/catch 容错。
- 阴影开启时固定 `DirectionalLight({direction, intensity:3})` + `shadowMap.enabled`，关闭还原 `SunLight`；日照光照独立 `globe.enableLighting`；自动旋转改为 `requestAnimationFrame` 驱动（记录 raf id，切换/卸载时 `cancelAnimationFrame`）——早期实现在 `viewer.clock.onTick` 内逐帧写 `model.modelMatrix`，会污染当帧视锥剔除状态，headless SwiftShader 必现 `RangeError: Invalid array length`（`updateFrustums`），已改 rAF 修复。
- 控制面板（右侧可折叠）：模型加载（点击/拖拽/选文件夹/URL）、模型信息、定位到模型、位置、旋转、缩放（锁定统一）、外观、动画（转速滑杆）、场景（地形/日照）、快捷位置 8 城、重置/移除；加载遮罩 + 4s 自动消失 toast。
- `vite.config.ts` 的 `CESIUM_SYMBOLS` 白名单新增 `Model`（dev 模式 cesium 走全局 shim，缺失符号报 `does not provide an export named ...`）。
- 规格文档 `.monkeycode/specs/gltf-viewer/`（requirements.md + design.md）。

**验证结果**：
- `npx vue-tsc -b --force` 0 error（EXIT=0，0 TS 错误）。
- `npm run build` EXIT=0（✓ built in 58.70s，产物含 `GltfViewerDemo-*.js/.css` 独立 chunk）。
- Playwright headless 冒烟 **16/16 PASS**：gallery 卡片与分类点击打开、canvas/面板渲染、本地 `.gltf` data-uri、本地 `.glb`（`tri.glb`）、`.gltf`+外部 `.bin` URI blob 重写、远程 URL（`CesiumMilkTruck.glb`、`Box.glb`）、加载后开启自动旋转无 pageerror、模型信息面板刷新、移除与重置。
- 视觉冒烟：headless 截图（1500×950）地图场景区域 15.7 万种颜色、91.9% 高方差像素，确认 Bing 底图+模型+阴影非空白渲染。
- 修复点：补齐模板引用的 `onDragOver`/`onDragLeave` 处理器（含拖拽高亮态 `dragActive`）；移除未使用 `syncLockedScales`；各 section 包入 `.panel-scroll` 可滚动容器避免面板超高溢出；滚动条选择器改挂 `.panel-scroll`；blob-URL 回收与 `removeModel` 解耦避免 `Model.fromGltfAsync` 就绪前被 revoke；修复 `clock.onTick` 逐帧写矩阵触发 Cesium 渲染崩溃（改 rAF）。

## V6.19.1 glTF/GLB 模型查看器案例收尾（icon 上传 / 面板样式对齐 / 移除快捷位置）

**用户要求**：① 卡片 icon 采用上传的 image-1（即本案例运行截图）；② 右侧面板样式参考其他案例样式；③ 移除快捷位置部分内容。

**实施内容**：
- 卡片 icon：`src/cases/gltf-viewer/icon.webp` = 上传的 image-1（1235×647），`index.ts` import 并填写 `icon` 字段，与同分类案例截图缩略图一致。
- 面板样式对齐通用「深蓝玻璃」控制面板：`.side-panel` 由整高不透明栏改为右上 compact 浮卡（`top/right:12px`、`max-height:calc(100%-24px)`、圆角 9、`background rgba(10,26,52,.9)`、`border rgba(157,188,224,.28)`、轻投影），删除标题栏渐变背景改为纯文字标题；全量色板 token 化对齐（文字 `#dce8f5`/`#c3d5e8`、分组小标题 `#8ea5c2`、主色 `#2f80ed`、输入框 `rgba(20,43,80,.75)` 等）；按钮语义色（主蓝 / 成功绿 / 危险红 / 定位描边），滑块 thumb 与复选框 accent 统一主色。
- 移除「快捷位置」区块：删除 `PRESETS` 常量与 `Preset` 类型、`applyPreset`/`flyToPosition`（仅被其引用）及模板 section、`.preset-row/.preset-btn` 死样式；保留「定位到模型」。
- 清理历史遗留的重复 `.panel-collapse-btn/.panel-restore` 规则。

**验证结果**：`npx vue-tsc -b --force` 0 error；`npm run build` EXIT=0；headless 冒烟复核 **8/8 PASS**（卡片展示 icon.webp 缩略图且无「暂无截图」兜底、打开案例 canvas 与侧栏渲染、快捷位置区块与 preset 元素数为 0、模型加载/定位到模型/重置分组保留、远程 Box.glb 加载后模型信息正常、无页面级错误）。

## V6.20 新增「综合态势标绘控件」案例（界面控件分类；几何标绘 + 文本/图片/模型点标注 + 多坐标系导出，卡片 icon=上传 image-1）

**用户要求**：在既有 military-plotting-lib 21 种几何标绘基础上新增综合态势标绘能力：复用几何绘制/编辑底座，叠加文本/图片/模型三类点标注的放置、选择、移动/旋转/缩放与属性实时修改，并把几何与标注统一导出为多坐标系 GeoJSON / SHP。交付时按追加反馈定稿：案例名称「综合态势标绘控件」，归入「界面控件」分类（category `widgets`），卡片 icon 用上传的 image-1（.monkeycode-tmp-files/ecc51bf4-image-1.webp，49272B）。

**实施内容**：
- 可复用库 `src/cases/situation-plotting-lib/`（不依赖军事几何编辑器实现细节）：
  - `annotation-types.ts`：三类点标注的字段类型/默认值与常量（`PLOT_ENTITY_PREFIX='military-plotting-'` 之外的实体前缀 `situation-annotation-text-|image-|model-`、选中标记 id `situation-annotation-select-marker`）、文本/图片/模型预设与 `getPlacementFields`、`renderAnnotationEntity`、`updateAnnotationPosition`、`renderAltitudeOf`、实体点位读回等；
  - `annotation-session.ts`：标注会话（放置 keyword 回调 / 选择 / 编辑工具 setTool('select'|'move'|'rotate'|'scale') / 属性 patch 实时生效 / 撤销 / 惰性高亮实体——首次 add 固定样式参数，拖拽/切换只改 `position`，避免重建闪烁）；
  - `export-controller.ts`：把几何对象与标注会话对象合并为统一 FeatureCollection/要素集，交由 `draw-export-lib/exporter`（本轮扩展 baseName/DBF 字段，向后兼容）导出 GeoJSON / SHP；
  - `SituationPlotting.vue`（约 1445 行，scoped）：右侧深蓝玻璃控制面板（六模式 chip：几何标绘/文本标注/图片标注/模型标注/编辑标注/导出）、三类对象列表与属性实时编辑、撤销/删除、多坐标系选择、内置 glTF/本地上传（文本旋钮可视禁用，图片/模型可旋转/缩放/抬升高度）。两套会话互不感知：几何走 lazy 构造的 PlotEditSession + `startDraw`，标注走 AnnotationSession `setPlacing(kind)`。
- 薄壳 `src/cases/situation-plotting/`：`index.ts`（title 综合态势标绘控件、category `widgets`、tag 标绘标注导出、icon=复制入目录的 icon.webp（上传 image-1 49272B）、updatedAt 2026-09-07）与 `Demo.vue`（仅渲染 SituationPlotting.vue），并在 `src/cases/index.ts` 注册；`SituationPlotting.vue` 面板标题默认文案同步为「综合态势标绘控件」。
- 内置模型资源沿用 `public/data/model/{metro_station,launchvehicle}/`（外部引用 gltf 形态），图片预设走 svg data-url，本地上传与 URL 均兼容。

**验证结果**：
- `npx vue-tsc -b --force` EXIT=0（0 TS 错误）；`npm run build` EXIT=0（✓ built in 1m 2s）。
- headless 冒烟 `/tmp/opencode/verify_situation.cjs` 全绿：全局搜索命中并打开「综合态势标绘控件」（panel-title 正确、Cesium 容器 1246×645）；「界面控件」分类下列出案例卡，卡 icon 上传 image-1 加载成功（无 .no-image 兜底）；文本标注放 2 处、图片预设与模型预设各 1 处后标注列表 4 行、点选出现属性面板、编辑 tool-chip 可用性正确（文本行旋转禁用）；导出 GeoJSON 下载 `综合态势标绘-YYYYMMDD-HHmmss.geojson`、SHP 下载 `*_shp.zip` 均成功；全程 0 pageerror / console.error（唯一 favicon.ico 404 为浏览器自动请求的环境噪音）。

## V6.21 新增 3 案例：天气特效-沙尘暴 / 场景截图控件 / 区域截图控件（均无 icon）

**用户要求**：系统迭代各新增一项案例（三案例均明确不生成 icon，卡片图标留空）——① 天气特效分类新增满屏沙尘暴天气特效（按提问反馈选「沙尘暴-满屏风尘（推荐方案）」体感；原推荐方案为后处理+粒子的体感实现）；② 界面控件分类新增「场景截图控件」（点击截图整张 Cesium 场景）；③ 界面控件分类新增「区域截图控件」（在 Cesium 场景上以两次左键单击框选矩形区域并截图）。交付时统一整体省略 `icon` 字段，`demoCase` 数组与分组内顺序保持连续。

**实施内容**：
1. 天气特效-沙尘暴（category `weather`，id `weather-sandstorm`）：
   - `src/lib/weather.ts` 追加 `export const SANDSTORM_FRAGMENT`（行 419-524）：uniform `time/density/haze/wind/speed/tint/darken`；内置 hash / noise / perlin3-fbm；三片合成——`streakLayer` 横向沙丝、`bankMask` 双 perlin 滚动卷尘、最终沙黄色调雾 mix（`darken` 控整体压暗、`density` 控浓度、`haze` 控雾障、`wind` 控风向/流速）。
   - `src/cases/weather-sandstorm/SandstormDemo.vue`（243 行）：沿用 rain 类 weather 壳 `.weather-shell` + 深蓝玻璃参数面板；`createMapScene` 全屏加载 Bing 影像；`scene.postProcessStages.add(new Cesium.PostProcessStage({ fragmentShader, uniforms }))`；`viewer.scene.postUpdate` 以 clock 差分累计 `time`；6 个滑杆参数实时同步 uniform；面板开关切换 stage 显隐。
   - 参数：浓度 0.2~3（default 1.2）、雾障 0~1（default 0.4）、风向 ±0.9（default 0.25）、风速 0.5~8（default 1.6）、沙色 tint 0~1（default 0.42）、压暗 0~1（default 0.28）。
2. 场景截图控件（category `widgets`，id `widget-scene-shot`）：
   - 新建 `src/cases/widget-scene-shot/WidgetSceneShotDemo.vue`（292 行）+ `index.ts`。因 `createMapScene` 不能配置 webgl contextOptions，自建 Viewer 并设 `contextOptions:{webgl:{preserveDrawingBuffer:true, alpha:false}}`（须截图帧离屏缓冲）；相机参数复制 `cesium-scene.ts` 默认并初始定位北京（116.397,39.908,90000m）；`loadBingImagery` + globe.baseColor + Ion token 同 `cesium-scene.ts`。
   - 预置 2 points + 3 polylines「示例要素」组，供 /canvas 切换显隐（演示截图内容）。
   - 捕获实现：`captureOnce` 将 `viewer.resolutionScale = scale`（清晰度 0.5~3 step 0.25，default 1），注册一次性 `scene.postRender` listener + `viewer.scene.requestRender()`，回调内 `viewer.canvas.toDataURL()` → `finish(dataURL,w,h)`，3s→8s（SwiftShader 高倍率 PNG 编码偏慢）超时 + 0 尺寸 fallback；`a[download]` 触发下载 `场景截图-YYYYMMDD-HHmmss.(png|jpg)`；PNG 直出 / JPG 经二值 Image 转 `image/jpeg` 质量 0.92。
3. 区域截图控件（category `widgets`，id `widget-region-shot`）：
   - `src/cases/widget-region-shot/WidgetRegionShotDemo.vue`（448 行）+ `index.ts`。状态机 `idle→drawing→flying→ready`：点「开始框选」进入 drawing，第一次左键 `pickCartographic`（复用 `src/cases/measure-lib/pick`）设起点，MOUSE_MOVE 实时半透明面+描边预览，第二次左键成矩形（面积阈值 `MIN_AREA_RAD2=1e-9`）→ flying：`camera.flyTo(Rectangle, {pitch:-55°, duration:0.9})` → ready（「重新框选」可回 idle；可截图并下载）。
   - 截图下载与 widget-scene-shot 同构（resolutionScale / postRender / toDataURL / PNG·JPG），文件名 `区域截图-YYYYMMDD-HHmmss.(png|jpg)`。
   - `src/cases/index.ts` 全局注册 3 案例：weatherSandstormCase 接 integralHeightFogCase 后；widgetSceneShotCase / widgetRegionShotCase 接 widgetMapSplitCase 后（voxelStrata 前），weather 与 widgets 组内顺序连续。

**验证结果**：
- `npx vue-tsc -b --force` EXIT=0（0 TS 错误）。首轮唯一 TS2353：区域版 polyline 误带 `perPositionHeight`（描边位置已含地板高度）→ 删除后全量 0 error。
- `npm run build` EXIT=0（vue-tsc + vite 0 error，含 weather-sandstorm / widget-scene-shot / widget-region-shot 独立 chunk）。
- headless SwiftShader 冒烟 `/tmp/opencode/verify_new3.cjs` 全绿（0 FAIL）：沙尘暴卡片可搜索打开、panel 标题「沙尘暴效果」、6 滑杆齐全、调参+开关无报错；场景截图控件在清晰度 2.0x 下下载 `场景截图-*.png`（2492×1290，5,918,733B 非空）；区域截图控件两击框选→chip「选区就绪」→下载 `区域截图-*.png`（2492×1290，7,507,578B 非空）；全程 0 pageerror / console.error。
- 修复点：demo 内捕获等待超时由 3000ms 放宽至 8000ms（SwiftShader 高倍率 toDataURL 编码偏慢）；冒烟脚本下载断言从固定 sleep 改为轮询等待（download 事件有延迟竞态）。

## V6.21.1 三案例卡片 icon 补充 + 区域截图控件重构为「页面遮罩拖拽框选」

**用户要求**：① 天气特效-沙尘暴卡片 icon 采用上传 image-1；② 场景截图控件卡片 icon 采用上传 image-2；③ 区域截图控件卡片 icon 采用上传 image-3；④ 区域截图交互不符合预期，改按澄清确认的推荐方案「页面遮罩拖拽框选」重做——在页面上直接选择区域进行图鉴输出（用户明确选择了该选项）。

**实施内容**：
1. 卡片 icon：三张上传 webp 分别复制为 `src/cases/{weather-sandstorm,widget-scene-shot,widget-region-shot}/icon.webp`（152586/171696/168740 字节），三个 `index.ts` 增加 `import icon from './icon.webp'` 与 `icon,` 字段。
2. `src/cases/widget-region-shot/WidgetRegionShotDemo.vue` 全量重构（447 行 → 约 440 行）：
   - 移除原「两次左键在地图上框选 → camera.flyTo 飞向选区 → 截当前视野」全流程及其 geo 实体（rect/outline/角点标记）、`pickCartographic`、Rectangle/flyTo 相关代码。
   - 新交互：点击「开始框选」→ 在 `.widget-shell` 内覆盖半透明 `.crop-mask`（`inset:0`、z-index 40、cursor crosshair、user-select none）；`mousedown` 记起点后把 `mousemove / mouseup / keydown(Esc)` 挂到 window，移动实时显示选区虚线框 + 尺寸标签（`W × H px`）；松开把坐标 clamp 到遮罩范围得 CSS 像素 DragBox，范围 <12×12px 视为取消；Esc 或单击即取消。
   - 出图管线：释放后先隐藏 DOM 层（遮罩与浮控面板），`readMapFrame()` 走「scene.postRender 一次性 listener + requestRender → 把 preserveDrawingBuffer 的 `viewer.canvas` 全量 drawImage 到离屏 canvas」取最新地图帧，再按 `frame.width / canvas.clientWidth` 像素换算对 DragBox 做 `drawImage` 子矩形裁剪 → `toDataURL`（PNG 直出 / JPG 经二次 Image 转码 quality 0.92）→ `区域图鉴-YYYYMMDD-HHmmss.(png|jpg)` 下载；面板同步刷新降采样缩略图与 `width×height@×scale` 信息。
   - 说明文案与状态机简化：phase 仅 `idle/ready`，chip 文案「待框选/可再次框选」，主按钮「开始框选 ↔ 重新框选」；描述强调「当前页面上遮罩拖拽框选任意矩形区域，松开立即导出 PNG/JPG 图鉴图片」。
   - 捕获超时沿用 8000ms；清晰度滑杆 watch 实时写 `resolutionScale`。
3. `src/cases/widget-region-shot/index.ts` description 同步为遮罩拖拽语义。

**验证结果**：
- `npx vue-tsc -b --force` EXIT=0（0 TS 错误）；`npm run build` EXIT=0（vue-tsc + vite 0 error）。
- headless SwiftShader 冒烟 `/tmp/opencode/verify_v6211.cjs` 全绿：三卡片图标 webp naturalWidth>0（weather/widget-scene-shot/widget-region-shot）；搜索打开区域截图控件后点「开始框选」出现 `.crop-mask`，`page.mouse` 拖拽（约 500×320）松手后轮询到下载 `区域图鉴-*.png`（非空，尺寸随清晰度 2x ≈ 2 倍裁剪）与缩略图出现，重开状态 chip「可再次框选」；全程 0 pageerror / console.error。

## V6.21.2 修复区域截图控件地图场景不可见

**用户反馈**：区域截图案例无法看到地图场景。

**根因**：V6.21.1 重构时 `new Viewer(el, ...)` 误把外层 `.widget-shell`（含地图子 div 的容器）作为挂载元素。Cesium 会向该元素注入整套 `.cesium-viewer` 结构，与 `.cesium-container` 地图 div 形成并列块级布局；`widget-shell` 上又有 `overflow: hidden`，于是 canvas 被挤到可视区之外被裁掉，表现即「地图场景不可见」（仅剩浮控面板与遮罩）。

**修复**：`WidgetRegionShotDemo.vue` 中 Viewer 挂载回尺寸固定的 `.cesium-container`（`ref="container"`，模板 `widget-shell > .cesium-container`），与场景截图控件等其它案例保持一致；`readMapFrame` 的 CSS 尺寸兜底同步改用 `container`。无其它行为变更。

**验证结果**：
- `npx vue-tsc -b --force` EXIT=0；`npm run build` EXIT=0。
- headless 可见性验证 `/tmp/opencode/verify_region_visible.cjs`：canvas 几何与 `.widget-shell` 完全重合（1246×645，`canvas in-shell: true`），地图区域像素彩色度 0.998（Bing 影像真实渲染，非空白），0 pageerror。
- 完整冒烟 `/tmp/opencode/verify_v6211.cjs` 复跑 0 FAIL（图标、遮罩拖拽、`区域图鉴-*.png` 下载 264KB、缩略图/状态、0 pageerror）。

## V6.17 新增「洪水淹没·GPU SPH粒子流线」案例（自动采样真实地形 + DEM 淹深 + GPU SPH + GPU 流线，支持上传栅格）

**用户要求（问卷确认）**：新增洪水淹没类案例，标题「洪水淹没·GPU SPH粒子流线」，归入 `water` 分类；支持上传 GeoTIFF/PNG/JPG 栅格数据与矩形框选两种深度数据来源；打开案例自动用示例数据采样真实地形并直接运行模拟；不配置 icon（与既有参考案例一致）。

**实施内容**：
- 新案例 `src/cases/flood-sph-simulation/`（id `flood-sph-simulation`，在 `src/cases/index.ts` 挂到 `flood-depth-simulation` 之后，无 icon 字段）：
  - `terrain-sampler.ts`：`sourceExtent/sampleTerrainHeights` 分批调用 `sampleTerrainMostDetailed`（rowsPerBatch≈8192/cols），产物为 south-first Float32Array；`aspectRows` 按纬向长度比换算正交网格纵横比，修复原子调用 `Cartographic.fromDegrees` 弧度/度数双 bug 与单次大批量采样卡死。
  - `raster-loader.ts`：GeoTIFF 经 `fromArrayBuffer→getImage→readRasters({samples:[0]}, interleave:true)` 读取单波段，EPSG 由 GeoKeys 探测并经 proj4 升维到 EPSG:4326 输出经纬化 bounds，nodata 清 NaN；PNG/JPG 走 `createImageBitmap`→canvas 灰度归一化 float（0..1）；网格最大 1024。
  - `gpu-sph-engine.ts`（`#version 300 es`，WebGL2 双 FBO ping-pong）：rho 预计算 pass + force（压力 k*(rho-rho0) 与粘度拉普拉斯）+ integrate，水深投影 + 软墙边界；depth R32F 深度纹理承载 DEM 水位淹深；粒子与流线两套独立 render pass，粒子位置直送 vertexAttrib；`frame` 每帧注入 waterFill/Time/flowDepth/depthMax/relLevel 5 个 uniform；step 与 render 时间分离（有界累计 Δt）。非 WebGL2/多 Viewer 场景保留降保真路径（readback/缩放方案）以兼容既有渲染管线。
  - `FloodSphSimulationDemo.vue`：面板含深度数据来源（真实地形采样 / 上传 / 框选）、SPH 演进（暂停/继续/重置）、水深梯度预览；默认自动示例（打开后自动采样真实山脉区域并直接运行）；流线 / 水深叠加开关 + 水位滑杆；地图事件（postRender）逐帧驱动引擎上屏。
- 默认自动示例区域取既有洪水案例验证过的真实山脉范围（west 85.2844 / east 85.6063 / south 28.1153 / north 28.5735），替换无高程返回的华阴区域后恢复（高程 1224~7227 m）。

**验证结果**：
- `npx vue-tsc -b --force` 0 error；`npm run build` EXIT=0。
- headless SwiftShader `verify_fss.js` **9/9 PASS**：案例卡片存在；自动采样后 `__fssSim.engine` 就绪（粒子 512、流线 28 条/56 段、128×207 深度网格、最大水深 2401.2 m）；暂停/继续按钮切换与 toast 4200ms 自动隐藏；深度预览 canvas 已绘制；数据摘要「真实地形｜128 x 207｜高程 1224~7227 m｜最大水深 2401.2 m」；截图 `/tmp/fss_shot.png`（609KB/1500×950，有效画面 + 暖色粒子）确认渲染上屏；全程无关键页面错误。

## V6.16.2 升级版水文案例 icon 上传配置 + 矢量河网断裂修复（汇流吸附与主支续接）

**用户反馈**：空间分析-水文分析(升级版)卡片缺上传图标（沿用占位图）；矢量河网在汇流处呈「端到端断开的小段子线」，视觉断裂。

**实施内容**：
- icon：`src/cases/hydro-analysis-pro/icon.webp` 由 `.monkeycode-tmp-files/b1099d4f-image-1.webp`（121102B）复制而来；`src/cases/hydro-analysis-pro/index.ts` 增加 `import icon from './icon.webp'` 与 `icon,` 字段（不引用临时目录，构建后可打包）。
- 断链根因：原 `computeStreamLinks` 以汇流点（upstream≥2 或 0）为链头拆链，支流止于汇流点上游一格，同一汇流处前后折线存在**一格空隙**；Cesium 渲染时表现为多段互不相接的短折线。
- 修复：`hydro-lib.ts` 新增导出 `vectorizeLinksContinuous(grid, links, ctx)`（`ctx = {dir, acc, linkOf, streamOf}`，旧 `vectorizeLinks` 保留）：
  - 按链尾沿 `dir` 找下游流像元，若其归属另一未访问链且链首即该像元、且该像元处**最强入流正是本链尾**，则把下游链并入本链段（干流续接、跨汇流贯通）；
  - 未续接的支流把下游最近河道格（汇流结点中心）并入末点，使支流终点与干流共用同一像元中心，消除端到端空隙。
- 两个 Vue 页面均改调新函数：`src/cases/hydro-analysis/HydroAnalysisDemo.vue`、`src/cases/hydro-analysis-pro/HydroAnalysisProDemo.vue`（import 与调用点都切到 `vectorizeLinksContinuous`）。

**修正沿程（调试要点）**：`buildHydroGrid` 会把列数钳到 `Math.max(8,…)`，测试按入参 7 分配 dir/acc 数组导致行列错位、链段被误拆；凡用 `buildHydroGrid` 构造网格，数组一律以返回的 `grid.cols × grid.rows` 分配。

**验证结果**：
- 合成网格单测 `/tmp/opencode/test_vector_merge.mjs` **9/9 PASS**：西支流终点吸附汇流 J、主链 A→B→J→T1→T2→T3 贯通且无重复相邻点、直河不被误扩展。
- `npx vue-tsc -b --force` 0 error，`npm run build` EXIT=0。
- headless `verify_hydro_pro.mjs` **43/43 PASS**（截图 `/tmp/opencode/hydro-pro-final.png`）：升级版卡片 `img` 存在且 src 含 `hydro-analysis-pro/icon.webp`；导出 `reaches.geojson` 后新增连续性度量——河段内相邻顶点均为单格步（jumps=0，无跳变空隙）、支流与干流在汇流处存在共用端点（sharedEndpoints=70）。
- headless `verify_hydro.mjs` **18/18 PASS**（截图 `/tmp/opencode/hydro-final.png`）：基础版卡片断言同步为「(基础版)」标题 + `icon.webp`；1160 链段 → 1086 条连续矢量河段（合并生效）。

## V6.16 新增空间分析-水文分析(升级版)案例（按间距采样、成果集中导出 TIF/GeoJSON/SHP、分步帮助说明）

**用户要求（问卷确认）**：在 V6.15 基础版上做升级——地形采样支持「按行列数」与「按间距(米)」**互斥切换**（输入间距自动换算为区域行列）；矢量成果支持导出 GeoJSON 或 SHP（SHP 用户 Recommended，需带属性）；每步分析产物汇集到**页面左上方「分析成果」浮层面板**，栅格导出 GeoTIFF、矢量导出 GeoJSON/SHP；逐步分析过程每个步骤加「?」帮助图标，点击解释该步原理与实现；步骤执行与真实地形采样等沿用基础版约定。

**实施内容**：
- 新案例 `src/cases/hydro-analysis-pro/`（category `analysis`，无 icon 字段）：
  - `index.ts`（id `hydro-analysis-pro`，title `空间分析-水文分析(升级版)`，updatedAt `2026-09-04`），并在 `src/cases/index.ts` 挂到 `analysis` 分类水文基础版之后。
  - `export-formats.ts`（纯 TS，零 Cesium 依赖）：GeoTIFF Float32 单波段写器（正确分置 ModelPixelScale / ModelTiepoint / GeoKeyDirectory 三段偏移、StripOffsets 内联与 ASCII 说明互不覆盖，EPSG:4326）；GeoJSON 生成；SHP(shp+shx+dbf) 二进制写器与属性 DBF 表、多边形自动闭合；STORE+CRC32 zip 打包；统一 `downloadBytes/downloadText` 触发浏览器下载。
  - `step-help.ts`：七条帮助数据 `{key,title,principle,implementation,outputs}`，面板「?」按钮切换展开帮助框。
  - `HydroAnalysisProDemo.vue`（由基础版复制改造）：采样模式状态 `dim|spacing` 与 `gridDimsForSampling`（间距模式按区域中心纬度把米换算为行列后仍走 `buildHydroGrid(bounds, cols, rows)`，保证核心语义不变）；每次区域/采样变更重采样后结果面板只保留并更新 DEM 条目，其余中间成果随重新分析重建；成果面板条目按步骤 S1..S7 显示并带对应 TIF / GeoJSON / SHP 按钮。
- 修正沿程：GeoTIFF 写器首版出现 Tiepoint 与 PixelScale 同偏移、ASCII 元数据覆盖数据条带、StripOffsets 写零等字节级错误，通过读写回读单测全部修复。

**验证结果**：
- 导出库读写单测（`/tmp/opencode/test_export_formats.mjs`）**20/20 PASS**：GeoTIFF 魔数/IFD/宽高/SampleFormat=Float/像素尺度含负行向/Tiepoint/像素逐格回读/ASCII 说明存在；GeoJSON FeatureCollection；SHP 头 9994、Polyline(3)/Polygon(5)、记录数与点数、多边形自动闭合、zip 内含 shp+dbf 且 CRC32 一致。
- `npm run build` EXIT=0（vue-tsc 0 error + vite 产物生成）。
- headless `verify_hydro_pro.mjs` **40/40 PASS**（截图 `/tmp/opencode/hydro-pro-final.png`）：基础版卡片标题含「(基础版)」且 `img` 指向 `src/cases/hydro-analysis/icon.webp`；升级版卡片存在；自动采样「列数 160 → 160×155，约 64 m/格」；切「按间距」输入 300 → 说明与网格变「间距 300 m → 31×30，约 328 m/格」，DEM 成果备注同步更新；成果面板为地图左上浮层；点击步骤「?」弹说明且可关闭；DEM 导出 `dem.tif`（`II*\0` 魔数 + ASCII 说明）；②~⑦ 逐步完成且成果条目齐全；矢量河段导出 `reaches.geojson`（FeatureCollection，属性含 id/points/length_km）与 `reaches.zip`（内含 reaches.shp + reaches.dbf）；拾取倾泻点生成流域 P1 成果条（3 个导出按钮）；面板可收起/展开；全程 0 关键页面错误。

## V6.15.1 水文分析案例改名「(基础版)」并换用 image-1 作卡片 icon

**用户要求**：基础版名称改为「空间分析-水文分析(基础版)」，卡片 icon 使用上传的 image-1；icon 不得引用 `.monkeycode-tmp-files/`（生产构建后缺失），须复制进案例目录。

**实施内容**：
- `src/cases/hydro-analysis/index.ts`：title 改「空间分析-水文分析(基础版)」，新增 `import icon from './icon.webp'` + `icon` 字段，updatedAt `2026-09-04`。
- `src/cases/hydro-analysis/icon.webp`：由 `.monkeycode-tmp-files/2fc9c17b-image-1.webp`（72734B）复制而来，src 经构建打包为资源，不依赖临时目录。
- `src/cases/hydro-analysis/HydroAnalysisDemo.vue`：面板标题同步改「空间分析-水文分析(基础版)」。

**验证结果**：headless 校验基础版卡片标题含「空间分析-水文分析(基础版)」、卡片 `img` 存在且 `src` 含 `hydro-analysis/icon.webp`，随 V6.16 一并 40/40 PASS 通过。

## V6.15 空间分析-水文分析全流程案例（真实地形采样→填洼→D8 流向→汇流累积→栅格/矢量河网→倾泻点→汇水流域）

**用户要求**：新增空间分析案例——对区域真实地形执行完整水文分析流水线（填洼、流向、汇流、河网提取、倾泻点与汇水流域），按七步按钮**逐步执行**而非一键自动演示；不生成 icon，留空。

**实施说明（关键选型）**：
- DEM 仅来自 `sampleTerrainMostDetailed` 对 Cesium World Terrain 的真实采样，无外部文件/合成数据；示例区域 108.94–109.04°E / 34.02–34.10°N（华阴一带），按 `floor(6000/cols)` 行分批采样、请求间 `yieldFrame` 交还主线程，`analysisRun` 令牌防竞态（busy/progress/status 沿用既有 gallery 非遮罩交互样式）。
- 水文算法全部纯 TS 无 Cesium 依赖（`hydro-lib.ts`），用合成地形在 node v22 `--experimental-strip-types` 下先单测闭环再接 Vue。
- 填洼＝边界播种 priority-flood 小顶堆，只抬升内部低点，边界最低点可作合法出水口 sink；D8 流向＝加权最大坡降（对角除 √2），平坦单元向已解析低流量方向回溯，内部 sink 清零。
- 汇流累积＝上游计数 + 队列拓扑归并（Float64）；栅格河网＝阈值分割链段；矢量河网＝链段 cell 中心序列批量 `PolylineGeometry`；倾泻点＝半径内取最大累积像元吸附，流域＝反向 D8 DFS 输出 mask，轮廓用「网格边平面图 + 最长闭合环」追踪生成可闭合 polygon（单像元环 4 点、6×5 矩形 22 点单测锚定）。
- 渲染全部走顶点色 Primitive + 双线性地形插值贴地（复用 `depth-contour-lib` 的 `createSurfaceAppearance/rampRgb`），不新增全屏遮罩。
- 七步按钮：①DEM 采样→②洼地填平→③D8 流向→④汇流累积量→⑤栅格河网→⑥矢量河网→⑦拾取倾泻点；⑦之后可反复在地图上单击拾取多个倾泻点（每个生成彩色分区流域 + 多边形描边 + 编号 marker），可一键清除。

**实施内容**：
- 新案例 `src/cases/hydro-analysis/`（category `analysis`，无 icon 字段）：
  - `index.ts`（id `hydro-analysis`，title `空间分析-水文分析全流程`，updatedAt `2026-09-03`）。
  - `hydro-lib.ts`：`fillDepressions`/`computeD8Direction`/`computeAccumulation`/`computeStreamLinks`/`vectorizeLinks`/`snapPourPoint`/`computeWatershed`/`traceOuterRing`，`HydGrid` 增加 `demMin/demMax`。
  - `hydro-render.ts`：`RasterMode/RasterStyle`、`buildRasterSurfacePrimitive`、`buildFlowArrowsPrimitive`、`buildReachPrimitive`、`DIR_COLORS` 8 向 8 色、`accGradientCss/raiseGradientCss`。
  - `HydroAnalysisDemo.vue`：分步执行与参数面板（分辨率 90/120/160/200、基底图层 DEM|填洼|汇流 切换与对数色图例、箭头密度/透明度、河网阈值、显隐开关、范围线、统计文本、示例区域/框选区域）。
- 修正沿程：矢量河段若为**单格链段**会让 Cesium `PolylineGeometry` 抛 `DeveloperError: At least two positions are required`（headless 步骤⑤卡死定位），渲染侧改为 `cells.length < 2` 直接跳过。

**验证结果**：
- 算法单测（`/tmp/opencode/hydro-lib.test.mjs`、`hydro-diag.mjs`）：60×72 合成地形（南倾 + 中心洼地）抬升 56 格、内部 sink 清零仅边界出口存活、drained=4320、maxAcc=4320、145 条链段且流像元全部有 linkOf；流域 2559 像元、环 216 点。
- `npm run build` EXIT=0（vue-tsc + vite，0 error）。
- headless `verify_hydro.mjs` **17/17 PASS**（截图 `/tmp/opencode/hydro-final.png`）：卡片存在且无 `img`；示例区域自动 DEM 采样完成；②~⑦ 逐步执行完成（填洼 1784 格/最大 10.8m、最大汇流 10220 格、河网像元 5349/链段 1160、矢量河段 1160 条）；流向箭头 8 色图例；基底切汇流累积后图例切为对数色；地图上三次单击拾取 P1/P2/P3 生成 3 个汇水流域（末个 3241 像元、轮廓 296 点）；全程 0 关键页面错误。

## V6.14 修复地形压平调参/撤销黑屏（provider 单例 + 局部瓦片失效）

**用户反馈**：V6.13 每次「重新应用压平」（调参）与「恢复原状」都会整片地形黑屏约 1.5–2s、完全复原约 5s，观感不可用。

**根因（源码定位 + 数据级探针量化）**：
- 旧实现 `viewer.terrainProvider = 新包装对象`，Globe setter 变更引用后，每帧 `beginFrame` 把新 provider 回灌给 `GlobeSurfaceTileProvider`，其 setter 检测引用变化即 `invalidateAllTiles()`，把**全部已加载瓦片** freeResources 回 START 态，画面进入数秒空窗（headless 探针实测 `_tilesToRender` 18→0 持续约 1.5–2s）。
- 探针确认（Cesium.js unminified 1.144）：`scene.globe._surface` 本身就是 `QuadtreePrimitive`（持有 `forEachLoadedTile`、`_tileReplacementQueue`），**不存在 `_surface._quadtree`**——初版局部失效代码误引用不存在的 `_quadtree` 层导致失效函数静默空转（第 1 次修复探针 seen/touched 恒为 0 即因此）。

**实施内容**：
- `src/cases/polygon-terrain-flatten/terrain-flatten-provider.ts`：
  - `createFlattenTerrainProvider(base)` 改为返回 `FlattenTerrainController { terrainProvider, setOptions, getOptions }`，仅创建一次并常驻 `viewer.terrainProvider`；mount 初始 options 为 null（纯代理），apply/撤销只通过 `setOptions` 改可变 state，**不再整体替换 provider**，根治全量瓦片失效。
  - 新增 `invalidateTilesIntersectingRing(scene, ring)`：经 `scene.globe._surface.forEachLoadedTile` 遍历已加载瓦片，只对 state=DONE、与 ring AABB 相交、且无「已加载且相交」子瓦片（用 `_southwestChild/_southeastChild/_northwestChild/_northeastChild` 判定）的瓦片 `freeResources()`，再 `scene.requestRender()`；顶层相关瓦片由 LOD 决策自动重载，其余视口瓦片与 base 瓦片缓存完全保留。
  - 统计 `stats` 提升为模块级单例，公开入口 `resetFlattenTerrainStats()/readFlattenTerrainStats()` 不变。
- `PolygonTerrainFlattenDemo.vue`：模块级 `terrainFlatten: FlattenTerrainController | undefined` + `lastAppliedRing: Ring | undefined`；`mountScene` 创建 controller 后赋 `viewer.terrainProvider = controller.terrainProvider`（catch 分支置 undefined）；`applyFlatten` 先记 `lastAppliedRing`，再 `setOptions({ringDeg, targetHeight})` + 局部失效，轮询重试期间每约 6s 重复局部失效直至 `touchedTiles>0` 或 50s 超时；`restoreOriginalTerrain` 改为 `setOptions(null)` + 对 `lastAppliedRing` 局部失效（不再 reassign base provider）；`onBeforeUnmount` 清理 controller/ring 引用。

**验证结果**（headless 数据级探针，`/tmp/opencode/probe_ptf_v3_fix.mjs`、`_diag.mjs`、`_restore.mjs`、`_stability.mjs`）：
- 调参黑屏回归：拖动抬升滑块（40/80/120/150m 共 4 轮）全程 `_tilesToRender` 恒为 18、**掉零时长 0ms**（修复前基线约 1.5–2s 归零）；每轮中心高度均正确更新（1200.75→1238.75→1278.75→1318.75→1348.75）。
- 局部失效机制确认：手动对 9 块 ring 相交 DONE 瓦片 freeResources 后，渲染瓦片数保持 18 不跌零，加载队列短暂 9→4→0 即完成重载。
- 撤销恢复验证：压平时中心高 1200.75（整平面 1200.8），「恢复原状并清除」后中心高回到原始地形值 348.12，证明就地改写未污染 base 缓存、恢复路径正确。
- `npx vue-tsc -b --force` EXIT=0；`npm run build` EXIT=0（vue-tsc + vite 0 error，31.53s）；4 轮稳定性回归无关键页面错误。

## V6.13 地形压平改为「修改真实地形数据」实现（依据参考博客：Cesium 高级教程-地形应用-修改地形数据的方式实现地形压平）

**用户反馈**：上一版 V6.12「半透明平面 + 立面」的视觉效果不是想要的，要求按参考实现**真实地形压平**。

**关键选型**：
- 参考文档核心原理：Cesium 每块地形瓦片对应一个 `QuantizedMeshTerrainData`，`_quantizedVertices` 内存布局为**三通道分离**的已解码量化值（先全部 u、再全部 v、再全部 height，每通道 0~32767），height=0 对应瓦片 `_minimumHeight`、32767 对应 `_maximumHeight`；渲染顶点经 `createMesh` 交给 worker 后私有字段即被释放，因此**只能在 requestTileGeometry 返回 Promise 阶段改写地形数据**。
- 实现方式：用 `Object.create(baseProvider)` 包装原 `CesiumTerrainProvider` 并覆写同签名 `requestTileGeometry`，先按瓦片包围盒与多边形 AABB 快速求交（不相交直接透传），相交瓦片把每个顶点经纬度反算后做点在多边形内判断，将内部顶点高度改为统一整平高度，重算整块瓦片 min/max 后按新区间重编码 rawH 回写 `_minimumHeight/_maximumHeight/_quantizedVertices`（rawU/rawV 不变）。顶点高度通道存的是**已解码值，无需再做 zigzag 增量编码**（网上部分资料有误）。
- 为规避压平区光照法线错误：加载该案例地形时 `requestVertexNormals: false`（整片地形一致性明暗，无需重编码法线）。
- 旧版「盖平面/立面、配色透明度」等贴面外观全部移除；范围线保留用于标注压平边界。

**实施内容**：
- 新增 `src/cases/polygon-terrain-flatten/terrain-flatten-provider.ts`：
  - `createFlattenTerrainProvider(base, {ringDeg, targetHeight})` 返回扁平包装 provider；
  - `flattenQuantizedTile()` 顶点解码/多边形内改写/重算 min-max/重编码核心；
  - `ringIntersectsTile()` AABB 快速排除 + `readFlattenTerrainStats()/resetFlattenTerrainStats()` 记录 seen/touched/flattenedVertices 供状态展示与验收。
- 重写 `PolygonTerrainFlattenDemo.vue`：示例区域/手动绘制多边形→采样原始地形统计与填挖方→自动应用真实压平并等待瓦片改写（状态显示「已改写 N 块瓦片、共 M 个地形顶点」）；整平基准（区域最高点+抬升 / 指定高度）变化 600ms 防抖自动「重新应用压平」（重新赋值 provider 触发地形重建）；「恢复原状并清除」还原 base provider；填方/挖方量（m³/万 m³）、平均/最大填挖深统计。
- 修正 `terrain-flatten-lib.ts`：新增 `computeEarthworks()`；移除上一版立面/实心外观几何函数。

**统计修正**：`createSampleGrid` 的 `cellLat` 为负（行自北向南），此前算体积出现负面积导致填挖量为 0，`computeEarthworks` 中面积须对两个 cell 步长取 `Math.abs`。

**验证结果**：
- `npm run build` EXIT=0（`/tmp/build_ptf_v2.log`）。
- headless `verify_ptf_v2.mjs` 16/16 PASS（`/tmp/opencode/verify_ptf_v2b.log`）：示例区域自动真实压平（改写 12 块瓦片/3382 顶点至 1200.8m）；统计含填方量（16412815.16 万 m³）与填深行；指定高度 200m 下挖场景生效（改写 10 块/2669 顶点、整平面 200.0m）；恢复原状后统计区块隐藏；手动绘制闭合自动压平成功（2 块/631 顶点）；全程 0 关键页面错误。

## V6.12 空间分析-多边形地形压平案例（手动绘制多边形→地形采样→整平为水平面）

**用户要求**：新增空间分析案例——手动绘制多边形，实现地形压平功能，支持各类参数设置；不生成 icon，留空。

**实施说明（关键选型）**：
- 曾实测 Cesium 1.144 的 `Globe.clippingPolygons`+`ClippingPolygon`：赋值与渲染不报错，但对区域做 scene.pickPosition 高度统计发现仅隐藏/改地形几何而无法按目标高度"压平填面"（区域内拾取高度 std 仍达 278m、且无官方 height 参数支撑），故未采用。
- 采用「水平整平面 + 立面实体」稳健方案：把多边形区域内部地形用不透明/可调透明实体覆盖至目标水平面，达到视觉上的地形压平，全部参数实时可控，不依赖 ground/分类渲染。

**实施内容**：
- 新案例 `src/cases/polygon-terrain-flatten/`（category `analysis`，无 icon 字段）：
  - `index.ts`（id `polygon-terrain-flatten`，title `空间分析-多边形地形压平`，updatedAt `2026-09-03`）。
  - `PolygonTerrainFlattenDemo.vue`：复用多边形系列骨架（示例区域/逐点采集+右键闭合、进度+状态、范围线、飞入），渲染整平面 entity polygon（`height=目标高`、凹多边形自动三角化、outline 描边）+ 边界立面 `Primitive`（自定义 Geometry：每边界点上下两顶点、立面三角带，顶点色+ALPHA_BLEND，cull 关）。
  - `terrain-flatten-lib.ts`：`computeRegionStats`（多边形近似面积 km²、区域内采样点数、平均/最低/最高高程）；`buildFlattenWallGeometry`（立面几何，索引三角带）；`buildSolidAppearance`（顶点色自绘 appearance）。
- 参数：整平面/立面填充/范围线显示开关；高度基准（整平至最高点 或 指定高度）与抬升补偿（-50~+300m）/指定高度输入；立面深度倍数（0.3~2.5×区域高差）；平面与立面配色与透明度（0.2~1）。统计面板显示区域面积、采样点、原始高程区间与平均、整平面高、平均/最大填深。

**验证结果**：
- `npm run build` EXIT=0（`/tmp/build_ptf1.log`，vue-tsc + vite 0 error，41.47s）。
- headless `verify_ptf_icon.mjs` 20/20 PASS（含滚动补测）：坡度坡向案例 icon.webp 解码 1235×657、src 与字节（98688）正确；压平新卡片无 icon；示例区域自动压平分析完成（默认整平至最高点 +2m，示例区整平面 1201.1m、最大填深 1150.6m）；面积/采样/高程/填深统计齐全；整平面/立面开关移除无错误；指定高度（400m）与最高点模式切换统计实时更新；手动逐点绘制 + 右键闭合再次压平成功；全程无关键页面错误。

## V6.11 空间分析-多边形坡度/坡向案例（手动绘制多边形→地形采样→坡度图+8 方向坡向箭头）

**用户要求**：新增空间分析案例——手动绘制多边形，根据地形自动生成坡度图和坡向箭头；坡向分为 8 个方向；支持坡度图与坡向显示/隐藏控制与各类参数设置；案例不生成 icon，留空。

**实施内容**：
- 新案例 `src/cases/polygon-slope-aspect/`（category `analysis`，无 icon 字段）：
  - `index.ts`（id `polygon-slope-aspect`，title `空间分析-多边形坡度/坡向`，updatedAt `2026-09-03`）。
  - `PolygonSlopeAspectDemo.vue`：完全复用 V6.10 多边形案例已验证的骨架（Bing 底图 + Cesium World Terrain、示例区域/手动逐点采集+右键/双击闭合、progress 进度与 status 提示、区域范围线、飞入），替换分析渲染为坡度面 + 坡向箭头。
  - `slope-aspect-lib.ts`：坡度/坡向纯算法 + 渲染几何。节点级中心差分梯度场（全采样矩形计算，多边形仅作统计/裁剪范围）→ 单元格四角梯度均值聚合出坡度角与坡向方位角；坡向按 45° 归并为 N/NE/E/SE/S/SW/W/NW 八扇区（`atan2(下山东西向, 下山南北向)`）。坡度面用每格中心 inside + 边界射线裁剪的三角网格、逐角点坡度归一（0~色带上限°）取色（复用同款 surface shader appearance），坡向箭头用 `PolylineColorAppearance.VERTEX_FORMAT` + `PolylineGeometry` 批量实例（中心→箭尖→两翼共 5 顶点，抬升 16m 贴地形采样插值），默认每 4 格 1 支、按 8 向 8 色。
- 复用 V6.10 `depth-contour-lib.ts` 的网格采样/渲染基础（`createSampleGrid/fillGridStats/bilinearHeight/rampRgb/pointInRing/rayRingIntersection` 等，其中 `rayRingIntersection` 加 export 共享）；跨案例工具 import 沿用 `measure-lib` 既有先例。
- 参数：采样网格分辨率；坡度图显示/色带/色带上限（5~60°）/透明度；坡向箭头显示/密度（每 2~8 格）/长度（0.4~2.6×格宽）/线宽/透明度/颜色方案（8 向配色或自定义色）/忽略平缓坡阈值（0.5~8°，低于阈值不出箭头、不计方向）；范围线与图例显示开关。
- 统计面板：采样点数、高程范围、平均坡度、最大坡度、主坡向（八方向占比）、箭头数、忽略平缓格数。地图左下角图例 = 坡度渐变条（0~上限°）+ 8 方向色块条。

**验证结果**：
- `npm run build` EXIT=0（`/tmp/build_psa1.log`，vue-tsc + vite 0 error，47.44s）。
- headless `verify_psa.mjs` 19/19 PASS：新卡片在空间分析分类下且 `img` 数为 0（无 icon）；示例区域自动分析完成并显示平均坡度/最大坡度/主坡向（示例区主坡向东南 SE 19%）；箭头 823 支、8 方向图例色块存在；关闭坡度图 → 坡度图例隐藏、关闭坡向箭头 → 箭头数归零且方向图例隐藏、再开启恢复；箭头密度（每 6 格）与自定义配色切换无页面错误；手动逐点绘制 + 右键闭合再次自动分析成功并出统计；全程无关键页面错误。

## V6.10 空间分析-多边形深度图与等高线案例（手动绘制多边形→地形采样→深度图+等高线）

**用户要求**：新增「空间分析-多边形深度图与等高线」案例——手动绘制多边形，自动采样地形提取多边形内深度图并生成等高线，全程支持显示/隐藏控制、等高线各类参数设定与等高线标注及相关设置；不生成 icon（卡片空占位）。

**目标**：绘制任意多边形后自动完成「多边形内地形采样 → 深度图渲染 → 等高线提取/渲染 → 等高线标注」一条龙，等高线参数（等高距/线宽/透明度/配色/标注）可实时调整。

**实施内容**：
- 新增 `src/cases/polygon-depth-contour/`（`PolygonDepthContourDemo.vue` + 纯算法库 `depth-contour-lib.ts` + `index.ts`），category=`analysis`，tag=`空间分析`，title=`空间分析-多边形深度图与等高线`，注册于 `src/cases/index.ts` `polygonDepthContourCase`（紧跟 dayantaXyzCase 之后）；**无 icon**（index.ts 省略 icon 字段，卡片空占位）。
- **绘制交互**：点「绘制多边形」进入绘制，逐点单击采集顶点（顶点黄点 + 橡皮筋多边形预览），右键/双击闭合；≥3 顶点自动触发分析（顶点过多/自交兜底剔除首尾重复点）；「示例区域」内置多边形一键演示，「清除结果」复位。
- **深度图**：包围盒自适应网格（maxDimension=160）→ 对全部格点 `sampleTerrainMostDetailed` 分批采样（约 6000 点/批，批间 `requestAnimationFrame` 让进度刷新、run-token 支持取消）→ 自定义 Appearance 逐顶点着色透明面片（terrain/coolwarm/thermal 三色带、透明度可调），显隐开关实时切换。
- **等高线**：Marching Squares 提取等值线段（按「连续 run 分段 + 过短段 simplify 丢弃」）→ **经典 Primitive + PolylineColorAppearance**：逐实例 PolylineGeometry（`vertexFormat=VERTEX_FORMAT`、`colors` 逐顶点同色、`colorsPerVertex:true`），顶点高度 = 网格 `bilinearHeight + 14m` 贴地形；等高距（10m 默认）/线宽/透明度/模式（渐变色带或固定深浅褐色）/三色带 参数实时重算或重渲染。
- **标注**：等高线标注显隐、字体大小、文字色、背景色/背景显隐、每隔 N 层标注；标注为 Label 实体（FILL_AND_OUTLINE 描边，`disableDepthTestDistance=∞`）。
- 统计面板：高程范围 / 等高线层数 / 段数 / 等高距、状态提示、参数实时预览。

**关键决策与踩坑（headless 验证驱动）**：
- **dev shim 缺符号**：dev 模式 cesium 走 `vite.config.ts` 的 `CESIUM_SYMBOLS` 白名单 + `window.Cesium` 全局 shim，白名单缺 `BlendingState/ClassificationType/GroundPolylinePrimitive/ArcType` → dev 运行时报 `BlendingState is undefined`（node 侧与生产构建均正常，极难定位）。修复：四符号补入 `CESIUM_SYMBOLS`。
- **GroundPolylinePrimitive 批处理崩溃**：等高线初版用 `GroundPolylinePrimitive + PolylineColorAppearance` 挂 `scene.groundPrimitives`，添加后第一帧渲染抛 `BatchTable.setBatchedAttribute: value is required`，Cesium widget 弹错误面板遮罩阻断全部后续交互。修复：改为经典 `Primitive`，等高线沿真实地形高度 + 14m 偏移悬浮贴合，绕开 ground 分类批处理。
- 无 icon：按用户要求不生成/不设置（沿用「图标留空显示占位」惯例）。

**验证结果**：
- `npm run build` EXIT=0（`/tmp/build_pdc4.log`，vue-tsc 0 error，`✓ built in 1m1s`）。
- headless `verify_pdc.js` **16/16 PASS**：卡片存在/标题正确/卡片 img 数=0（无 icon）；案例页标题；控制面板；分析完成且高程非零（真实采样，50.6~1199.1 m）；等高线 114 层 / 47120 段；等高距 10 m；等高线显隐开关可切；等高距 10→20 m 后层数 114→57；深度图显隐开关可切；标注显隐开关可切；配色切墨蓝；无关键页面错误。
- headless `verify_pdc_draw.js` **7/7 PASS**：示例区域自动分析完成 → 清除结果 → 点「绘制多边形」→ 地图逐点采集顶点 → 右键闭合 → 自动进入分析并「已生成」+ 统计出现；无关键页面错误。
- 修复前复现：分析完成后 Cesium 错误面板（`.cesium-widget-errorPanel`）出现并拦截点击；修复后诊断脚本无 panel、无 pageerror。

## V6.10.1 修复等高线断线（逐格短段改首尾成链 + 去除丢段）

**用户反馈**：生成的等值线存在明显的断线情况。

**根因**：
- 等高线原实现是"逐格 marching squares"，每个网格单元输出独立两点线段（47120 段），靠相邻格共享边上的交点数值一致来视觉拼接；
- 其中 `minPieceLength = 0.45×cell` 会把"等高线贴近格网顶点时产生的过短穿越段"整段丢弃，这些短段正是相邻链之间的连接段，丢弃后等高线出现断口；
- 边缘裁剪段只按离散采样点截断，端点不精确落在多边形边界，链端存在微小游离缺段。

**实施内容**（`depth-contour-lib.ts` `computeContours`）：
- 不再按段丢弃：全部合格穿越段（含边缘裁剪 run）先收入每层的 `raw` 列表；
- 新增 `chainLevel()`：按层把 raw 段"首尾相接"拼成连续折线（坐标桶近邻匹配、单向沿链 walk、闭合成环时去掉重复首点），再对整条链做 RDP 简化（epsilon=0.02×cell），仅丢弃总长 < 0.12×cell 的极短数值碎片；
- 边缘裁剪改用边界二分细化（28 次迭代）把 run 端点精确收敛到多边形边界交点，内部 run 起点/终点恰为共享格边交点，可与相邻格精确成链；
- 结果每层由大量两格短段收敛为少数连续折线（默认示例：47120 段 → 1954 条链，114 层不变）。

**验证结果**：
- 算法单测（合成高斯场 + 加噪场，间隔 5/10/20m）：成链后断点（无近邻匹配端点）为 0；
- `npm run build` EXIT=0（`/tmp/build_pdc5.log`，`✓ built in 1m7s`）；
- headless `verify_pdc.js` 16/16 PASS：统计 114 层 / 1954 条链、等高距 10→20m 后 114→57、显隐/标注/配色联动、无关键页面错误；
- headless `verify_pdc_draw.js` 7/7 PASS：示例区域→清除→手动绘制→右键闭合→自动分析完成。

## V6.10.2 多边形深度图与等高线案例卡片 icon 换用户新图

**用户要求**：空间分析-多边形深度图与等高线案例（polygon-depth-contour，V6.10 上线时按要求未设置 icon）卡片 icon 采用上传的 image-1。

**实施内容**：
- 将用户上传图复制为 `src/cases/polygon-depth-contour/icon.webp`（f0e476b0-image-1.webp，106166B，1235×649）；不得引用 `.monkeycode-tmp-files/` 内文件（构建后目录缺失会失败）。
- `src/cases/polygon-depth-contour/index.ts` 加 `import icon from './icon.webp'` 与 `icon,` 字段（此前无 icon，卡片显示占位图）。

**验证结果**：
- `npm run build` EXIT=0（`/tmp/build_pdc6.log`，vue-tsc + vite 0 error）。
- headless `verify_pdc_icon.js` 7/7 PASS：案例卡片存在；卡片含 img 且 `naturalWidth=1235/naturalHeight=649` 可解码；src 指向 `polygon-depth-contour/icon.webp`；点击卡片案例页正常加载；`icon.webp` HTTP 200 且字节数与源一致（106166）；无关键页面错误。

## V6.9 空间分析-大雁塔模型XYZ编辑坐标轴-平移/旋转案例（3D Tiles 模型绑定 XYZ 编辑轴）

**用户要求**：将现有大雁塔模型与自定义 XYZ 轴结合，实现对模型的平移和旋转操作，支持参数修改；不生成、不设置 icon（卡片图标留空即可）。

**目标**：新增「大雁塔模型XYZ编辑坐标轴-平移/旋转」案例——把内置大雁塔 3D Tiles 模型（`public/dayanta/`，bbox 半径约 287m，原生地理坐标约 108.9606°E / 34.2199°N）与 V6.8.2 同款 xyz 编辑 gizmo（每轴 = 直线轴 line + 端手柄 handle + 环形轴 ring + X/Y/Z 标签）绑定：拖直线轴/端手柄 → 模型沿该轴平移，拖环形轴 → 模型绕环所在轴方向旋转；平移只改模型中心、旋转只改姿态角，互不干扰；坐标/姿态实时同步、console 打印开始/过程/完成，轴长/环半径/线宽/拾取容差/颜色/显示等参数面板可调；无 icon（index.ts 省略 icon 字段，卡片保留占位）。

**实施内容**：
- 新增 `src/cases/dayanta-xyz/`（`DayantaXyzDemo.vue` + `index.ts`），category=`analysis`，tag=`坐标轴`，title=`大雁塔模型XYZ编辑坐标轴-平移/旋转`，注册于 `src/cases/index.ts` `dayantaXyzCase`（紧邻 xyz 系列三项之后）；不生成 icon。
- 加载链：`createMapScene` + Bing + Cesium World Terrain（best-effort，失败不阻断模型加载，同时将深度测试默认关掉）→ `Cesium3DTileset.fromUrl('/dayanta/tileset.json')` → gizmo 在模型加载完成后创建。
- **变换模型（核心）**：模型加载时记录锚点 `nativeP0 = tileset.boundingSphere.center` 及其 ENU 基（`eastNorthUpToFixedFrame`），基座固定取 P0（模型本地体轴方向，全程不随中心变化，保证 gizmo 轴恒等于模型体轴）；模型姿态 `modelMatrix = T(中心)·R·T(-P0)`——平移只改中心、旋转只改 R；加载即 R=I、中心=P0，矩阵为单位阵，模型停留在原生地理坐标不动，与既有大雁塔 demo 展示一致。
- gizmo 实体复用 V6.8.2 骨架（id 前缀 `xyzm-`，3×(line+handle+ring+label)+origin=13，红/黄/绿=东/北/上，悬停黄高亮、按下加粗，`pickedTarget ?? targetAt` 距离兜底，`activeKind` 分流 translate/rotate）；所有实体位置用 `CallbackProperty` 跟随 `currentCenter`，因此模型平移后 gizmo 自动随行，无需重建。
- **平移路径**：`dragStartCenter + dragAxisDir` 投影向量换算屏幕每米像素 → 鼠标位移投影为沿轴米数 → 只更新 `currentCenter`（并回写经/纬/高输入）→ `updateModelTransform()`；姿态矩阵与三姿态角保持不变。
- **旋转路径**：以模型中心（=gizmo 原点）屏幕投影为枢轴，极角增量换算 body 旋转角，`R ← R·fromRotationX/Y/Z(δ)` 右乘 → `extractAttitude` 欧拉反解回写绕 X/Y/Z 输入 → `updateModelTransform()`；中心坐标不变。
- 默认轴尺度按模型自适应：`axisLength ≈ 2.2×R`、`ringRadius ≈ 1.4×R`（R=287 → 650/400m，实测），保证环/直线末端伸出模型包围球，不易被模型几何遮挡拾取。
- 参数面板：模型区（显示模型开关/深度测试开关/重置变换/回到模型/重新加载）+ 中心点经/纬/高（应用中心点）+ 姿态绕 X/Y/Z（应用/重置姿态）+ 当前坐标/姿态 live + 轴长/环半径/线宽/打印节流/拾取容差 + 三轴颜色 + 轴端标签/手柄/环形轴/Bing 底图开关。
- console 前缀 `[大雁塔XYZ编辑]`：`开始拖动沿X（东）轴平移…` / 节流 `平移中 累计 ±xx.xxm…` / `平移完成：累计 …`；旋转对应 `…沿Z（上）轴旋转 / 旋转中 累计旋转 ±xx.xx° / 旋转完成`。
- `resetTransform` 把中心与姿态还原到 P0/0（modelMatrix 复原单位阵）；不采用 xyz 系列「应用中心点后清空姿态重建」的语义，模型位移/旋转各自独立保留。

**关键决策**：
- 基座固定为 P0 的 ENU（`computeBasisAtP0`）而非常规的「每中心点重算 ENU」：因为真实模型在 ECEF 中是刚体，平移不改变体轴方向；gizmo 轴=模型体轴二者恒贴合，任何位置拖拽都指哪打哪，避免远距离搬移后 gizmo 与模型姿态错位。
- 平移沿固定世界方向拖直线（与 xyz 系列一致），非沿新地点的 ENU 重定向，保证拖拽期间 gizmo 与模型零偏差；面板应用中心点同理。
- 无 icon：按用户要求不生成/不设置，index.ts 不写 icon 字段，卡片占位图留空。
- 后续若把同一 gizmo 逻辑复用到任意 Cesium3DTileset，仅需替换 TILESET_URL 与「加载后记录 P0/尺度」两步。

**验证结果**：
- `npm run build` EXIT=0（`/tmp/build_dayantaxyz2.log`，vue-tsc + vite 0 error）。
- headless `verify_dayanta_xyz.js` 39/39 PASS：卡片存在；模型与 gizmo 均就绪（status 遮罩消失）；实体恰 13（无旧案例遗留）；tileset 已加载 boundingSphere.radius=287；加载后 modelMatrix≈单位阵（模型在原地理坐标）；中心经/纬位于西安一带（108.9606°E / 34.2199°N）；初始姿态 0°；三直线+三环 RGB 正确；平移流程取 X 直线 t=0.66 干净点（scene.pick 命中 line-x）悬停 width 3→6、按下→12，拖 -150px 后中心经度 108.960582→108.956057、坐标 live 更新、姿态保持 0°、**modelMatrix 平移列与中心点位移一致（err=0.000m，模型真实移动）**、console 平移三类打印；旋转流程取 Z 环干净点画弧 +80°，ring 方向变化、姿态 live `绕Z +80.0000°`、绕Z 输入回写 79.99999、**modelMatrix 旋转块变化 + 锚点映射回当前中心 err=0.000m（模型真实绕中心旋转）**、中心点与坐标 live 不变、console 旋转三类打印；旋转后再拖 X 直线中心仍可平移且绕Z 姿态保持 79.99999（联动共存）；无关键页面错误。
- headless `verify_dayanta_panel.js` 10/10 PASS：直线轴长度滑块 650→3000m、环形轴半径 400→1800m 实时生效；显示模型开关关闭后 `tileset.show=false`；轴端标签开关生效；应用中心点经度 108.9606→109.0106 生效；应用姿态 45° 生效（modelMatrix m0=cos45°）；重置变换后中心回到原生坐标、姿态归零、modelMatrix 复原单位阵；无关键页面错误。

## V6.5.7 白模 custom shader 失效修复与点光源光照输出重构

**目标**：
1. 修复「样式+着色器」「点光源效果」两案例参数实时调节无效的问题（用户反馈边缘光及点光源参数调整无感）。
2. 保证风格色带（Cesium3DTileStyle）与 custom shader 边缘光正确叠加，点光源光照结果不被 lighting 管线二次调制。

**根因（对照 Cesium 1.144 打包产物内建 GLSL 与管线源码定位，非臆测）**：
- `CustomShaderPipelineStage`（Cesium.js L113367-113550）`inferAttributeDefaults` 只去掉 `MC|EC` 后缀补默认值；fragment shader 引用 `normalWC` 无对应 attribute 时无默认值兜底 → 输出 one-time warning `incompatiblePrimitiveFS`（"Primitive is missing attribute normalWC, disabling custom fragment shader."）并返回 `{enabled:false}`，**整个 custom fragment shader 被禁用，所有 uniform 失效**。`normalEC` 有默认值 `vec3(0,0,1)`，`positionEC`/`positionWC` 为 builtin 恒可用。
- Model 渲染管线顺序：`materialStage → customShaderStage → lightingStage → cpuStylingStage → modelColorStage → handleAlpha`（Cesium.js L129810-129835）。`tileset.style` 色带在 `cpuStylingStage` 处理，REPLACE 下 `highlight=ceil(model_colorBlend)=1` → `diffuse *= mix(style,1,1)=1` 不覆盖 custom diffuse、`alpha *= style.a` 保留透明度；`modelColorStage` 仅在显式设置 `tileset.color` 时编译（本案例未设置，不运行）。故 REPLACE + custom shader 的正确组合是：色带色由 materialStage 的 `blend(base, featureColor, blend)` 以 style 色初始化 `material.diffuse`，custom shader 读取后叠加边缘光/亮度，输出不被后级覆盖。

**实施内容**：
- `src/cases/city-style-shader/CityStyleShaderDemo.vue`：SHADER_FRAGMENT 中 `normalize(fsInput.attributes.normalWC)` → `normalize(fsInput.attributes.normalEC)`、视线向量改用 `normalize(-fsInput.attributes.positionEC)`；import 并设置 `ts.colorBlendMode = Cesium3DTileColorBlendMode.REPLACE`（色带完整显示，边缘光叠加在 style 色之上）。
- `src/cases/city-point-light/CityPointLightDemo.vue`：SHADER_FRAGMENT 中 `normalWC` → `normalEC`、`positionWC` 相关计算改用 `positionEC`，光源位置 WC→EC 变换用 `czm_view`（Cesium 1.144 打包产物中无 `czm_viewMatrix`，uniform 名为 `czm_view`）；光照输出重构：Blinn-Phong 漫反射+高光结果写 `material.emissive`（加色直达，不受 lightingStage 二次 PBR 调制），`material.diffuse = base * u_ambient` 保留环境基色，`material.specular = vec3(0)`。
- 混合模式：point-light 同步设 `Cesium3DTileColorBlendMode.REPLACE`（无 style 时 diffuse=base 白，光照输出走 emissive 不受 blend 影响）。

**验证结果**：
- `npm run build` EXIT=0（/tmp/build_v658.log，✓ built in 1m 4s，vue-tsc + vite 0 error）。
- headless SwiftShader（/tmp/opencode/verify_v657_final.js）：5/5 PASS —— 两案例瓦片加载 ✓、全程无 custom shader 禁用/编译警告 ✓（修复前稳定触发 `incompatiblePrimitiveFS`）、交互参数（色带/透明度/边缘光强度与颜色/亮度/高度渐变、光源位置/颜色/强度/衰减/环境光/高光）实时 setUniform 无 pageerror、全程 0 pageerror。
- 预览：https://5173-0bc9c7e0e3f401be.monkeycode-ai.online（HTTP 200），dev server（term_1788239483855_459）运行中。

**后续约定**：
- 白模 CustomShader 案例中 fragment 一律使用 `normalEC`/`positionEC`（有默认值/builtin 兜底），严禁引用 `normalWC`/`positionWC` attribute；WC 相关计算先 `czm_view` 变换到 EC。
- 涉及 `Cesium3DTileStyle` 与 custom shader 叠加时，`colorBlendMode` 固定 `REPLACE`；点光源类加色光照写 `material.emissive`。

## V6.5.6 白模着色器案例 icon 替换

**目标**：
1. 「三维数据加载-城市建筑白模自定义着色器」案例卡片 icon 采用用户上传 image-1。
2. 「三维数据加载-城市建筑白模样式+着色器」案例卡片 icon 采用用户上传 image-2。

**实施内容**：

- `src/cases/city-shader/icon.webp` 覆盖为用户 image-1（1234x655 webp，md5 `134837d1f3ae30b4c93fa9d3f979938d`）。
- `src/cases/city-style-shader/icon.webp` 覆盖为用户 image-2（1237x656 webp，md5 `c4460c49a02b68f9f2ddad96ac81a415`）。
- 无代码逻辑改动，仅静态资源替换（dev server HMR 自动生效，`?t=...` 时间戳使浏览器刷新缓存）。

**验证结果**：

- `npm run build` EXIT=0（✓ built in 25.54s，vue-tsc + vite 0 error）。
- headless SwiftShader（/tmp/opencode/verify_v656.js）：两张卡片 `<img>` naturalWidth/Height 与目标图完全一致（1234x655 / 1237x656）、工作区文件 md5 与上传缓存一致、无页面相关报错（唯一 console 404 为浏览器默认 `/favicon.ico` 请求，headless 环境噪声，已用 CDP `Log.entryAdded` 定位确认）。
- 预览：https://5173-0bc9c7e0e3f401be.monkeycode-ai.online（HTTP 200），dev server（term_1788239483855_459）运行中。

## V6.5.5 白模 icon 替换与自定义着色器/样式/点光源 3 案例

**目标**：
1. 「三维数据加载-城市建筑白模」案例卡片 icon 替换为用户上传的 image-1。
2. 参考 https://github.com/dvt3d/dc-sdk 仓库的 3D Tiles 自定义着色器（`3dtiles_custom_shader.html`）与样式+着色器（`3dtiles_style_and_shader.html`）示例，新增三个城市建筑白模案例，全部支持参数实时修改。

**dc-sdk 参考要点**：
- `DC.Tileset.setCustomShader(customShader)` → 对应 Cesium `tileset.customShader`；`DC.CustomShader({ fragmentShaderText })` 即 Cesium 1.144 `CustomShader`，fragmentMain 中基于 `czm_frameNumber`、`position.z` 实现动态光环与渐变。
- `DC.TilesetStyle()` → 即 Cesium `Cesium3DTileStyle`，按属性 conditions 分级设色；customShader 中 `material.diffuse` 继承 style 色，可再叠加渐变/边缘光。

**实施内容**：

1. icon 替换：`src/cases/city-white-model/icon.webp` 覆盖为用户上传 image-1（1239x657 webp）。
2. 新增共享设施：
   - `src/lib/use-white-model-tileset.ts`：composable，封装 viewer/底图创建、3DBAG tileset 加载（LOD 切换）、阿姆斯特丹相机定位、实时性能统计（帧率/瓦片/三角面/GPU 内存/排队）、重置与销毁；`onTilesetReady(viewer, tileset)` 回调由各案例注入自定义逻辑。
   - `src/lib/white-model-glsl.ts`：`WGS84_HEIGHT_GLSL`（`dc_approxEllipsoidHeight` 自实现 WGS84 快速椭球高度，因 Cesium 内置 `czm_approximateEllipsoidHeight` 在打包产物中未直接暴露，改用自算规避）。
3. 新增案例一 `src/cases/city-shader/`（自定义着色器）：
   - CustomShader fragmentMain：建筑按椭球高度渐变（底部暗→顶部亮）+ 动态扫描光带（`czm_frameNumber` 驱动，扫描带在高度范围循环升降）。
   - 参数：动态扫描开关、扫描颜色（青/绿/橙/紫/红）、扫描周期（0.5~8s）、扫描带宽（2~40m）、扫描范围（30~200m）、基础颜色（白/银灰/天蓝/暖白）、高度渐变开关、渐变上限（20~150m）。
   - uniform 全部用 `setUniform(name, value)` 实时更新，VEC3 传 `Cartesian3`，FLOAT 传 number。
4. 新增案例二 `src/cases/city-style-shader/`（样式+着色器）：
   - `Cesium3DTileStyle` 按 3DBAG 建筑属性 `b3_volume_lod22`（建筑体量 m³）conditions 分级设色，5 套色带（地形暖色/冷色蓝/Turbo 热力/森林绿/单色银），透明度可调。
   - CustomShader 叠加边缘光（normalWC 与视线点积的 rim 高光）+ 整体亮度 + 高度渐变亮度。
   - 建筑属性展示：通过 `tileVisible` 监听 + `tile.content.getFeature(0).getProperty()` 读取真实建筑体积/占地面积/建造年份。
   - 参数：色带方案、透明度（10~100%）、边缘光强度（0~2）、边缘光颜色（白/暖金/青/粉/绿）、整体亮度（0.5~2）、高度渐变（0~1）。
5. 新增案例三 `src/cases/city-point-light/`（点光源效果）：
   - CustomShader 实现 Blinn-Phong 点光源：光源 ECEF 位置（uniform VEC3）、颜色、强度、衰减半径（线性衰减 `1-dist/r` 的指数）、环境光、高光强度与高光指数。
   - 场景中 `viewer.entities.add` 一个发光点 + label「点光源」标记光源位置，随参数联动移动。
   - 参数：光源经度（4.6~5.2）/纬度（52.2~52.6）/高度（100~800m）、光源颜色（白/暖黄/青/紫/洋红）、光源强度（0~6）、衰减半径（200~3000m）、衰减指数（0.5~4）、环境光（0~1.5）、高光强度（0~2）、高光指数（8/16/32/64/128）。
6. 三个案例注册进 `src/cases/index.ts`（effects 分类，cityWhiteModelCase 之后），icon 由文生图生成（1448x1086 → webp）。

**关键坑与解决**：
- 3DBAG lod22 为 3D Tiles 1.1 **嵌套 tileset**（root 为 `Empty3DTileContent`，子瓦片 `_Tileset3DTileContent` 指向 `tileset-5-*.json`，真正的 glb 是 `_Model3DTileContent`）；遍历取属性需跳过空/嵌套 content。
- `feature.getProperty('b3_h_nok')` 与 `b3_bouwlagen` 返回 null/undefined（Cesium 1.144 该 property 读取路径问题），改用可读的 `b3_volume_lod22`（体积）、`b3_opp_grond`（面积）、`oorspronkelijkbouwjaar`（年份）、`b3_h_maaiveld`（地面高程）；style 分级依据相应改用体量。
- `Entity.isDestroyed()` 在 .d.ts 中不存在，光源实体复用检查改为 truthy 判断。
- `label.pixelOffset` 类型为 `Cartesian2`，`entity.position` 需 `ConstantPositionProperty` 包装。

**验证结果**：

- `npm run build` EXIT=0（vue-tsc + vite，0 error，✓ built in 1m 2s）。
- headless SwiftShader（/tmp/opencode/verify_v655.js）：25 项全 PASS —— 3 个新卡片存在且 icon 加载正常、custom-shader 面板标题/4 滑块/3 下拉/2 开关/tileset 加载/参数交互无报错、style-shader 色带与滑块/tileset 加载/建筑属性读取成功（建筑体积 301 m³ / 占地 97 m² / 建造年份 1980）/参数交互无报错、point-light 位置滑块与下拉/tileset 加载/参数交互无报错、全程 0 pageerror。
- 预览：https://5173-0bc9c7e0e3f401be.monkeycode-ai.online（HTTP 200），dev server（term_1788239483855_459）运行中。

## V6.5.4 城市建筑白模 3D Tiles 案例

**目标**：搜索并采用公开城市级白模 3D Tiles 资源，新增城市建筑白模展示案例，支持 LOD 精度切换、渲染参数（着色/透明度/混合/高度偏移）与性能参数（屏幕空间误差/缓存内存/溢出上限/LOD 跳级/动态误差）实时调节，并展示实时性能统计（帧率/瓦片数/三角面/GPU 内存/排队瓦片）。

**数据源调研结论**：

1. 采用 3DBAG（荷兰全境建筑白模）：`https://data.3dbag.nl/v20250903/cesium3dtiles/lod22/tileset.json`（3D Tiles 1.1，REPLACE 细分，glb 瓦片，CORS `access-control-allow-origin: *`，ECEF 坐标可直接加载）。lod22 精细/ lod13 简化 / lod12 最简三个精度层级均可用。
2. 数据源探测链：从 3dbag viewer 前端 JS（`3dbag.nl/js/app.js`）逆向出真实端点 `data.3dbag.nl/v<版本>/cesium3dtiles/lod{22,13,12}/tileset.json`；子瓦片为 `tileset-5-*.json` 与 `t/*/*.glb`，均 CORS `*`。
3. 候选源对比：腾讯太原 3dTilesGCJ02（mapapi.qq.com）仅约 1MB 街区数据、GCJ02 坐标偏移；高德 single.json 规模更小；Esri tiles.arcgis.com 返回假 200（body 为 error JSON）、GSI 日本 000、data.3dbag.nl/api/v2 404，均不可用。故采用 3DBAG。

**实施内容**：

1. 新增 `src/cases/city-white-model/`（index.ts + CityWhiteModelDemo.vue + icon.webp，归 effects 分类，数组尾部）：
   - 加载 3DBAG lod22 荷兰全境建筑白模 tileset，相机初始定位阿姆斯特丹市区（18000m 倾斜视角）。
   - 「数据层级」LOD 下拉：lod22（精细）/ lod13（简化）/ lod12（最简）切换即重建 tileset。
   - 「渲染参数」着色（white/silver/cyan/orange，`Cesium3DTileStyle`）+ 透明度 + 混合模式（替换/高亮/混合）+ 混合度 + 高度偏移（±200m，modelMatrix 平移）。
   - 「性能参数」屏幕空间误差（2~64）、缓存内存（128~2048MB → `cacheBytes`）、溢出上限（0~1024MB → `maximumCacheOverflowBytes`）、跳过细节层级（`skipLevelOfDetail`）、动态误差（`dynamicScreenSpaceError`）。
   - 「实时性能」帧率（setInterval 300ms 自算）+ 已加载瓦片（`statistics.numberOfTilesWithContentReady`）+ 三角面（`statistics.trianglesLength`）+ GPU 内存（`totalMemoryUsageInBytes`）+ 排队瓦片（`statistics.numberOfPendingRequests`）。
   - 按钮：定位阿姆斯特丹 / 重置（全部参数复位并重载 lod22）。
2. `src/cesium-render.d.ts` 通过 interface 合并补充 Cesium3DTileset 的 `statistics` 属性类型声明（`Cesium3DTilesetStatistics`，含 numberOfTilesWithContentReady/numberOfPendingRequests/trianglesLength 等），官方 .d.ts 未声明该属性。
3. Cesium 1.144 API 适配：旧 `tileCacheSize`/`maximumMemoryUsage`/`trianglesLoaded`/`tilesWaitingToLoad` 已移除，改用 `cacheBytes`/`maximumCacheOverflowBytes`/`statistics.*`；`tilesLoaded` 为 boolean 语义（该视图瓦片是否全部加载）。

**验证结果**：

- `npm run build` EXIT=0（/tmp/build_v654c.log，✓ built in 1m 3s，vue-tsc + vite 0 error）。
- headless SwiftShader（/tmp/opencode/verify_v654.js）：14 项全 PASS —— 首页卡片与 icon 加载、点击进入案例视图、控制面板标题、6 滑块 + 3 下拉 + 5 性能指标、tileset 瓦片/内存加载>0（2 瓦片 9MB）、屏幕空间误差调至 64 生效、LOD 切 lod13 生效、着色切 cyan 生效、重置回退 lod22、0 pageerror。
- 运行时统计字段核实：`statistics.numberOfTilesWithContentReady=7`、`totalMemoryUsageInBytes≈11MB`，字段名与读取逻辑一致；SwiftShader 低帧率下快照偶显 0，属渲染时序非逻辑错误。
- 预览：https://5173-0bc9c7e0e3f401be.monkeycode-ai.online（HTTP 200），dev server（term_1788239483855_459）运行中。

## V6.5.3 图标替换与来源表述清理

**目标**：光锥图元案例卡片 icon 换为用户上传 image-1，电弧球体案例卡片 icon 换为用户上传 image-2；移除所有案例中“基于XXX”“参考XXX”“移植XXX”“仿照XXX”这类来源表述。

**实施内容**：

1. icon 替换：
   - `src/cases/light-cone/icon.webp` ← image-1（639b8287，100914B，md5 4758be1f…）。
   - `src/cases/elec-sphere/icon.webp` ← image-2（6ce6a23a，72096B，md5 c9bc5069…）。
   - cp 覆盖后 md5 与原上传文件完全一致。
2. 来源表述清理（`src/cases/` 全量）：
   - 3 个 dc-sdk primitive 案例（elec-sphere/light-cone/diffuse-wall）index.ts 与 Demo.vue 移除“基于 dc-sdk XxxPrimitive”字样，改为直接功能描述。
   - line-material 案例移除“dc-sdk 材质线样例”字样。
   - 其余案例中“基于……”开头的 description/hint 统一改写为“采用/通过/以/数据驱动”等表述：flood-inundation、volume-cloud、terrain-excavation、point-cluster、earth-rotation、heatmap-3d、fog、weather-rain、viewshed、heatmap-canvas、chart-pm25/migrate/message。
   - 保留名词性“参考线/参考视图/位置参考”等功能描述（非来源表述）。

**验证结果**：

- `npm run build` EXIT=0（vue-tsc + vite，✓ built in 39.07s，0 error）。
- headless 验证 11 项全 PASS：27 卡片全部 icon 正常加载、全量卡片文案 0 命中禁用词（基于/移植/仿照/复刻/照搬/dc-sdk/借鉴/参照）、电弧球体与光锥图元卡片 icon 加载成功、两案例控制面板出现、primitives 正常（has=true prims=1）、hint 文案已清理、0 pageerror。
- dev server 热更新生效，`/src/cases/light-cone/icon.webp` 与 `/src/cases/elec-sphere/icon.webp` 均 HTTP 200。

## V6.5.2 三维特效-电弧球体/光锥图元/扩散墙 3 案例

**目标**：参考 dc-sdk 仓库 arc-sphere（ElecEllipsoidPrimitive + EllipsoidElectric）、light-cone（LightCylinderPrimitive：CircleRing/CircleRotate/CylinderFade/CylinderParticles）、diffuse-wall（DiffuseWallPrimitive + WallDiffuse）三组 primitive，新增 3 个三维特效案例，支持参数实时调节与点击地图放置。

**实施内容**：

1. 共享库 `src/cases/primitive-effect-lib/`（参照 dc-sdk `overlay/primitive/{ElecEllipsoidPrimitive,LightCylinderPrimitive,DiffuseWallPrimitive}.js` 与 `material/type/{ellipsoid,circle,cylinder}.js`）：
   - `materials.ts`：注册 5 种 Fabric 材质 —— `EllipsoidElectric`（电弧球体，uniform color+speed，fbm/smoothNoise 随机电弧，`st.t<0.5 discard` 只显示上半球）、`CircleRing`（底部圆环）、`CircleRotate`（旋转扫描圆，需 image uniform）、`CylinderFade`（光柱渐隐）、`CylinderParticles`（上升粒子，需 image uniform）；`makeCircleImage`（512 虚线圆 canvas）与 `makeParticlesImage`（64x256 粒子条 canvas）替代 dc-sdk base64 贴图。
   - `elec-sphere.ts`：`ElecSpherePrimitive extends PrimitiveCollection`，内部单个 `Primitive`（EllipsoidGeometry radii + maximumCone=PI/2 + MaterialAppearance EllipsoidElectric），modelMatrix 用 `eastNorthUpToFixedFrame`；`create/update/removeElecSphere`。
   - `light-cone.ts`：`LightConePrimitive extends PrimitiveCollection`，含底部圆环（CircleRing）、旋转扫描圆（CircleRotate）、光柱侧面（自建 `_createCylinderInstance`：ENU 局部椭圆点 + PolygonGeometry perPositionHeight + st 纹理坐标）、上升粒子（CylinderParticles）；`_computeEllipsePositions` 用 `eastNorthUpToFixedFrame`+`Matrix4.multiplyByPoint` 替代 dc-sdk 的 `EllipseGeometryLibrary`（Cesium 1.144 未导出）；`create/update/removeLightCone`。
   - `diffuse-wall.ts`：`DiffuseWallPrimitive` 自定义 primitive（含 `isDestroyed()`），每帧 update 中重建 `WallGeometry`（圆形 positions 按 `_currentRadius` 扩散、`_currentHeight` 递减），材质复用 wall-effects-lib 的 `WallDiffuse`（先调 `registerWallMaterials()`）；`create/update/removeDiffuseWall`。
   - 移除实体时先 `instances.delete(id)` 再 `scene.primitives.remove(instance)`（remove 会自动 destroy 实例，避免二次 destroy 抛 throwOnDestroyed）。
2. 三个案例（index.ts + Demo.vue + icon.webp，均归 effects 分类，数组尾部）：
   - `elec-sphere` 电弧球体：参数含颜色/透明度/闪烁速度/半径XYZ，相机 30000m。
   - `light-cone` 光锥图元：参数含颜色/透明度/锥高/顶半径/底半径，相机 80000m。
   - `diffuse-wall` 扩散墙：参数含颜色/透明度/扩散半径/墙高/扩散速度，相机 100000m。
   - 每个案例支持点击地图放置（LEFT_CLICK 拾取 + 重建实体）、重置默认位置、参数实时联动（watch 调 update）。
3. `src/cases/index.ts` 注册 3 案例进 demos（effects 分类，数组尾部）。
4. 材质线 `line-material` icon → image-1（0e930cd6，74070B）、流动线 `line-flow` icon → image-2（8c9c762d，73186B），cp 覆盖字节数一致。
5. `vite.config.ts` CESIUM_SYMBOLS 新增 `PrimitiveCollection`（此前仅 Primitive）。

**验证结果**：

- `npm run build` EXIT=0（/tmp/build_v652.log，✓ built in 37.87s）。
- headless SwiftShader（/tmp/opencode/verify_v652.js）：3 卡片导航与控制面板均出现；每案例创建 1 个 primitive（scene.primitives.length=1）且无 Cesium errorPanel；电弧球体速度 5→12、光锥高度 400→500、扩散墙半径 300→600 参数联动生效（uniform/opts 实时更新）；0 个 pageerror。
- dev server（term_1788239483855_459）运行中，localhost:5173 HTTP 200。

## V6.5.1 线案例 icon 替换 + 材质线多材质 + 流动线多色

**目标**：按用户反馈（1）图片轨迹线/闪烁线/发光轨迹线 icon 采用用户上传图；（2）材质线案例提供更多材质样例；（3）流动线支持一条线段多个颜色。

**实施内容**：

1. icon 替换：图片轨迹线 `line-image-trail` → image-3（abfa9aa6，55094B）、闪烁线 `line-flicker` → image-2（23002a09，70322B）、发光轨迹线 `line-lighting-trail` → image-4（e47d674b，79122B）；仅覆盖各案例 `icon.webp`。
2. `polyline-effects-lib/materials.ts` 新增 5 种 dc-sdk 折线材质注册与 shader 移植：
   - `PolylineLighting`（发光线，lighting.png 贴图 + diffuse 增亮）
   - `PolylineFence`（栅栏线，dashPattern 位掩码虚线 + 外轮廓，uniform dashLength/dashPattern/maskLength/outlineWidth/outlineColor，shader 用 `v_polylineAngle`/`v_width`/czm_antialias/czm_gammaCorrect）
   - `PolylineMultiArrow`（多箭头线，repeatFactor 控制箭头重复数，fwidth 抗锯齿）
   - `PolylineDashArrow`（虚线箭头线，dashPattern 位掩码虚线 + 箭头头）
   - `PolylineDirection`（方向线，fragLength 周期 + 菱形箭头 + 外轮廓）
   - `PolylineMaterialProperty` 扩展全部字段（dashLength/dashPattern/maskLength/outlineWidth/outlineColor/directionColor/repeatFactor/antiClockWise），`getValue` 按 kind 组装对应 uniform；`entities.ts` `updatePolylineEntity` 同步新字段。
3. 材质线案例 `line-material` 升级：增加「材质类型」下拉（10 种：材质线/流动线/栅栏线/多箭头线/虚线箭头线/方向线/发光线/闪烁线/图片轨迹线/发光轨迹线），切换时应用各自默认参数并重建实体，条件渲染专属参数（速度/段长/渐变/重复次数/箭头重复/虚线长度/虚线图案/外轮廓宽/方向颜色）。
4. 流动线案例 `line-flow` 新增「颜色模式」（单色/多色）：多色模式调用新增 `createColoredLineSegments`，把 5 点折线拆成 4 段，每段独立实体 `dc-polyline-line-flow-seg-N` 用预设红橙绿蓝着色，流动参数（speed/percent/gradient/width）同步联动；切回单色清理全部段实体。
5. 案例描述同步更新（材质线=10 种材质样例、流动线=单色/多色）。

**验证结果**：

- `npm run build` EXIT=0（/tmp/build_v651.log，✓ built in 37.88s）。
- headless SwiftShader（`/tmp/opencode/verify_v651.js`）：3 张新 icon 卡片真实加载（naturalWidth 1235~1239）；材质线 9 种材质切换全部成功且切回材质线正常（复杂 shader 材质如 Fence/MultiArrow/DashArrow/Direction 无编译错误）；流动线多色模式创建 4 段实体且 4 色互异（红255,51,68/橙255,153,51/绿51,204,102/蓝51,153,255），切回单色后段实体清理干净；0 个 pageerror。
- dev server（term_1788236849151_451）运行中，localhost:5173 与 3 张新 icon.webp 均 HTTP 200。

## V6.5.0 三维特效-线 5 案例

**目标**：参考 dc-sdk 仓库 polyline 材质，新增 5 个线效果案例（材质线/图片轨迹线/流动线/闪烁线/发光轨迹线），支持各类参数实时修改，归入三维特效分类。

**实施内容**：

1. 贴图素材：复制 dc-sdk `src/modules/images/lighting.png`（512x152，发光轨迹线）、`examples/assets/icon/arrow_1.png`（30x21，图片轨迹线）到 `public/images/`（lighting.png / polyline-arrow.png）。
2. 共享库 `src/cases/polyline-effects-lib/`（参照 dc-sdk `material/type/polyline.js` 与 `material/property/polyline/`）：
   - `materials.ts`：注册 5 种 Fabric 折线材质，shader 移植自 dc-sdk `shader/polyline/*.glsl` —— `PolylineTrail`（材质线，`alpha = color.a * fract(st.s-time)` 分段尾迹）、`PolylineImageTrail`（图片轨迹线，`texture(image, vec2(fract(st.s-time), st.t))` + repeat 平铺）、`PolylineFlow`（流动线，smoothstep+step 沿 st.s 流动段 + percent/gradient）、`PolylineFlicker`（闪烁线，整线 scalar 明暗闪烁）、`PolylineLightingTrail`（发光轨迹线，lighting.png 贴图 + st.t 中心亮线）；提供通用 `PolylineMaterialProperty`（kind + color/speed/percent/gradient/repeatX/repeatY/image）。
   - `entities.ts`：`createPolylineEntity`（Entity `polyline`，positions/width 用 ConstantProperty、material 用 `PolylineMaterialProperty`）、`updatePolylineEntity`、`removePolylineEntity`（id 前缀 `dc-polyline-`）、`DEFAULT_LINE_POSITIONS`（北京-天津-济南-郑州-武汉 5 点折线，高度 1000m）。
3. 五个案例（index.ts + Demo.vue + icon.webp，均归 effects 分类）：
   - `line-material` 材质线：PolylineTrail，参数含颜色/透明度/流动速度/线宽。
   - `line-image-trail` 图片轨迹线：PolylineImageTrail（polyline-arrow.png），参数含颜色/透明度/流动速度/重复次数/线宽。
   - `line-flow` 流动线：PolylineFlow，参数含颜色/透明度/流动速度/段长/渐变强度/线宽。
   - `line-flicker` 闪烁线：PolylineFlicker，参数含颜色/透明度/闪烁频率/线宽。
   - `line-lighting-trail` 发光轨迹线：PolylineLightingTrail（lighting.png），参数含颜色/透明度/流动速度/线宽。
   - 每个案例支持点击地图平移整条折线（保持相对形状）、重置默认位置、参数实时联动。
4. `src/cases/index.ts` 注册 5 案例进 demos（effects 分类，数组尾部）。

**验证结果**：

- `npm run build`（vue-tsc + vite）EXIT=0，日志 `/tmp/build_v65.log`（✓ built in 1m 4s）。
- headless SwiftShader（`/tmp/opencode/verify_v65.js`）：5 卡片均可导航，每案例创建 1 个 `dc-polyline-*` 实体且材质类型正确（PolylineTrail/PolylineImageTrail/PolylineFlow/PolylineFlicker/PolylineLightingTrail）；图片轨迹线重复次数 8→15、流动线段长 0.03→0.1 参数联动生效；0 个 pageerror。
- dev server（term_1788233273801_448）运行中，localhost:5173 与 lighting.png / polyline-arrow.png 均 HTTP 200。

## V6.4.1 墙体 3 案例 icon 替换为用户上传图

**目标**：按用户反馈将三维特效-墙体 3 案例卡片 icon 替换为用户上传图片。

**实施内容**：基础墙体 `wall-basic` → image-3（47abf99f，149180B）、流动墙体 `wall-trail` → image-2（53e33ed1，147478B）、流动图片墙体 `wall-image-trail` → image-1（30a51595，158768B）；仅覆盖各案例目录 `icon.webp`（index.ts 已引用 `./icon.webp`，无需改动）。

**验证结果**：`npm run build` EXIT=0（/tmp/build_v641.log，✓ built in 46.28s）；dev server（term_1788232310480_446）下三张 icon.webp HTTP 200（字节数与源一致）；headless（/tmp/opencode/verify_v641.js）三卡片 `img` 均真实解码加载（naturalWidth 1234~1238），0 pageerror。

## V6.4.0 三维特效-墙体 3 案例

**目标**：参考 dc-sdk 仓库墙体实现，新增 3 个墙体效果案例（基础墙体 / 流动墙体 / 流动图片墙体），支持各类参数实时修改，归入三维特效分类。

**实施内容**：

1. 贴图素材：复制 dc-sdk `src/modules/images/fence.png`、`space_line.png` 与 `examples/assets/icon/arrow.png` 到 `public/images/`（wall-fence.png / wall-space-line.png / wall-arrow.png）。
2. 共享库 `src/cases/wall-effects-lib/`（参照 dc-sdk `material/type/wall.js` 与 `material/property/wall/`）：
   - `materials.ts`：注册 3 种 Fabric 墙体材质，shader 移植自 dc-sdk `shader/wall/*.glsl` —— `WallDiffuse`（竖向渐变发光，uniform color）、`WallTrail`（栅栏纹理沿 st.t 向上流动，uniform image/speed/color）、`WallImageTrail`（箭头纹理沿 st.s 水平流动 + repeat 平铺，uniform image/color/speed/repeat）；提供通用 `WallMaterialProperty` 属性类（color/speed/repeatX/repeatY/image）。
   - `entities.ts`：`createWallEntity`（Entity `wall`，positions 用 `ConstantProperty(Cartesian3[])`、material 用 `WallMaterialProperty`）、`updateWallEntity`（重建 positions 或改 material 属性）、`removeWallEntity`（id 前缀 `dc-wall-`）、`rectPositions`（中心经纬度 + 墙宽/墙深/墙高换算 5 点闭合矩形）。
3. 三个案例（index.ts + Demo.vue + icon.webp，均归 effects 分类）：
   - `wall-basic` 基础墙体：`WallDiffuse` 材质，参数含颜色/透明度/墙宽/墙深/墙高/顶部描边。
   - `wall-trail` 流动墙体：`WallTrail` 材质（wall-fence.png），参数含颜色/透明度/流动速度/墙宽/墙深/墙高。
   - `wall-image-trail` 流动图片墙体：`WallImageTrail` 材质（wall-arrow.png），参数含颜色/透明度/流动速度/重复次数/墙宽/墙深/墙高。
   - 每个案例支持点击地图放置、重置默认位置、参数实时联动。
4. `src/cases/index.ts` 注册 3 案例进 demos（effects 分类，数组尾部）。

**验证结果**：

- `npm run build`（vue-tsc + vite）EXIT=0，日志 `/tmp/build_v64.log`（✓ built in 34.74s）。
- headless SwiftShader（`/tmp/opencode/verify_v64.js`）：3 卡片均可导航，每案例创建 1 个 `dc-wall-*` 实体且材质类型正确（WallDiffuse / WallTrail / WallImageTrail）；流动图片墙体调节重复次数滑块后 `repeat.x` 12→20 生效；0 个 pageerror。
- dev server（term_1788225990978_444）运行中，localhost:5173 与 wall-fence.png / wall-arrow.png 均 HTTP 200。

## V6.3.0 案例搜索升级为全局搜索

**目标**：案例搜索从"当前分类内按名称过滤"升级为全局搜索，支持跨全部分类按案例名称与描述检索。

**实施内容**：

1. `src/App.vue` `visibleDemos` 计算属性重写：输入关键词时忽略当前分类限制，`demos.filter` 匹配 `title` 或 `description`（`toLowerCase()` 大小写不敏感）；关键词为空时回退为当前分类过滤。排序逻辑保持不变（最新收录优先）。
2. 新增 `searching` computed（关键词 trim 非空判定），面包屑显示「全局搜索」、标题显示 `搜索 “关键词” N 个案例`。
3. 搜索框 placeholder 由「搜索案例名称」改为「全局搜索案例名称 / 描述」。
4. 使用帮助文档更新搜索说明（跨分类、名称/描述检索、自动切换到全局搜索结果视图）。

**验证结果**：

- `npm run build`（vue-tsc + vite）EXIT=0，日志 `/tmp/build_v63.log`（✓ built in 50.45s）。
- headless SwiftShader（`/tmp/opencode/verify_v63.js`）：①默认三维特效分类显示 16 案例；②在三维特效分类下搜索「平面视频」（data 分类）跨分类命中 1 案例，标题正确；③搜索描述关键词「羽化渐变」命中视频融合(羽化)；④无结果显示空态；⑤清空关键词恢复三维特效 16 案例；0 个 pageerror。
- dev server（term_1788225197706_442）运行中，localhost:5173 返回 200。

## V6.2.1 视频效果 3 案例卡片 icon 更换

**目标**：视频效果 3 案例卡片 icon 采用用户上传新图：①平面视频用 image-2；②视频融合用 image-1；③视频融合(羽化)用 image-3。

**实施内容**：

1. `video-plane/icon.webp` 换为 `0e0d9fa7-image-2.webp`（md5 50ffb3d5…，122722 字节）。
2. `video-fusion/icon.webp` 换为 `1b34c185-image-1.webp`（md5 c6cfdf22…，122266 字节）。
3. `video-feather/icon.webp` 换为 `b286ca10-image-3.webp`（md5 3a146771…，119488 字节）。
4. 三个 `index.ts` 已引用 `./icon.webp`，无需改动；仅覆盖案例目录 icon 文件，源文件保留在 `.monkeycode-tmp-files/` 不被 src 直接引用。

**验证结果**：

- `npm run build`（vue-tsc + vite）EXIT=0，日志 `/tmp/build_v6210.log`（✓ built in 1m 8s）。
- headless SwiftShader（`/tmp/opencode/verify_v6210.js`）：三卡片 icon 均真实解码加载（naturalWidth 1240/1238/1236），0 个 pageerror。
- dev server（term_1788224589022_440）运行中，localhost:5173 与三个 icon.webp 均 HTTP 200。

## V6.2.0 数据可视化-视频效果 3 案例

**目标**：新增 3 个视频效果案例（平面视频 / 视频融合 / 视频融合-羽化），支持位置、尺寸、透明度、羽化宽度等参数实时调节，归入数据可视化分类。素材采用 dc-sdk 自带 `examples/assets/data/demo.mp4`。

**实施内容**：

1. 素材：复制 dc-sdk `demo.mp4`（536KB）到 `public/videos/demo.mp4`，供各案例 video 元素加载。
2. 共享库 `src/cases/video-effects-lib/`：
   - `video.ts`：`createVideoElement()`（muted + loop + playsInline + autoplay 创建 HTMLVideoElement）/ `disposeVideoElement()`。
   - `materials.ts`：注册自定义 Fabric 材质 `VideoFusionMaterial`（半透明融合，uniform `image/color/opacity`）与 `VideoFeatherMaterial`（边缘 alpha 羽化，uniform `image/color/featherWidth`），shader 内 `texture(image, st)` 直接采样视频纹理。
   - `entities.ts`：`createVideoPrimitive()` 基于 dc-sdk VideoPrimitive 思路，用 `GroundPrimitive` + `PolygonGeometry.fromPositions`（按中心经纬度 + 宽高换算矩形四角）+ `EllipsoidSurfaceAppearance` + 对应材质；提供 `moveVideoPrimitive()`（位置/尺寸变更重建）、`updateVideoPrimitive()`（透明度/羽化宽度直接改 uniform）、`removeVideoPrimitive()`。
3. 三个案例（index.ts + Demo.vue + icon.webp，均归 data 分类）：
   - `video-plane` 平面视频：`materialKind: 'Image'`，视频作为影像贴地显示。
   - `video-fusion` 视频融合：`materialKind: 'VideoFusion'`，半透明叠加地形，透明度控制地形透出。
   - `video-feather` 视频融合(羽化)：`materialKind: 'VideoFeather'`，边缘 alpha 羽化渐隐过渡。
   - 每个案例支持点击地图放置、重置默认位置、宽度/高度滑块、透明度/羽化宽度滑块、播放暂停按钮。
4. `src/cases/index.ts` 注册 3 个案例进 demos（data 分类，数组尾部）。

**验证结果**：

- `npm run build`（vue-tsc + vite）EXIT=0，日志 `/tmp/build_v62.log`（✓ built in 37.38s）与 `/tmp/build_v62b.log`（材质注册修复后 ✓ built in 29.76s）。
- headless SwiftShader（`/tmp/opencode/verify_v62.js`）：3 个卡片均可导航，每案例 `groundPrimitives` 中创建 1 个带 `_dcVideoId` 的视频 primitive，材质类型分别正确（Image / VideoFusionMaterial / VideoFeatherMaterial）；羽化案例调节透明度滑块后 `color.alpha` 0.5 生效，0 个 pageerror。
- 修复要点：自定义材质注册 uniforms 的 `image` 需给 `Material.DefaultImageId` 默认值，否则 `Material.fromType` 因 `getUniformType(undefined)` 报 "Cannot read properties of undefined (reading 'type')"。
- dev server（term_1788223174230_438）运行中，localhost:5173 返回 200。

## V6.1.11 波纹雷达卡片 icon 更换

**目标**：三维特效-波纹雷达效果案例卡片 icon 采用 image-1。

**实施内容**：

1. `radar-wave/icon.webp`（202b305f-image-1）复制进案例目录。
2. `radar-wave/index.ts` 添加 `import icon from './icon.webp'` 与 `icon` 字段。至此三维特效分类 10 个案例（V6.1.7 新增）的图标全部为用户提供的新图。

**验证结果**：

- `npm run build`（vue-tsc + vite）EXIT=0，日志 `/tmp/build_ts93.log`（✓ built in 59.20s）。
- headless SwiftShader（`/tmp/opencode/verify_v621.js`）：波纹雷达卡片 icon 真实解码加载（naturalWidth 1237/1237），0 个 pageerror。
- dev server（term_1788166037586_433）运行中，localhost:5173 返回 200，icon.webp HTTP 200。

## V6.1.10 雷达线/雷达图片/多彩圆三个卡片 icon 更换

**目标**：① 多彩圆卡片 icon 采用 image-3；② 雷达线卡片 icon 采用 image-1；③ 雷达图片卡片 icon 采用 image-2。

**实施内容**：

1. `radar-line/icon.webp`（cff3ce6c-image-1）、`radar-pic/icon.webp`（a80e8dc6-image-2）、`circle-vary/icon.webp`（19c691f7-image-3）复制进案例目录。
2. 三个 `index.ts` 添加 `import icon from './icon.webp'` 与 `icon` 字段。至此 V6.1.7 新增的 10 个三维特效案例图标全部为用户提供的新图。

**验证结果**：

- `npm run build`（vue-tsc + vite）EXIT=0，日志 `/tmp/build_ts92.log`（✓ built in 41.93s）。
- headless SwiftShader（`/tmp/opencode/verify_v620.js`）：三个卡片 icon 均真实解码加载（naturalWidth 1236/1237/1235），0 个 pageerror。
- dev server（term_1788165524745_430）运行中，localhost:5173 返回 200，三个 icon.webp 均 HTTP 200。

## V6.1.9 动画圆/螺旋圆/脉冲圆三个卡片 icon 更换

**目标**：① 动画圆卡片 icon 采用 image-1；② 螺旋圆卡片 icon 采用 image-2；③ 脉冲圆卡片 icon 采用 image-3。

**实施内容**：

1. `circle-ring/icon.webp`（238de2f3-image-1）、`circle-spiral/icon.webp`（4ad070ca-image-2）、`circle-pulse/icon.webp`（c348ed6f-image-3）复制进案例目录。
2. 三个 `index.ts` 添加 `import icon from './icon.webp'` 与 `icon` 字段。至此三维特效分类 10 个案例（V6.1.7 新增的 10 个）全部补齐卡片图标。

**验证结果**：

- `npm run build`（vue-tsc + vite）EXIT=0，日志 `/tmp/build_ts91.log`（✓ built in 1m 10s）。
- headless SwiftShader（`/tmp/opencode/verify_v619.js`）：三个卡片 icon 均真实解码加载（naturalWidth 1237/1237/1235），0 个 pageerror。
- dev server（term_1788164869281_427）运行中，localhost:5173 返回 200，三个 icon.webp 均 HTTP 200。

## V6.1.8 三个案例换 icon、修复动画圆、雷达案例新增范围圈线

**目标**：① 圆(逐渐消逝)卡片 icon 采用 image-1；② 模糊圆卡片 icon 采用 image-2；③ 扩散圆卡片 icon 采用 image-3；④ 修复「动画圆」无动画的问题；⑤ 雷达图片、波纹雷达两个案例补上雷达范围圈线，并作为可开关参数。

**实施内容**：

1. **图标**：`circle-fade/icon.webp`（cbe4cc82-image-1）、`circle-blur/icon.webp`（087893fa-image-2）、`circle-diffuse/icon.webp`（d2208e44-image-3）复制进案例目录，三个 `index.ts` 添加 `import icon from './icon.webp'` 与 `icon` 字段（沿用 flood 案例 V6.1.6 的 icon 组织方式）。
2. **动画圆修复**：`dc-effects-lib/materials.ts` 的 `CIRCLE_RING_SOURCE` 原版移植自 dc-sdk，其中 `time = 1.0 - abs(czm_frameNumber * speed / 360.0 - 0.5)` 变量计算后从未参与 alpha 计算（dc-sdk 原版即为死变量），导致圆环完全静态。重构为：`float pulse = 0.5 + 0.5 * sin(t * 2.0)` 驱动外环半径 `outerR = 0.55 + 0.3 * pulse`、内环半径 `innerR = 0.45 - 0.25 * pulse` 呼吸缩放，环随 `speed` 同步运动。
3. **范围圈线**：`dc-effects-lib/materials.ts` 新增 `RADAR_OUTER_TYPE = 'RadarOuterMaterial'` 及 `RADAR_OUTER_SOURCE`（同心圆环，uniform color/speed/repeat/thickness，移植 dc-sdk `shader/radar/RadarOuterMaterial.glsl`），注册进 `registerDcEffectsMaterials()`（默认 repeat=30、thickness=0.3）；`DcCircleMaterialProperty` 增加 repeat/thickness 可选 uniform 与 getter/setter。
4. `dc-effects-lib/entities.ts` 新增 `DC_EFFECT_RING_PREFIX = 'dc-effect-ring-'` 前缀及 `createDcEffectRingEntity`/`updateDcEffectRingEntity`/`removeDcEffectRingEntity` 三函数，实体 id 形如 `dc-effect-ring-radar-pic`、`dc-effect-ring-RadarWaveMaterial`。
5. `radar-pic/RadarPicDemo.vue`、`radar-wave/RadarWaveDemo.vue` 新增「范围圈线」开关（checkbox），默认开启；主实体放置/参数更新时同步创建/更新圈线，关闭开关移除圈线实体；圈线半径、位置、颜色跟随主实体，速度取旋转速度绝对值（radar-pic）或主 speed（radar-wave）。

**验证结果**：

- `npm run build`（vue-tsc + vite）EXIT=0，日志 `/tmp/build_ts90.log`；首轮报 2 处 TS2554（`position.getValue` cast 签名与调用参数不一致），修正为 `(time: unknown) => Cartesian3 | undefined` 后通过。
- headless SwiftShader（`/tmp/opencode/verify_v618.js`）：
  - 三个卡片 icon 均真实解码加载（naturalWidth 1238/1235/1235）。
  - 动画圆实体材质类型 CircleRingMaterial，两帧截图（间隔 700ms）像素差异 124,828 个点，确认环在呼吸动画。
  - 雷达图片：范围圈线默认存在（RadarOuterMaterial），关闭开关实体消失，重开恢复。
  - 波纹雷达：范围圈线默认存在（RadarOuterMaterial），关闭开关实体消失。
  - 全程 0 个 pageerror。
- dev server（term_1788164012356_422）运行中，localhost:5173 返回 200，三个 icon.webp 均 HTTP 200。

## V6.1.6 洪水两案例卡片 icon 更换

**目标**：① 洪水淹没模拟案例卡片 icon 采用 image-1；② 深度图洪水模拟案例卡片 icon 采用 image-2。

**实施内容**：

1. `src/cases/flood-inundation/icon.webp`：将 image-1（125594 字节，RIFF webp）复制为案例 icon；`index.ts` 的 `import icon from './icon.jpg'` 改为 `'./icon.webp'`。
2. `src/cases/flood-depth-simulation/icon.webp`：将 image-2（81608 字节，RIFF webp）复制为案例 icon；`index.ts` 补充 `import icon from './icon.webp'` 并添加 `icon` 字段（此前该案例卡片无图标）。
3. 旧的 `flood-inundation/icon.jpg` 不再被引用（保留文件，未删除）。

**验证结果**：

- `npm run build`（vue-tsc + vite）EXIT=0，日志 `/tmp/build_ts88.log`。
- headless SwiftShader（`/tmp/opencode/verify_icons.js`）：洪水淹没模拟卡片 `imgSrc=icon.webp`（1237×656，即 image-1）；深度图洪水模拟卡片 `imgSrc=icon.webp`（1236×656，即 image-2）。
- dev server 下两 icon 资源 HTTP 200，字节数与源文件一致（125594 / 81608）。

## V6.1.5 洪水水面按浅深水色梯度渐变渲染

**目标**：深度图洪水模拟已支持设置浅水区/深水区颜色，但地图渲染效果始终近乎全为深水色——需要让水面按设置的两色随水深做梯度渐变（浅水区显示浅水色、深水区显示深水色、中间平滑过渡）。

**根因**：`shaders.ts` 的 `RENDER_SHADER` 中 `tc = mix(tc, deep, smoothstep(0.0, 0.05, waterDepth))` 将颜色渐变区间**硬编码**为水深 0~0.05（归一化水深单位），超过 0.05 立即完全过渡到深水色，导致整个水面几乎全显示深水色，浅水色仅在极浅处出现，看不到浅→深的梯度效果。

**实施内容**：

1. `shaders.ts`（`RENDER_SHADER`）：新增 `uniform float gradientDepth;`，渐变改为 `float grad = smoothstep(0.0, max(gradientDepth, 0.001), waterDepth)`，`tc` 与 `alpha` 均按 `grad` 混合；`max(…, 0.001)` 防止滑杆为 0 时 smoothstep 参数非法。
2. `fluid-demo.ts`：`SimParams` 增加 `gradientDepth: number` 字段，Draw 命令 `uniformMap` 增加 `gradientDepth: () => self.opts.gradientDepth`。
3. `FloodDepthSimulationDemo.vue` 与 `FloodInundationDemo.vue`（两案例共用流体库）：`ui` 增加 `gradientDepth: 0.3` 默认值、`simParams` 增加字段、`flushParams()` 回写；UI 在「深水区颜色」下方新增「颜色渐变深度」滑杆（min 0.05 / max 1 / step 0.01），运行中实时调节。

**验证结果**：

- `npm run build`（vue-tsc + vite）EXIT=0，日志 `/tmp/build_ts87.log`。
- headless SwiftShader（`/tmp/opencode/verify_grad3.js`）：通过 `scene.primitives` 定位 Draw 命令（CustomPrimitive，uniformMap 含 `shallow/deep`），读取 `gradientDepth` uniform 实时联动——默认 `grad=0.3`，滑杆调至 0.8 → `grad=0.8`、调至 0.1 → `grad=0.1`；深水色改为 `#ff0000` → `deep="rgb(255,0,0)"` 联动。
- 渐变滑杆 UI 存在：`颜色渐变深度 0.30`（min 0.05 / max 1 / step 0.01）。

## V6.1.4 洪水反馈三连修：全局提示非遮罩化、矩形贴地与显隐控制、出水点点击选择修复

**目标**：处理用户三项反馈——①「正在加载Cesium World Terrain」类状态提示不能以全屏遮罩呈现，全部案例统一为非遮罩提示，不拦截地图操作；② 深度图洪水模拟的绘制矩形必须贴真实地形，且深度图预览面板需增加矩形显隐控制；③「重置出水点」后应能继续通过地图点击选择出水点。

**根因**（反馈③）：flood-depth-simulation 的 `stopDrawing()` 执行 `handler.removeInputAction(LEFT_CLICK)` 与 `removeInputAction(MOUSE_MOVE)`。`startDrawing()` 复用了 `handler`（在 onMounted 中注册出水点 `onCanvasClick` 的同一个 ScreenSpaceEventHandler）覆盖注册矩形绘制逻辑，绘制完成调用 `stopDrawing()` 时把 LEFT_CLICK action 永久移除，导致生成深度图后 `onCanvasClick`（出水点/水闸选择）不再触发，「重置出水点」后也无法再点击地图选择出水点。

**实施内容**：

1. 全局 70 案例 `.status-mask` 统一非遮罩化：用脚本（`/tmp/opencode/fix_mask.js`）将 `src/cases/**` 中所有 `inset: 0`/`place-items: center` 的全屏遮罩样式替换为顶部居中小提示条（`top:12px; left:50%; transform:translateX(-50%); width:max-content; max-width:380px; pointer-events:none`），共修改 68 个案例文件；flood-inundation 与 flood-depth-simulation 两案例原本已是 toast 样式不受影响。`widget-loading-mask` 案例的 `.cesium-loading-mask`（演示加载遮罩组件本体）按功能保留，其 `.status-mask` 已改 toast。
2. 反馈③修复（`FloodDepthSimulationDemo.vue`）：新增独立 `drawHandler`，`startDrawing()` 在 `drawHandler` 上注册矩形绘制的 LEFT_CLICK/MOUSE_MOVE，`stopDrawing()` 仅销毁 `drawHandler`，不再触碰 onMounted 中注册出水点选择的 `handler`；`onBeforeUnmount` 同时清理 `drawHandler`。
3. 反馈②矩形贴地：移除 `rectangleEntity` polygon 上渲染不可靠的 `outline/outlineColor/outlineWidth`，新增 `rectangleOutlineEntity`（`clampToGround: true` 的 polyline，5 点闭合）作为贴地边框；`setRectangle()` 同步更新填充 polygon 与贴地边框。
4. 反馈②矩形显隐控制：`result-panel`「地图叠加显示」组新增「显示选择矩形」checkbox，绑定 `rectangleVisible` ref，watch 联动控制 polygon 与 polyline 的 `show`。

**验证结果**：

- `npm run build`（vue-tsc + vite）EXIT=0，日志 `/tmp/build_ts86.log`。
- headless SwiftShader（`/tmp/opencode/verify_v614.js`）：`.status-mask` 为 toast 样式（宽 282px 高 36px、`pointer-events:none`、非全屏）；`result-panel` 含「显示深度图层」「显示选择矩形」两个 checkbox。
- headless SwiftShader（`/tmp/opencode/verify_click.js`，真实鼠标点击）：生成深度图后点击地图出水点文本变为 `(0.8088, 0.7427)`（markers=3）；点击「重置出水点」后文本回「点击地图选择出水点」（markers=2）；再次点击地图出水点文本变为 `(0.5780, 0.4005)`（markers=3）——反馈③修复验证通过。
- headless SwiftShader（`/tmp/opencode/verify_rect.js`）：矩形 polygon 无 outline、`heightReference=1`(CLAMP_TO_GROUND)、4 点贴地；边框 polyline `clampToGround=true`、5 点闭合；取消「显示选择矩形」后 polygon/polyline `show=false`，重新勾选后恢复 `show=true`。
- 全局替换后用 grep 复核 `src/cases/**` 无残留 `inset: 0`/`place-items: center` 的 `.status-mask`。

## V6.1.3 洪水模拟不贴地修复：simParams 未同步真实高程

**目标**：修复用户反馈「洪水淹没模拟，模拟过程没有贴地」——水面/盒体悬浮于真实地形之上，未贴合地表。

**根因**：`simParams`（`SimParams` 对象）在模块初始化时对 `ui.minElevation/maxElevation` 做了一次**值拷贝**（flood-inundation 默认 4300~5800），此后 `alignToRealTerrain()`（V6.1.1 新增）采样真实地形并把对齐值写入 `ui.minElevation/maxElevation`（1149~7094），但 `flushParams()` **从未把这两个字段回写 `simParams`**，导致 `new FluidDemo(...)` 始终按默认 4300~5800 计算盒体：`relativeToZ=(5800-4300)/2+4300=5050`、`thickness=1500`，盒体悬浮于真实地表（1249~6994m）之上，水面渲染位置与实际地形脱节。该问题同时影响 flood-inundation 与 flood-depth-simulation 两个案例（共用 `simParams` 同步模式）。

**实施内容**：

1. `FloodInundationDemo.vue` 与 `FloodDepthSimulationDemo.vue` 的 `flushParams()` 补上：
   ```
   simParams.minElevation = ui.minElevation
   simParams.maxElevation = ui.maxElevation
   ```
   `startSimulation()` 与 `watch(ui, ...)` 均经 `flushParams()` 同步，对齐值即可正确传递到 `FluidDemo` 的盒体 `relativeToZ/thickness`。

**验证结果**：

- `npm run build`（vue-tsc + vite）EXIT=0，日志 `/tmp/build_ts85.log`。
- headless SwiftShader flood-inundation（`/tmp/verify_old_ground_622.js`）：对齐后滑杆为 3600/7090，盒体 `boxBottom=1149`、`boxTop=7094`、z 厚 5945（真实地形采样 1249~6994 + 100m 缓冲），与对齐前默认 4300~5800/厚 1500 相比已完全包裹真实地表，零 JS 错误。
- headless SwiftShader 新案例（`/tmp/verify_fix_621.js`）：盒体 height=97、z 厚 194（北京四至区域真实地形 0~200m），与所绘矩形一致，零 JS 错误。

## V6.1.2 洪水模拟三反馈修复：盒体四至弧度bug、非遮罩提示、框选实时预览

**目标**：修复用户反馈的三个问题——① flood-inundation 模拟区域四至与实际地图范围不符；② flood-depth-simulation 操作提示（「点击地图确定第一个角点」等）不能以全屏遮罩形式呈现，绘制矩形移动鼠标时要实时预览待绘矩形，开始模拟后模拟范围要与所绘矩形一致。

**实施内容**：

1. **盒体四至弧度 bug（核心，`fluid-demo.ts`）**：
   - **根因**：`initShaderToy` 中 `EllipsoidGeodesic` 的起终点 `Cartographic((west+east)/2, south)` 直接传入了**度数**，而 `Cartographic` 期望**弧度**，导致 `surfaceDistance` 把 `0.12°` 当作 `0.12 弧度` 计算，盒体东西/南北尺寸被放大约 44 倍（实测新案例盒体四角 113.8~119.1E / 37.6~42.2N，而输入四至应为 116.30~116.42E / 39.86~39.94N）。V6.0 无真实地形参照时未暴露。
   - **修复**：改用 `Rectangle.fromDegrees` 的 `center`（弧度）与 `rectangle.south/north/west/east`（弧度）构造 `EllipsoidGeodesic`，`boxWidth/boxHeight` 恢复真实地表尺寸。该修复位于公共库，两个案例同时生效。
2. **操作提示改非遮罩 toast（`FloodDepthSimulationDemo.vue` / `FloodInundationDemo.vue`）**：
   - `.status-mask` 从全屏 `inset:0` 遮罩改为顶部居中的小提示条（`top:12px`、`width:max-content; max-width:380px`、半透明圆角背景 + 边框 + 阴影），`pointer-events:none` 保留，不再遮挡地图操作与视野。
3. **框选矩形实时预览（`FloodDepthSimulationDemo.vue`）**：
   - **根因**：`rectangleEntity` 变量声明但从未 `viewer.entities.add` 创建，`setRectangle` 直接 return，预览矩形从不显示。
   - **修复**：在 `onMounted` 创建 polygon 实体（`heightReference: CLAMP_TO_GROUND` 贴真实地形，青色半透明 + 亮青描边，默认 `show:false`）；`MOUSE_MOVE` 分支已存在（`setRectangle(normalizedRectangle(firstCorner, cursor))`），实体创建后移动鼠标即实时刷新待绘矩形。
4. **默认相机聚焦（`FloodDepthSimulationDemo.vue`）**：`DEFAULT_VIEW_RECTANGLE`（75~140E/0~60N）覆盖过大，框选拖拽即跨越数十度导致深度图采样爆炸崩溃；场景就绪后 `flyTo(116.30,39.86,116.42,39.94)` 对齐默认四至输入，框选范围与采样耗时回归合理区间。

**验证结果**：

- `npm run build`（vue-tsc + vite）EXIT=0，日志 `/tmp/build_ts84.log`。
- headless SwiftShader flood-inundation（`/tmp/verify_old_box_621.js`）：盒体四角 `[85.28488/28.11540, 85.28419/28.57317, 85.60581/28.11540, 85.60650/28.57317]` 与 EXTENT `[85.2844047, 28.1153162568, 85.6062847, 28.5734562568]` 完全吻合（误差 <0.001°），盒体 dims 31559×50773m，零 JS 错误。
- headless SwiftShader 新案例（`/tmp/verify_fix_621.js`）：矩形实体已创建（`hasHeightRef=true`）；框选拖动实时预览矩形动态更新（PREVIEW_RECT 位置随鼠标变化）；操作提示为 270×36 非全屏小条；开始模拟后模拟盒体 SIM_BOX（116.34399~116.37289E / 39.89155~39.90638N）与所绘矩形 PREVIEW_RECT 完全一致，零 JS 错误。

## V6.1.1 洪水模拟地形对齐与就绪提示阻塞修复

**目标**：修复用户反馈的两个问题——① flood-inundation 加载真实地形后，深度图盒体高程区间（固定 4300~5800m）与真实那曲地表（采样 1249~6994m）不对齐，盒体悬浮/嵌入真实地形，覆盖范围错误；② flood-depth-simulation 案例启动后「场景已就绪：输入四至或框选范围生成深度图。」全屏遮罩常驻拦截地图鼠标操作，导致无法框选/点击。

**实施内容**：

1. **flood-inundation 高程自动对齐真实地形**（`FloodInundationDemo.vue`）：
   - 新增 `alignToRealTerrain()`：`loadWorldTerrain` 成功后对 `EXTENT` 做 33×33 网格 `sampleTerrainMostDetailed` 采样，取真实高程 min/max，自动写入 `ui.minElevation/maxElevation = floor(min-100) ~ ceil(max+100)`，并短暂提示「已按真实地形对齐：xxm ~ xxm」；采样失败则保留默认范围并提示。
   - 盒体 `relativeToZ/thickness` 由 `minElevation/maxElevation` 计算，对齐后盒体恰好包裹真实地形起伏，深度图模拟覆盖范围与真实地形区域一致。
2. **新案例就绪提示不再阻塞**（`FloodDepthSimulationDemo.vue`）：
   - `.status-mask` 增加 `pointer-events: none`，即使提示存在也不拦截地图鼠标操作（flood-inundation 同步修改保持一致）。
   - 「场景已就绪」提示改为 `window.setTimeout(3000)` 后自动清空 `statusMessage`，不再常驻全屏遮罩；`onBeforeUnmount` 不依赖该定时器清理（回调内已做 viewer 存活判断）。

**验证结果**：

- `npm run build`（vue-tsc + vite）EXIT=0，日志 `/tmp/build_ts80.log`。
- headless SwiftShader 回归 flood-inundation（`/tmp/verify_flood_old2.js`）：地形加载后 `minElevation=1149`、`maxElevation=7094`（真实采样 1249~6994m 对齐生效），「已按真实地形对齐」提示短暂出现后消失，开始模拟变「停止模拟」，点击地图可更换水源点（(0.0000, 0.4052)），遮罩消失、零 JS 错误。
- headless SwiftShader 新案例（`/tmp/verify_flood_depth2.js`、`verify_flood_depth3.js`）：就绪提示出现但地图点击不受阻（`pointer-events: none` 生效），3 秒后遮罩自动消失，框选按钮可点；填四至生成深度图约 13 秒完成（SwiftShader 采样耗时），结果面板正常出现，零 JS 错误。

## V6.0 洪水淹没模拟新案例：GPU 双缓冲流体模拟 + 光线步进水渲染

**目标**：参考 GitHub `chendingwei364/flood`（Cesium flood earthsdk）案例，新增「洪水淹没模拟」案例。深度图采用用户上传的 1024×1024 RGB 深度图（灰阶 1~255），四至 `[85.2844047, 28.1153162568, 85.6062847, 28.5734562568]`（西藏方向约 30km×51km）；支持鼠标选择水源点（起始点）与全部详细参数设置。

**调研结论**（`/tmp/flood_index.js`，1640 行）：参考项目核心为「4 个 ComputeCommand 双缓冲 GPU 流体模拟 + 1 个 BoxGeometry 光线步进渲染」：

- 1024×1024 RGBA **FLOAT** 纹理 A/B 存 `(terrainElevation, waterDepth)`，C/D 存四方向 `OutFlow`；BufferA/C 更新水位、BufferB/D 更新流量，两组 ping-pong。
- 水位更新：`waterDepth = height - totalOutFlow + totalInFlow`，水源半径内叠加 `waterAddRate`，再扣 `evaporationRate`；流量守恒：四方向流出 `max(0, (terrain+water)_center - (terrain+water)_neighbor)` 并做 `attenuation*oOutFlow + strenght*nOutFlow`，总量超 `minTotalFlow` 才保留、超水位则等比裁剪。
- 渲染 pass：`BoxGeometry(1×1×1)` + `modelMatrix = ENU×RotX(90°)×Scale(width, thickness, height)`；片元 shader 逐像素光线步进（射线穿盒求水面/地形交点，`getHeight` 用 `p.xz+0.5` 采样水位纹理），浅/深水色按 `waterDepth` smoothstep 混合，水面法线反射高光 `spec=pow(dot,20)`。
- 交互：`scene.pickPosition` 拾取 → `(lon-minLon)/(maxLon-minLon)`、`y=1-(lat-minLat)/(maxLat-minLat)` 归一化为水源 uv；`setDam` 模式下点击两点生成挡水墙（`intersectsDam` 判 uv 距闸段 <0.001）。

**实施内容**（新增 `src/cases/flood-inundation/`）：

1. `depth-map.webp`：从 `.monkeycode-tmp-files/dd13c159-rectangle-depth-map-2.webp` 拷贝至案例目录并随 Vite 打包，`Resource.fetchImage` 加载为 `HTMLImageElement` 后作为 `heightMap` Texture（RGBA/UNSIGNED_BYTE、`flipY:false`、LINEAR+REPEAT）。深度图纹理北向上（v=0 顶=北），与盒局部 z（scale 后 z 增向南）及 getDamPos 的 `y=1-归一化纬度` 全链路自洽，无需翻转。
2. `FloodInundationDemo.vue`：忠实移植 CustomPrimitive（标准 Cesium API：`ComputeCommand`/`DrawCommand`/`VertexArray.fromGeometry`/`ShaderProgram.fromCache`/`RenderState.fromCache`/`VertexArray`），FluidDemo 类创建 4 个 Compute + 1 个 Draw primitive 并 `scene.primitives.add`；`scene.postRender` 每帧推进 `frame`（整数，供 shader `iFrame`）；`destroy()` 移除全部 primitive/entity 并显式销毁 5 张纹理。
3. 交互：LEFT_CLICK → `scene.pickPosition` → 归一化 uv → `sim.setWaterPos` + 地图红点标记；勾选「绘制水闸」后连点两点生成闸墙（CallbackProperty 墙 + `damHeight` 归一化高度）；开始/停止模拟按钮、重置水源按钮。
4. 参数面板：演进区域（最低/最高高程）、流体参数（水流增加速率/水源半径/衰减/强度扰动/最小水流/初始水位/光线步进次数/蒸发率/透明度）、浅/深水色、水闸高度与开关。uniformMap 闭包实时读参数对象，运行中即时生效；初始水位与高程变更自动重建模拟。
5. `icon.jpg`：用 numpy+PIL 将深度图灰阶伪彩色（深蓝→青→浅蓝→白 洪水色带）裁剪 16:9 生成 1280×720（quality 88，68KB）。
6. 注册 `src/cases/index.ts`（water 分类）+ `vite.config.ts` CRESIUM_SYMBOLS 补充 `BlendEquation/BlendFunction/CullFace/Matrix3/Resource/GeometryPipeline`。

**验证结果**：

- `npm run build`（vue-tsc + vite）EXIT=0，日志 `/tmp/build_ts76.log`。
- headless SwiftShader：首页「水面效果」分类找到卡片→打开案例→控制面板/地图容器/Bing 底图正常→点击「开始模拟」按钮变为「停止模拟」且无 JS/GL 错误（模拟初始化成功）。
- 期间修复两个问题：① Cesium 1.144 的 `Texture` 的 `source` 直接传 `HTMLImageElement`（`{image}` 对象会触发 `texImage2D overload resolution failed`）；② Cesium 1.144 仅支持 WebGL2 GLSL 300 es，无 GLSL 100 自动转换——全部 shader 改写：`texture2D`→`texture`、`gl_FragColor`→`layout(location=0) out vec4 outputColor`、`attribute`/`varying`→`in`/`out`。
- 注：SwiftShader 软件渲染下 4 个 1024×1024 RGBA32F compute pass + 180 步光线步进每帧 >100s，`page.screenshot` 无法完成帧合成，效果（洪水漫延动画、水面反光）以真实 GPU 浏览器验收；SwiftShader 仅确认无 JS/GL 错误、shader 编译通过、模拟启动状态正确。

## V5.6 钻孔建模与体素地层案例卡片 icon 替换为用户上传图片

**目标**：① 三维地层-钻孔建模案例卡片 icon 采用用户上传的 image-1；② 三维体素-地层体素数据案例卡片 icon 采用用户上传的 image-2。

**实施内容**：

1. 视觉分析确认对应关系：image-1（`75519f14-image-1.webp`）为钻孔建模场景截图（含 ZK01~ZK19 钻孔标记、分层地层块、右侧面板）；image-2（`c244761c-image-2.webp`）为体素地层场景截图（棕褐/绿色/深灰三分层体素块、无钻孔）。
2. 用 PIL 将两张 webp 转为 JPEG（quality 88）并覆盖：
   - `src/cases/drill-strata/icon.jpg` ← image-1（1237×654，230KB）
   - `src/cases/voxel-strata/icon.jpg` ← image-2（1237×653，212KB）
3. 两个 `index.ts` 均以 `import icon from './icon.jpg'` 引用，文件覆盖后无需改代码。

**验证结果**：

- `npm run build`（vue-tsc + vite）EXIT=0，日志 `/tmp/build_ts75.log`。
- headless 首页「数据可视化」分类展开确认两张卡片 icon 引用分别指向 `/src/cases/drill-strata/icon.jpg` 与 `/src/cases/voxel-strata/icon.jpg`（Vite 打包后路径正确）。

## V5.5 钻孔案例地层渲染回归体素：每层一个 VoxelPrimitive 光线步进

**目标**：用户明确要求「三维地层-钻孔建模还是需要用体素来实现」。将 V5.2 引入的 BoxGeometry 实例化渲染回退为体素（`VoxelPrimitive` 光线步进）方案，并完整保留 V5.2~V5.4 的所有功能（地层范围贴合钻孔外扩、垂向凸出展示、展开间距、分层显隐、岩芯钻孔、拾取高亮、步长网格）。

**实施内容**（`src/cases/drill-strata/DrillStrataDemo.vue`）：

1. 渲染引擎改为「每层一个 VoxelPrimitive」共 5 个体素体：每个 provider 生成 `gx×gy×gz` 的 VEC4/FLOAT32 颜色数据，仅本层归属体素 alpha=1 并写岩性色，其余 alpha=0；纹理数组 z 方向与语义深度翻转（纹理 zi=0 对应底部，语义 z=gz-1-zi）。
2. `shapeTransform` 从 provider 读取（Cesium 实现：`provider.shapeTransform ?? IDENTITY`，非 VoxelPrimitive 构造参数）：`shapeTransform = T(0,0,LIFT-h/2) * S(bodyWidth, bodyDepth, SCALE_Z)`，实现体素体尺寸映射与 LIFT 垂向凸出；`modelMatrix = ENU * T(0,0, i*spacing)` 承载展开间距（`VoxelPrimitive.modelMatrix` 运行时可写，但 TS 类型标为 readonly，需 `as unknown as { modelMatrix: Matrix4 }` 绕过）。
3. 每个地层层独立 `CustomShader` 实例（独立 `u_selectedTile/u_selectedSample` uniform），shader 内光照 + 命中体素高亮 mix 黄色，未用 discard（遵守体素管线 D3D11 约束）。
4. 拾取改为 `scene.pickVoxel`：命中后 `layerPrimitives.indexOf(picked.primitive)` 定位层，sampleIndex 反查纹理 z → 深度 `((gz-1-tz)+0.5)/gz*SCALE_Z`；删除原 BoxGeometry 高亮框（高亮已内置于 shader）。
5. 展开间距/分层显隐/整体显隐/岩芯钻孔（CylinderGeometry 实例化）/ZK 标记/步长网格（gridForStep 重建）逻辑全部保留；面板说明更新为「5 个体素立方体光线步进渲染」。
6. `buildLayerMap`/`idwDepth`/`computeExtent`/`bodyWidth`/`bodyDepth`/`LIFT` 等范围与插值逻辑原样保留（V5.3/V5.4 修正不被回退）。

**验证结果**：

- `npm run build`（vue-tsc + vite）EXIT=0，日志 `/tmp/build_ts74.log`。
- headless SwiftShader 状态读取确认：5 个 `VoxelPrimitive` 全部 show=true、stepSize=1.5、dims 12×12×16，`shapeTransform` 平移 z=-15（=LIFT-h/2）、5 层 modelMatrix 逐层上移（世界 z 分量每层差约 1.28=2m 在 up 方向投影）、19 个 ZK 钻孔 Entity、相机 1572m 视角正确。
- 注：SwiftShader 软件光栅下 5 个体素体光线步进渲染帧耗时 >200s（V2.2 记录单 voxel 约 1 FPS，5 层叠加远超），`page.screenshot`/`scene.render`+`readPixels` 均无法完成帧合成，无法截图与读像素验证；此属软件渲染固有极限（与 voxel-strata 案例单体素可在真实 GPU 流畅渲染同理），体素渲染是否达标应以真实 GPU 浏览器验收，SwiftShader 仅确认无 JS/GL 错误与管线配置正确。

## V5.0 钻孔地层体素案例与排查清单融入首页

**目标**：① 三维体素-地层体素数据案例卡片 icon 换用上传的 image-1（用户确认暂未上传，本次不做）；② 新增钻孔数据驱动、可显隐/可展开合并的三维地层体素案例；③ 将 deepseek_html_20260830_e188a6-1.html（CesiumJS 场景卡顿排查 20 条清单）按系统深色风格融入首页供查看。

**实施内容**：

1. 新建案例 `src/cases/drill-strata/`（id `drill-strata`，title「三维地层-钻孔建模」，tag「三维地层」，分类 data）：
   - `DrillStrataDemo.vue`：核心组件（392 行）。
   - `index.ts`：注册 DemoCard；`icon.jpg` 复用 voxel-strata 教程配图。
2. 钻孔数据模拟与插值：
   - `makeBoreholes()` 生成 19 处钻孔（5×4 勘探网去除 1 孔 + 随机抖动），每孔 5 层底界深度（基础深度 + 正弦起伏 + 随机扰动，单调化）。
   - `idwDepth()` 反距离加权（p=3）插值网格每点的 4 个地层分界面 → `buildLayerMap()` 预计算 28×28×48 体素层归属。
   - 每层一个 `VoxelPrimitive`（共 5 层），`VoxelContent.fromMetadataArray` 写入 VEC4/FLOAT32 颜色，非本层体素 alpha=0；CustomShader 中 `alpha<0.01` 直接 discard，保留岩性照度。
3. 交互能力：
   - 整体显隐：统一控制所有层 `show`。
   - 分层显隐：每层一个 toggle（点击切换 `primitive.show`），层色点标识。
   - 展开/合并：`spacing` 滑块（0~90m）实时改写每层 `modelMatrix`（`ENU * scale * Translation(0,0,k*spacing)`），合并即 0 回归原位，无需重建数据。
   - 拾取：MOUSE_MOVE → `scene.pickVoxel`，由返回 primitive 映射层位，显示岩性/深度/层号（左上信息面板）。
   - 钻孔标注：19 个 Entity 点（金色）+ 标签 ZK01~ZK19。
4. `vite.config.ts` CESIUM_SYMBOLS 补充 `Entity` / `PointGraphics` / `LabelGraphics` / `PointPrimitive`（钻孔标注与后续 entity 用法）。
5. `src/cases/index.ts` 注册 `drillStrataCase`，案例总数 80 → 81（data 13 → 14）。
6. 排查清单融入首页：
   - 新建 `src/components/PerfChecklistDoc.vue`：数据驱动渲染 20 条排查清单（4 节 + 速查表 + 建议），深色风格（背景渐变 #0b1a33、卡片、代码块 #0d1830、现象/原因/排查/方案四色标签、锚点导航平滑滚动、返回按钮），共 11 个代码块。
   - `src/App.vue`：顶栏新增 `Notebook` 图标入口（title「Cesium 卡顿排查清单」），点击打开全屏文档视图 `PerfChecklistDoc`，支持返回案例库。

**修复记录**：

- `import type { Cartesian2 }` 是 type-only，编译后被移除，运行时 `new Cartesian2` 抛 `Cartesian2 is not defined`；改用 value import。
- `VoxelPrimitive.modelMatrix` TS 类型为只读，动态更新需断言 `(primitive as unknown as { modelMatrix: Matrix4 }).modelMatrix`。
- entity `label` 无独立 `position` 字段（位置由 entity.position 决定），标签偏移用 `pixelOffset` + `VerticalOrigin.BOTTOM`/`HorizontalOrigin.CENTER`。
- 首次 build EXIT=1（上述 TS 错误），修复后 EXIT=0。

**验证结果**：

- headless Chromium：
  - 首页「在线案例库 - 共 81 个」；Notebook 入口打开清单页：20 条 / 5 节 / 速查表 5 行 / 11 代码块，锚点滚动与返回正常。
  - 数据可视化分类 14 卡片含「三维地层-钻孔建模」；打开后 `primitives=6`（5 层 voxel + 场景默认）、钻孔标注 entity 19 个；展开间距 0→70、分层点击隐藏、整体显隐切换均无 pageerror/console error。
- `npm run build`（vue-tsc + vite）EXIT=0，日志 `/tmp/build_ts64.log`。

## V4.9 体素案例参数面板右移与地层信息面板左上独立显示

**目标**：将「三维体素-地层体素数据」案例的参数调整面板布局与其他案例统一（右侧），并把鼠标悬停地层的信息面板独立显示在界面左上侧。

**实施内容**：

1. `src/cases/voxel-strata/VoxelStrataDemo.vue`：
   - `.control-panel` 由 `left: 12px` 改为 `right: 12px`，参数面板移至界面右侧（参考 builtin-water 等案例的右侧面板定位）。
   - `.pick-box` 从参数面板内拆出，改为独立 `.pick-panel` 定位 `top: 12px; left: 12px`，标题「地层信息」，含岩性/深度/层号三行；仅当 `pickedInfo` 非空时显示。
   - 删除原 `.pick-box` 样式，新增 `.pick-panel` / `.pick-title` / `.pick-row` 样式。

**验证结果**：

- headless Chromium（视口 1440×900）：控制面板定位 `top=228, left=1067, 右缘=1331`（贴右侧 12px），8 个 slider 齐全；未悬停时 `.pick-panel` 数量为 0（隐藏）；`scene.primitives=1`，无 pageerror。
- `npm run build`（vue-tsc + vite）EXIT=0，日志 `/tmp/build_ts62.log`。

## V4.8 三维体素-地层体素数据案例

**目标**：新增数据可视化分类下的「三维体素-地层体素数据」案例，参考 VoxelPrimitive 教程，手写 `VoxelProvider` 加载地层体素数据，并支持网格密度、分层深度、体块尺寸、步长等参数实时调整。

**实施内容**：

1. 新建案例目录 `src/cases/voxel-strata/`：
   - `index.ts`：id 为 `voxel-strata`，title「三维体素-地层体素数据」，tag「体素渲染」，分类归入 `data`。
   - `icon.jpg`：从 cesium.xin 教程配图（`voxel-picking-1024x564.jpg`，26767B）下载作为卡片图标。
   - `VoxelStrataDemo.vue`：案例主体，共 299 行。
2. `vite.config.ts`：`CESIUM_SYMBOLS` 补充 Voxel 相关符号（`VoxelContent` / `VoxelPrimitive` / `VoxelShapeType` / `MetadataType` / `MetadataComponentType`），解决 dev 下 cesium shim 缺失。
3. `src/cases/index.ts`：注册 `voxelStrataCase`，总案例数 79 → 80（data 分类 12 → 13）。

**VoxelProvider 手写实现要点**：

- 自定义 `StrataVoxelProvider` 继承 `Cesium.VoxelProvider`：`shape` 为 `VoxelShapeType.BOX`，默认网格 8×8×25（X/Y/Z）。
- 颜色元数据 `VoxelMetadata`（VEC4 / FLOAT32）经 `VoxelContent.fromMetadataArray` 写入体素数据，每个单元按深度分层赋予砂土/粉质黏土/密实砂砾石/风化泥岩/泥岩等岩性颜色，同时写入「岩性代码」标量元数据（UINT8）供拾取返回岩性名。
- `VoxelPrimitive` 挂载 `customShader`（分层岩性着色 + `voxelColor` 混合），并启用 `nearestSampling`。
- 落地北京（116.39°E / 39.91°N，高程 500m），经 `Transforms.eastNorthUpToFixedFrame` 建立 ENU 局部坐标。
- 拾取：`scene.mouseMove` → `scene.pickVoxel`，返回 `fsInput.voxel.tileCoords` / `fsInput.metadata.color`，映射岩性代码显示弹层。`pickVoxel` 与 `fsInput.metadata` 由 voxel 管线自动注入，CustomShader 构造无需 metadata 字段。

**控制面板**：

- 网格密度 X/Y：4~16 step2（实时重建）。
- 地层分层数：8~40 step2。
- 砂土层厚度（格）：1~25；黏土埋深（格）：10~60。
- 水平范围：200~3000m；垂直厚度：100~800m。
- 步长：0.2~2（实时改 `primitive.stepSize`，不重建）。
- 显示开关：实时改 `primitive.show`。

**修复记录**：

- 重建时曾出现 `scene.primitives.remove()` 与手动 `destroy()` 双重销毁抛 DeveloperError：`PrimitiveCollection.remove` 内部已 destroy，删除后不再手动调用 `destroy()`。
- 编辑期间 HMR 报 `Unexpected token`：rebuild 函数后残留了带调试日志的孤儿重复代码块，已清除。
- dev 下 headless 首轮点击案例卡片超时：HMR 语法错误导致模块编译失败，修复后正常。

**验证结果**：

- `npm run build`（vue-tsc + vite）EXIT=0，日志 `/tmp/build_ts61.log`。
- headless Chromium：数据可视化分类卡片 13 个，含「三维体素-地层体素数据」，icon 1024×564；打开后 `scene.primitives=1`，8 个 slider 齐全；依次调整网格 X/Y、层数、砂土厚、水平范围、垂直厚度、步长后重建正常、`primitives=1`，无 pageerror/console error。
- 拾取验证：SwiftShader 下 `pickVoxel` 依赖 GPU 拾取纹理未触发（环境限制，浏览器真机可用），逻辑与教程一致。
- dev（localhost:5173，日志 `/tmp/dev_ts60.log`）与 preview 均返回 200。

## V4.7 地图卷帘控件卡片图标更换

**目标**：地图卷帘控件（widget-map-split）案例卡片 icon 采用上传的 image-1。

**实施内容**：

1. 上传图片 `.monkeycode-tmp-files/38a6981f-image-1.webp` 复制为 `src/cases/widget-map-split/icon.webp`。
2. `src/cases/widget-map-split/index.ts` 图标引用由 `./icon.svg` 改为 `./icon.webp`。

**验证结果**：

- `npm run build`（vue-tsc + vite）EXIT=0，日志 `/tmp/build_ts59.log`。
- headless Chromium：界面控件分类下「地图卷帘控件」卡片图标加载 `icon.webp`，naturalWidth 1237 × naturalHeight 653，无 pageerror。

## V4.6 地图卷帘控件对比底图改为高德地图

**目标**：地图卷帘控件（widget-map-split）左侧对比底图采用高德地图，移除 ArcGIS 相关服务。

**实施内容**：

1. `src/cases/widget-map-split/WidgetMapSplitDemo.vue`：
   - import 移除 `ArcGisMapServerImageryProvider`，改用 `UrlTemplateImageryProvider`。
   - `setCompare` 对比底图 URL 由 `services.arcgisonline.com` World_Street_Map/World_Imagery 改为高德瓦片服务：
     - 街道图：`https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}`
     - 影像图：`https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=6&x={x}&y={y}&z={z}`
     - `subdomains: ['1','2','3','4']`，`maximumLevel: 18`。
   - 因本 Cesium 版本 `UrlTemplateImageryProvider` 为构造函数式 API（无 `fromUrl` 静态方法），使用 `new UrlTemplateImageryProvider({ url, subdomains, maximumLevel })`。
   - 下拉选项文案更新为「高德街道图 / 高德影像图 / 无」，提示文案同步说明左侧为高德街道/影像图。
2. 全项目 `grep -i arcgis` 无任何残留引用。

**验证结果**：

- `npm run build`（vue-tsc + vite）EXIT=0，日志 `/tmp/build_ts58.log`。
- headless Chromium 打开「地图卷帘控件」案例：高德 autonavi 瓦片请求 53 次，ArcGIS 请求 0 次，无 pageerror，卷帘分割正常。

## V4.5 导航菜单细化重归类与顶栏功能实现

**目标**：

1. 将原 6 类功能导航菜单细化为 11 类并重新归类全部案例。
2. 右上标题改为「在线案例库 - 共 X 个」，X 为实时案例总数。
3. 左下「持续更新中 · 2025」更新为「持续更新中 · 2026」。
4. 为右上三个原本无功能的图标（Document、Setting、头像 C）实现实际功能。

**实施内容**：

- 新分类体系（`src/cases/index.ts` categories 定义，Element Plus 图标）：
  - `effects` 三维特效（TrendCharts）：dynamic-wall、radar、radar-scan-entity、radar-scan-primitive、water-wave、volume-cloud（6）。
  - `weather` 天气特效（PartlyCloudy）：weather-rain、weather-snow、lightning、weather-fog、integral-height-fog、wind-layer-3d（6）。
  - `particles` 粒子特效（Star）：fire-particles、smoke-particles、explosion-particles、explosion-boom（4）。
  - `water` 水面效果（Drizzling）：builtin-water、dynamic-volume-water、water-polygon、water-reflection、water-depth-heat（5）。
  - `draw` 标记标绘（Location）：draw-export、point-create、polyline-create、polygon-create、point-markers、html-popup（6）。
  - `measure` 空间测量（ScaleToOriginal）：distance/height/area/bearing/triangle 五类量测（5）。
  - `analysis` 空间分析（DataLine）：点/线/面缓冲区、比例符号面、可视域、通视、剖面、填挖方、地形开挖、深度图提取、影像对比（11）。
  - `data` 数据可视化（Grid）：ECharts、信息发送、模拟迁徙、PM2.5、海量线/面/立方体/文字、点聚合、表格点位、热力图、三维热力图（12）。
  - `tiles` 三维数据加载（Box）：3DTiles 加载/压平/大雁塔、本地矢量、GeoServer 加载/图层、地形显示与夸张（7）。
  - `scene` 场景示例（Compass）：Cesium 初始化、三维场景演示、相机参数、鼠标位置/提示、初始化自转、地球自转（7）。
  - `widgets` 界面控件（Setting）：罗盘、右键菜单、距离比例尺、鹰眼、加载遮罩、位置栏、地图卷帘、气泡、提示浮层、缩放控制器（10）。
  - 合计 79 个案例，分类 id 变更通过脚本统一重写各案例 `src/cases/<id>/index.ts` 的 `category` 字段（旧 `terrain`/`tools` 分类废弃，无残留）。
- 补注册漏收案例：`src/cases/widget-map-split`（地图卷帘控件，含组件与 icon.svg）原本未加入 demos 数组，本轮补注册，案例总数 80→79 中的 widgets 分类由 9 增至 10。

  > 注：案例目录实际有 index.ts 的为 79 个，全部注册并计入分类统计；「共 X 个」显示 demos.length 实时值。

- `src/App.vue` 右上 `topbar-actions`：
  - `version-chip` 文案改为「在线案例库 - 共 {{ totalDemos }} 个」，`totalDemos` 由 demos.length 计算。
  - Document 图标（title=使用帮助）点击打开「使用帮助」模态框：浏览/演示/搜索排序/新增案例说明。
  - Setting 图标（title=界面设置）点击打开「界面设置」模态框：默认排序单选（最新收录/默认顺序，联动 sortNewest）+ 显示更新时间开关（`showUpdatedAt`，关闭时卡片徽标显示「可在线演示」）。
  - 头像 C（title=关于案例库）点击打开「关于」模态框：已收录案例数、可在线演示数、功能分类数统计 + 技术栈与版权说明。
- `sidebar-footer` 文案「持续更新中 · 2025」更新为「持续更新中 · 2026」。
- 模态框实现：自写轻量 modal（未引入 ElDialog），样式追加至 `src/style.css`（`.modal-mask`/`.modal-panel`/`.setting-row`/`.toggle`/`.switch-button`/`.stats-grid` 等），模板经 `<Teleport to="body">` 渲染。

**验证结果**：

- `npm run build`（vue-tsc + vite）EXIT=0，日志 `/tmp/build_ts56.log`（built in 55.98s）。
- headless Chromium 验证：版本徽标「在线案例库 - 共 79 个」；侧栏 11 个分类及其计数 6/6/4/5/6/5/11/12/7/7/10 与设计一致；「持续更新中 · 2026」生效；三个图标分别弹出使用帮助/界面设置/关于模态框；设置开关可切换且卡片徽标联动；widgets 分类下「地图卷帘控件」卡片可打开并正常渲染 Cesium 画布，无 pageerror。

## V4.4 数据可视化案例卡片图标更新

**目标**：数据可视化分类下信息发送效果、模拟迁徙效果、PM2.5 分布三个案例卡片图标分别更换为上传图片。

**实施内容**：

- `5b6a00b3-image-1.webp` 复制为 `src/cases/chart-message/icon.webp`，`index.ts` 改引 `./icon.webp`。
- `37aab38e-image-2.webp` 复制为 `src/cases/chart-migrate/icon.webp`，`index.ts` 改引 `./icon.webp`。
- `9f4e3ffb-image-3.webp` 复制为 `src/cases/chart-pm25/icon.webp`，`index.ts` 改引 `./icon.webp`。

**验证标准**：

- 三个案例卡片图标均以 webp 正常加载（naturalWidth/naturalHeight 有效）。
- TypeScript 类型检查与 Vite 生产构建通过（EXIT=0）。
## V4.3 原样例文案清理与底图亮度恢复

**目标**：
1. 去除信息发送/模拟迁徙/PM2.5 案例提示面板中「参考 cesium-chart 仓库 xx 样例」类原样例引用信息，仅保留功能说明。
2. 三个案例底图恢复正常亮度显示（此前为突出 ECharts 发光效果压暗为 brightness 0.35/saturation 0.2/contrast 1.1）。

**实施内容**：

1. `chart-message`/`chart-migrate`/`chart-pm25` 三个 Demo 的 `hint` 文案删除「参考 cesium-chart 仓库 message/migrate/pm2.5 样例：」前缀，保留效果功能描述。
2. 三案例 `loadBingImagery(viewer, sceneCallbacks, (layer) => { brightness/saturation/contrast 调整 })` 改为 `loadBingImagery(viewer, sceneCallbacks)`，底图亮度恢复默认 1。

**验证标准**：

- 三个案例 imageryLayer 的 brightness/saturation/contrast 均为默认 1；案例无报错遮罩，ECharts 叠加层正常渲染。
- TypeScript 类型检查与 Vite 生产构建通过（EXIT=0）。
## V4.2 cesium-chart 案例运行报错修复与比例符号面问题修复

**目标**：
1. 修复数据可视化分类下信息发送/模拟迁徙/PM2.5 三个案例运行时抛 `Cannot read properties of undefined (reading 'slice')`。
2. 比例符号面案例：卡片图标更换为上传图片；边框颜色与宽度参数无效；数值标签勾选无效。

**根因定位**（通过 headless Chromium + playwright 复现，捕获 Demo onMounted try/catch 中吞掉的异常堆栈）：

- 三个 cesium-chart 案例报错栈指向 `createSeriesData` → `getCoordSysDimDefs`：`registeredCoordSys.dimensions.slice()`。`CoordinateSystem.get('GLMap')` 返回注册的 GLMapCoordSys **类**，而移植时 `dimensions` 只声明为**实例属性**，类上为 undefined，故 `undefined.slice()` 崩溃。原版 cesium-chart 为 `static dimensions`。

**实施内容**：

1. `src/lib/cesium-chart.ts`：`GLMapCoordSys` 增加 `static readonly dimensions = ['lng', 'lat']`（类属性，供 echarts `getCoordSysDimDefs` 读取），同时保留实例 `dimensions`。
2. 比例符号面图标：上传的 `187ea9b1-image-1.webp` 复制为 `src/cases/proportional-area/icon.webp`，`index.ts` 改引 `./icon.webp`。
3. 比例符号面边框：Cesium 贴地 Polygon（GroundPrimitive）的 `outline` 不生效，改为每个符号额外创建 **Polyline 实体**绘制外圈边框（positions 闭合），宽度/颜色由 Polyline 控制，`showBorder` 控制增删——边框颜色、宽度、开关均实时生效。
4. 比例符号面数值标签：原 `style: 1` 在 Cesium 1.144 中为 `LabelStyle.OUTLINE`（只显示描边），深色描边在深色底图上不可见；改为 `LabelStyle.FILL_AND_OUTLINE`（白字深边）+ 加粗字体 + 半透明背景，勾选/取消实时增删标签实体。
5. `vite.config.ts` 的 `CESIUM_SYMBOLS` 补充 `LabelStyle`（dev 全局 shim 需覆盖新用到的 cesium 符号）。

**验证标准**：

- 三个 cesium-chart 案例打开无遮罩报错（statusMask=null），ECharts 叠加层正常渲染（容器内出现 canvas）。
- 比例符号面：初始 8 面 + 8 边框 + 8 标签；关/开边框、改边框颜色/宽度、关/开标签，实体与样式均实时联动。
- TypeScript 类型检查与 Vite 生产构建通过（EXIT=0）。

**稳定规则**：自定义坐标系注册给 echarts 时，供 `CoordinateSystem.get(name)` 读取的 `dimensions`/`getDimensionsInfo` 必须是**类静态成员**，实例属性不会被 `getCoordSysDimDefs` 读取；cesium 地面 Polygon 的 outline 不生效，边框一律用 Polyline 实体；Label 文字样式用 `LabelStyle.FILL_AND_OUTLINE`（2）而非 1。
## V4.1 cesium-chart 样例案例与比例符号面

**目标**：
1. 参考 CesiumChina/cesium-chart 仓库（Cesium+ECharts 桥接库），对仓库 message/migrate/pm2.5 三个重点样例各生成一个新案例。
2. 在现有「点/线/面缓冲区」案例基础上新增「比例符号面」案例，以面符号面积或半径表示数值属性，支持各类参数设定。

**实施内容**：

1. 桥接库移植 `src/lib/cesium-chart.ts`：将 cesium-chart 的 `ChartLayer` + `GLMapCoordSys` 移植为本地库，适配 echarts 6 与 cesium 1.144——`registerCoordinateSystem('GLMap')` 以经纬度实时投影到 Cesium 画布坐标（`scene.cartesianToCanvasCoordinates`），`registerAction('GLMapRoam')` 触发布局重算；相机 `changed` 事件触发 `chart.resize()` 使静态系列也随相机跟随。
2. 新案例（均 category=data，tag=cesium-chart，独立 chunk）：
   - `chart-message` 信息发送效果：各省流动箭头线向北京市发送信息 + 涟漪散点 + 目标大头针；
   - `chart-migrate` 模拟迁徙效果：北京/上海/广州三大枢纽 Top10 双线层（白点尾迹 + 飞机符号）+ 涟漪散点 + 可开关图例；
   - `chart-pm25` PM2.5 分布：全国 190 城市散点（大小与浓度成正比）+ 浓度 Top6 涟漪高亮。
   - 底图用 Bing 街道图并调暗（brightness 0.35/saturation 0.2），相机 `setView` 至全中国范围，突出 ECharts 发光效果。
3. `proportional-area` 比例符号面案例（category=analysis，tag=缓冲区）：载入 8 个示例城市（数值模拟人口），圆面半径按「面积正比（√(value×面积系数/π)）」或「半径正比（value×半径系数）」计算，支持最小/最大半径钳制、圆滑度、填充色/透明度/边框/数值标签等参数，参数变化实时重建全部符号；支持输入数值并点击地图添加符号。

**验证标准**：

- 数据可视化分类下新增信息发送/模拟迁徙/PM2.5 三个案例，空间分析分类下新增比例符号面案例。
- 各案例展示 ECharts 叠加层并随相机移动实时投影跟随；比例符号面随参数变化实时更新面大小与样式。
- TypeScript 类型检查和 Vite 生产构建通过（EXIT=0）。

**稳定规则**：Cesium+ECharts 叠加层统一使用 `src/lib/cesium-chart.ts` 的 `ChartLayer`（`new ChartLayer(id, viewer)` + `setOption`），禁止直接新建多个 echarts 全量实例；echarts 全量打包约 620KB，属预期体积。
## V4.0 鹰眼视野范围框与缩放级别、罗盘/鹰眼图标更新

**目标**：
1. 「罗盘控件」案例卡片 icon 采用上传的 `0623f44d-image-1.webp`、「鹰眼小地图控件」案例卡片 icon 采用上传的 `be659f1d-image-2.webp`。
2. 修复鹰眼小地图显示位置不正确的问题。
3. 鹰眼小地图缩放级别应比主地图低 2 级，并标出当前主地图视野范围。

**实施内容**：

1. 图标替换：`src/cases/widget-compass/icon.webp`、`src/cases/widget-hawkeye-map/icon.webp` 采用上传图片副本，两个 `index.ts` 由 `./icon.svg` 改为 `./icon.webp`；鹰眼 `description` 同步更新为街道底图/低 2 级/视野框选说明。
2. 鹰眼定位重构（`src/cases/widget-hawkeye-map/WidgetHawkeyeMapDemo.vue`）：
   - 根因：原 `syncMap()` 用 `pickEllipsoid` 取中心 + `lookAt(target, (0,0,distance))`，distance 为 3D 透视距离直接作为 2D 高度，导致鹰眼定位偏差；
   - 新方案：主相机经 `camera.computeViewRectangle(ellipsoid)` 求当前视野经纬度矩形（求不到时跳过），取中心向四周各扩展 1 倍边长（视野 4 倍 = 缩放低 2 级），纬度 clamp 至 ±85.051°、经度 wrap 至 [-180,180]，以 `miniViewer.camera.setView({ destination: Rectangle.fromDegrees(...) })` 精确 fit 到鹰眼窗口，并 `requestRender()` 强制渲染；
   - 视野范围框：用 `miniViewer.scene.mapProjection.project()`（WebMercator）把主视野矩形与鹰眼扩展矩形的四角转平面坐标，按比例定位叠加在鹰眼上的 `.hawkeye-range` div（黄色 2px 边框 + 半透明填充），随主相机移动实时更新。

**验证标准**：

- 罗盘/鹰眼案例卡片显示上传图标。
- 鹰眼窗显示 Bing 街道图，定位与主图中心一致，缩放比主图低 2 级，黄色矩形框实时框选主图视野。
- TypeScript 类型检查和 Vite 生产构建通过（EXIT=0，vue-tsc 曾报 `miniViewer` 闭包 undefined，已用局部变量 `miniScene` 修复）。

**稳定规则**：鹰眼小地图定位统一使用「主相机 `computeViewRectangle` 取范围 → `Rectangle.fromDegrees` 目标范围 → 迷你相机 `setView`」；2D 鹰眼的缩放级别控制通过扩展目标矩形边长（每 2 倍边长 = 低 1 级）实现。
## V3.99 控件图标更新、鹰眼底图切换与罗盘交互修复

**目标**：
1. 「信息提示控件」卡片 icon 采用上传的 `a2040d2c-image-1.webp`、「缩放控制器控件」卡片 icon 采用上传的 `e6ab0928-image-2.webp`。
2. 鹰眼小地图底图由 ArcGIS 影像切换为 Bing 街道图（与主图同源、无版权拼接问题），并修复 2D 鹰眼视图不显示的根因。
3. 修复罗盘控件内圈（gyro）无法操作的根因，并将内圈视觉还原为参考实现漩涡纹样式。

**实施内容**：

1. 图标替换：`src/cases/widget-tooltip/index.ts`、`src/cases/widget-zoom-controller/index.ts` 均改引 `./icon.webp`，对应 webp 图片为上传副本。
2. 鹰眼街道图：`src/lib/bing.ts` 新增 `createBingRoadImageryProvider()`（`r{quadkey}.png` 街道瓦片，同 subdomains/credit/maximumLevel=19）。
3. 鹰眼修复（`src/cases/widget-hawkeye-map/WidgetHawkeyeMapDemo.vue`）：
   - 移除 ArcGIS `ArcGisMapServerImageryProvider.fromUrl` 异步底图，改用同步 `createBingRoadImageryProvider()`；
   - `syncMap()` 改用 `scene.mapProjection.project()` 将主相机中心点的经纬度换算为 SCENE2D 平面坐标，经 `lookAt` 定位并 `requestRender()` 强制渲染，修复 2D 鹰眼小窗不显示/不同步。
4. 罗盘修复（`src/cases/widget-compass/WidgetCompassDemo.vue`）：
   - 根因：`orbit()` 在 SCENE3D 分支命中 `if (sscc.enableLook) return`，而默认 `enableLook=true`，导致内圈漫游直接返回、无法操作；删除该守卫，仅保留 tilt/rotate 可用性检查；
   - 内圈判定阈值由 `50/145` 提升至 `0.45`，使整个 gyro 圆形区域（半径 13px）都进入 orbit（漫游）模式；
   - 内圈 SVG 替换为参考实现（cesium-widget compass-inner）的漩涡纹路径，外圈 rotation-marker 与参考一致。

**验证标准**：

- tooltip/zoom-controller 案例卡片显示上传图标。
- 鹰眼小窗显示 Bing 街道图并随主相机移动同步中心与缩放。
- 罗盘外圈拖拽旋转航向、内圈拖拽漫游均可用，内圈显示漩涡纹。
- TypeScript 类型检查和 Vite 生产构建通过（EXIT=0）。

**稳定规则**：新增 cesium 运行时符号必须在 `vite.config.ts` 的 `CESIUM_SYMBOLS` 中声明，否则 dev 报 `does not provide an export named`；构建阶段（vue-tsc/vite build）会校验引用符号，务必先杀 dev server 释放内存再构建。
## V3.98 控件案例图标/名称调整与卷帘移除

**目标**：
1. 「加载遮罩控件」名称改为「初始化加载控件」，卡片 icon 采用上传的 image-1（`8b35786d-image-1.webp`）。
2. 「位置信息栏控件」卡片 icon 采用上传的 image-2（`020b4d25-image-2.webp`）。
3. 移除「地图卷帘控件」案例（widget-map-split）。
4. 「气泡弹窗控件」卡片 icon 采用上传的 image-3（`26b2316b-image-3.webp`）。
5. 修复罗盘控件 dev 报错：`does not provide an export named 'HeadingPitchRange'`。

**实施内容**：

- `src/cases/widget-loading-mask/`：写入 `icon.webp`，`index.ts` 的 `title` 改为「初始化加载控件」、description 同步更新，icon 导入改 `./icon.webp`。
- `src/cases/widget-location-bar/icon.webp`、`src/cases/widget-popup/icon.webp` 写入上传图片，两个 `index.ts` icon 导入改 `./icon.webp`。
- `src/cases/index.ts`：移除 `widgetMapSplitCase` 的 import 与 `demos` 注册项（源码目录 `src/cases/widget-map-split/` 保留，未删除文件）。
- `vite.config.ts` CESIUM_SYMBOLS 补充 `HeadingPitchRange`（罗盘案例 doubleClick 回正用 `flyToBoundingSphere` 的 offset 参数）。

**验证结果**：

- dev 下 shim 模块已导出 `HeadingPitchRange`，`WidgetCompassDemo.vue` 编译 200。
- `npm run build`（vue-tsc + vite）通过，0 错误；产物中不再包含 `WidgetMapSplitDemo` chunk（卷帘已移除）。
- 三个案例 `index.ts` 均引用 `icon.webp`，dev server 已重启，预览地址 `https://5173-0bc9c7e0e3f401be.monkeycode-ai.online`。

**稳定规则**：

- CESIUM_SYMBOLS 全局 shim 是 dev 模式下 `import { ... } from 'cesium'` 的唯一导出来源，新增案例用到任何新的 Cesium 符号（如 HeadingPitchRange、BoundingSphere、IntersectionTests 等）必须同步加入该清单，否则 dev 运行时报 `does not provide an export named`。

## V3.97 控件案例图标替换与罗盘报错修复

**目标**：
1. 「右键菜单控件」案例卡片 icon 采用上传的 image-1（`39b5d119-image-1.webp`）。
2. 「距离比例尺控件」案例卡片 icon 采用上传的 image-2（`f8783bd1-image-2.webp`）。
3. 修复罗盘控件报错：`Uncaught (in promise) SyntaxError: The requested module '/@id/__x00__cesium-global' does not provide an export named 'BoundingSphere'`。

**实施内容**：

- `src/cases/widget-context-menu/icon.webp`、`src/cases/widget-distance-legend/icon.webp` 写入上传图片，两个 `index.ts` 的 icon 导入从 `./icon.svg` 改为 `./icon.webp`。
- `vite.config.ts` CESIUM_SYMBOLS 补充 `BoundingSphere`（此前仅有 BoundingRectangle，罗盘案例在 dev shim 下找不到该导出而报错；生产构建走真实 cesium 全局不受影响，故仅 dev 暴露）。

**验证结果**：

- dev 下 shim 模块已导出 `BoundingSphere`，`WidgetCompassDemo.vue` 编译 200。
- 两个案例 `index.ts` 均引用 `icon.webp`；构建产物中对应资源以 `icon-8WGE8nWV.webp`（157KB）等独立文件打包并被主包引用。
- `npm run build`（vue-tsc + vite）通过，0 错误。

## V3.96 新增 Cesium 控件系列 10 案例

**目标**：参考 GitHub CesiumChina/cesium-widget 开源仓库的 10 个控件（Compass、ContextMenu、DistanceLegend、HawkeyeMap、LoadingMask、LocationBar、MapSplit、Popup、Tooltip、ZoomController），分别新建独立案例并接入「常用工具」分类。

**实施内容**：

1. 克隆参考仓库至 `/tmp/cesium-widget`，逐控件阅读源码（`src/widgets/*.js`、`src/themes/*.scss`、`src/icons/*`），确认 10 个控件清单与交互逻辑。
2. 新建 10 个案例目录与图标（`src/cases/widget-*/`，icon.svg 手写 SVG）：
   - `widget-compass`：罗盘外圈随航向旋转、拖拽内圈旋转视角/外圈漫游、双击回正（移植 getCameraFocus/flyToBoundingSphere 逻辑）。
   - `widget-context-menu`：右键菜单（飞行到此位置/添加标记/清除/回默认/取消飞行），拾取并显示经纬度高程。
   - `widget-distance-legend`：按 1/2/3/5 序列自适应档位，屏幕中心两侧 ray 求测地线距离换算比例尺。
   - `widget-hawkeye-map`：内嵌 2D Viewer 圆形鹰眼窗，`camera.changed` 同步中心点与距离。
   - `widget-loading-mask`：全屏遮罩 + 5 个错峰闪烁光点，提供「模拟加载」演示按钮。
   - `widget-location-bar`：底部状态栏实时显示鼠标经纬度/海拔与相机视角/视高（300ms 节流）。
   - `widget-map-split`：卷帘分割条拖拽，右侧 Bing 影像 / 左侧 ArcGIS 街道或影像图对比。
   - `widget-popup`：点击地图在拾取点上方弹出贴地气泡，`SceneTransforms.worldToWindowCoordinates` 跟随，含预设 POI 飞行弹窗。
   - `widget-tooltip`：鼠标跟随提示浮层，显示拾取坐标，支持自定义文本输入。
   - `widget-zoom-controller`：放大（朝焦点前进 1/2）/缩小（反方向一倍）/回默认视角（flyHome），Ray + IntersectionTests 求焦点。
3. 适配新版 Cesium（1.144）：`Cesium.getTimestamp()` → `performance.now()`；`SceneTransforms.wgs84ToWindowCoordinates` → `worldToWindowCoordinates`；`scene.imagerySplitPosition` → `scene.splitPosition`；`ArcGisMapServerImageryProvider({url})` → `await fromUrl(url)`；`ImagerySplitDirection` → `SplitDirection`。
4. `vite.config.ts` CESIUM_SYMBOLS 补充 `Ray`、`IntersectionTests`、`ArcGisMapServerImageryProvider`、`ImagerySplitDirection`。
5. `src/lib/cesium-scene.ts` 的 `loadBingImagery` 增加可选第三参 `onLayer` 回调（MapSplit 设置 splitDirection 用）。
6. 10 个案例均用 `defineAsyncComponent` 动态导入，注册进 `src/cases/index.ts`（`category: 'tools'`），案例总数 65 → 75。

**验证结果**：

- `npm run build`（vue-tsc + vite）通过，构建耗时约 22s，0 错误。
- 10 个 widget 案例均独立拆分为 `Widget*Demo-*.js` + 对应 css chunk，主包保持约 131KB。
- dev server 已重启（端口 5173），预览地址 `https://5173-0bc9c7e0e3f401be.monkeycode-ai.online`。

**稳定规则**：

- 新版 Cesium 中 `Scene.imagerySplitPosition` 已重命名为 `splitPosition`；`ArcGisMapServerImageryProvider` 使用 `fromUrl` 静态工厂（async）。
- 案例卡片对象必须包含 `id/title/category/description/tag/icon/component` 字段（`DemoCard`），`category` 使用英文 id（如 `tools`）。

## V3.95 大雁塔案例图标替换

**目标**：「3DTiles-大雁塔模型」案例卡片 icon 采用上传的 image-1。

**实施内容**：

- `src/cases/tiles-3d-dayanta/icon.webp` 替换为 `18d38107-image-1.webp`（md5 af70016b...）。

**验证结果**：

- `npm run build` 通过。
- dev 下 `icon.webp` 200，首页卡片显示新图标（vite 热更新已生效）。

## V3.94 大雁塔模型渲染修复（KHR_technique_webgl → PBR）

**问题**：大雁塔案例加载后模型无法渲染。诊断确认根因——`public/dayanta/` 的 b3dm 由旧版 cesiumlab（2022）生成，内嵌 glTF 使用**已废弃的 `KHR_technique_webgl` 扩展**（`extensionsRequired`），现代 Cesium 的 glTF loader 不再支持该扩展，导致瓦片加载后无法显示。

**资源搜索**：重新搜索 GitHub/Gitee/web，网络上大雁塔 3D Tiles 数据均为此 cesiumlab 旧格式同源数据，无现代 PBR 格式的现成资源。故采用「转换现有模型」方案。

**实施内容**：

1. 编写 Node 脚本 `/tmp/convert_b3dm_khr.js`：解析每个 b3dm（header + featureTable/batchTable + GLB 三部分），将 GLB 内 `KHR_technique_webgl` 材质转换为标准 PBR——`pbrMetallicRoughness.baseColorTexture` 指向原 diffuse 纹理，`metallicFactor: 0`、`roughnessFactor: 1`，并移除 `extensionsRequired/extensionsUsed`、`techniques/programs/shaders`；GLB 的 JSON/BIN chunk 按规范（4 字节对齐）重建，b3dm 的 featureTable/batchTable 字节原样保留。
2. 修复过程中定位两个解析陷阱：GLB chunk header 为 `length(4)+type(4)`（此前读反）；BIN chunk 与 JSON chunk 读取顺序均按标准字节布局校正。
3. 备份 `public/dayanta` 至 `/tmp/dayanta_backup`，批量转换 **189 个 b3dm 全部成功**，全量校验通过：无 KHR_technique_webgl 残留、BIN chunk（纹理 JPEG）完整、无越界。
4. `tileset.json.bak`（V3.93 备份）移出 public 至 /tmp，避免进 dist。

**验证结果**：

- `npm run build` 通过，`dist/dayanta/000/000.b3dm` 确认已转换（无 KHR_technique_webgl，PBR 材质）。
- dev 下 `/dayanta/tileset.json`、`/dayanta/000/000.b3dm` 均 200。
- 预览：数据可视化 →「3DTiles-大雁塔模型」，模型应正常渲染显示，控制台无 KHR_technique_webgl 报错。

## V3.93 大雁塔 tileset.json 属性迁移

**目标**：消除 Cesium 控制台警告「This tileset JSON uses the "content.url" property which has been deprecated. Use "content.uri" instead.」。

**实施内容**：

1. 备份 `public/dayanta/tileset.json` 为 `tileset.json.bak`。
2. Node 脚本递归遍历 tileset 所有 tile 节点，将 `content.url` 迁移为 `content.uri`（189 个 tile，b3dm 相对路径不变）。
3. 校验：`content.url` 残留 0 个、`content.uri` 189 个，JSON 结构完整。

**验证结果**：

- dev 下 `/dayanta/tileset.json` 返回 200 且 189 处 `"uri"`，警告消除。
- `npm run build` 通过，`dist/dayanta/tileset.json` 同步为 uri 版本。
- 预览：数据可视化 →「3DTiles-大雁塔模型」控制台无 content.url 弃用警告。

## V3.92 新增「3DTiles-大雁塔模型」案例

**目标**：新增案例 `tiles-3d-dayanta`——下载典型大雁塔 3D Tiles 模型到项目本地，支持 3D Tiles 加载与各类参数实时调整。

**实施内容**：

1. **模型下载**：从 GitCode 开源仓库（open-source-toolkit/f81f0）克隆西安大雁塔 3D Tiles 数据，解压 `dayanta.zip` 至 `public/dayanta/`（tileset.json + 0-6 层级 b3dm，共 387 文件 / 约 16MB，WGS84 ECEF transform 内嵌定位）。构建时自动拷贝至 `dist/`。
2. **案例结构**：`src/cases/tiles-3d-dayanta/{index.ts, icon.webp, Tiles3DDayantaDemo.vue}`，注册进 `src/cases/index.ts`（→65），分类 `data`，图标复用 `a630afa4-image-1.webp`。
3. **加载**：`Cesium3DTileset.fromUrl('/dayanta/tileset.json')`，加载 Bing 底图 + World Terrain 后自动 flyTo 定位模型。
4. **参数调整**（面板）：
   - 显示/隐藏模型（`tileset.show`）。
   - 高度偏移（`modelMatrix` 平移，单位 m）。
   - 透明度滑块 0-100%：`Cesium3DTileStyle` `color('色名', alpha)` 表达式实现整体透明。
   - 着色颜色（white/cyan/orange/red/green）。
   - 混合模式（替换/高亮/混合）+ 混合度滑块（`colorBlendMode` / `colorBlendAmount`）。
   - 屏幕空间误差滑块 2-64（`maximumScreenSpaceError`，控制 LOD 精度）。
   - 场景光照（`globe.enableLighting`）、深度测试（`depthTestAgainstTerrain`）、Cesium3DTilesInspector 监视器。
   - 「定位模型」「重置」按钮。
5. **shim 补充**：`vite.config.ts` CESIUM_SYMBOLS 增加 `Cesium3DTileStyle`、`Cesium3DTileColorBlendMode`。

**验证结果**：

- `npm run build`（vue-tsc + vite）通过，新 chunk `Tiles3DDayantaDemo-DFTBWt78.js`，`dist/dayanta/tileset.json` 正确拷贝。
- dev 下案例模块 200，`/dayanta/tileset.json` 200，shim 导出 `Cesium3DTileStyle`/`Cesium3DTileColorBlendMode` 正常。
- 手动验证：首页 → 数据可视化 →「3DTiles-大雁塔模型」，模型自动加载定位；高度偏移、透明度、着色、混合模式/度、屏幕空间误差、光照、深度测试均实时生效；监视器与重置正常。

## V3.91 ECharts 案例增强

**目标**：迭代 `echarts-map` 案例——①卡片 icon 采用上传的 image-1；②图表尺寸随相机缩放动态调整（近大远小）；③支持面板参数调整；④支持输入图表 Options + 输入坐标或在地图上点击动态添加图表。

**实施内容**：

1. **图标**：`icon.webp` 替换为上传的 `af0785b2-image-1.webp`。
2. **缩放联动**：所有图表 Billboard 设置 `scaleByDistance`（`NearFarScalar`），相机靠近放大、远离缩小。
3. **参数面板**：
   - 模板下拉（柱状图 / 玫瑰饼图 / 折线图，选中填充 JSON 编辑器）。
   - Options JSON 文本区：可自由编辑 ECharts option。
   - 经度/纬度输入、图表宽/高输入。
   - 「缩放参数」折叠区：近距/远距/近端缩放/远端缩放，修改后同步应用到全部已添加图表。
4. **动态添加**：
   - 「添加图表」：解析 JSON → 离屏渲染 → 在输入坐标处添加 Billboard。
   - 「点击地图拾取坐标添加」：切换拾取模式，点击地图经 `globe.pick` 取地形交点经纬度，直接用当前 Options 在该点添加。
   - 「按参数重新渲染全部」：按保存的 option 与最新参数重渲全部图表。
   - 「删除最近」「清除全部」管理已添加图表。
5. **初始示例**：打开案例自动渲染三组模板图表（柱状/饼图/折线）。
6. **类型处理**：`scaleByDistance` 赋 `NearFarScalar` 时经 `Property` cast 绕过 cesium 类型声明缺方法问题；拾取回调标注 `ScreenSpaceEventHandler.PositionedEvent`。

**验证结果**：

- `npm run build`（vue-tsc + vite）通过，新 chunk `EChartsMapDemo-C_42kT1a.js`。
- dev 下案例模块 200。
- 手动验证：案例卡片显示新 icon；打开案例默认三组图表；滚动缩放相机，图表随距离近大远小；面板调整缩放参数立即生效；编辑 Options + 坐标「添加图表」成功；开启拾取模式点击地图在新位置添加图表；「重新渲染全部/删除最近/清除全部」正常。

## V3.90 新增「数据可视化-ECharts图表」案例

**目标**：新增案例 `echarts-map`，演示将 ECharts 图表以图片形式叠加到 Cesium 三维地图上——离屏渲染图表 → 导出 canvas PNG → 以 Billboard 方式挂载到指定经纬度。

**实施内容**：

1. **案例结构**：`src/cases/echarts-map/{index.ts, icon.webp, EChartsMapDemo.vue}`，注册进 `src/cases/index.ts`（→64），分类 `data`（数据可视化）。
2. **图表数据**：三组示例（福州周边三个坐标点）——①分组柱状图（样例A/B × 5 组数据）；②南丁格尔玫瑰饼图；③三条平滑折线图。
3. **渲染流程**：离屏容器（`left:-9999px`）逐组渲染，`echarts.init` → `setOption`（关闭动画）+ `finished` 事件与超时兜底 → 取容器 canvas `toDataURL('image/png')` → `CustomDataSource` 添加 Billboard（`HorizontalOrigin.CENTER` / `VerticalOrigin.BOTTOM`，宽高按图表 size）→ `dispose` 下一组。
4. **交互**：控制面板含「重新渲染图表」「清除图表」按钮；加载状态遮罩提示。
5. **相机**：初始 flyTo 福州区域（复用参考的 Cartesian3 目标）。
6. **依赖**：echarts ^6.1.0（已存在于 dependencies，随案例异步 chunk 加载，不增加首页主包）。

**验证结果**：

- `npm run build`（vue-tsc + vite）通过，新 chunk `EChartsMapDemo-sWljzT-i.js`（echarts 库随该 chunk 异步加载，仅打开案例时请求）。
- dev 下案例模块 200，shim 导出 `CustomDataSource`/`HorizontalOrigin`/`VerticalOrigin` 正常。
- 手动验证：首页 → 数据可视化 →「数据可视化-ECharts图表」，三组图表分别以 Billboard 叠加在福州周边三个坐标点；可重新渲染与清除。

## V3.89 填挖方分析增强

**目标**：基于 V3.88 填挖方分析案例做交互与可视化增强——①卡片 icon 换新上传的 image-1；②分析区域边框贴地；③结果展示时同时显示设计标高线平面，支持显隐与透明度调节；④支持单端控制仅显示填方或挖方结果；⑤采样精度改为预设档位。

**实施内容**：

1. **图标**：`cut-fill-analysis/icon.webp` 替换为 `2eda2e09-image-1.webp`。
2. **边框贴地**：分析区域边界 `fillCutBoundary` polyline 与绘制预览折线 `clampToGround: true`，紧贴地形显示。
3. **标高线平面**：分析完成后在 `design` 高度创建网格线平面（`GridMaterialProperty`，青色半透明 + 24×24 网格线 + 白色 outline），表示设计标高水平面：
   - 「显示」开关控制平面显隐（`entity.show`）。
   - 透明度滑块（0-100%）实时更新 `GridMaterialProperty.color` 透明度。
4. **单端显示**：新增「全部 / 仅填方 / 仅挖方」视图切换，按 `solid.type` 过滤三角形实例后重建 `Primitive`。
5. **精度预设**：采样精度改为下拉预设 256 / 512 / 1024 / 2048，`granularity = PI / 2^11 / precision`。
6. **shim 补充**：`vite.config.ts` CESIUM_SYMBOLS 增加 `GridMaterialProperty`（dev 全局 shim 导出）。

**验证结果**：

- `npm run build`（vue-tsc + vite）通过，新 chunk `CutFillAnalysisDemo-C44KIdae.js`。
- dev 下 shim 导出 `GridMaterialProperty` 正常，案例模块 200。
- 手动验证：首页 → 空间分析 →「空间分析-填挖方分析」卡片显示新图标；绘制区域后边界贴地；分析结果下方显示标高线平面，可开关显隐、调透明度；可切换仅看填方或挖方体块；精度可选 256/512/1024/2048。

## V3.88 新增「空间分析-填挖方分析」案例

**目标**：参考外部实现（DEJA_VU3D 填挖方分析），新增填挖方分析案例——绘制多边形区域，按精度采样生成三角网格（TIN），逐三角面比较地形高度与设计标高，计算填方面积/体积与挖方面积/体积，并以三棱柱体块可视化。

**实施内容**：

1. 新增 `src/cases/cut-fill-analysis/CutFillAnalysisDemo.vue`：
   - 交互复用现有分析案例模式（左键采集顶点、移动实时预览、右键/双击闭合），支持 Ctrl 无关的自定义区域绘制。
   - 采样网格：`PolygonGeometry.fromPositions({ positions, vertexFormat: FLAT_VERTEX_FORMAT, granularity })` + `createGeometry`，`granularity = PI / 2^11 / precision`，precision 可调（64-1024，默认 256）。
   - 地形高度：优先 `sampleTerrainMostDetailed` 一次采样全部网格顶点（Cesium World Terrain），降级回退 `globe.getHeight`。
   - 计算：海伦公式求三角形水平投影面积，三顶点均高与设计标高比较——低于为填方（`fillVolume += area × (design - mean)`）、高于为挖方、相等为无须填挖。
   - 可视化：每个三角面生成三棱柱（顶面为地形高度、`extrudedHeight` 为设计标高），通过单个 `Primitive` + `PerInstanceColorAppearance` 一次绘制全部实例；填方绿色、挖方橙色、不变灰色；边界以青色 polyline 标识。
   - 设计标高输入为 0 时自动采用采样区域平均地形高度（保证演示有填有挖）。
2. `src/cases/cut-fill-analysis/index.ts` 注册 DemoCard（category: analysis，标题「空间分析-填挖方分析」）。
3. `src/cases/cut-fill-analysis/icon.webp` 使用未占用图标 `a630afa4-image-1.webp`。
4. `src/cases/index.ts` 注册新案例（demos 62 → 63）。

**验证结果**：

- `npm run build`（vue-tsc + vite）通过，生成独立 chunk `CutFillAnalysisDemo-WrWLRAns.js`。
- dev 下案例模块 200，标题/图标/分类渲染于首屏元数据。
- 手动验证：首页 → 空间分析 → 「空间分析-填挖方分析」卡片打开，默认演示区域自动分析并显示填挖面积/体积结果；点击「绘制分析区域」在地图上采集顶点、右键/双击闭合后自动分析；调节设计标高与精度可重新计算。

## V3.87 Cesium 系统初始化异步预加载：dev 下 cesium 走全局 shim，消除案例打开等待

**目标**：用户反馈案例打开时因 cesium 包加载很久。根因：dev 模式下 vite-plugin-cesium 不注入 Cesium 全局脚本，`import from 'cesium'` 由 Vite 预构建/逐模块编译 Cesium 未压缩源码（node_modules/cesium 源码 ESM），首次打开案例触发 esbuild 预构建 + 源码转换，耗时极长。方案改为系统初始化时异步加载 Cesium 全局脚本，案例打开即时可用。

**实施内容**：

1. `vite.config.ts` `cesiumHtmlOptimize`：build 注入的 `<script src="/cesium/Cesium.js">` 由 `defer` 改为 `async`——系统初始化即异步下载执行 Cesium，但不阻塞首屏渲染。
2. 新增 `cesiumDevGlobal` 插件（dev 模式，`enforce: 'pre'`）：
   - `transformIndexHtml` 注入 `<script src="/cesium/Cesium.js" async>`（利用 vite-plugin-cesium 中间件提供的 Cesium 静态资源）。
   - `resolveId`/`load` 将 `cesium` 导入 shim 为 `window.Cesium` 全局对象，静态导出项目用到的 120 个 Cesium 具名符号，避免 Vite 编译/预构建 Cesium 源码。
3. `optimizeDeps.exclude: ['cesium']`：阻止 Cesium 进入依赖预构建（esbuild 打包整个 Cesium 是 dev 首次打开案例慢的主因）。
4. `src/App.vue` 新增 `ensureCesium()`：打开案例前轮询等待 `window.Cesium` 就绪（30s 超时兜底重新注入 script）；`openCase` 改为 `async` 并先 `await ensureCesium()` 再挂载案例组件。首屏渲染不受影响（async script 不阻塞）。

**验证结果**：

- dev 下 `src/lib/cesium-scene.ts` 的 cesium 导入重写为 `/@id/__x00__cesium-global`（shim），首页模块（main.ts/App.vue）无任何 cesium 依赖。
- 首页 html 注入 `<script src="/cesium/Cesium.js" async>`，系统初始化即异步预加载 Cesium（15.6MB 未压缩，局域网毫秒级），点击案例不再等待编译。
- `npm run build`（vue-tsc + vite）通过；build 产物 index.html 中 Cesium.js 为 async。
- 预览地址 https://5173-0bc9c7e0e3f401be.monkeycode-ai.online 连接正常。
- 手动验证：首页秒开；点击任意案例应快速进入（Cesium 已在后台预加载）。

## V3.86 首页白屏深度优化：案例异步拆分、Cesium 非阻塞化；通视分析改名与剖面图标更新

**目标**：解决首页首屏白屏问题。根因为 `src/cases/index.ts` 静态导入全部 62 个案例组件，且 vite-plugin-cesium 在 index.html 同步注入 14MB 的 `/cesium/Cesium.js` 与 widgets.css，首屏需下载解析全部案例（原单包 3.4MB / gzip 1.04MB）+ Cesium.js 才可渲染。同时完成通视分析改名与剖面分析 icon 更新。

**实施内容**：

1. **案例组件异步化**：62 个 `src/cases/*/index.ts` 中 `import XDemo from './XDemo.vue'` 全部改为 `const XDemo = defineAsyncComponent(() => import('./XDemo.vue'))`，每个案例 Demo 组件（含其 Cesium/echarts/xlsx 等依赖）拆分为独立异步 chunk，仅打开案例时加载。
2. **App.vue 移除 Cesium 静态依赖**：删除 `import { getCesiumStats } from './lib/cesium-scene'`，改为 `loadCesiumStats()` 动态 `import('./lib/cesium-scene')`，cesium-scene（进而 Cesium）不再进入首页主包。
3. **element-plus 按需化**：`main.ts` 移除全量 `ElementPlus` 与 `element-plus/dist/index.css`，仅注册 `ElIcon` 并按需引入其样式。
4. **widgets.css 随案例异步加载**：Cesium 的 widgets.css 从 `main.ts` 移入 `src/lib/cesium-scene.ts`，随 cesium-scene 异步 chunk 按需注入。
5. **Cesium.js 非阻塞化**：`vite.config.ts` 新增 `cesium-html-optimize` 插件，`transformIndexHtml` 将 vite-plugin-cesium 注入的 `<script src="/cesium/Cesium.js">` 改为 `defer`，并移除重复注入的 `/cesium/Widgets/widgets.css` link。
6. **首页图标懒加载**：App.vue 卡片缩略图 `<img>` 增加 `loading="lazy"` 与 `decoding="async"`。
7. **案例名称与 icon**：`perspective-analysis` title 改为「空间分析-通视分析」；`profile-analysis/icon.webp` 替换为 image-1（47eb23ce-image-1.webp）。

**验证结果**：

- `npm run build`（vue-tsc + vite）通过；62 个案例 Demo 全部生成独立 chunk，Cesium 由主包移出。
- 首页主包由 3.4MB（gzip 1.04MB）降至约 131KB（gzip 43KB）；index.html 不再同步阻塞加载 Cesium.js（defer 非阻塞），widgets.css link 移除。
- 手动验证项：①首页 → 空间分析 → 剖面分析卡片显示 image-1 新图标；②首页 → 空间分析 → 通视/可视域分析卡片标题「空间分析-通视分析」（卡片渲染在首屏 bundle 中，不受异步拆分影响）；③首页首屏加载不再白屏。

## V3.85 修正图标应用对象：透视分析换 image-1，可视域分析恢复原图

**目标**：纠正 V3.84 的误操作——image-1 图标本应应用于「空间分析-透视分析」案例卡片，而非「空间分析-可视域分析」。

**实施内容**：

1. `src/cases/perspective-analysis/icon.webp` 替换为 image-1（来源 `.monkeycode-tmp-files/c5abaa9e-image-1.webp`）。
2. `src/cases/viewshed/icon.webp` 恢复原图：由于 `src/cases/` 目录未纳入 git 跟踪、无法从版本库恢复，通过 MD5 比对推断原图——08-27 上传的候选图标中，`b277b60f-image-1.webp`（90540 字节）是唯一未被任何现有案例使用的文件，判定为可视域分析原 icon 并恢复（已复制到 `viewshed/icon.webp`）。

**验证标准**：

- `npm run build`（vue-tsc + vite）通过。
- dev server（5173）perspective/viewshed 模块与 icon 均 200。
- 手动验证：①「空间分析-透视分析」卡片显示 image-1 图标；②「空间分析-可视域分析」卡片显示原有图标。

## V3.84 剖面分析多类型采样切换与起终点标记修复

**目标**：①剖面分析案例支持多类型采样参数设置切换（每段步数/固定间距/总采样点数）；②修复绘制剖面路径时起点和终点标记没有正确显示位置。

**问题定位**：

1. 剖面起终点标记：`initLabel()` 用 `Cartesian3.fromDegrees(lon, lat)` 创建 point/label（高度 0 位于椭球面），且仅在挂载时对默认路径创建一次；手动绘制新路径后标记停留在默认路径、位置也不贴合地形。
2. 距离计算：原实现逐采样点 `length(lineString(arr), { units: 'miles' })` 逐步重建 LineString（性能差），且 x 轴/总长单位混乱（英里换算错误）。

**实施内容**：

1. `ProfileAnalysisDemo.vue`：
   - `initLabel()` 重构为 `updateMarkers(path)`：起终点 point/label 增加 `heightReference: HeightReference.CLAMP_TO_GROUND` + `disableDepthTestDistance: Infinity`，用带 id（`profile-start`/`profile-end`）实体，供 `removeById` 重建；新增 `updatePathLine(path)` 统一管理红色路径折线。绘制中每采集一个折点实时刷新标记（`onLeftClick` 调 `updateMarkers`），`finishDrawing` 确认后刷新标记与路径，`startDrawing` 清除旧标记/路径，`onBeforeUnmount` 清理标记实体。
   - 采样参数切换：新增 `samplingType`（steps/distance/total）select 与 `intervalM`（固定间距 m）、`totalPoints`（总采样点数）ref；面板按类型显示对应参数滑条。
   - 采样逻辑重构：`haversineMeters` 手写球面距离 + `buildDenseSamples` 高密度路径点（每段 500 点）→ `sampleAtTargets` 按目标累计距离线性插值；三种模式分别生成目标距离序列（每段等分/固定间隔/总点数均匀）。采样点距离统一为米，剖面图 x 轴 km、总长 m，修正原英里单位错误。移除 `@turf/length`、`@turf/helpers` 依赖。
2. hint 文案更新为"沿路径按所选采样方式插值采样真实地形高程"。

**验证标准**：

- `npm run build`（vue-tsc + vite）通过。
- dev server（5173）profile 模块均 200。
- 手动验证：①剖面分析「采样方式」切换三类参数后「开始分析」图表正确；②绘制路径时起点/终点红点标记贴合地形并随路径更新。

## V3.83 地形开挖案例名称与卡片 icon 更新

**目标**：地形开挖案例名称改为「空间分析-地形开挖(支持凹边形)」，案例卡片 icon 采用 image-1。

**实施内容**：

1. `src/cases/terrain-excavation/icon.webp` 替换为 image-1 图标（来源 `.monkeycode-tmp-files/197eae99-image-1.webp`，按案例本地 `./icon.webp` 约定复制进案例目录）。
2. `src/cases/terrain-excavation/index.ts`：`title` 更新为「空间分析-地形开挖(支持凹边形)」，`description` 同步更新为「基于 Globe ClippingPolygons 裁剪地形，支持凹边形基坑开挖效果」。

**验证标准**：

- `npm run build`（vue-tsc + vite）通过。
- dev server（5173）案例模块与 icon 均 200。
- 首页「空间分析」分类下地形开挖卡片显示新名称与新图标。

## V3.82 地形开挖改 Globe ClippingPolygons；绘制预览改实时半透明面

**目标**：修复地形开挖案例两个问题——①`depthTestAgainstTerrain=true` 时开挖结果（坑底/四壁）被地形深度遮挡不可见；②绘制预览改为顶点 ≥3 时的实时半透明面（跟随光标闭合预览），<3 时保留折线。

**问题定位**：

1. 原方案用 `Globe.clippingPlanes`（`ClippingPlaneCollection`，手算每个边界的无限半空间平面）裁剪地形。经引擎源码核对（`Scene.js:3736` `clearGlobeDepth = globe.show && (!globe.depthTestAgainstTerrain || SCENE2D)`、`GlobeFS.glsl:336` 裁剪片元 `discard`、`GlobeDepth.js:391` clear 仅清颜色），`depthTestAgainstTerrain=true` 时地形深度保留并参与实体 OPAQUE pass 深度测试，无限平面裁剪对该深度路径的支撑不可靠，导致坑底 Polygon（height=minHeight）与四壁 Wall 被地形深度遮挡，`false` 时因 `clearGlobeDepth` 清深度而可见。
2. Cesium 1.111 起官方提供针对 terrain 的原生多边形裁剪 `Globe.clippingPolygons`（`ClippingPolygonCollection`，PR #11750）；参考库 @bimangle/cesium-tool-excavate 1.1.0 在 `_detectClippingAPI()` 中优先选择该 API（`typeof Cesium.ClippingPolygon !== 'undefined'`），实证在 `depthTestAgainstTerrain=true` 下正常。
3. 无头 SwiftShader 像素验证不可靠（canvas 被 resize 为 300x150、`toDataURL`/`readPixels` 通道全 baseColor），结论以源码推理 + @bimangle 实证方案为准。

**实施内容**：

1. `TerrainExcavationDemo.vue` `excavate()`：删除逐边中点/up/right/normal 手算 `ClippingPlane` 及 `ClippingPlaneCollection` 赋值，改为 `viewer.scene.globe.clippingPolygons = new ClippingPolygonCollection({ polygons: [new ClippingPolygon({ positions: config.positions })] })`；坑底 `entityDM` 增加 `outline: true / outlineColor: Color.OLIVE / outlineWidth: 1` 表达裁剪边界（polygon API 无 edgeWidth/edgeColor）。
2. 清理逻辑（`clearExcavation`、`onBeforeUnmount`）由 `clippingPlanes = undefined` 改为 `clippingPolygons = undefined`（TS 中转 `as unknown as { clippingPolygons?: ClippingPolygonCollection }`）。
3. `updatePreview()`：顶点 ≥3（含跟随光标）时渲染半透明面 `PolygonHierarchy`（`Color.YELLOW.withAlpha(0.22)` + 黄色 outline，`perPositionHeight: true` 贴合地表），<3 时保留原有折线预览。
4. 移除失效的「裁剪边宽」控件（`edgeWidth`）与未使用的 `isClockWise` 函数、`ClippingPlane/ClippingPlaneCollection/Plane` 导入；hint 文案更新为 ClippingPolygons 方案。

**验证标准**：

- `npm run build`（vue-tsc + vite）通过。
- dev server（5173）案例模块 200。
- 手动验证：`depthTestAgainstTerrain=true` 时坑底/四壁/裁剪边均可见；绘制区域时 ≥3 顶点出现跟随光标半透明面，右键/双击闭合开挖。

## V3.81 修复手动绘制/选点被全屏提示遮罩拦截；剖面图移右下并修复未显示

**目标**：修复 V3.80 引入的三个交互缺陷——①地形开挖绘制区域时「在地图上单击依次采集顶点」全屏提示导致无法点击地图；②透视分析手动选点「请点击地图设置观测点」提示同样拦截操作；③剖面分析绘制路径提示拦截操作、剖面图未显示、且需要从左侧移到右下方。

**问题定位**：

1. 三个案例的绘制/选点提示统一写入 `statusMessage`，而模板用全屏 `.status-mask`（`position: absolute; inset: 0; z-index: 9`）渲染——遮罩覆盖整个地图并拦截全部鼠标事件，Cesium canvas 收不到点击/移动，绘制与选点全部失效。
2. 剖面图未显示：`runProfile` 中先调用 `initChart(profile)`（此时 `showChart=false`，`chartContainer` 尚未挂载，`chartContainer.value` 为 null，`initChart` 直接 return），之后才 `showChart.value = true`，echarts 实例从未初始化；且多次分析时旧 chart 实例绑定的 DOM 被 `v-if` 移除后未 dispose，重新 setOption 仍不可见。

**实施内容**：

1. 提示方案调整（三案例）：绘制/选点提示改为面板内提示条，不再写入 `statusMessage`：
   - `terrain-excavation`：`startDrawing`/`onLeftClick`/`finishDrawing` 移除对 `statusMessage` 的赋值，改用面板 `v-if="drawing"` 提示条动态显示「在地图上单击依次采集顶点…」或「已采集 N 个顶点…」。
   - `perspective-analysis`：新增 `pickHint` ref；`startPicking`/`onLeftClick` 将提示写入 `pickHint`，面板以 `.pick-hint` 样式提示（观测点→目的点两阶段文案），`cancelPicking` 清空；分析时 `statusMessage` 仍走遮罩但仅在计算通视瞬间出现。
   - `profile-analysis`：新增 `drawHint` ref；`startDrawing`/`onLeftClick`/`finishDrawing` 提示写入 `drawHint`，面板 `result` 条统一显示绘制状态（含路径至少 2 点提示）。
2. 遮罩兜底：三案例 `.status-mask` 增加 `pointer-events: none`，即使残留遮罩也不拦截地图交互。
3. 剖面图修复（`ProfileAnalysisDemo.vue`）：
   - 渲染顺序改为 `showChart.value = true` → `await nextTick()` → `initChart(profile)`，保证容器挂载后再初始化 echarts。
   - `runProfile` 开头 dispose 旧 chart 并置 `chart = undefined`，避免 `v-if` 移除 DOM 后旧实例失效。
   - 图表容器样式从 `left: 12px` 移到右下：`.chart-right { left: auto; right: 12px; }`，宽度放宽为 `min(560px, calc(100% - 24px))`。
4. 复查 `viewshed` 案例：其 `.status-mask` 仅在 `v-if="loading"` 时渲染，选点提示不经过遮罩，无同类缺陷，不改动。

**验证标准**：

- `npm run build`（vue-tsc + vite）通过。
- dev server（5173）三案例组件模块均 200。
- 手动验证：①地形开挖「绘制开挖区域」后在地图上单击可正常采集顶点、右键/双击闭合并自动开挖；②透视分析「手动选点」依次点击地图设置观测点/目的点后「开始分析」正常出结果；③剖面分析「绘制剖面路径」可采集折点，「开始分析」后在界面右下方弹出 ECharts 剖面图。

## V3.80 三空间分析案例支持手动创建；移除参考源表述

**目标**：①移除三个案例 UI 面板中类似「参考实现：Cesium-Examples「4.1.1、地形开挖」（excavateTerrain.js）」的参考源表述；②地形开挖、透视分析、剖面分析支持用户手动绘制/选取分析要素，不再局限于固定演示数据。

**实施内容**：

1. 移除参考源表述：删除 `terrain-excavation`、`perspective-analysis`、`profile-analysis` 三个案例模板中的 `warn` 段落及其 `.warn` 样式（含「Cesium 1.144 将 wgs84ToWindowCoordinates 移除」等内部说明），改为面向使用方式的 `hint`/`hint2` 说明文案。
2. `src/cases/terrain-excavation/TerrainExcavationDemo.vue` 支持手动绘制开挖区域：
   - 新增「绘制开挖区域/闭合区域」按钮，进入绘制模式后在地图上左键单击采集顶点（`pickPosition` 拾取真实地形高度），鼠标移动显示黄色折线预览，右键/双击闭合。
   - 闭合后顶点数 ≥ 3 自动以手动区域开挖；不足 3 点给出提示并清空。
   - `runExcavation` 优先使用手动区域（`manualPositions`），否则回退默认演示四边形（`ORIGINAL_POSITIONS`）。绘制期间禁用开挖/清除按钮。
   - `ScreenSpaceEventHandler` 在挂载时创建、卸载时销毁。
3. `src/cases/perspective-analysis/PerspectiveAnalysisDemo.vue` 支持手动选点：
   - 新增「手动选点」按钮：进入选点模式后第一次左键点击设置观测点、第二次设置目的点，随即结束选点可分析。
   - `startPoint`/`endPoint` 由固定常量改为可变 `Cartesian3 | undefined`；`setStartPoint`/`setEndPoint` 同步更新实体位置与标签经纬度文本；「开始分析」使用当前两点。
   - 选点模式下「开始分析」禁用，给出「正在选点…」按钮态。
4. `src/cases/profile-analysis/ProfileAnalysisDemo.vue` 支持手动绘制剖面路径：
   - 新增「绘制剖面路径/结束绘制」按钮：左键单击采集折点（`pickCartographic` 转经纬度），鼠标移动显示黄色预览线，右键/双击结束。
   - 结束后折点 ≥ 2 重建红色路径实体（`pathEntity`），`activePath()` 优先返回手动路径，否则回退 `DEFAULT_PATH`；「开始分析」沿当前路径采样。
   - 移除内部 `PATH` 常量对分析逻辑的硬依赖。

**验证标准**：

- `npm run build`（vue-tsc + vite）通过（模块数与 bundle 大小基本持平，新增逻辑无运行时依赖）。
- dev server（5173）三案例组件模块均 200；UI 面板不再出现「参考实现：Cesium-Examples」类表述；三案例可分别手动绘制开挖区域/选点/绘制剖面路径并执行分析。

## V3.79 新增地形开挖、透视分析、剖面分析三个空间分析案例

**目标**：参考 GitHub 仓库 jiawanlong/Cesium-Examples（1.98）中的三个案例，适配 Cesium 1.144 移植为独立案例：4.1.1 地形开挖、4.1.8 透视分析、4.1.9 剖面分析。

**实施内容**：

1. `src/cases/terrain-excavation/`（地形开挖）：
   - 移植 `excavateTerrain.js` 核心：`isClockWise` 判断坐标环顺逆 → Cartographic/Cartesian3 裁剪平面顶点算法（逐边中点 → up/right/normal → `Plane.getPointDistance` 求距离 → `ClippingPlane`）生成球面裁剪集合 `ClippingPlaneCollection({ planes, edgeWidth, edgeColor })`。
   - 底部 `entityDM` polygon：`ImageMaterialProperty`（top 纹理 + `Cartesian2(30,30)` repeat）+ `height: minHeight`（顶点最低高程 - 开挖深度）。
   - 四壁 `entityDMBJ` wall：沿边采样 2048 点 `sampleTerrainMostDetailed` 取真实地形高度作 maximumHeights，minimumHeights 为 minHeight；`terrainProvider._layers` 不存在时降级为 0 高度（椭球面）。
   - 纹理：`terrain-side.jpg`/`terrain-top.jpg` 复制到案例目录，`?url` import 离线加载；参数 depth 5~100m、edgeWidth 0.5~3。
   - TS 适配：`scene.globe.clippingPlanes` 在 1.144 类型非可选但运行时可 undefined，清空时以 `as unknown as { clippingPlanes?: ... }` 赋 undefined。
2. `src/cases/perspective-analysis/`（透视分析/通视分析）：
   - 按 html 实现分段通视：观测点与目的点连线段按 `stepCount`（50~300）等分，逐段将屏幕像素步长与空间步长对应，`scene.pickPosition` + `globe.pick(ray, scene)` 取该屏幕点实际高程，与线段理论高程比较——实际 > 理论则该点为障碍点。
   - Cesium 1.144 适配：`SceneTransforms.wgs84ToWindowCoordinates` 已移除，改用 `scene.cartesianToCanvasCoordinates(position)`。
   - 结果可视化：可视画绿色直线；不可视绿色（起点→障碍）+ 红色（障碍→终点）两段线 + 橙色障碍点标注。
3. `src/cases/profile-analysis/`（剖面分析）：
   - 固定 4 顶点折线路径（90.5/30.5 ~ 90.5/31.5），沿每段 `stepCount`（20~300）步 `CesiumMath.lerp` 插值采样，`globe.getHeight` 取真实地形高程。
   - 距离累计用 `@turf/length`（`lineString` 逐点重建，units=miles）；新增依赖 `echarts`（^6.1.0）、`@turf/length`（^7.4.0）。
   - ECharts 按需引入（`echarts/core` + LineChart/Grid/Tooltip + CanvasRenderer），左下角浮动面板绘制高程剖面折线图（x=累计距离 km、y=高程 m），展示剖面最高点与路线总长。
4. 三案例均注册进 `src/cases/index.ts`（import + demos 数组），category 均为 `analysis`、tag「空间分析」；卡片 icon 从 `.monkeycode-tmp-files/` 闲置 webp 取用（terrain-excavation=f84726a8、perspective-analysis=a630afa4、profile-analysis=aded5174）。

**验证标准**：

- `npm run build`（vue-tsc + vite）通过（2807 modules，dist 含 terrain-top/terrain-side.jpg 纹理与 echarts 产物）。
- dev server（5173）主页面与三案例组件模块均 200；三案例卡片出现在「空间分析」分类下，点击可运行：地形开挖生成裁剪坑洞+纹理底面/四壁；透视分析点击「开始分析」给出可视/不可视结论并渲染绿/红线段；剖面分析采样地形并弹出 ECharts 剖面图。

## V3.78 移除数据可视化-点聚合(Supercluster)案例及 supercluster 依赖

**目标**：按用户要求移除「数据可视化-点聚合(Supercluster)」案例及相关代码。

**实施内容**：

1. 删除 `src/cases/supercluster-cluster/` 目录（`SuperclusterClusterDemo.vue`、`index.ts`、`icon.webp`）。
2. `src/cases/index.ts`：移除 `superclusterClusterCase` 的 import 与 demos 数组注册。
3. `package.json`：移除 `supercluster`（^9.0.0）与 `@types/supercluster`（^7.1.3）依赖。

**验证标准**：

- `npm run build`（vue-tsc + vite）通过，模块数由 2207 降至 2200，bundle 不再包含 supercluster。
- `rg` 检查 `src/` 下无 supercluster/supercluster-cluster 残留引用（历史迭代日志中保留记录）。

## V3.77 Supercluster 案例按 OpenThree html 完整移植（setClusterCollection 结构）

**目标**：用户反馈 V3.76 的 Supercluster 案例仍有问题，要求直接移植 OpenThree「cesium大量点聚合」html 的实现形式，调整显示图标（单点/聚合图标），并支持参数调整。

**实施内容**：

1. `src/cases/supercluster-cluster/SuperclusterClusterDemo.vue` 完整重写，按 html 结构移植：
   - `setClusterCollection(points, callback, options)` 聚合方法：`new Supercluster({ radius, extent, minZoom, maxZoom, minPoints })` → `load(points)` → 初始化 `getClusters([-180, -85, 180, 85], 2)`；`getBounds()` 用 `computeViewRectangle()` 经 `CesiumMath.toDegrees` 转度数 bbox；`getLevel()` 读取 `globe._surface._tilesToRender[0]._level` 真实瓦片层级。
   - `setBillboards(arr)`：对每个 feature 判断 `properties.cluster`——聚合点取 `getLeaves(clusterId, Infinity, 0)` 遍历原始点、`Cartesian3.distance` 找离聚合中心最近的真实点作为锚点（与 html 完全一致），并附加 `isCluster/clusterId/pointCount` 供 callback 区分图标；初始化先渲染全球 zoom 2 结果，再监听 `camera.changed` 动态 `removeAll + setBillboards(getClusters(getBounds(), level))`。
   - callback 渲染：聚合点用 canvas 聚合圆标（红色系，可配颜色/透明度/scale 0.5，数量缩写 1.0k，按 count+颜色+透明度缓存 dataURL）；单点用 canvas 小圆贴图（可配颜色/大小，白描边）；均 `disableDepthTestDistance = +Infinity`，id 携带 `{ clusterId, lng, lat }` 供点击。
   - 点击：聚合点 `getClusterExpansionZoom` 逐级放大，单点放大到 maxZoom。
   - 参数面板：数量（1万/5万/10万/50万）、聚合半径（20~120）、切片范围 extent（256~1024）、最小层级 minZoom（0~4）、最大层级 maxZoom（8~20）、最小点数 minPoints（2~10）、单点大小（3~14）/颜色、聚合透明度（0.3~1）/颜色。
   - 计数：`setBillboards` 开头重置，callback 内累计 `clusterCount`（聚合数）/`visibleCount`（可见总数）。
   - 清理：重生成时先移除旧 billboard 与 `camera.changed` 监听；卸载时移除监听、销毁 handler。
   - TS 适配：`getLeaves` 返回类型坐标与 `CallbackData` 冲突，统一用 `as unknown as` 中转，坐标类型放宽为 `number[]`。

**验证标准**：

- `npm run build`（vue-tsc + vite）通过，dev server（5173）主页面与组件模块均 200。
- Supercluster 案例完全按 html 结构运行：初始化渲染全球 zoom 2 聚合，缩放/平移时按真实瓦片层级动态更新，聚合圆标锚定聚合内最近真实点；单点与聚合图标可分别调整颜色/大小/透明度；点击聚合逐级放大。

## V3.76 点聚合基础版 icon 换 image-1；Supercluster 案例修复（层级/bbox 对齐）

**目标**：①「数据可视化-点聚合(基础版)」案例卡片 icon 采用用户上传的 image-1；②修复 Supercluster 高性能聚合案例聚合/点显示异常问题——结合参考 html（`globe._surface._tilesToRender[0]._level` 取真实瓦片层级、`computeViewRectangle` 转度数 bbox、聚合点锚定最近真实点）与现有代码，构建性能与渲染效果最优的案例。

**问题定位**：

1. bbox 未转度数：`computeViewRectangle()` 返回弧度（Rectangle.west/east 等），而 supercluster `getClusters(bbox, zoom)` 需要 `[westLng, southLat, eastLng, northLat]` 度数——导致查询范围错误，缩放时聚合/点错乱。
2. 层级换算错误：用 `Math.log2(360 / 经度跨度)` 估算 zoom，与 Cesium 实际瓦片层级不同步；参考 html 改用 `globe._surface._tilesToRender[0]._level` 获取真实瓦片层级作为 supercluster zoom，聚合结果与地图缩放严格对齐。
3. 初次渲染空白：瓦片未就绪时 `_tilesToRender` 为空，`getTileLevel()` 返回 undefined 直接 return；新增 `fallbackZoom()`（按相机高度估算）+ bbox 兜底 `[-180, -85, 180, 85]`，并监听 `scene.globe.tileLoadProgressEvent` 瓦片就绪后重绘。

**实施内容**：

1. `src/cases/point-cluster/icon.webp`：替换为用户上传 `0192375c-image-1.webp`（61776 字节）。
2. `src/cases/supercluster-cluster/SuperclusterClusterDemo.vue`：
   - `getTileLevel()`：读取 `globe._surface._tilesToRender[0]._level` 作为真实瓦片层级（TS 以 `as unknown as { _surface?: { _tilesToRender?... } }` 访问私有属性）；undefined 时回退 `fallbackZoom()`（`log2(RADIUS_ORIGIN/height)+1`）。
   - `getViewBoundsDegrees()`：`computeViewRectangle()` 经 `CesiumMath.toDegrees` 转为度数 bbox，无效时回退全球范围。
   - `updateClusters()`：`getClusters(bbox, clamp(level, 0, maxZoom))`，聚合点经 `getClusterAnchor` 用 `getLeaves(clusterId, 2000, 0)` 找到聚合圆内最近真实点作为锚点显示（`leafAnchorCache` 按 clusterId 缓存，`MAX_LEAF_SCAN=2000` 控制扫描量）；聚合 billboard `scale: 0.5`。
   - 事件：`camera.changed`、`camera.moveEnd`、`scene.globe.tileLoadProgressEvent` 均触发 `updateClusters`；卸载时全部移除。
3. `src/cases/index.ts`：无需改动（V3.75 已注册）。

**验证标准**：

- `npm run build`（vue-tsc + vite）通过，dist 产物含点聚合新 icon（61.78 kB），dev server（5173）三处模块均 200。
- 点聚合基础版卡片 icon 显示 image-1。
- Supercluster 案例：初次进入即有聚合/点显示（fallback 兜底），缩放/平移时聚合结果与地图瓦片层级同步（`_tilesToRender[0]._level`），聚合圆标锚定真实点，点击聚合逐级放大正常。

## V3.75 新增点聚合（EntityCluster）与 Supercluster 高性能聚合案例

**目标**：新增两个点聚合案例——①「数据可视化-点聚合(基础版)」参考官方 html，基于 Cesium EntityCluster + clusterEvent 自定义 canvas 聚合图标；②「数据可视化-点聚合(Supercluster)」基于 supercluster 库自主聚合，仅渲染视野内聚合结果、支持点击逐级放大。两者均支持多类参数设置。

**实施内容**：

1. `src/cases/point-cluster/`（基础版点聚合，category: data）：
   - `PointClusterDemo.vue`：`CustomDataSource('points')` + `entities.add`（point，可配 pixelSize/颜色/白边 outlineWidth），`clustering.enabled = true`、`pixelRange`（20~200）、`minimumClusterSize`（2~10）；`clusterEvent` 监听——隐藏 label、billboard 垂直方向 BOTTOM、聚合图标 `size = min(100, 30 + count/10)`、canvas 绘制 rgba 聚合圆（可配颜色/透明度）+ 白边 2px + bold 14px Arial 白字，`createClusterCanvas` 结果按 count 缓存 dataURL；数量 5000/1万/5万/10万，分块生成（chunk 5000）+ 进度 + 耗时。
   - `index.ts`：`{ id: 'point-cluster', title: '数据可视化-点聚合(基础版)', category: 'data', tag: '点聚合' }`；icon 采用 `f84726a8-image-1.webp`（89.42 kB）。
2. `src/cases/supercluster-cluster/`（Supercluster 聚合，category: data）：
   - `SuperclusterClusterDemo.vue`：`new Supercluster({ radius, minPoints, maxZoom }).load(features)` 构建索引；监听 `camera.changed`（percentageChanged=0.05）与 `camera.moveEnd`，按 `computeViewRectangle` 换算相机层级 zoom（`clamp(round(log2(360/经度跨度)))`）并取视野 bbox，`getClusters(bbox, zoom)` 得到视野内聚合结果；`BillboardCollection` 渲染（聚合点 canvas 圆标 + 数量缩写 1.0k，单点小圆贴图按点色缓存，`disableDepthTestDistance = +Infinity`）；点击聚合点 `getClusterExpansionZoom` 逐级放大、单点放大到 maxZoom；数量 1万/5万/10万/50万；参数：radius（20~120）、minPoints（2~10）、maxZoom（8~20）、点大小（3~14）、单点色/聚合色；构建时统计索引加载耗时（loadMs）与聚合点/可见点计数。
   - `index.ts`：`{ id: 'supercluster-cluster', title: '数据可视化-点聚合(Supercluster)', category: 'data', tag: '点聚合' }`；icon 采用 `a630afa4-image-1.webp`（23.73 kB）。
3. `src/cases/index.ts`：import 两个新案例并追加进 demos 数组（`pointClusterCase`、`superclusterClusterCase`）。
4. 依赖：`npm install supercluster`（^9.0.0，ESM）+ `npm install -D @types/supercluster`（^7.1.3，引用 @types/geojson 传递依赖）。TS 类型注意：`@types/supercluster` 导出 `export = Supercluster` 命名空间（esModuleInterop 下 `import Supercluster from 'supercluster'`）；索引类型统一用 `Supercluster`（不带泛型参数或 `Supercluster.AnyProps`），否则 `load()` 返回的 `Supercluster<AnyProps, AnyProps>` 无法赋给带 `Record<string, never>` 泛型的变量。

**验证标准**：

- `npm run build`（vue-tsc + vite）通过，dist 产物含两个新 icon（89.42 / 23.73 kB），dev server（5173）HMR 编译正常（HTTP 200）。
- 数据可视化分类下新增「数据可视化-点聚合(基础版)」「数据可视化-点聚合(Supercluster)」两张卡片。
- 基础版：缩小视角可见圆形聚合图标，数量随缩放动态变化，聚合图标按 count 缓存。
- Supercluster 版：相机移动/缩放时按视野动态重算聚合，点击聚合圆点逐级放大，50 万点索引构建正常。

## V3.74 海量文字/立方体改名并归入数据可视化分类、更新 icon

**目标**：①「海量随机文字」改名「数据可视化-海量文字」并归入数据可视化分类，icon 采用 image-1；②「海量随机立方体」改名「数据可视化-海量立方体」并归入数据可视化分类，icon 采用 image-3。

**实施内容**：

1. `src/cases/mass-text/index.ts`：`title` 改为「数据可视化-海量文字」，`category` 由 effects 改为 data。
2. `src/cases/mass-cubes/index.ts`：`title` 改为「数据可视化-海量立方体」，`category` 由 effects 改为 data。
3. `3f706299-image-1.webp`（159138 字节）→ `src/cases/mass-text/icon.webp`；`3b8496ae-image-3.webp`（48614 字节）→ `src/cases/mass-cubes/icon.webp`。

**验证标准**：

- `npm run build`（vue-tsc + vite）通过，dist 产物含两个新 icon（159.14 / 48.61 kB，与源文件字节一致），HMR 已推送 dev server（5173）。
- 数据可视化分类下显示「数据可视化-海量文字」「数据可视化-海量立方体」两张卡片。

## V3.73 新增海量随机文字与海量随机立方体案例

**目标**：新增两个十万级至百万级海量渲染案例——①海量随机文字（参考 BillboardCollection + canvas 文字贴图方案）；②海量随机立方体（参考 Primitive + BoxGeometry 实例化方案）。两者均支持多类参数设置。

**实施内容**：

1. `src/cases/mass-text/`（海量随机文字，category: effects）：
   - `MassTextDemo.vue`：`BillboardCollection` 批量渲染；`createCanvasText` 程序化生成中文文字贴图（中文字符池「京沪津…」随机组合，白字 + 阴影，可选白色描边）；文字贴图按 `文字|字号|颜色|描边` 组合键缓存去重，池大小可配（10/50/100/500/1000）避免百万级贴图爆炸；数量 1万/5万/10万/50万/100万；参数：字号 12~48、缩放 0.2~2、白边开关、分布范围（中国 73~135°E / 18~54°N 或全球黄金角均匀分布）、颜色模式（随机 HSL 色/单色）；分块生成（chunk 2 万）+ 进度显示 + 耗时统计。
   - `index.ts`：`{ id: 'mass-text', title: '海量随机文字', category: 'effects', tag: '海量渲染' }`；icon 采用 `f84726a8-image-1.webp`（89.42 kB）。
2. `src/cases/mass-cubes/`（海量随机立方体，category: effects）：
   - `MassCubesDemo.vue`：`Primitive` + `GeometryInstance` + `BoxGeometry.fromDimensions`（`PerInstanceColorAppearance.VERTEX_FORMAT`）+ `Transforms.eastNorthUpToFixedFrame` + `PerInstanceColorAppearance` 批量渲染；数量 1万/5万/10万/50万/100万；参数：宽 5000~100000m、高 5000~100000m、深 50000~1000000m、尺寸随机开关、分布范围（全球/中国）、颜色模式（随机 HSL/单色/双色交替）、透明度 0.05~1；分块生成（chunk 1 万）+ 进度显示 + 耗时统计。
   - `index.ts`：`{ id: 'mass-cubes', title: '海量随机立方体', category: 'effects', tag: '海量渲染' }`；icon 采用 `a630afa4-image-1.webp`（23.73 kB）。
3. 两案例均注册进 `src/cases/index.ts` demos 数组末尾。
4. 修复：`BoxGeometry.fromDimensions` 为静态工厂方法，不可 `new`。

**验证结果**：

- `npm run build`（vue-tsc + vite）通过，仅 chunk>500kB 预期警告；dist 含新 icon（23.73 kB / 89.42 kB）。
- dev server（5173）HMR 编译无错误，两个案例模块 HTTP 200。
- 十万级渲染流畅度、百万级生成耗时与内存表现待浏览器预览确认。

## V3.72 三维场景演示改名为基础版并更新卡片 icon

**目标**：①「三维场景演示」案例名称改为「三维场景演示_基础版」；②案例卡片 icon 采用 image-1。

**实施内容**：

1. `src/cases/skyline-presentation/index.ts` 中 `title` 更新为「三维场景演示_基础版」。
2. `41990c87-image-1.webp`（140992 字节）→ `src/cases/skyline-presentation/icon.webp`。

**验证标准**：

- `npm run build`（vue-tsc + vite）通过，dist 产物含新 icon（140.99 kB，与源文件字节一致），HMR 已推送 dev server（5173）。

## V3.71 新增「三维场景演示」Skyline Presentation 能力案例

**目标**：基于两份设计文档（演示原型设计 60 秒园区演示 + 完整分层设计方案），实现 Skyline Presentation 能力原型案例——路径平滑漫游、时序图层调度、标注弹窗触发、播放控制（暂停/倍速/跳转/循环）、时间轴交互、演示结束场景自动还原，验证标准为「路径平滑度 / 时序同步性 / 交互可控性 / 场景完整性」。

**实施内容**：

1. `src/cases/skyline-presentation/presentation.ts`：类型定义 `PresentationKeyframe`（位置+姿态+transition）、`PresentationEventType`（10 种：layer_show/layer_hide/label_show/label_hide/popup_open/popup_close/effect_start/effect_stop/camera_jump/custom）、`PresentationConfig`/`PresentationEvent`/`Presentation`；`demoPresentation` 为 60 秒园区汇报演示脚本：5 个关键帧（1500m 俯瞰→300m→120m 环绕→-15m 地下→800m 离场）+ 10 个时序事件（8s 建筑显示、14s 主标签、18s 弹窗、25s 车流特效、40s 地下管网、42s 地下模式、46s 关弹窗、50s 隐标签、55s 隐管网、57s 停车流）。
2. `src/cases/skyline-presentation/PresentationEngine.ts`：`PresentationEngine` 类——位置采样 `SampledPositionProperty`（HermitePolynomialApproximation 二次插值）+ 姿态采样 `SampledProperty`（LagrangePolynomialApproximation）；`clock.onTick` 统一时间源驱动 `updateCamera` + `checkEvents`（事件跨时触发一次，`triggeredEvents` 集合）；play/pause/seek/setSpeed/setLoop；seek 清空已触发集并重放 ≤t 事件保证拖拽状态正确；`restoreInitialScene` 快照相机与 `depthTestAgainstTerrain`，结束时自动还原；`custom` 事件支持 enableUndergroundMode 切换地下穿透。
3. `src/cases/skyline-presentation/SkylinePresentationDemo.vue`：`createMapScene`+`loadBingImagery`+`loadWorldTerrain` 初始化；程序化园区场景（26 栋随机建筑 box + 主建筑 + 主标签 label + 环形道路 polyline + 16 辆金色车流点 + 地下管网 polyline/point，零外部模型资源）；控制面板（播放/暂停、重置、0.5x/1x/2x、时间显示、循环开关）；时间轴（进度条、关键帧黄色圆点、10 类事件着色菱形标记、刻度、点击跳转）；弹窗跟随建筑屏幕坐标（`cartesianToCanvasCoordinates` + clamp）。
4. `src/cases/skyline-presentation/index.ts` + `icon.webp`（复用 cesium-init 占位图）：`DemoCard` 导出 `{ id: 'skyline-presentation', title: '三维场景演示', category: 'effects', tag: '展示汇报' }`；注册进 `src/cases/index.ts` demos 数组末尾。
5. Cesium 1.144 API 适配：`JulianDate.fromSeconds/toSeconds` 已移除，改用 epoch（`JulianDate.fromDate(new Date(0))`）+ `addSeconds/secondsDifference` 封装 `secondsToJulianDate/julianDateToSeconds`；`removeAllSamples` 改为 `removeSamples(new TimeInterval(...))`；`cartesianToWindowCoordinates` 改名 `cartesianToCanvasCoordinates`；`Entity.position` 赋值须用 `ConstantPositionProperty` 包装；`CatmullRomSpline` 非 `InterpolationAlgorithm`，改用 `HermitePolynomialApproximation`。

**验证结果**：

- `npm run build`（vue-tsc + vite）通过，仅 chunk>500kB 预期警告；dist 含 skyline 案例代码。
- dev server（5173）HMR 编译无错误，案例模块与首页 HTTP 200。
- 预览地址：https://5173-0bc9c7e0e3f401be.monkeycode-ai.online
- 播放流畅度、时序事件同步、时间轴跳转与场景还原效果待浏览器预览最终确认。

## V3.70 点位标记/海量线/海量多边形案例卡片 icon 更新

**目标**：点位标记与清单案例卡片 icon 采用 image-1、海量不规则线采用 image-2、海量不规则多边形采用 image-3。

**实施内容**：

1. `98f73f3e-image-1.webp`（141294 字节）→ `src/cases/point-markers/icon.webp`。
2. `ad89a90c-image-2.webp`（164418 字节）→ `src/cases/mass-lines/icon.webp`。
3. `7234c090-image-3.webp`（136296 字节）→ `src/cases/mass-polygons/icon.webp`。
4. 三案例 `index.ts` 已存在 `import icon from './icon.webp'` + `icon` 字段，无需改动。

**验证标准**：

- `npm run build`（vue-tsc + vite）通过，dist 产物含三个新 icon（141.29 / 164.42 / 136.30 kB，与源文件字节一致），HMR 已推送 dev server（5173）。

## V3.69 点位编辑提示改为自动消失的 toast

**目标**：修复「保存编辑后，点位信息已更新会一直存在影响操作」——成功提示以全屏遮罩（status-mask）常驻，遮挡操作。

**实施内容**：

1. toast 机制：新增 `flashStatus(message)` / `clearStatus()`，所有操作反馈消息（成功与错误）统一走 `flashStatus`，3 秒后自动清空；新增点位成功后 `clearStatus()` 即时清空，多个提示共享单一定时器（先清后设，避免竞态）。
2. 遮罩不拦截交互：`.status-mask` 增加 `pointer-events: none`，背景透明度 0.72 → 0.55，提示展示期间不遮挡地图与面板操作。
3. 生命周期：`onBeforeUnmount` 清理定时器，避免卸载后回调。

**验证标准**：

- 保存编辑后「点位信息已更新」约 3 秒自动消失，期间不遮挡操作。
- 错误提示（如名称不能为空、经纬度无效）同样 3 秒消失，不常驻挡操作。
- `npm run build`（vue-tsc + vite）通过，HMR 已推送 dev server（5173）。

## V3.68 点位标记与清单：名称与属性字段编辑弹窗

**目标**：标记标绘-点位标记与清单（point-markers）增加编辑按钮，点击弹窗支持名称编辑和属性字段编辑，经纬度不允许编辑。

**实施内容**：

1. 数据模型：`PointRecord` 新增 `attributes: PointAttribute[]`（`PointAttribute = { key: string; value: string }`），`addPoint` 初始化为空数组。
2. 清单「编辑」按钮：点位行新增「编辑」按钮（跳转/编辑/删除），点击 `openEdit(record)` 打开编辑弹窗；行 `title` 悬停显示属性摘要（无属性时显示名称与坐标）。
3. 编辑弹窗：名称文本输入框可编辑；经纬度以只读样式展示（`editLon`/`editLat` 仅初始化，无输入框）；属性字段区支持每行「属性名 + 属性值」编辑、逐条删除、「+ 添加属性」新增行；底部「取消/保存」。
4. 保存校验与清洗：名称去空格非空校验；属性过滤空属性名、重复属性名去重（后者覆盖前值）；保存更新清单数据并提示「点位信息已更新」。
5. 导出扩展：CSV/Excel 按所有点位属性名并集动态生成属性列，值按属性名对齐；CSV 对含逗号/引号/换行的值补引号转义。

**验证标准**：

- 清单每项出现「编辑」按钮，点击弹窗中名称可改、属性可增删改、经纬度为只读文本。
- 保存后清单名称与属性更新，悬停可见属性摘要；导出 CSV/Excel 包含属性列。
- `npm run build`（vue-tsc + vite）通过，HMR 已推送 dev server（5173）。



## V3.67 深度图叠加报错定位：四至度数误作弧度导致矩形非法

**目标**：定位「按四至生成」时报错「深度图生成失败：Expected otherRectangle to be typeof object, actual typeof was undefined」的准确调用点并修复。

**根因**：`tryBoundsRectangle()`（RectangleDepthMapDemo.vue:160）用 `new Rectangle(west, south, east, north)` 构造四至矩形，而 `Rectangle` 构造参数单位为**弧度**，四至输入为**度数**。北京 116.3/116.48/39.84/40.0 被当作 116.3 弧度（约 18 圈），生成的矩形纬度 39.84 远超地球 ±π/2。`_GlobeSurfaceTileProvider._onLayerAdded` 在 `addImageryProvider` 同步遍历所有已加载 tile 并调用 `_createTileImagerySkeletons`：第一个 `Rectangle.intersection(provider.rectangle(非法), layer._rectangle(全地球))` 判定不重叠返回 `undefined`，第二个 `Rectangle.intersection(tile.rectangle, undefined)` 即抛「Expected otherRectangle to be typeof object」。

**实施内容**：

1. 根因修复：`tryBoundsRectangle()` 改为 `Rectangle.fromDegrees(west, south, east, north)`，四至矩形回归弧度制；采样插值、起点/终点标记、四至标签（`toDegrees` 显示）、SITP 叠加 `rectangle` 全部随之一致。此前四至标签数值也因该 bug 显示异常（如 6663 度）。
2. 错误堆栈化：`generateDepthMap` catch 显示 `error.stack`，报错可定位到精确调用点。
3. 叠加链路隔离：`addOverlay()` 独立 try/catch，叠加失败不再污染生成流程；`rectangle` 缺省兜底 `Rectangle.MAX_VALUE`。
4. 开关去重：`watch(overlayVisible)` 打开分支改为 `if (!overlayLayer)`，消除生成后重复叠加重建。

**验证标准**：

- 「按四至生成」成功后深度图自动叠加到地图四至矩形范围，叠加显示失败错误消除。
- 四至标签显示正常度数（116.3000 等）。
- `npm run build`（vue-tsc + vite）通过，HMR 已推送 dev server（5173）。



## V3.66 深度图四至显示、1024爆栈修复与地图叠加

**目标**：①深度图提取案例四至与矩形范围实时显示在地图上；②修复选择 1024×1024 分辨率生成时报错「深度图生成失败：Maximum call stack size exceeded」；③生成深度图后支持以影像图层形式叠加到地图上显示，并支持显示/隐藏与透明度设置。

**实施内容**：

1. 四至与矩形范围地图显示：`setRectangle` 新增 `updateBoundsLabel()`，在矩形中心生成四至文本标签（西/东/南/北各四位小数，`disableDepthTestDistance` 防遮挡）；矩形 polygon 边框改为高亮 `#7ef0ff` 并加粗 `outlineWidth: 2`，输入四至或框选时均实时更新。
2. 1024×1024 爆栈修复：原 `Math.min(...heights)` / `Math.max(...heights)` 对 1024×1024 = 1,048,576 个元素展开参数导致调用栈溢出（512 及以上同样会触发），改为单次循环求最值，O(n) 且无参数展开。
3. 深度图地图叠加：`DepthMap` 类型新增 `rectangle` 快照；生成成功后 `addOverlay()` 用 `SingleTileImageryProvider` 将深度图 PNG（dataURL）以生成范围 `rectangle` 叠加为影像图层；面板新增「显示深度图层」开关与透明度滑块，`watch` 控制 `layer.show` 与 `layer.alpha`，卸载时 `removeOverlay()` 清理图层。
4. 叠加报错修复：`SingleTileImageryProvider` 构造强制要求 `tileWidth` / `tileHeight`（`Check.typeOf.number`），缺省抛「Expected options.tileWidth to be typeof number, actual typeof was undefined」；`addOverlay()` 补传 `tileWidth: result.width` / `tileHeight: result.width`（PNG 实际像素尺寸）。

**验证标准**：

- 四至输入修改时矩形与四至标签实时更新，框选同理。
- 1024×1024 分辨率可正常生成深度图，无爆栈错误。
- 生成后深度图自动叠加到地图矩形范围，可开关显示、可调透明度，与地形/模型对齐。
- `npm run build`（vue-tsc + vite）通过。

## V3.63 热力图/三维热力图 icon 与交互缺陷修复

**目标**：①「数据分析-热力图」案例卡片 icon 采用用户上传 image-1（`3365da2a-image-1.webp`），并修复更换数据源后相机不跳转、固定范围下随机生成闪烁问题；②「数据分析-三维热力图」案例卡片 icon 采用用户上传 image-2（`84938388-image-2.webp`），并修复更换数据源后相机不跳转、三维起伏不明显、固定范围下随机生成闪烁问题。

**实施内容**：

1. icon：`3365da2a-image-1.webp`（86794 字节）→ `src/cases/heatmap-canvas/icon.webp`；`84938388-image-2.webp`（56448 字节）→ `src/cases/heatmap-3d/icon.webp`；各自 `index.ts` 增加 `import iconUrl from './icon.webp'` + `icon: iconUrl`。
2. 修复相机跳转（2D/3D 共用）：`onSceneChange` 不再只调 `runUpdate()`，新增 `flyToScene(scene)` 按 `scene.bounds` 中心做 `camera.flyTo`（2D 用 `Rectangle.fromDegrees(bounds±0.6°)` 顶视；3D 用中心经纬度 + `Math.max(30000, span*25000)` 视距 + `heading -35° / pitch -42°` 斜视角），场景与参数变更均同步重建热力图，保证切换数据即跳转。
3. 修复 3D 起伏不明显：`heightScale` 默认 600 → 3000、滑块范围 100~2000 → 200~8000；相机视距从 `span*90000`（约 279km）缩到 `span*25000`（约 77km），结合 42° 俯角使 3000m 级山峰在画面中起伏清晰。
4. 修复固定范围随机生成闪烁（2D/3D）：移除 `busy` 遮罩（`runUpdate` 中的 `requestAnimationFrame` + 30ms 延时 + `v-if="busy"` 遮罩全部删除），改为同步重建；3D 的 `rebuildMesh` 先构建新 `Primitive` 再 `remove` 旧 `Primitive`，无空帧；2D 的 `updateHeatmap` 同步刷新 entity material。

**验证标准**：

- `npm run build` 通过（vue-tsc + vite，13.97s）。
- 无头浏览器（Playwright + swiftshader）验证，零 pageerror / 零 console error：
  - icon：`heatmap-canvas/icon.webp` 与 `heatmap-3d/icon.webp` 均 `complete && naturalWidth > 0`。
  - 2D 相机跳转：初始北京(116.45, 39.90) → 切上海后飞至(121.55, 31.25) → 切成都飞至(104.10, 30.70)。
  - 3D 相机：初始北京，`heading=325 / pitch=-42` 斜视角；切广州后飞至(113.40, 23.05)。
  - 3D 起伏：高度倍率 8000 vs 200 下网格投影分布显著不同（`zoneWarm` 分布完全不同），立体起伏清晰可辨；默认视距下彩色像素 67%。
  - 随机生成闪烁：2D/3D 各连续 5 次随机生成，全程无 `busy` 遮罩、`primitives=1` 稳定，无闪烁帧。

## V3.62 热力图与三维热力图案例

**目标**：①新增「数据分析-热力图」案例：根据数据动态生成 Canvas 密度热力图，支持数据动态切换与各类参数设置（移植用户上传参考 `643cebfc-long-input-20260827-060304.txt`，leaflet.heat/h337 + setCesiumHeatmap）；②新增「数据分析-三维热力图」案例：根据数据动态生成三维热力网格，支持网格（LINES）/面状（TRIANGLES）形式切换、数据动态切换与各类参数设置（移植 `b9526954-long-input-20260827-060413.txt`，h337 + 采样构建 200×200 高度网格）。

**实施内容**：

1. 公共模块 `src/cases/heatmap-lib/`：
   - `heatmap-engine.ts`：移植 leaflet.heat 的 Canvas 热力渲染核心——`buildPalette`（gradient stops → 256 色查色表）、`createPointTemplate`（径向渐变圆 sprite，blur 控制软/实边）、`createHeatmapCanvas(points, bounds, options)`：点映射到画布坐标 → shadow canvas 按归一化值 `globalAlpha` 叠加 sprite → colorize（按 alpha 强度查 palette 上色、alpha 夹取到 `[minOpacity, maxOpacity]`）→ 输出 canvas；导出 `shadowData`（强度 alpha 数组）与 `colorData`（着色后像素数组，供 3D 逐顶点采样，避免逐像素 `getImageData` 性能开销）与 `getValueAt(x,y)`。
   - `heatmap-data.ts`：`heatmapScenes` 四套内置场景（北京多中心 clusters / 上海沿江带状 band / 广州环形 ring / 成都核心聚集 core），`generateSceneData` 用 seededRandom + Box-Muller 高斯生成确定性模拟点（值域 0~1000），支持随机种子重新生成。
2. ① `src/cases/heatmap-canvas/HeatmapCanvasDemo.vue` + `index.ts`（`data` 分类，标题「数据分析-热力图」，tag「数据可视化」）：`createMapScene` + `loadBingImagery`；热力图 canvas `toDataURL()` → `Cesium.ImageMaterialProperty`（**`transparent: true` 保留 alpha，否则矩形显示黑底**）贴 rectangle entity；参数：热力半径、最大/最小透明度、模糊度、画布宽度、色带（蓝绿黄红/热成像/黑红黄白/紫青黄）+ 渐变图例、固定数据范围开关 + min/max、数据场景 select + 随机生成按钮、相机自适应半径开关（`camera.moveEnd` 按高度把 radius 从初始值线性插值到 120）。
3. ② `src/cases/heatmap-3d/Heatmap3DDemo.vue` + `index.ts`（`effects` 分类，标题「数据分析-三维热力图」，tag「三维数据」）：heatmap canvas 生成强度/颜色像素数组 → `createMeshGeometry(resolution, bounds, heatmap)` 构建 `resolution×resolution` 顶点网格（每顶点高度 = `intensity × heightScale + baseElevation`，颜色从 `colorData` 采样，alpha 乘整体透明度）；**面状 TRIANGLES**（每格 2 三角形）/ **网格 LINES**（行水平线 + 列垂直线）切换（`PrimitiveType.TRIANGLES/LINES`，索引用 `Uint16Array`/`Uint32Array` 按最大索引选择）；自定义 Appearance（`depthTest.enabled=false` + `ALPHA_BLEND` + `czm_translateRelativeToEye` + `out_FragColor`）；参数：热力半径、模糊度、网格分辨率（20~120）、热力分辨率（100~400）、高度倍率、基准高度、透明度、色带、固定范围、数据场景 + 随机生成；metric 显示数据范围与网格顶点数。
4. `src/cases/index.ts`：注册 `heatmapCanvasCase`（data 分类）与 `heatmap3DCase`（effects 分类，置于 water-depth-heat 之后）。

**关键踩坑（后续案例必读）**：

1. **`Cesium.ImageMaterialProperty` 用于带 alpha 的 canvas 热力图必须传 `transparent: true`**，否则 alpha 通道被忽略、热力图矩形显示为不透明黑底。
2. **Cesium 1.144 没有 `IndexDatatype.getSizeInBytes`**；索引用 `Uint16Array`/`Uint32Array` 判断应依据 `Math.max(...indices) > 65535`。
3. **3D 热力图逐顶点采样性能**：不要对每顶点调用 `getValueAt`（内部 `getImageData(1×1)`，40000 顶点会卡死）；`createHeatmapCanvas` 一次性导出 `shadowData`/`colorData` 像素数组，网格构建时直接索引。
4. **h337 渲染两段式**：先 shadow canvas 按 `globalAlpha = (value-min)/(max-min)` 叠加径向渐变 sprite（强度累积），再 colorize 按 alpha 从 palette 查色并夹取透明度；本模块保持相同流程，效果与 leaflet.heat 一致。
5. **首页分类 tab 筛选**：首页默认显示 `effects` 分类卡片，其他分类需点击 `.category-item` 切换后再点卡片；无头验证新案例需先切分类。

**验证标准**：

- `npm run build` 通过（vue-tsc + vite，50.20s）。
- 无头浏览器（Playwright + swiftshader）验证：
  - ①「数据分析-热力图」（数据可视化分类）：面板标题「热力图」；hint「北京多中心 · 120 个数据点」；图例渐变正常；彩色像素 28%（热力矩形真实渲染）；场景切换上海带状、色带切换热成像、随机重新生成均生效且 hint 更新；零 pageerror。
  - ②「数据分析-三维热力图」（三维特效分类）：面板标题「三维热力图」；metric 数据范围 511~1000、网格顶点 3,600；primitives=1；面状 TRIANGLES 彩色 33%；切换网格 LINES 模式彩色 26%（线框渲染）；场景切换广州环形生效；零 pageerror。


## V3.61 三维水深热力改名与案例卡片 icon

**目标**：①「水面效果-三维水深热力」改名「数据分析-三维水深热力」；②案例卡片 icon 采用用户上传截图（`74d60b8c-image-1.webp`）。

**实施内容**：

1. `src/cases/water-depth-heat/index.ts`：标题 `水面效果-三维水深热力` → `数据分析-三维水深热力`；新增 `import iconUrl from './icon.webp'` 与 `icon: iconUrl`。
2. `src/cases/water-depth-heat/icon.webp`：`74d60b8c-image-1.webp`（64212 字节）复制到案例目录。

**验证标准**：

- `npm run build` 通过（vue-tsc + vite，10.69s）。
- 无头浏览器（Playwright + swiftshader）验证：
  - 首页无「水面效果-三维水深热力」卡片（旧标题卡片数为 0），「数据分析-三维水深热力」卡片正常显示。
  - 卡片 `img[src=/src/cases/water-depth-heat/icon.webp]` 正常显示。
  - 点击进入案例零 pageerror，遮罩消失，面板标题「三维水深热力分析」正常。

## V3.60 动态体积水卡片 icon 与三维水深热力案例

**目标**：①「水面效果-动态体积水」案例卡片 icon 改用用户上传截图（`c1d10859-image-1.webp`）；②新增「水面效果-三维水深热力」案例，移植用户上传参考 HTML（`fcba5efe-三维水深热力图-2.html`，原作者 Cesium Bathymetry Lab）的测深点采样 + 多方法插值三维水深热力效果。

**实施内容**：

1. ① icon：`c1d10859-image-1.webp` 复制为 `src/cases/dynamic-volume-water/icon.webp`；`dynamic-volume-water/index.ts` 新增 `import iconUrl from './icon.webp'` 与 `icon: iconUrl`。
2. ② 新案例 `src/cases/water-depth-heat/`（category `effects`，标题「水面效果-三维水深热力」，tag「插值分析」），按项目约定拆分为纯逻辑 + 渲染组件：
   - `bathymetry.ts`：**纯算法模块**（无 Cesium 依赖，可单测）。`createSoundings(2600)` 用 `seededRandom(20260531)` 生成合成测深场（海沟/浅滩/通航水道/冲刷坑/波纹，92km 与 111km 比例波长）；四种插值 `interpolateIdw`（power 2.15、limit 80）/`interpolateKriging`（`fitVariogramModel` 变差函数拟合 + `solveLinearSystem` 普通克里金）/`interpolateSpline`（thinPlate，`(r/1000)²·ln(r/1000)`，32 样本）/`interpolateNaturalNeighbor`（自然邻域 + 半平面裁剪，limit 14、expansion 1.08）；`interpolateGrid` 生成 `InterpolationGrid`（cells + bounds + min/max + krigingModel）；四色带（ocean/thermal/channel/safety）+ `depthToColor`/`paletteToGradient`；`calculateDifferenceStats`（MAE/RMSE/maxAbs）。
   - `WaterDepthHeatDemo.vue`：`createMapScene` + `loadBingImagery` + `loadWorldTerrain`（catch 降级 + `disposed` 保护，沿用 V3.59 约定）；相机飞至 `CENTER(121.92, 30.72)` 上海杭州湾 26km；测深点 `PointPrimitiveCollection`（disableDepthTest）；插值面按参考方案渲染——`interpolateGrid` cells 三角化网格，逐顶点 `color` attribute（`ComponentDatatype.UNSIGNED_BYTE` + normalize），自定义 `Appearance`（`depthTest.enabled=false` + `cull.enabled=false` + `ALPHA_BLEND` + `czm_translateRelativeToEye` 顶点着色器 + `out_FragColor` 片元），`asynchronous:false`；左侧面板：插值方法切换、方法参数（idw 幂次/邻近、克里金拟合滞后/样本/块金、样条样本/正则、自然邻域候选/扩展）、分析参数（采样点、网格密度、下凹倍率、透明度）、显示点位/插值面开关、差值对比（基准方法 + 差值图开关 + MAE/RMSE/maxAbs 统计）、水深色带 + 反转 + 渐变图例、指标网格（水深点/网格单元/最浅/最深）、重新分析按钮与加载遮罩。
   - `index.ts` 注册 `DemoCard`；`src/cases/index.ts` 注册 `waterDepthHeatCase`（置于 dynamic-volume-water 之后）。
3. 新案例未生成 icon（沿用「暂无截图」占位，见 MEMORY 规则）。

**关键踩坑（后续案例必读）**：

1. **Cesium 1.144 的 `GeometryAttributes` 构造函数不接受对象参数**（旧版本可传）；必须 `new Cesium.GeometryAttributes()` 后逐个赋值 `attributes.position/color = new Cesium.GeometryAttribute({...})`。
2. **TS 无法追踪跨函数调用对模块级变量的窄化**：`clearPoints()` 会把模块级 `pointCollection` 置 undefined，其后再用 `pointCollection.add(...)` 报 `possibly 'undefined'`；用局部 `const collection = scene.primitives.add(...)` 赋值后引用。
3. **克里金性能**：变差函数拟合在网格重建时只做 1 次（不是每 cell），`interpolateGrid` 把拟合模型缓存进 `InterpolationGrid.krigingModel`；每 cell 仅解 23×23 线性系统，38×38 网格无头环境可流畅完成。
4. **差值图与测点互斥**：差值图开启时隐藏测点（两者叠加会遮挡差值色块），交互约定与参考 HTML 一致。
5. **自然邻域实现**：按参考用种子点生成 Delaunay 三角网（`delaunayTriangulation` + Bowyer-Watson 增点），重心坐标区域划分 + 每个插值候选点逐步添加形成局部三角剖分，按贡献多边形面积比例加权（`triangleArea` 判断点在三角形内/边上/外），非负权重归一化。

**验证标准**：

- `npm run build` 通过（vue-tsc + vite，11.01s）。
- 无头浏览器（Playwright + swiftshader）验证：
  - ① 动态体积水卡片 `img[src=/src/cases/dynamic-volume-water/icon.webp]` 正常显示。
  - ② 进入三维水深热力案例零 pageerror / console error；遮罩消失、面板标题「三维水深热力分析」；网格单元 1,444（38×38）、水深范围 -16.2 ~ -46.9 m；中心区域彩色（高饱和）像素占比 89%，热力面真实渲染。
  - 四种插值方法切换均重建网格（idw→kriging→spline→natural 帧间像素差异 0.1~0.18%，与参考 HTML 同源海洋场差异一致）；差值图开启后统计「MAE 0.229 m · RMSE 0.340 m · 最大差 1.583 m」，与参考实现量级一致。


## V3.59 动态体积水默认加载 Cesium World Terrain

**目标**：让「水面效果-动态体积水」案例默认加载真实地形，使水面贴合丽江真实海拔（2400m）区域显示。

**实施内容**：

1. `src/cases/dynamic-volume-water/VolumeWaterDemo.vue`：
   - `onMounted` 中 `viewer.scene.globe.depthTestAgainstTerrain = true`、`viewer.scene.globe.maximumScreenSpaceError = 2`，`statusMessage` 显示「正在加载Cesium World Terrain...」，`await loadWorldTerrain(viewer)` 后初始化水面场景。
   - 抽离 `initWaterScene()`（创建 `VolumeWaterSurface`、点/预览线集合、绘制事件），地形加载成功或失败均调用（失败降级仍能渲染水面，避免无地形环境无法使用）。
   - 新增 `disposed` 标志，卸载时置位，保护异步地形回调不写入已销毁的 Viewer（参考 terrain-control 约定）。
   - 矩形模式默认中心经纬度与滑块范围适配丽江：`planeLon/planeLat` 默认 `100.66/26.55`，滑块范围 `99~102 / 25~28`。
2. `src/cases/dynamic-volume-water/VolumeWaterSurface.ts`：`DEFAULT_WATER_PARAMS.planeHeight` 1800→2400（丽江水域海拔，防止水面埋入真实地形）、`planeLon/planeLat` 121/35.8→100.66/26.55。

**验证标准**：

- `npm run build` 通过（vue-tsc + vite，10.22s）。
- 无头浏览器（Playwright + swiftshader）验证：
  - 进入案例先显示「正在加载Cesium World Terrain...」遮罩，加载完成后遮罩消失。
  - 网络请求：`api.cesium.com` 1 次（terrain asset 端点）+ `assets.ion.cesium.com` 66 次（World Terrain 瓦片），确认真实地形加载而非降级。
  - 水面渲染正常：CDP 截图像素分析蓝色系占比 30.64%，零 pageerror / console error。

## V3.58 动态体积水面板精简、丽江默认边界、绘制坐标修复

**目标**：调整「水面效果-动态体积水」案例：删除「重置默认多边形/重建水面/复位视角」三个按钮，默认多边形改用「水面效果-Primitive真实倒影」案例的丽江水域边界（`LIJIANG_WATER_POSITIONS`），并修复地图绘制结束时记录的节点坐标不正确问题。

**实施内容**：

1. `src/cases/dynamic-volume-water/VolumeWaterDemo.vue`：
   - 删除面板中的三个按钮：「重置默认多边形」按钮、底部「重建水面」「复位视角」按钮；`resetDefaultPolygon` 函数随之移除。`applyAreaRebuild` 保留（网格分段/矩形宽深滑块 `@change` 仍复用）。
   - `DEFAULT_POLYGON_TEXT` 改为从 `LIJIANG_WATER_POSITIONS`（428 点，丽江水域，lon 100.638~100.692、lat 26.463~26.63）生成，坐标文本框默认显示丽江边界。
   - **绘制坐标 bug 修复**：`finishPolygon()` 原先直接用 `Cartographic.fromCartesian(vertex)` 的 `longitude/latitude`（**弧度**）当作 `PolygonPosition`（约定为**度数**），导致绘制的多边形节点坐标全部错乱；现乘以 `TO_DEGREES = 180 / Math.PI` 转为度数后再 `toFixed(5)`。
2. `src/cases/dynamic-volume-water/VolumeWaterSurface.ts`：`DEFAULT_WATER_PARAMS.polygonPositions` 由原青岛 5 点替换为 `LIJIANG_WATER_POSITIONS`（`createWaterParams` 内 `.map(position => [...position])` 深拷贝，避免共享引用；`normalizePolygonPositions` 自动去掉首尾重复点）。

**验证标准**：

- `npm run build` 通过（vue-tsc + vite，11.77s）。
- 无头浏览器（Playwright + swiftshader）验证：
  - 进入案例零 pageerror / console error；CDP 截图像素分析蓝色系占比 30.57%，丽江默认水面正常渲染。
  - 面板按钮仅剩「应用多边形」「地图绘制」，三个目标按钮已移除。
  - 坐标文本框默认值以 `100.65222819444305,26.6226402878333; ...` 开头，共 428 点。
  - 地图绘制：模拟 3 次左键采集 + 右键结束，`result-hint` 显示「多边形水面创建成功（3 个顶点）」，polygonText 为 `100.66987,26.50484; 100.67807,26.49644; 100.65747,26.47694`（丽江区域度数，弧度→度数修复生效）。
  - 默认加载性能：428 点多边形网格构建触发最长 long task 771ms（swiftshader 下，meshSegments=160、ySegments 按 depth/width 放大），阻塞总量 1.5s，可接受。

## V3.57 动态体积水案例（多边形/矩形几何位移水面）

**目标**：新增「三维特效」分类动态体积水案例，将用户上传样例（`a1e67386-long-input-20260826-093616.txt`，原作者 lv-Jis 的 Cesium 动态体积水）的完整效果移植到本项目，并支持**指定多边形**（地图绘制或坐标文本）构建真实几何起伏的水面。

**实施内容**：

1. `src/cases/dynamic-volume-water/VolumeWaterSurface.ts`：移植核心渲染对象 `VolumeWaterSurface`（自定义 `Cesium.Primitive` + 自定义 GLSL 顶点/片元着色器 + 程序化网格几何）：
   - 顶点着色器：5 层 fBm 波浪叠加（`vertexSeaHeight`，freq 起始 0.16×1.9 递进、amp ×0.22、choppy 混合），`st→centered` 局部 uv，有限差分（±eps）求高度差生成切空间扰动法线，`normal * displacement`（`geometryWaveHeight`）做真实几何位移。
   - 片元着色器：6 层 fBm 采样，切空间→世界法线重建，crest 泡沫（高度阈值 + 斜率），菲涅尔天空反射，`czm_sunDirectionEC` 漫反射 + 高光 sparkle + slopeGlint，`czm_gammaCorrect` 输出。
   - 网格：局部 X/Y 平面（Z=0）+ ENU frame modelMatrix；`meshSegments` 控制 xSegments，ySegments 按 `depth/width` 比例推导；多边形模式用射线法 `isPointInPolygon` + 半格采样 `shouldKeepPolygonVertex` 保留边界格点裁剪网格。
   - 范围模式：`polygon`（按顶点质心建 ENU frame，多边形裁剪）/`rectangle`（中心经纬度 + 宽深高）。
   - 参数：animate、timeScale、speed、waveScale、waveHeight、geometryWaveHeight、choppy、foam、normalStrength、fresnel、specular、alpha、deepColor/shallowColor/foamColor、meshSegments、矩形尺寸/中心/高度、多边形顶点。
2. `src/cases/dynamic-volume-water/VolumeWaterDemo.vue`：项目风格参数面板（运动/外观/范围三组，滑块 + 颜色选择 + select），**指定多边形**两种方式：地图绘制（`LEFT_CLICK` 采集顶点、`RIGHT_CLICK`/`LEFT_DOUBLE_CLICK` 结束，绘制预览点与闭合线）与坐标文本输入（`经度,纬度;...` 解析），应用后自动重建 + flyTo；矩形/多边形模式即时切换。
3. `src/cases/dynamic-volume-water/index.ts`：注册 `effects` 三维特效分类，标题「水面效果-动态体积水」，tag「材质效果」；未提供截图，卡片显示"暂无截图"占位。
4. `src/cases/index.ts`：注册 `dynamicVolumeWaterCase`（置于 water-reflection 之后）。

**关键踩坑（后续案例必读）**：

1. **`Cesium.Appearance` 必须设置 `material`**，否则 `Appearance.prototype.update` 返回 `undefined`，`Primitive.prototype.update` 在 `createCommands` 前直接 `return`，渲染命令不生成（画面完全无该 primitive）。`new Cesium.Appearance({ ..., material: Cesium.Material.fromType(Cesium.Material.ColorType) })` 即可；自定义片元着色器使用 `out_FragColor`，Color 材质的 `czm_getMaterial` 定义无害。
2. **Cesium 1.144 的 `Pass` 枚举已扩展**：ENVIRONMENT=0、GLOBE=2、**OPAQUE=9、TRANSLUCENT=10**（旧版 OPAQUE=4/TRANSLUCENT=6 已废弃）。调试 commandList 时按新枚举判断 pass。
3. **`Primitive.geometryInstances` 会在几何上传 GPU 后被置 undefined**（`releaseGeometryInstances` 默认 true，`createVertexArray` 中 `primitive.geometryInstances = void 0`），不能据此判断几何是否存在；用 `_va`（vertexArray）、`_colorCommands`、`_boundingSphereWC` 判断渲染状态。
4. **Cesium 1.144 的 Primitive 内部无 `_primitive` 对象**（旧版结构），渲染状态直接挂在 `_va`/`_colorCommands`/`_sp` 上。
5. **无头 swiftshader 验证 WebGL 画面**：canvas 默认 `preserveDrawingBuffer=false`，用 2D `drawImage` 或 `toDataURL` 读主 canvas 会得到空白/黑色，像素分析不可信。需用 CDP `Page.captureScreenshot` 截取真实合成画面，再用 pngjs 解码统计颜色占比。
6. **持续动画导致 playwright `page.screenshot` 超时**（等待两帧稳定永不满足），改用 CDP 截图；验证脚本可全局安装 `playwright-core@1.49.0`（匹配 `~/.cache/ms-playwright/chromium-1234`）+ `pngjs`。

**验证标准**：

- `npm run build` 通过（vue-tsc + vite，52s，2086 modules）。
- 无头浏览器（Playwright + chromium-headless-shell + swiftshader）验证：
  - 首页点击「水面效果-动态体积水」卡片进入案例，零 pageerror、零 console error。
  - CDP 截图像素分析：初始默认多边形（青岛）蓝色系像素占比 28%；切换矩形模式后 30%（矩形参数面板出现）；应用自定义 4 点多边形后 47%（`result-hint` 显示「已应用多边形水面（4 个顶点）」），水面均真实渲染。
  - 关闭波浪动画开关成功、滑块设置成功、`status-mask` 无错误遮罩。
  - 注：无头环境下 Bing 影像 provider 未就绪（`imageryReady` 未定义），底图为深色 baseColor，不影响水面渲染验证；真实环境影像正常。

## V3.56 缓冲区案例图标、边框与端点/拐角样式修复

**目标**：修复 V3.55 三个缓冲区案例的用户反馈问题：补充案例图标；显示边框及边框参数无效；端点/拐角样式切换无效果；面案例待缓冲多边形不明显。

**问题根因**：

1. 边框无效：`PolygonGraphics.outline/outlineColor/outlineWidth` 在地面多边形上渲染不可靠（用户侧不可见）。改用独立 `polyline` 实体绘制缓冲环边框，开关/颜色/宽度直接作用于 polyline 属性。
2. 端点/拐角样式无效：`@turf/buffer` 的源码**忽略** `joinStyle`/`endCapStyle`（内部 `BufferOp.bufferOp(geom, distance, steps)` 仅透传 steps）。改为直接调用完整版 `jsts`（2.7.1）的 `BufferOp(geom, BufferParameters)`：`setJoinStyle`（round/miter/bevel）+ `setEndCapStyle`（round/flat/square）+ `setQuadrantSegments`（steps）。经纬度→平面投影沿用 turf 的方位等距投影方案（`geoAzimuthalEquidistant` + `earthRadius` scale）。
3. 面案例源面不明显：源多边形填充由白色 0.18 改为黄色 0.35，并新增黄色 3px 源面轮廓 polyline。

**实施内容**：

1. 依赖：新增 `jsts@^2.7.1`、`d3-geo`、`@turf/center`；新增 `@types/d3-geo`；新增 `src/jsts.d.ts` 类型声明（jsts 无官方类型）。
2. `src/cases/measure-lib/buffer.ts` 重写：基于 jsts `BufferOp` + `BufferParameters` 实现 `pointBuffer/lineBuffer/polygonBuffer`，`joinStyle`/`endCapStyle`/`steps` 全部生效；保留 `bufferOuterRing` 与 `BufferParams` 接口（组件无需改动调用签名）。
3. 三个案例组件：缓冲边框从 polygon outline 改为独立 polyline 实体（`borderPolyline`），`applyBufferStyle` 更新 show/width/material，线/面案例 `rebuildBuffer` 同步更新 positions。
4. 三个案例 `index.ts`：新增 `icon` 引用（点缓冲用 image-1、线缓冲用 image-3、面缓冲用 image-2，用户提供截图）。
5. 面案例：源面填充改黄色 0.35 + 黄色 3px 轮廓 polyline。

**jsts 模块加载说明**：jsts 为 CJS/UMD 包且内部自带 `__esModule: true`，会误导 vite 的 CJS interop（`import default` 取到 `.default` 为 undefined）。`buffer.ts` 使用 `import * as jstsModule` + 运行时 `operation` 存在性判断兼容 vite dev（esbuild prebundle）与 vite build（rollup commonjs）。

**验证标准**：

- `npm run build` 通过（vue-tsc + vite）。
- 无头浏览器（Playwright + swiftshader）验证：
  - 首页空间分析分类三个缓冲卡片均显示 icon（`hasImg: true`）。
  - 点缓冲：坐标创建生成 1 点 + 1 缓冲 polygon + 1 边框 polyline；边框开关关闭后 polyline `show=false`；边框颜色改红后材质为 RGB(1,0,0)；缓冲环 193 点（steps=48）。
  - 线缓冲：库函数直接验证 round/miter/bevel 拐角处坐标不同（round 弧形过渡多采样点、miter 尖角直达、bevel 切角）、flat 端点环 5 点 vs round 131 点（UI 切换 select 后生效）。
  - 面缓冲：绘制 3 顶点闭合生成 1 源面 + 1 源轮廓 + 1 缓冲 + 1 边框（polys:2 lines:2）。
  - build 产物（vite preview）同样验证通过，全程零 pageerror。
  - 注：无头 swiftshader 下地图点击拾取（pickPosition）偶发返回 null 导致个别顶点丢失（退化为直线时 joinStyle 无可见差异），为测试环境渲染时序限制；真实 GPU 环境拾取正常。

## V3.55 点/线/面缓冲区分析三案例

**目标**：新增三个「空间分析」分类缓冲区案例：点数据、线数据、面数据的缓冲区生成，支持缓冲值、方角/圆角等参数设置。

**实施内容**：

1. 依赖：引入 `@turf/buffer`、`@turf/helpers`（GeoJSON 缓冲计算，支持 `joinStyle`/`endCapStyle`/`steps`）。
2. `src/cases/measure-lib/buffer.ts` 新增共享缓冲区工具：`pointBuffer(lng, lat, params)`、`lineBuffer(lngLats, params)`、`polygonBuffer(lngLats, params)`、`bufferOuterRing(poly)`；`BufferParams` 含 `radius`(m)、`joinStyle`（round 圆角/miter 方角/bevel 斜角）、`endCapStyle`（round 圆端/flat 平端/square 方端）、`steps`（圆滑度）。`polygonBuffer` 内部对顶点环自动闭合（turf `polygon()` 要求 ring ≥4 点）。
3. `src/cases/point-buffer/` 新增「空间分析-点缓冲区分析」：地图点击或输入经纬度创建点，按半径(m)生成圆形缓冲区；参数面板含半径、圆滑度、填充颜色/透明度、边框开关/颜色/宽度；已建缓冲区样式实时更新。
4. `src/cases/line-buffer/` 新增「空间分析-线缓冲区分析」：LEFT_CLICK 采集顶点、右键/双击结束生成折线并自动生成缓冲；参数面板含缓冲值(m)、端点样式（圆角/平角/方角）、拐角样式（圆角/方角/斜角）、圆滑度及显示样式；参数变更后重算所有已绘折线的缓冲。
5. `src/cases/polygon-buffer/` 新增「空间分析-面缓冲区分析」：LEFT_CLICK 采集顶点、右键/双击闭合生成面并自动生成缓冲；参数同线缓冲案例；参数变更后重算所有已绘面的缓冲。
6. 三个案例均已注册进 `src/cases/index.ts`（`analysis` 空间分析分类，排在量测案例之后）。遵循新约定：**新案例不自动生成 icon，卡片默认显示"暂无截图"占位**（`DemoCard.icon` 为可选，App.vue 用 `v-if="demo.icon"` 处理）。

**验证标准**：

- `npm run build` 通过（vue-tsc + vite，约 9.6s），`git diff --check` 无空白错误。
- 无头浏览器（Playwright + swiftshader）验证：
  - 首页空间分析分类下三个新卡片显示"暂无截图"（无 icon）。
  - 点缓冲：按坐标创建生成 1 点 + 1 缓冲；地图点击创建缓冲环 193 点；半径改 3000 后新建缓冲正常；清除后归零。
  - 线缓冲：绘制 2 点右键结束生成 1 线 + 1 缓冲；拐角样式切 miter 后缓冲仍存在（未崩溃）。
  - 面缓冲：绘制 3 点右键闭合生成 1 面 + 1 缓冲；缓冲值 800→1500 后缓冲重算正常；3 点面不抛 `LinearRing must have 4 or more Positions`（自动闭合环）。
  - 全程零 pageerror。

## V3.54 绘制案例图标替换与实时预览/开关修复

**目标**：替换三个绘制案例图标为用户上传的 image-1/2/3，并为折线/多边形案例实现绘制过程中的实时预览，修复顶点/边框显示开关与预览崩溃问题。

**实施内容**：

1. 图标替换：用户上传 `image-1.webp`→`point-create/icon.webp`、`image-2.webp`→`polyline-create/icon.webp`、`image-3.webp`→`polygon-create/icon.webp`（均为 1237~1242×653~656 本地 webp，无外链）。
2. `polyline-create` 实时预览：新增 `previewPoint`（`PointPrimitiveCollection`）与 `previewLine`（`PolylineCollection`）primitive；`MOUSE_MOVE` 更新 `lastPreviewPos` 并调用 `updatePreview()` 重绘已采集点 + 到鼠标的预览线段。
3. `polyline-create` 顶点开关修复：顶点实体始终创建并存入 `vertexEntities` 数组，`watch(showPoints)` 调 `applyShowPoints()` 统一设置 `point.show`（原实现仅开启时创建，切换无效）。
4. `polyline-create` 预览崩溃修复：`PolylineCollection` 的 polyline `material` 必须是 `Material` 实例（`Polyline.js` setter 仅接受 Material，销毁时调用 `this._material.destroy()`），传 Color 报 `this._material.destroy is not a function` 且渲染停止；改用它引 `measure-lib/material.ts` 的 `makeLineMaterial(previewColor)`。
5. `polygon-create` 实时预览：`createPreviewEntities()` 建 `__preview-face__`/`__preview-border__` 实体；`updatePreview()` 在加点/移动时更新面 `PolygonHierarchy`（≥3 点显示）与首尾闭合预览边框；`finishPolygon` 隐藏预览。
6. `polygon-create` 边框开关修复：边框 polyline 始终创建、以 `show: showBorder.value` 控制显隐；`updateExistingPolygons` 更新 `polyline.show`（原实现仅开关开启时创建边框）。
7. `polygon-create` clampToGround 修正：`PolygonGraphics` 无 `clampToGround` 属性（TS 编译错误），改为 `height: 0 + heightReference: CLAMP_TO_GROUND` 方案；预览面与最终面同步；移除未用 import。
8. `polygon-create` 预览 NaN 崩溃修复：`PolygonGeometryUpdater._computeCenter` 计算质心时，当 `hierarchy` 仅 1~2 个点（area=0）产生 NaN 位置，而预览面设置了 `heightReference`（含 NONE），每次 hierarchy 变更都会经 `GroundGeometryUpdater` 创建 `TerrainOffsetProperty` 触发 `cartesian has a NaN component`；修复为顶点 <3 时不 `setValue` hierarchy（只隐藏预览面），并去重 `lastPreviewPos`（点击瞬间 MOUSE_MOVE 先于 LEFT_CLICK 导致预览点与刚采集点重合、出现重复顶点再次退化）。

**验证标准**：

- `npm run build` 通过（vue-tsc + vite，约 8.5s），`git diff --check` 无空白错误。
- 无头浏览器（Playwright + swiftshader）验证：
  - polyline 案例绘制中 `PolylineCollection` 含 1 条预览线 + `PointPrimitiveCollection` 含 2 个预览点；右键闭合后 1 条 polyline + 2 个顶点实体（show true）；显示顶点开关关闭后实体 `point.show` 全为 false。
  - polygon 案例绘制中预览面 `hierarchy` 3 点 + 预览边框 4 点，**全程零 NaN 错误**（`errs: 0`）；右键闭合后 1 个 polygon + 1 个边框 polyline；显示边框开关关闭后 `polyline.show` 由 true→false。
  - point 案例回归：点击 2 次右键结束生成 2 个 point + 2 个 label。
  - 全程无 pageerror。

## V3.53 标点/折线/多边形动态绘制三案例

**目标**：新增三个「标记标绘」分类案例：在地图上动态创建点、折线、多边形面，均支持鼠标点击绘制与参数实时调整。

**实施内容**：

1. `src/cases/point-create/` 新增「标点创建-动态点标注」案例（`PointCreateDemo.vue`、`index.ts`、`icon.webp`）：点击地图经 `pickPosition` 拾取后创建 Entity point + label（序号 P1/P2...）；参数面板提供点大小（3~40）、填充色（7 色色板）、轮廓宽度、点高度（米）、贴地（`CLAMP_TO_GROUND`）与标签显示开关；`watch` 各参数后遍历实体实时更新。
2. `src/cases/polyline-create/` 新增「线面绘制-动态折线」案例（`PolylineCreateDemo.vue`、`index.ts`、`icon.webp`）：单击采集顶点、右键/双击结束生成折线；参数面板提供线宽（1~12）、线颜色（7 色色板）、线型（实线/虚线 `PolylineDashMaterialProperty`/发光 `PolylineGlowMaterialProperty`/描边 `PolylineOutlineMaterialProperty`）、贴地与显示顶点；已绘折线参数实时更新。
3. `src/cases/polygon-create/` 新增「线面绘制-动态多边形面」案例（`PolygonCreateDemo.vue`、`index.ts`、`icon.webp`）：单击采集顶点、右键/双击闭合生成 `PolygonHierarchy` 面；参数面板提供填充色（7 色色板）、透明度（0~1）、面高度（米）、边框开关/宽度/颜色（取色器）与贴地；边框用独立 polyline 实体（首尾闭合）便于控制；已绘面参数实时更新。
4. 三个案例已注册进 `src/cases/index.ts`（均属 `draw` 标记标绘分类），图标为 Pillow 绘制的 1235×653 webp（点/线/面示意图形）。
5. 共用 `measure-lib` 的 `pickPosition`（深度拾取回退射线/椭球拾取）与 `createMapScene`/`loadBingImagery` 公共初始化。

**验证标准**：

- `npm run build` 通过（vue-tsc + vite，约 8.7s）。
- 无头浏览器（Playwright + swiftshader）逐个打开三案例：点案例点击 3 次后场景含 3 个 point + 3 个 label，点大小滑杆 10→30 实时生效；折线案例点击 4 次右键结束生成 1 条 polyline，切换线型后 `material` 变为 `PolylineDashMaterialProperty`；多边形案例点击 3 次双击闭合生成 1 个 polygon + 1 个 polyline 边框，透明度滑杆后 `material.getValue(0).color.alpha` 由 0.5→0.9；全程无 error panel、无 pageerror。

## V3.52 移除无真实案例的占位卡片

**目标**：清理案例中心首页中所有没有真实案例实现（无 `component`）的占位卡片，保证每张卡片均可点击打开完整案例。

**实施内容**：

1. `src/cases/index.ts` 中移除 12 个仅含元数据的内联占位卡片：`post-glow`（后处理-泛光效果）、`water-ocean`（水面效果-海洋）、`particle-fountain`（粒子系统-喷泉）、`particle-fire`（火焰粒子-篝火）、`scan-light`（光柱特效-扫描线）、`flight-path`（路径动画-飞行轨迹）、`breathing-pin`（标点样式-呼吸灯）、`area-draw`（线面绘制-区域标注）、`viewshed`（可视域分析）、`terrain-exaggeration`（地形夸张）、`population-heatmap`（热力图-人口密度）、`fly-tour`（常用视角-飞行漫游）。
2. 保留全部 33 个有真实组件的案例卡片；`App.vue` 的 `openCase` 逻辑（仅 `demo.component` 存在时可打开）无需改动，占位卡移除后所有卡片均可达。

**验证标准**：

- `npm run build` 通过（vue-tsc + vite）。
- 无头浏览器打开首页：分类计数分别为 三维特效 14 / 标记标绘 1 / 空间分析 7 / 地形影像 1 / 数据可视化 4 / 常用工具 6，默认分类渲染 14 张卡片，全程无 pageerror。

## V3.51 3DTiles 加载案例检查器与阴影光源修复

**目标**：修复第二轮迭代中发现的三项问题：3DTiles 加载案例的检查器面板无法关闭且位置在右侧、阴影光源开关无实际效果、地球自转动画无法播放。

**实施内容**：

1. 地球自转动画修复：CZML 加载完成后与开启旋转 toggle 两处均设置 `viewer.clock.shouldAnimate = true`，确保时钟推进、地球与卫星轨道持续转动。
2. 三个案例卡片图标分别替换为用户上传的 image-1/2/3（`earth-rotation` → image-1 转 webp，`tiles-3d-load` → image-2，`tiles-3d-flatten` → image-3）。
3. 检查器面板重构（`src/cases/tiles-3d-load/Tiles3DLoadDemo.vue`）：弃用 `viewer.extend(viewerCesium3DTilesInspectorMixin)`（该 mixin 只创建不销毁，重复调用还会抛 defineProperties 冲突），改为直接实例化 `Cesium3DTilesInspector` 并保存 widget/容器引用；开启时创建容器挂载到 `viewer.container`，关闭时 `destroy()` widget 并移除容器，卸载时同样清理。
4. 检查器面板位置移到左侧：容器使用自定义类名 `tiles-inspector-container`（inspector 内部不依赖 Cesium 默认容器类名），通过组件非 scoped 样式定位 `top:12px; left:12px; right:auto`，相对案例区域左侧 12px。
5. 阴影光源开关修复：默认 `SunLight` 方向由当前时钟时间决定，此时为夜晚则阴影不渲染导致开关看似无效；开启时改为设置固定 `DirectionalLight`（方向 `(-0.5,-0.6,0.7)`、强度 3.0）并加大 `shadowMap.maximumDistance`，关闭时还原 `SunLight`，同时维持 `globe.enableLighting` 与 `scene.shadowMap.enabled` 联动并 `requestRender()`。

**验证标准**：

- `npm run build` 通过（vue-tsc + vite，约 8.6s）。
- 无头浏览器（Playwright + swiftshader）验证：3DTiles 加载案例加载后 `tilesets=1`、无 error panel；监视器开启后面板相对案例区域左侧偏移 12px、内部含完整 `cesium-cesiumInspector` 组件，关闭后容器移除；阴影开启后 `shadowMap.enabled=true`、`globe.enableLighting=true`、光源为 `DirectionalLight`，关闭后恢复 `SunLight`；地球自转案例 `clock.shouldAnimate=true`、CZML 数据源 1 个；全程无 pageerror。


**目标**：参考 Arc3DLab-SDK-Pro 项目的「加载3DTiles」「3DTiles模型压平」「地球自转」三个案例，移植为当前案例中心的三个独立案例。

**实施内容**：

1. `src/cases/tiles-3d-load/` 新增「数据可视化-3DTiles加载」案例（`Tiles3DLoadDemo.vue`、`index.ts`、`icon.webp`）：通过 `Cesium3DTileset.fromUrl` 加载远程 3DTiles 服务，支持模型显示/阴影光源/监视器（`viewerCesium3DTilesInspectorMixin`）开关，`tileLoad` 中 `trimLoadedTiles` 保持显存，`offsetHeight` 修正模型高度后 `flyTo`。
2. `src/cases/tiles-3d-flatten/` 新增「数据可视化-3DTiles模型压平」案例（`Tiles3DFlattenDemo.vue`、`Flatten.ts`、`index.ts`、`icon.webp`）：移植 SDK 的 `Flatten` 类（基于 `CustomShader` 的 ECEF 矩形区域压平），默认高度 -50 米，区域顶点沿用参考项目原 4 个 ECEF 坐标，开关控制压平/恢复。
3. `src/cases/earth-rotation/` 新增「常用工具-地球自转」案例（`EarthRotationDemo.vue`、`data/simple.czml`、`index.ts`、`icon.webp`）：CZML 卫星轨道加载 + 地球自转 toggle，速度滑杆 200~5000，参考 SDK `Navigation` 源码使用 `scene.postUpdate` 监听 + `Transforms.computeIcrfToFixedMatrix` + `camera.lookAtTransform`，关闭时移除监听并复位 `Matrix4.IDENTITY`。
4. 三个案例已注册进 `src/cases/index.ts`（tiles-3d-load/tiles-3d-flatten 属 `data` 分类，earth-rotation 属 `tools` 分类），图标为本地生成的 1236×655 webp。
5. 地形加载统一参考「地形效果-显示与夸张」案例：加载前设置 `globe.depthTestAgainstTerrain = true`、`globe.maximumScreenSpaceError = 2`，`await loadWorldTerrain(viewer)` 后显示"正在加载Cesium World Terrain..."状态，卸载时 `disposed` 保护。

**数据源说明**：案例①原参考 beipiao 远程 tileset（`map.larkview.cn/tileserver`），该服务当前返回空响应；按用户决策改用会昌倾斜摄影数据（与案例②一致），`offsetHeight` 相应改为 555。

**验证标准**：

- `npm run build` 通过（vue-tsc + vite，约 8.5s）。
- 无头浏览器（Playwright + swiftshader）逐个打开三个案例：卡片存在、无 error panel、无 pageerror、帧推进正常；案例①/② 场景中 `Cesium3DTileset` 数量为 1，案例③ 加载 CZML 数据源。
- Cesium Ion 地形服务（`api.cesium.com/v1/assets/1/endpoint`）存在间歇性故障，偶发导致地形加载报 "Request has failed."，重试后即恢复，属外部服务不稳定。

## V3.49 深度图案例更名与图标替换

**目标**：将「空间分析-矩形范围深度图」案例更名为「空间分析-深度图提取」，并将案例卡片图标替换为用户上传的 `image-2.webp`。

**实施内容**：

1. `src/cases/rectangle-depth-map/index.ts` 中 `title` 更新为"空间分析-深度图提取"。
2. 新增本地 `src/cases/rectangle-depth-map/icon.webp`（1239×656，用户上传 image-2）并在 `index.ts` 中通过 `icon` 字段引用，案例卡片展示新图标。

**验证标准**：

- 空间分析分类中深度图案例卡片显示新名称"空间分析-深度图提取"与上传图标。
- TypeScript 类型检查和 Vite 生产构建通过（9.42s）。

## V3.48 噪声云团案例图标替换

**目标**：将「爆炸特效-噪声云团」案例卡片图标替换为用户上传的 `image-1.webp`。

**实施内容**：

1. `src/cases/explosion-boom/icon.webp` 替换为用户上传的 1236×655 image-1 图片，案例卡片展示新图标。

**验证标准**：

- 三维特效分类中爆炸特效-噪声云团案例卡片显示上传图标。
- TypeScript 类型检查和 Vite 生产构建通过（8.27s）。

## V3.47 水面倒影图标替换与地形数据加载

**目标**：将「水面效果-Primitive真实倒影」案例卡片图标替换为用户上传的 `image-1.webp`，并在场景初始化时参考其他案例加载 Cesium World Terrain 地形数据。

**实施内容**：

1. `src/cases/water-reflection/icon.webp` 替换为用户上传的 1237×655 image-1 图片，案例卡片展示新图标。
2. `WaterReflectionDemo.vue` 场景初始化参考 `rectangle-depth-map`/`terrain-control` 等案例：启用 `depthTestAgainstTerrain`，通过公共 `loadWorldTerrain` 异步加载 Cesium World Terrain 地形，加载完成后再创建水面 Primitive、中心球体与浮动盒子，并在卸载时复用公共销毁流程。
3. 修复地形加载完成后状态提示未清除的问题：`await loadWorldTerrain(viewer)` 返回后置空 `statusMessage`，加载期间仍显示"正在加载Cesium World Terrain..."，就绪后遮罩消失。

**验证标准**：

- 三维特效分类中水面倒影案例卡片显示上传图标。
- 打开案例加载真实地形（`scene.terrainProvider` 为 `CesiumTerrainProvider`，`globe.depthTestAgainstTerrain` 为 true），水面贴合湖盆渲染倒影。
- 状态提示时序：地形加载期间显示"正在加载Cesium World Terrain..."，加载完成（约 6 秒）后清除并持续保持为空。
- 无头浏览器验证：无 `pageerror`、无 `console.error`、无错误面板、PING 7ms、水面 Primitive 存在、渲染循环持续（frameNumber 105 → 112）。
- TypeScript 类型检查和 Vite 生产构建通过（8.46s）。

## V3.46 动态水面-Primitive 真实倒影移植

**目标**：基于 `dynamic-water-reflection` 规格重新移植 Arc3DLab-SDK-Pro 参考项目「011-动态水面（带倒影）」案例，实现丽江水域场景、波纹、反射、光照、高光与浮动盒子控制，适配 Cesium 1.144 与项目公共场景生命周期。

**实施内容**：

1. 新增 `.monkeycode/specs/dynamic-water-reflection/` 需求与设计文档（EARS 需求、架构图、组件接口、正确性属性与测试策略）。
2. 实现 `src/cases/water-reflection/WaterReflectionPrimitive.ts`（863 行，移植自参考 `WaterPrimitive.ts`）：`PolygonGeometry` + `MaterialAppearance` 水面图元，镜像虚拟相机将场景渲染至离屏帧缓冲生成反射纹理，自定义 GLSL 水面材质按法线扰动采样反射纹理；导出 `WaterReflectionOption` 接口（`height`、`flowDegrees`、`positions`、`normalMapUrl`、`rippleSize`、`waterAlpha`、`waterColor`、`reflectivity`、`lightDirection`、`sunShiny`、`distortionScale`）与可变属性 getter/setter。
3. 离屏渲染采用手动场景渲染流程（`updateFrameState` + `Cesium3DTilePassState` + `updateEnvironment` + `updateAndExecuteCommands` + `resolveFramebuffers`），避免嵌套 `scene.render()` 导致主线程热循环；`UniformState.prototype.updateFrustum` 与 `PerspectiveFrustum.prototype.clone` 覆写通过 `customProjectionMatrix` 支持反射裁剪平面。
4. 帧缓冲 `colorTexture`（RGBA，hdr 时 HALF_FLOAT/FLOAT）+ `depthTexture`（`DEPTH_COMPONENT` + `UNSIGNED_INT`），`destroyAttachments: false`；纹理所有权归 `Material` 统一管理，`depthTexture` 由 Primitive 手动销毁，避免双重销毁。
5. 反射材质以占位纹理初始化 `image` 与 `normalTexture` 采样器并标记 `sampler2D`，避免采样器为空引发运行时错误；法线贴图异步加载后替换。
6. 实现 `src/cases/water-reflection/WaterReflectionDemo.vue`（206 行）：公共场景 + Bing 影像 + 时钟动画，相机定位丽江水域；黄色中心球体与浮动盒子实体（`CallbackProperty` 依时钟更新位置、`scene.preUpdate` 更新朝向）；全量参数面板（波纹大小、透明度、反射率、扭曲强度、高度、光照方向、太阳高光、水体颜色、盒子大小/速度/颜色/显示）。
7. 复制 `water-img.ts` base64 法线纹理，新建 `water-positions.ts`（约 420 个丽江水域经纬度轮廓点，高度 `1480 + 5 * Math.random()`，`perPositionHeight: true`），本地 `icon.webp` 与 `index.ts`。
8. 注册「水面效果-Primitive真实倒影」案例卡片至 `src/cases/index.ts`（category `effects`）。

**验证标准**：

- `npm run build` 通过（8.35s，vue-tsc 类型检查 + vite build），`git diff --check` 无输出。
- 无头浏览器（Playwright + swiftshader）打开案例：卡片存在、无 `pageerror`、无 `console.error`、无错误面板、PING 3ms（主线程无热循环）。
- 水面 Primitive 存在（材质类型 `ReflectionWater`），渲染循环持续（frameNumber 70 → 76，约 4fps，swiftshader 软件渲染正常帧率），截图显示水面、面板与工具条渲染正常。
- 参数面板联动生效（波纹/透明度/反射率/扭曲/高度/光照/高光/颜色/盒子）。

## V3.45 移除水面动态倒影与 Primitive 真实倒影案例

**实施内容**：

1. 移除“水面效果-动态倒影”案例（`src/cases/water-reflection/`，含 `WaterReflectionDemo.vue`、`index.ts`）及其在 `src/cases/index.ts` 中的导入与注册。
2. 移除“水面效果-Primitive真实倒影”案例（`src/cases/reflection-water-primitive/`，含 `ReflectionWaterPrimitiveDemo.vue`、`WaterReflectionPrimitive.ts`、`index.ts`）及其在 `src/cases/index.ts` 中的导入与注册。
3. 保留共享的“水面效果-Cesium内置材质”案例（`src/cases/builtin-water/`）及其资源（`waterNormalsSmall.jpg`）；`water-reflection-depth-map` 规格目录作为历史记录保留。

**验证标准**：

- `npm run build` 通过（7.93s），无残留 import 错误。
- `git diff --check` 无输出。
- 无头浏览器首页列表共 19 个案例卡片，不再出现“水面效果-动态倒影”与“水面效果-Primitive真实倒影”，其余案例正常显示。

## V3.44 真实倒影帧缓冲与材质纹理销毁冲突修复

**实施内容**：

1. 修复 `DeveloperError: This object was destroyed`：`ensureFramebuffer` 在画布尺寸变化（窗口 resize）时先销毁 `colorTexture`/`depthTexture` 再销毁 `framebuffer`，而 `Framebuffer.destroy()` 在 `destroyAttachments`（默认 true）下会连带销毁挂载纹理，导致对同一纹理双重销毁。
2. 调整纹理所有权：`colorTexture` 与 `normalTexture` 交由 `Material` 统一管理（`Material.update` 在 uniform 值变化时自动销毁旧缓存纹理，`material.destroy()` 销毁全部缓存纹理）；`framebuffer` 改为 `destroyAttachments: false` 不再拥有附件；`depthTexture` 由 `WaterReflectionPrimitive` 手动销毁。
3. 修复 `loadNormalTexture` 中手动销毁占位纹理与 `Material` 缓存冲突的潜在双重销毁问题，替换占位纹理后由 `Material` 统一接管。
4. 占位纹理拆分为 `image` 与 `normalTexture` 两个独立实例，避免同一纹理被两个 uniform 共享时一方替换导致另一方访问已销毁纹理。

**验证标准**：

- `npm run build` 通过（8.04s）。
- `git diff --check` 无输出。
- 无头浏览器（Playwright + swiftshader）连续 4 次窗口尺寸变化（800x600 / 1300x900 / 950x720 / 1200x800）：无 `pageerror`、无 `Rendering has stopped`、无 `destroyed` 错误，页面保持响应。
- 切换到“水面效果-动态倒影”再返回“水面效果-Primitive真实倒影”：无错误，页面正常。
- 水面 `Primitive` 渲染正常：离屏反射纹理 1034x445、着色器编译成功、屏幕中心拾取命中、渲染循环持续。

## V3.43 真实倒影离屏渲染改用手动场景渲染流程

**实施内容**：

1. 定位并消除主线程热循环：`updateReflection` 中嵌套 `scene.render()` 触发约 1000fps 的重入渲染（12 秒计数 12281 次），导致点击案例后主线程阻塞 90-170 秒以上。
2. 参考 Arc3DLab `WaterPrimitive` 手动渲染流程改写 `updateReflection`：渲染前先 `scene.updateFrameState()`，设置 `frameState.passes.render = true` 与模块级 `Cesium3DTilePassState`，随后 `updateEnvironment()`、`updateAndExecuteCommands(passState, backgroundColor)`、`resolveFramebuffers(passState)` 将场景直接渲染进反射帧缓冲，不再嵌套调用 `scene.render()`。
3. 移除临时 `[WRP]` 诊断日志与 `rendering` 重入标志。
4. 修复第二个渲染错误 `'batchId' : undeclared identifier`：Cesium 的 `createShaderProgram` 无条件注入 `czm_batchTable_pickColor(batchId)`，自定义顶点着色器补充 `in float batchId;` 声明（与参考实现一致）。
5. `Cesium3DTilePass`/`Cesium3DTilePassState` 在 Cesium 1.144 运行时导出但缺少类型声明，改经 `import * as Cesium` 的运行时命名空间取值。

**验证标准**：

- `npm run build` 通过（8.67s）。
- `git diff --check` 无输出。
- 无头浏览器（Playwright + swiftshader）点击“Primitive真实倒影”卡片后：主线程 PING 正常（不再阻塞）、无 `pageerror`、无 `Rendering has stopped`、无着色器编译错误。
- 页面探测：水面 `Primitive` 存在且 `hasShaderProgram: true`，离屏反射纹理尺寸 1034x445 与画布匹配且每帧更新，屏幕中心 `scene.pick` 命中水面 Primitive，渲染循环持续（`frameNumber` 持续增长），无 Cesium 错误面板。
- `http://127.0.0.1:5173/src/cases/reflection-water-primitive/WaterReflectionPrimitive.ts` 等模块访问 200。

## V3.42 真实倒影顶点着色器 varyings 补齐

**实施内容**：

1. 修复案例渲染中断问题：自定义顶点着色器仅输出 `v_reflectionUv` 与 `v_worldPosition`，但默认 `MaterialAppearance` 片元模板（Textured 外观）需要 `v_positionEC`、`v_normalEC`、`v_st`，导致 GLSL 链接失败，场景停止渲染。
2. 在 `WaterReflectionPrimitive.ts` 顶点着色器中补齐 `v_positionEC`、`v_normalEC`、`v_st` 三个 varying，并复用 `czm_modelViewRelativeToEye`、`czm_normal` 计算，与默认模板保持一致。
3. 确认 `czm_viewerPositionWC` 与 `czm_model` 均为 Cesium 1.144 内置自动 uniform，片元材质源码无需改动。

**验证标准**：

- `npm run build` 通过（8.57s）。
- `git diff --check` 无输出。
- `http://127.0.0.1:5173/src/cases/reflection-water-primitive/WaterReflectionPrimitive.ts` 模块可访问，已含新 varying。
- 预览刷新后水面材质着色器链接正常，水面与倒影正常渲染。

## V3.41 真实倒影帧缓冲深度纹理格式修复

**实施内容**：

1. 修复渲染报错 `The depth-texture pixel-format must be DEPTH_COMPONENT`。
2. 帧缓冲深度纹理从 `DEPTH_STENCIL` 改为 `DEPTH_COMPONENT` 与 `UNSIGNED_INT`，满足 Cesium 1.144 帧缓冲校验。

## V3.40 真实倒影材质采样器初始化修复

**实施内容**：

1. 修复打开案例时报 `Cannot read properties of undefined (reading 'type')` 的运行时错误。
2. 自定义水面材质使用占位纹理初始化 `image` 与 `normalTexture` 采样器。
3. 法线贴图异步加载完成后替换占位纹理，并统一为采样器标记 `sampler2D`。

## V3.39 Primitive 真实水面倒影案例

**实施内容**：

1. 新增独立动态水面倒影案例，基于参考 `WaterPrimitive` 的镜像虚拟相机、帧缓冲和自定义水面材质结构。
2. 提供波纹、透明度、反射率、扭曲强度、水位、光照、高光、颜色及浮动盒子参数控制。
3. 使用参考示例的丽江水域、黄色球体与动态立方体场景。

## V3.38 水面边界视角与倒影可见性修复

**实施内容**：

1. 初始化和应用边界时，基于当前水域坐标范围定位相机。
2. 水面多边形保留顶点高程，确保水面与对象使用同一高度基准。
3. 扩大倒影条尺寸并提高基础可见度。

## V3.37 水面对象高度范围调整

**实施内容**：

1. 黄色中心球体高度滑块调整为 10 至 1500 米。
2. 浮动立方体高度滑块调整为 10 至 1500 米。

## V3.36 水面对象大小与高度控制

**实施内容**：

1. 水面倒影面板增加黄色中心球体的大小和高度控制。
2. 水面倒影面板增加浮动立方体的大小和高度控制。
3. 立方体大小同步应用到水面倒影条，保持对象与倒影视觉的尺度关联。

## V3.35 参考水域与波动倒影视觉

**实施内容**：

1. 动态水面倒影案例默认场景改为参考示例的丽江水域轮廓和 1480 米水位。
2. 场景补齐参考示例的黄色中心球体，以及位于 `100.66938, 26.56588` 的浮动立方体。
3. 倒影由多条水面反射条构成，每条根据时钟、波纹参数、扭曲强度和浮动物体移动产生独立横向偏移、竖向起伏和闪烁透明度，形成摇曳视觉。

## V3.34 水面动画参数与深度图交互增强

**实施内容**：

1. 动态水面倒影案例启用 `viewer.clock.shouldAnimate`，扩展波纹大小、反射率、扭曲强度、水面高度、光照方向、太阳高光和浮动物体参数。
2. 浮动物体与水面镜像倒影根据时钟持续移动，水位、物体显示和倒影显示保持独立控制。
3. 深度图案例增加起点、终点标记和鼠标移动过程中的矩形实时预览；第二次点击后保留透明度为 0.3 的最终矩形。
4. 深度图分辨率扩展至 1024 x 1024，地形采样改为分批执行并显示采样、预览和 TIFF 编码进度。

## V3.33 动态水面倒影与矩形范围深度图

**实施内容**：

1. 新增“水面效果-动态倒影”案例，保留 Water 材质的频率、速度、波幅、透明度、颜色和边界控制，并提供水面和倒影独立开关。
2. 在水面中加入浮动物体与对应镜像实体，形成可切换的水面倒影视觉。
3. 新增“空间分析-矩形范围深度图”案例，加载世界地形和三维建筑模型后，通过两个角点框选矩形。
4. 框选完成后自动按所选分辨率采样高程，左上角展示灰度深度图与高程统计，并支持 PNG、无压缩灰度 TIFF 下载。
5. 新增 `water-reflection-depth-map` 需求、设计和任务清单。

## V3.32 移除爆炸特效-空间反转案例

**实施内容**：

1. 从案例注册表移除“爆炸特效-空间反转”卡片。
2. 移除该案例的 Vue 组件、片元着色器、缩略图和噪声纹理。
3. 移除仅由该案例使用的 `ShadertoyLayer`。
4. 更新爆炸效果规格，保留“爆炸特效-噪声云团”作为唯一的爆炸效果案例。

## V3.31 统一双爆炸案例的生命周期与参数交互

**实施内容**：

1. 噪声云团案例卡片改用用户提供的 image-1 缓存资源作为构建期图标。
2. 噪声云团新增生命周期滑杆，范围为 0.2 至 30 秒；生命周期参数即时决定当前云爆对象的隐藏时间。
3. 空间反转案例新增相同的生命周期滑杆，扩大速度与全部爆炸参数范围；生命周期结束后隐藏画布，重新引爆时销毁旧 `ShadertoyLayer` 并创建新对象。
4. `ShadertoyLayer` 提供当前动画时间读取接口，供空间反转案例判断生命周期终点。

## V3.30 扩展云爆参数范围并改为单次生命周期

**实施内容**：

1. 将云团速度、显示尺寸、噪声尺度、fbm 细节、密度、烟化、半径、边缘柔和度和调色频率的滑杆扩大到覆盖弱、中、强效果区间。
2. 将 `noise-cloud` 公告牌最大点尺寸提高到 1024px，以匹配扩展后的显示尺寸范围。
3. 单次云爆完成 3 秒时间轴后隐藏当前对象；“重新引爆”销毁旧 `GpuParticleSystem` 和生命周期监听器，再创建新的世界坐标云爆对象。

## V3.29 消除云团方形边界并开放着色器参数

**问题**：单团云爆在点精灵边界输出不透明背景色，地图上出现方形区域；案例控制项无法调整云爆细节。

**实施内容**：

1. 移除点精灵内的背景色输出，以 `shape * cloudFade * cloudDensity` 作为 alpha；低 alpha 片元丢弃，地图只显示不规则云爆区域。
2. 新增噪声尺度、fbm 细节、云团密度、烟化程度、爆炸半径、边缘柔和度和调色频率 uniform。
3. 参数面板新增对应滑杆，默认值维持单次 Bim Boom Bam 着色器的原始观感。

## V3.28 基于单次 Bim Boom Bam 着色器重写噪声云团

**实施内容**：

1. `noise-cloud` 分支改用固定 `id=0.5`、固定背景参数和固定 8 octave gyroid/fbm，移除实例 seed、颜色查找纹理与可变噪声参数对云团外观的影响。
2. 按参考着色器加入中心差分法线、余弦调色、烟化混色与完整方形输出，消除多实例平铺导致的分割线。
3. 案例面板保留世界坐标定位、暂停、重新引爆、播放速度和显示尺寸；移除火焰类型、噪声尺度、细节、密度、烟化程度等无效控件。

## V3.27 消除噪声云团 GPU 状态纹理反馈回路

**问题**：浏览器控制台报告 `GL_INVALID_OPERATION: glDrawElements: Feedback loop formed between Framebuffer and active Texture`。

**修复**：噪声云团只有一个静止公告牌，其形状和动画完全来自片元着色器。因此 `noise-cloud` 实例跳过速度与位置的计算命令，渲染命令直接读取初始化的状态纹理，时间动画由渲染命令更新。普通粒子火焰继续执行原有 ping-pong 计算流程。

**验证结果**：`npm run build` 通过。

## V3.26 噪声云团改为 Shadertoy 主导世界坐标公告牌

**目标**：让 Shadertoy Bim Boom Bam 的云团着色器成为噪声云团案例的主体视觉，GPU 层仅承担经纬度世界坐标锚定、透视投影和深度测试。

**实施内容**：

1. `ExplosionBoomDemo.vue` 将粒子系统固定为一个静止点精灵：`size: 1`、速度/浮力/湍流/发射半径为 0、超长生命周期，粒子物理行为退出视觉主导。
2. 点精灵尺寸按米级 `cloudSize` 控制，顶点着色器按 Cesium 相机距离换算为屏幕尺寸，云团在世界坐标中随地图透视缩放。
3. 参数面板重构为 Shadertoy 语义：云团速度、云团尺寸、噪声尺度、噪声细节、云团密度、烟化程度；保留火焰类型、暂停、继续、重新引爆与经纬度定位。
4. `GpuParticleSystem` 新增 `smokeAmount` uniform，片元使用其控制参考 Shadertoy 的烟化颜色混合强度。
5. 同步更新 `.monkeycode/specs/explosion-effects/requirements.md` 与 `design.md`，记录“世界坐标 Shadertoy 云团公告牌”架构。

**验证结果**：

- `npm run build` 通过（vue-tsc + Vite，仅 chunk>500kB 预期警告）。
- 运行时视觉效果可通过浏览器预览交互确认。

## V3.25 Shadertoy 噪声云团与 GPU 粒子融合

**目标**：保持 GPU 粒子的经纬度世界坐标、相机跟随和地球遮挡，融合 Shadertoy Bim Boom Bam 的不规则噪声云团爆炸形态，形成与既有平滑火焰粒子明显不同的视觉效果。

**实施内容**：

1. 读取用户提供的 Bim Boom Bam 参考源码，提取 `gyroid`、8 octave `fbm`、`growth`、`fade`、`burn`、噪声半径和烟化混色核心结构。
2. `renderParticlesFragmentShader` 增加 `noise-cloud` 样式分支：每个粒子根据独立 seed 与 GPU 模拟时间计算爆发相位，在粒子点精灵内以 gyroid/fbm 生成不规则云团边缘、燃烧密度和烟化颜色。
3. `GpuParticleSystem` 增加 `style`、`noiseScale`、`noiseDetail`、`cloudDensity` 选项与模拟时间 uniform；普通 GPU 火焰案例仍使用原有平滑圆形粒子分支。
4. 噪声云团案例启用 `style: 'noise-cloud'`、球形初始发射与 3.14rad 扩散角，新增噪声尺度、噪声细节（3-8 octave）和云团密度控件。
5. 同步更新 `.monkeycode/specs/explosion-effects/requirements.md` 和 `design.md`，将案例定义为 Shadertoy 形态与 GPU 世界坐标粒子的融合效果。

**验证结果**：

- `npm run build` 通过（vue-tsc + Vite，仅 chunk>500kB 预期警告）。
- `git diff --check` 干净，dev server 案例模块返回 HTTP 200，预览代理连通。
- GPU 片元着色器的云团视觉可通过浏览器预览交互确认。

## V3.24 噪声云团迁移为 Cesium GPU 世界坐标火焰

**目标**：将“爆炸特效-噪声云团”从独立 Canvas 的屏幕空间着色器叠加迁移为 Cesium GPU 粒子系统，使指定经纬度成为火焰真实世界坐标，地图拖动、缩放、旋转与深度关系全部由 Cesium 场景处理。

**实施内容**：

1. `ExplosionBoomDemo.vue` 删除 `ShadertoyLayer`、shader canvas、`uCenter` 屏幕投影与 RAF；改为直接创建一套连续发射、加法混合、启用深度测试的 `GpuParticleSystem`。
2. 点击地图或输入经纬度时，使用 `GpuParticleSystem.updateEmitter()` 更新由 `Cartesian3.fromDegrees()` 与 ENU 局部坐标系定义的粒子发射器；世界坐标让火焰自动跟随相机视图与地球遮挡。
3. 火焰类型保留 8 种预设，改为 8 套 CSS 颜色梯度；`GpuParticleSystem.updateOptions({ colors })` 支持重建颜色查找纹理。
4. 参数面板改为 GPU 粒子语义：喷射速度、粒子数、粒子寿命、火焰强度、粒子尺寸、上升浮力、湍流、发射锥角、发射半径与高度拉伸；保留暂停、继续与重新引爆。
5. `GpuParticleSystem` 增加 `setPaused()` 与 `setTimeScale()`：暂停时计算步长为 0 且停止新粒子发射，变速缩放 GPU 计算步长。
6. 同步更新 `.monkeycode/specs/explosion-effects/requirements.md` 与 `design.md`，明确噪声云团案例采用 GPU 粒子世界坐标模型。

**验证结果**：

- `npm run build` 通过（vue-tsc + Vite，11.55s，仅 chunk>500kB 预期警告）。
- `git diff --check` 干净，dev server 案例组件返回 HTTP 200，预览代理连通。
- GPU 粒子视觉效果（世界坐标、遮挡、参数范围）可通过浏览器预览交互确认。

## V3.23 噪声云团单团地图火焰与坐标跟随修正

**目标**：噪声云团案例固定为地图叠加模式；给定经纬度后仅在对应位置显示一团火焰；地图拖动、缩放、旋转时火焰持续对齐指定地理坐标。

**实施内容**：

1. 移除 `ExplosionBoomDemo.vue` 的全屏深空/叠加地图切换，shader canvas 持续让出鼠标事件，地图点击与经纬度输入用于更新唯一火焰位置。
2. `boom.frag` 从 8 团环形火焰重构为一团基于 gyroid/fbm 的循环火焰，`uCenter` 控制火焰中心，`uScale` 更名为火焰尺寸；保留八种火焰类型调色板、强度、色彩频率、色相偏移、噪声密度与动画控制。
3. 位置计算采用 `SceneTransforms.worldToWindowCoordinates` 每帧投影经纬度；将 Cesium 左上原点坐标转换为 WebGL `gl_FragCoord` 左下原点坐标（`canvas.height - screenPos.y * dpr`），并在投影越出画布时隐藏火焰。
4. `ShadertoyLayer.render()` 每帧清空透明 canvas，防止先前帧的 alpha 片元残留导致火焰位置拖影。
5. 同步更新 `.monkeycode/specs/explosion-effects/requirements.md` 与 `design.md` 的单团地图火焰验收标准和坐标转换约定。

**验证结果**：

- `npm run build` 通过（vue-tsc + Vite，9.38s，仅 chunk>500kB 预期警告）。
- `git diff --check` 干净。
- dev server 中 `ExplosionBoomDemo.vue` 与 `boom.frag?raw` 均返回 HTTP 200，预览代理连通。

## V3.22 爆炸案例地图指定位置叠加与参数调节

**目标**：在 V3.21 双爆炸案例基础上迭代：①空间反转案例支持在地图上点击或输入经纬度指定爆炸位置，爆炸透明叠加在该位置屏幕投影处并随相机移动跟随，新增 8 项外观参数实时调节；②噪声云团案例重构为 8 个环形分布的火焰，支持 8 种火焰类型调色板切换与 5 项参数调节，同样支持地图位置定位叠加。

**实施内容**：

1. `src/lib/shadertoy.ts`：`setUniform` 支持 `number | number[]`（按数组长度分发 `uniform1f/2f/3f/4f`），支撑 vec2 uniform 注入。
2. `src/cases/explosion-space/explosion.frag`（941 行）：`mainImage` 顶部覆写 `grain/ballness/growth/fade/density/color_low/brightness.x/expRadius` 对应 `uGrain/uBallness/uGrowth/uFade/uDensity/uColorLow/uBright/uScale`；新增 `q -= (uCenter/iResolution.xy) - 0.5` 空间反转偏移实现爆炸中心定位；vignette 仅保留全屏分支，透明分支做 alpha 反预乘。
3. `src/cases/explosion-boom/boom.frag`：重写为 8 个火焰按 45° 环形均匀分布在以 `uCenter` 为圆心的圆上，每团相位依次延迟形成波浪起爆；`flameColor(type,n)` 按 `uFlameType` if-else 选 8 套调色板（能量青蓝/炽热橙金/烈焰红黄/霓虹紫粉/毒雾翠绿/电磁亮蓝/冰霜蓝白/星云彩带）；6 octave fbm；新增 `uCenter/uFlameType/uScale/uIntensity/uColorFreq/uColorShift/uDensity`。
4. 两个 `Demo.vue` 重写：默认 `background:'transparent'`；`ScreenSpaceEventHandler` 左键 `pickEllipsoid` 拾取经纬度（默认 114.3/30.5），经纬度 number 输入双向同步；`tick()` 内每帧 `SceneTransforms.worldToWindowCoordinates` 将经纬度投影为屏幕像素（乘 devicePixelRatio，dpr>2 截断）作为 `uCenter`；位置不可见时填 `[-9999,-9999]` 隐藏爆炸；全屏模式 `uCenter` 填画布中心。
5. 参数面板：空间反转 8 项（爆炸大小/细节颗粒/球度/生长速率/消退/密度/颜色暗度/亮度）+ 速度/暂停/重引爆/自动环绕；噪声云团 5 项（火焰间距/强度/色彩频率/色相偏移/噪声密度）+ `FLAME_TYPES` 8 按钮网格 + 动画控制。
6. 修复 Cesium 1.144 API 变更：`SceneTransforms.wgs84ToWindowCoordinates` 已更名，改用 `SceneTransforms.worldToWindowCoordinates`。
7. 同步更新 `.monkeycode/specs/explosion-effects/requirements.md` 与 `design.md`（新增地图叠加定位、参数映射、8 火焰类型约定）。

**验证结果**：

- `npm run build` 通过（vue-tsc + Vite，8.67s，仅 chunk>500kB 预期警告）。
- `git diff --check` 干净。
- dev server 两案例组件、`.frag?raw` 与 `src/lib/shadertoy.ts` 均 HTTP 200，日志无编译错误。
- 运行时效果（点击地图定位、经纬度输入、8 火焰类型切换、参数滑块实时生效）待浏览器预览确认。

## V3.21 双爆炸着色器特效案例

**目标**：新增两个全屏着色器爆炸效果案例：①"爆炸特效-空间反转"（参考 Shadertoy Xd3GWn，Roman Komary Explosion，融合 huwb 爆炸结构与 iq 空间反转思想，含星空与云层背景）；②"爆炸特效-噪声云团"（参考 Shadertoy lcKGRc，"Bim Boom Bam"，基于 gyroid/fbm 的屏幕空间细胞状爆炸云）。两案例共享一套 Shadertoy 兼容 WebGL2 渲染层，均可切换全屏背景或叠加三维地球，复用同一噪声纹理作为 `iChannel0`。

**实施内容**：

1. 新增公共渲染层 `src/lib/shadertoy.ts`：`ShadertoyLayer` 类以 WebGL2 全屏三角形运行 Shadertoy 片元着色器，自动注入 `#version 300 es`/`precision`/`in vec2 vUv`/`out vec4 fragColor` 并追加 `main()` 调用 `mainImage`；内置 `iResolution`/`iTime`/`iMouse`/`iFrame` uniform；支持图片纹理按名绑定（`iChannel0`）与运行期自定义 float uniform；提供暂停/变速/重引爆（重置动画时间）/鼠标状态/透明混合与 WebGL 资源释放。
2. 新案例 `src/cases/explosion-space/`：`ExplosionSpaceDemo.vue` + `explosion.frag`（899 行原版最小适配，LF 化；注入 uniforms 声明；以程序化 `sky()` 替换原 cubemap `iChannel1` 背景；`computePixelRay` 增加 `uAutoRotate` 分支；`mainImage` 末尾按 `uTransparent` 输出透明或全屏颜色）+ `assets/noise.png`。
3. 新案例 `src/cases/explosion-boom/`：`ExplosionBoomDemo.vue` + `boom.frag`（80 行原版适配，注入 uniforms，透明模式以 `1.0 - back` 为 alpha）+ `assets/noise.png`。
4. 两案例共用用户上传噪声纹理 `51adafa1-iChannel0-2.png`（234×119 RGBA）作为 `iChannel0`，复制到各自 `assets/`。
5. 案例图标：使用文生图生成两张爆炸主题图并经 PIL 压缩为 640 宽 webp（33.9/33.0kB），`index.ts` 注册"三维特效"分类卡片（`tag`：着色器特效）。
6. 组件提供"背景模式"（全屏太空/深空 ↔ 叠加地图）、暂停/继续、重新引爆、速度调节；空间反转案例额外提供相机自动环绕开关与全屏模式下的鼠标拖拽视角。
7. 注册 `src/cases/index.ts`，新增 `.monkeycode/specs/explosion-effects/requirements.md` 与 `design.md`。

**验证结果**：

- `npm run build` 通过（vue-tsc + Vite，10.05s，仅 chunk>500kB 预期警告）。
- `git diff --check` 干净。
- dev server 中两个案例的 index.ts、组件、`.frag?raw`、噪声纹理与图标模块均返回 HTTP 200。
- 运行时渲染效果（爆炸动画、透明叠加、拖拽视角）待浏览器预览确认。

## V3.20 三角量测夹角标注位置修正

**目标**：三角量测夹角标注位置从起点调整为"水平线与斜边的交点"所在点。

**实施内容**：

1. `TriangleMeasureDemo.vue` 的 `drawFinalShape` 中，夹角标注位置由固定的起点改为水平边与斜边的交点：终点高度高于起点时交点为终点、否则为起点（即水平边上除直角点外的端点）。
2. 同步更新 `.monkeycode/specs/measure-tools/requirements.md` 的 Requirement 7 验收标准。

**验证结果**：

- `npm run build` 通过（vue-tsc + Vite，仅 chunk>500kB 预期警告）。
- 夹角标注新位置待浏览器预览确认。

## V3.19 量测图标更新与地形开关动态生效

**目标**：①方位角量测卡片采用 image-1 图标，指北线改纯虚线并去掉箭头；②三角量测卡片采用 image-2 图标，地图上夹角值标注位置移到起点；③修复所有量测案例"启用地形"开关无效问题（勾选/取消勾选即时生效）。

**实施内容**：

1. `src/cases/bearing-measure/icon.webp` 替换为用户上传 image-1（54.9kB）、`src/cases/triangle-measure/icon.webp` 替换为用户上传 image-2（60.3kB）。
2. 方位角量测：移除指北线箭头（`northArrowEntity` 及相关代码），指北线保留绿色贴地虚线；垂直参考线仍为红色并保留箭头。
3. 三角量测：`drawFinalShape` 中夹角标注位置从直角点 `info.apex` 改为起点 `start`。
4. `src/lib/cesium-scene.ts` 新增 `setTerrainEnabled(viewer, enabled)`：启用时加载 Cesium World Terrain，禁用时切换 `EllipsoidTerrainProvider`。
5. 五个量测案例（距离/面积/高度/方位角/三角）统一改为 `applyTerrain(enabled)` + `watch(useTerrain)` 模式：勾选即时加载地形，取消勾选即时切回平坦椭球；地形变化后各案例重算/重绘（距离/面积重算地表结果、高度重算标注、方位角按地形重绘贴地参考线、三角仅切换拾取基准）。
6. 同步更新 `.monkeycode/specs/measure-tools/requirements.md` 的 Requirement 3-7 验收标准。

**验证结果**：

- `npm run build` 通过（vue-tsc + Vite，仅 chunk>500kB 预期警告）。
- `git diff --check` 干净。
- 开发服务器中 cesium-scene、五个量测案例组件与两个新图标均可访问（HTTP 200）。
- 各案例运行效果（地形开关动态切换、指北线去箭头、三角夹角起点标注）待浏览器预览确认。

## V3.18 四类量测更名与方位角/三角地形化改造

**目标**：①面积量测更名"空间测量-面积量测"并采用 image-1 图标；②高度量测更名"空间测量-高度量测"并采用 image-2 图标；③方位角量测更名"空间测量-方位角量测"，指北线贴地、垂直线改红色、参考线长度随起终点距离 1.2 倍实时调整、增加"启用地形"控制；④三角量测更名"空间测量-三角量测"，初始加载地形并增加"启用地形"控制。

**实施内容**：

1. `src/cases/area-measure/icon.webp` 替换为用户上传 image-1（75.7kB）、`src/cases/height-measure/icon.webp` 替换为用户上传 image-2（119.8kB）；四个量测案例 `index.ts` 标题分别改为"空间测量-面积量测 / 高度量测 / 方位角量测 / 三角量测"，`updatedAt` 更新为 2026-08-24，并同步描述文案。
2. 方位角量测：`drawReferenceLines(start, end)` 按 `max(distance*1.2, 50)` 动态计算参考线长度；`sampleGroundLine` 沿线采样 20 点并贴地形高度（未加载地形时贴椭球面，+2m 防 z-fighting）绘制贴地指北线；垂直参考线颜色改为红色 `#ff5a5a`（含箭头）；箭头尺寸随线长缩放。
3. 方位角量测：新增"启用地形"开关（`useTerrain`），地形加载完成后重绘参考线使其贴地；切换开关时按当前点重绘。
4. 三角量测：`onMounted` 初始加载 Cesium World Terrain；新增"启用地形"开关；移除无用 `worldTerrainLoaded` 变量。
5. 同步更新 `.monkeycode/specs/measure-tools/requirements.md` 的 Requirement 4-7 验收标准。

**验证结果**：

- `npm run build` 通过（vue-tsc + Vite，仅 chunk>500kB 预期警告）。
- `git diff --check` 干净。
- 开发服务器中四个案例的 index.ts、icon.webp 与组件模块均可访问（HTTP 200）。
- 各案例运行效果（贴地指北线、红色垂线、动态长度、地形开关）待浏览器预览确认。

## V3.17 量测可视化增强与三角量测重构

**目标**：①面积量测绘制中实时显示填充面、结束后在面重心显示面积结果；②高度量测结束后的地图标注改为紧邻点线（去掉大幅空间抬升）；③方位角量测参考线带箭头、结束后保留参考线、终点显示方位角结果；④三角量测整体重写为两点直角三角形量测（水平距离/垂直距离/斜边夹角）。

**实施内容**：

1. 公共库 `src/cases/measure-lib/geometry.ts` 新增 `polygonCentroid`（经纬度二维多边形重心 + 平均高度）、`rightTriangleInfo`（直角三角形参数：水平距离/垂直距离/斜边长度/夹角/直角点，直角点规则：终点高时取 (x1,y1,h2)、否则取 (x2,y2,h1)）、`arrowHeadPositions`（端点三角箭头）；并在 `index.ts` 导出。
2. 面积量测：`updatePolygon` 用 Entity Polygon 半透明填充实时显示围合面（少于 3 点清空），随鼠标移动更新；结束时固定最终面；`computeResult` 增加 `renderResultLabel` 在面重心位置显示空间/地表/投影面积。
3. 高度量测：移除沿法线 400m 抬升，A/B 点高度标注改放在点位上方、高差标注放在中点的 `pixelOffset` 屏幕偏移处（-24/+24），并管理 `labelEntities` 防止重复累积。
4. 方位角量测：`drawAuxiliaryLines` 中指北/垂线虚线加粗至 3px，`northArrowEntity`/`verticalArrowEntity` 在参考线末端绘制方向箭头（指北箭头 260×140m、垂线箭头 200×110m）；`finishMeasurement` 保留指北/垂线参考线与箭头（点数不足时清理）；`computeResult` 在终点位置显示方位角与方向标注。
5. 三角量测：整文件重写——仅需点选起点与终点；起点后鼠标移动实时构建直角三角形三边（水平边绿/垂直边蓝/斜边橙）并实时提示水平距离、垂直距离、斜边长度与夹角；第二次点击自动结束；结束后三边标注（水平边中点/垂直边中点/直角点）与左上结果面板（水平距离/垂直距离/斜边长度/夹角）；移除三点点选与地形开关。
6. 同步更新 `.monkeycode/specs/measure-tools/requirements.md` 的 Requirement 4-7 验收标准。

**验证结果**：

- `npm run build` 通过（vue-tsc + Vite，仅 chunk>500kB 预期警告）。
- `git diff --check` 干净。
- 开发服务器中 measure-lib 与四个量测案例模块均可访问（HTTP 200）。
- 各案例运行效果（面积实时填充与重心标注、方位角箭头参考线、三角两点构建）待浏览器预览确认。

## V3.16 空间测量-距离量测更名与四类量测交互统一

**目标**：①"常规距离量测"更名"空间测量-距离量测"并采用 image-1 图标；②重构高度量测（初始无提示、开始后提示、仅两点、第二次点击自动结束、每次为新过程、清除清空）；③重构面积量测（初始无提示、开始后提示、左上侧面板显示最终空间/地表/投影面积、每次新过程、清除清空）；④重构方位角量测（初始无提示、开始后提示、点选起点后随鼠标移动显示指北虚线/垂直地表虚线/连线并追加方位角提示、左上侧面板显示方位角/角度/方向、每次新过程、清除清空）；⑤三角量测做类似修复。

**实施内容**：

1. `src/cases/distance-measure/icon.webp` 替换为用户上传 image-1（132.5kB），`index.ts` 案例标题改为"空间测量-距离量测"，`updatedAt` 更新为 2026-08-24。
2. 量测公共库 `src/cases/measure-lib/material.ts` 新增 `makeDashMaterial(color)`（基于 `Material.PolylineDashType` 的虚线材质）并在 `measure-lib/index.ts` 导出，供方位角参考线使用。
3. 高度量测：新增 `startMeasurement`/`onToggleMeasure`，开始前鼠标移动不提示；开始后提示"单击选起点与终点，第二个点完成后自动结束"；第二次点击即 `finishMeasurement()` 自动结束（双击/右键仍兜底）；每次开始先 `resetMeasurement()`，清除复用同一函数。
4. 面积量测：`computeResult` 移除地图上漂浮的空间面积 Label（仅保留响应式结果）；结果面板由右上移至左上（空间/地表/投影面积）；初始无提示、开始后提示围合操作；每次开始先 `resetMeasurement()`。
5. 方位角量测：新增 `northLine`/`verticalLine` 两个 `PolylineCollection`，`drawAuxiliaryLines(start, mouse)` 绘制起点→鼠标实线、指北虚线（ENU 矩阵北向伸展 1500m，`makeDashMaterial('#7be09e')`）、垂直地表虚线（`geodeticSurfaceNormal` 伸展 900m，`makeDashMaterial('#c9d4dc')`）；未测量不显示提示；`collected.length>=1` 时画辅助线并在提示追加方位角与方向象限；第二次点击自动结束；结果面板移至左上（方位角/角度/方向）；结束与清除均清理参考线。
6. 三角量测：结果面板移至左上（三边/三内角/周长/面积）；新增 `onToggleMeasure`，模板按钮改由统一入口处理；初始无提示、开始后提示"单击依次采集三个顶点，第三个点自动结算"；修复既有 bug（此前第 3 点点击先置 `measuring=false` 导致 `finishMeasurement` 直接返回、无法自动结算）。
7. 同步更新 `.monkeycode/specs/measure-tools/requirements.md` 的 Requirement 3-7 验收标准。

**验证结果**：

- `npm run build` 通过（vue-tsc + Vite，仅 chunk>500kB 预期警告），构建产物含新距离图标（132.52kB）。
- `git diff --check` 干净。
- 开发服务器中 distance/height/area/bearing/triangle 五个量测案例与 measure-lib 模块均可访问（HTTP 200）。
- 各案例交互（初始无提示、二次/三次点击自动结算、方位角参考线、左上结果面板）待浏览器预览确认。

## V3.15 提示/弹窗图标更新与距离量测交互重构

**目标**：①鼠标移动提示案例卡片图标采用 image-1；②自定义 HTML 弹窗案例卡片图标采用 image-2；③重构常规距离量测交互：初始无提示、开始后提示操作、逐段保留过程线与点位距离标注、距离自适应 m/km 三位小数、左上侧面板显示最终总距离、每次开始为新过程、清除清空全部量测对象。

**实施内容**：

1. `src/cases/mouse-tip/icon.webp` 替换为用户上传 image-1（69.3kB）；`src/cases/html-popup/icon.webp` 替换为用户上传 image-2（139.7kB），两个案例 `index.ts` 的 `updatedAt` 更新为 2026-08-24。
2. 距离量测初始状态鼠标移动不显示任何提示；点击"开始测量"后鼠标提示操作方式（单击加点、双击或右键结束）与当前经纬度、高度。
3. 移除"实时模式"选择开关，距离统一按空间/地表/投影三值呈现；保留"启用地形"开关用于地表距离采样。
4. 单击加点逐段保留过程线（每段加入 `measureLine`），并在每个新点位以 Label 标注该点距上一点的空间/地表/投影距离。
5. 距离值小于 1000 以 m 为单位、不小于 1000 以 km 为单位，均保留三位小数；该格式化逻辑在案例内实现（`formatSeg`），不影响其他量测案例显示。
6. 量测结束在左上侧新增结果面板显示最终总的空间/地表/投影距离（逐段累加），控制面板保留右上。
7. 每次点击"开始测量"先清空上一次过程再开启全新过程；点击"清除"清除点、线、标注、结果与提示。
8. 同步更新 `.monkeycode/specs/measure-tools/requirements.md` 的 Requirement 3 验收标准。

**验证结果**：

- `npm run build` 通过（vue-tsc + Vite，仅 chunk>500kB 预期警告）。
- `git diff --check` 干净。
- 开发服务器中 distance-measure 案例与两个图标模块均可访问（HTTP 200）。
- 构建产物含新图标资源，距离量测逐段标注与最终总距离待浏览器预览确认。

## V3.14 量测提示偏移与线段渲染错误修复

**目标**：修复量测工具的两个运行时缺陷：①鼠标提示框与指针偏移过大；②开始量测点击地图报 `TypeError: Cannot read properties of undefined (reading 'search')`。

**实施内容**：

1. 修复提示框偏移：`MouseTooltip.setPosition` 原实现把 Cesium 画布像素坐标当作 client 坐标再减去容器 `getBoundingClientRect()`，产生双重偏移。改为直接使用画布像素坐标加偏移量，消除与指针的偏差（影响鼠标提示与 5 个量测案例的所有 tooltip）。
2. 定位并修复 `.search` 错误根因：`PolylineCollection.add` 直接把 `material: Color` 存为折线材质，而 Cesium 内部按 `material.type` 分组、在 `PolylineBucket.updateShader` 中调用 `material.shaderSource.search(...)`；裸 `Color` 实例的 `type` 与 `shaderSource` 均为 undefined，渲染时即抛 `reading 'search'`。
3. 新增共享函数 `measure-lib/material.ts` 的 `makeLineMaterial(color)`，内部用 `Material.fromType(Material.ColorType, { color })` 构造标准材质；5 个量测案例（距离/面积/高度/方位角/三角）中所有传给 `PolylineCollection` 的 `material: Color.fromCssColorString(...)` 全部替换为 `makeLineMaterial(...)`。
4. 用 Node 复现验证：修复前 `new Polyline({ material: Color })` 的 `material.type` 与 `shaderSource` 为 undefined；修复后 `makeLineMaterial` 生成 `type='Color'`、`shaderSource` 为合法字符串，满足 Cesium 渲染要求。

**验证结果**：

- `npm run build` 通过（vue-tsc + Vite，仅 chunk>500kB 预期警告）。
- `git diff --check` 干净。
- 开发服务器中 `measure-lib/material.ts`、`measure-lib/index.ts` 与更新后的案例模块均可访问（HTTP 200）。
- 修复后量测开始即可正常点击加点、绘制预览线与结果线，提示框紧贴指针。

## V3.13 鼠标提示、HTML 弹窗与常规量测案例

**目标**：新增 7 个案例：鼠标移动提示、自定义 HTML 弹窗、距离量测、面积量测、高度量测、方位角量测、三角量测，其中 5 个量测案例共享同一套量测库，支持地形与三维模型场景。

**实施内容**：

1. 新增共享量测库 `src/cases/measure-lib/`：`pick.ts`（深度/射线/椭球拾取）、`tooltip.ts`（跟随鼠标浮层）、`geometry.ts`（空间/地表/投影距离与面积、方位角、高差、三角形量算、格式化）。
2. 新增"鼠标移动提示"案例，气泡跟随鼠标实时显示经纬度与高度，支持显隐与精度切换。
3. 新增"自定义HTML弹窗"案例，点击地图创建锚定世界坐标的弹窗，`preRender` 中经 `SceneTransforms.worldToWindowCoordinates` 更新屏幕位置，拖动地球弹窗跟随。
4. 新增"常规距离量测"案例：空间/地表/投影三种距离，单击加点、双击或右键结束，移动鼠标实时提示。
5. 新增"常规面积量测"案例：空间/地表/投影三种面积，地表面积沿地形细分采样。
6. 新增"常规高度量测"案例：两点高度与高差。
7. 新增"常规方位角量测"案例：方位角、角度与八方向象限。
8. 新增"常规三角量测"案例：三边边长、三内角、周长与面积，三点自动结算。
9. 量测案例可选加载 Cesium World Terrain，`depthTestAgainstTerrain` 开启，地形加载失败回退无地形量测。
10. 7 个案例生成 `icon.webp` 并注册到 `src/cases/index.ts`，替换原"测量工具-空间距离"占位卡片。
11. 新增 `.monkeycode/specs/measure-tools/` 需求与设计文档。

**验证结果**：

- `npm run build` 通过，TypeScript 与 Vite 构建无错误。
- 开发服务器中 7 个案例模块与量测库模块均可访问（HTTP 200）。
- 后续在浏览器预览中验证弹窗跟随、三类距离/面积、高度/方位角/三角量算与鼠标提示。


## V3.12 粒子效果案例卡片图标更新

**目标**：为火焰、烟雾、爆炸三个 GPU 粒子效果案例配置用户上传图标。

**实施内容**：

1. 火焰粒子案例卡片 Icon 使用上传的 image-1。
2. 烟雾粒子案例卡片 Icon 使用上传的 image-2。
3. 爆炸粒子案例卡片 Icon 使用上传的 image-3。

**验证结果**：

- 三个图标均为有效 WEBP 图片并覆盖对应案例 `icon.webp`。
- `npm run build` 通过，`git diff --check` 无空白错误。
- 开发服务器运行中，HMR 自动生效。

## V3.11 GPU 粒子效果案例（火焰/烟雾/爆炸）

**目标**：新增火焰、烟雾、爆炸三个 GPU 粒子效果案例，共享一套基于 Cesium WebGL2 与 GPU 计算的粒子系统库，通过不同发射方向、力场参数、颜色表与混合模式区分三种效果。

**实施内容**：

1. 新增共享 GPU 粒子库 `src/cases/particle-effect/lib/`：`GpuParticleSystem` 主类、速度/位置更新 compute shader、渲染 shader、`ParticleEffectOptions` 类型与 `customPrimitive` 图元封装。
2. 粒子位置与速度以 RGBA `Float32` 纹理对存储，经两次 `ComputeCommand`（速度更新、位置更新）逐帧迭代，纹理乒乓交换避免读写同一纹理。
3. 渲染以 `GL_POINTS` 点精灵绘制，片元按寿命采样颜色表并做圆形软边缘与尾部淡出；开启深度测试、关闭深度写入保证地形遮挡。
4. 新增"火焰粒子-GPU计算"案例：向上喷射、白-黄-橙-红叠加混合、连续发射。
5. 新增"烟雾粒子-GPU计算"案例：缓慢升腾湍流扩散、灰白-深灰透明度混合、连续发射。
6. 新增"爆炸粒子-GPU计算"案例：全向爆发受重力回落、一次性爆发、点击地图重新引爆、`restart()` 重建纹理。
7. 三个案例支持点击地图设置发射点/爆点、粒子数/速度/寿命/湍流/浮力/锥角/重力等参数实时调整与显隐开关。
8. `cesium-render.d.ts` 由 wind 案例目录提升至 `src/` 全局共享，供风场与粒子库共用。
9. 三个案例配置 `icon.webp` 图标并注册到 `src/cases/index.ts`。
10. 新增 `.monkeycode/specs/particle-effect/` 需求与设计文档。

**验证结果**：

- `npm run build` 通过，TypeScript 与 Vite 构建无错误。
- `git diff --check` 无空白错误。
- 开发服务器运行中，三个案例模块经 HMR 正常响应。
- 后续在浏览器预览中验证三种粒子效果、点击交互、参数调整与卸载清理。


## V3.10 相机与鼠标案例十进制度与图标更新

**目标**：统一相机参数与鼠标位置案例的经纬度展示为十进制度，补充一键复制四至坐标，并为两个案例配置上传图标。

**实施内容**：

1. 相机参数案例经纬度与四至坐标改为十进制度展示，弧度转换修正 `fromDegrees` 参数。
2. 一键复制内容同时包含相机位置、朝向与四至坐标注释和可回放 `setView` 代码。
3. 相机参数案例卡片 Icon 使用上传的 image-1。
4. 鼠标位置案例经纬度改为十进制度展示。
5. 鼠标位置案例卡片 Icon 使用上传的 image-2。

**验证结果**：

- 相机参数面板与复制内容均为十进制度。
- 鼠标位置面板经纬度为十进制度。
- 两个案例卡片加载上传图标。
- 后续执行 TypeScript 类型检查和 Vite 生产构建验证。

## V3.9 相机参数与鼠标位置信息案例

**目标**：新增两个常用工具案例，展示相机状态与鼠标位置信息。

**实施内容**：

1. 新增“相机参数-位置与四至”案例，实时展示相机经度、纬度、海拔、航向角、俯仰角、翻滚角。
2. 通过 `camera.computeViewRectangle()` 展示当前视口四至坐标。
3. 提供一键复制相机参数功能，生成 `viewer.camera.setView({...})` 可回放代码片段。
4. 新增“鼠标位置信息”案例，通过拾取射线实时显示鼠标位置经纬度与海拔。
5. 海拔优先使用 `scene.pickPosition` 深度拾取，失败时回退 `globe.pick` 与椭球拾取。
6. 根据相机高度估算 Web Mercator 缩放层级，并计算屏幕图上 1 厘米对应的实际地面距离。
7. 新增 `.monkeycode/specs/camera-info/` 与 `.monkeycode/specs/mouse-info/` 需求和设计文档。

**验证结果**：

- 两个案例均从常用工具分类打开。
- 相机参数随视角变化实时更新。
- 鼠标移动时经纬度、海拔、缩放层级与比例尺实时刷新。
- 后续执行 TypeScript 类型检查和 Vite 生产构建验证。

## V3.8 动态多边形水面案例图标更新

**目标**：使用上传的水面截图作为“水面效果-动态多边形”案例卡片 Icon。

**实施内容**：

1. 将上传图片保存为 `src/cases/water-polygon/icon.webp`。
2. 在动态多边形案例元数据中引用 Icon，并同步更新案例完成日期。

**验证结果**：

- 案例卡片通过本地静态资源加载上传图片。

## V3.7 动态多边形水面 Fabric 材质优化

**目标**：参考上传的水面组件、shader 和 `DynamicWaterMaterialProperty`，提升动态多边形水面的动态更新稳定性和视觉层次。

**实施内容**：

1. 新增 `DynamicWaterMaterialProperty`，每帧返回 `time`、`waveSpeed`、`waveScale`、`waveHeight` 和 `clarity` uniforms。
2. 新增幂等的 `registerWaterMaterial()`，在创建多边形 Entity 前注册 `DynamicPolygonWater` Fabric 材质。
3. 调整解析波、分形噪声、法线扰动、菲涅尔、高光和泡沫的组合方式，匹配上传 shader 的动态表现。
4. 保留动态多边形案例已有的效果开关、参数滑杆、边界输入和 Viewer 生命周期管理。

**验证结果**：

- `npm run build` 通过。
- `git diff --check` 通过。

## V0.1 展示型案例中心原型

### 迭代目标

建立“Cesium酱の百宝箱”的基础展示界面，验证左右分栏、案例分类、响应式卡片和移动端导航的视觉与交互方向。

### 实施步骤

1. 初始化 Vue 3、Vite、TypeScript 和 Element Plus 工程。
2. 创建深色顶部标题栏，展示系统名称、状态和基础操作入口。
3. 创建左侧功能分类导航，支持桌面固定栏和移动端抽屉模式。
4. 创建右侧响应式案例卡片网格，支持按分类切换和名称搜索。
5. 创建 CSS 场景缩略图主题，覆盖天气、粒子、扫描线、水面等案例类型。
6. 创建案例详情弹窗，为后续加载真实 Cesium 案例预留入口。
7. 增加 Vite 外部访问配置并启动本地预览。

### 验证结果

- 桌面端支持 5、4、3 列自适应网格。
- 移动端支持抽屉导航与 1、2 列卡片布局。
- 分类切换、搜索筛选和详情弹窗交互可用。
- 生产构建通过。

## V0.2 案例工程化与 Cesium 初始化

### 迭代目标

建立每个案例独立目录的工程结构，引入当前最新版 CesiumJS，并完成第一个真实 Cesium Viewer 初始化案例；分类角标改为由案例数据自动统计。

### 实施步骤

1. 查询 CesiumJS 官方文档，确认 Vite 集成需要静态资源路径和 Widgets 样式支持。
2. 查询 npm 当前版本，确定 `cesium@1.144.0` 和 `vite-plugin-cesium@1.2.23`。
3. 创建 `src/cases/types.ts`，集中定义案例卡片和分类的类型契约。
4. 创建 `src/cases/index.ts`，集中导出分类列表和全部案例元数据。
5. 创建 `src/cases/cesium-init/`，将第一个案例的元数据和 `CesiumInitDemo.vue` 实现放在独立目录。
6. 使用 `vite-plugin-cesium` 处理 Cesium Workers、Assets、Widgets 和 ThirdParty 静态资源。
7. 在真实案例中初始化 `Viewer`，关闭非必要控件，设置地球底色，添加北京位置标记和标签，并执行相机飞行。
8. 在案例卸载时调用 `viewer.destroy()`，避免重复打开案例时产生 WebGL 资源泄漏。
9. 使用 `categoryCounts` 从 `demos` 数据实时统计各分类数量，左侧角标与右侧案例数据保持同一来源。
10. 在入口加载 Cesium Widgets 样式，使 Cesium 控件具备官方基础样式。

### 当前工程约定

- 新增案例使用 `src/cases/<case-id>/` 独立目录。
- 每个案例目录至少包含 `index.ts` 元数据文件和一个案例组件文件。
- 案例元数据通过 `src/cases/index.ts` 汇总到展示中心。
- 分类数量禁止手工填写，统一从案例数据集合计算。
- 需要 Cesium Ion、地形或 3D Tiles 的案例通过项目自身环境变量配置 token，凭据不写入源码。
- 案例组件必须在卸载生命周期中释放 Viewer、事件监听和其他渲染资源。

### 验证结果

- CesiumJS 版本：`1.144.0`。
- `vite-plugin-cesium` 版本：`1.2.23`。
- Cesium 初始化案例支持打开真实地球场景、位置标记和相机飞行。
- 左侧分类角标与 `demos` 实际数量联动。
- TypeScript 类型检查和 Vite 生产构建通过。

### V3.0 表格点位多 Sheet 图层与属性面板优化

**目标**：增强表格点位案例的多工作表加载和图层视觉管理。

**实施内容**：

1. 解析文件中的全部可用 Sheet，并支持选择单个或多个 Sheet。
2. 每个选中的 Sheet 创建独立点图层。
3. 同一图层内所有点使用统一颜色，不同图层使用随机颜色区分。
4. 属性弹窗移动到地图左上侧。

### V3.1 多 Sheet 独立字段映射

**目标**：支持结构不同的多个工作表分别配置点位字段。

**实施内容**：

1. 每个待加载 Sheet 保存独立的经度字段、纬度字段和标注字段。
2. 字段下拉框仅展示当前 Sheet 的表头，避免不同 Sheet 的字段混合。
3. 创建图层时按各 Sheet 的字段配置读取坐标和标注值。
4. 当选中 Sheet 缺少经纬度字段配置时，错误信息明确指出对应 Sheet 名称。

### V3.2 案例图标更新与全局滚动条优化

**目标**：统一新增案例的视觉入口，并优化不同主题页面的滚动体验。

**实施内容**：

1. “数据图层-表格点位”使用上传的 image-1 作为案例卡片 Icon。
2. “水面效果-Cesium动态水面”更名为“水面效果-Cesium内置材质”。
3. “水面效果-Cesium内置材质”使用上传的 image-2 作为案例卡片 Icon。
4. 为浅色工作台和深色案例页分别配置蓝灰色滚动条轨道、滑块和悬停状态。

### V3.3 首页案例滚动、最新排序与状态信息

**目标**：将首页滚动范围收敛到案例网格，并完善案例排序和生命周期状态展示。

**实施内容**：

1. 移除首页全局页面滚动条样式，仅由 `.demo-grid` 承担案例列表纵向滚动。
2. “最新收录”按钮默认按案例更新时间倒序排列，点击后可切换默认顺序。
3. 已有组件实现的案例显示绿色“更新完成 YYYY-MM-DD”状态和完成图标。
4. 尚未实现组件的案例显示灰色“开发中”状态和开发图标。

### V3.4 首页视口锁定、系统 Logo 与 Cesium 版本标识

**目标**：让首页保持视口内布局，避免外层滚动造成导航内容离开可视区域。

**实施内容**：

1. 锁定首页根容器和浏览器文档为视口高度，移除首页最外层滚动。
2. 让左侧导航栏在自身区域内适配高度并支持内部滚动，保证低高度窗口中的导航内容可访问。
3. 使用上传图片替换首页和完整案例页顶部的系统 Logo。
4. 将侧栏底部构建信息调整为 `Built with Cesium & Cesium 1.144.0`。

### V2.9 本地表格点图层与 Cesium 内置动态水面

**目标**：新增本地表格点位图层和 Cesium 内置动态水面案例。

**实施内容**：

1. 新增“数据图层-表格点位”，支持 CSV、TSV、TXT、XLS、XLSX、XLSM、XLSB、ODS 文件读取。
2. 支持经纬度字段、标注字段配置，以及随机颜色点、图层显隐、标注显隐、跳转、移除和属性拾取。
3. 新增“水面效果-Cesium动态水面”，使用 Cesium `Water` 材质和 `waterNormalsSmall.jpg` 法线纹理。
4. 支持动态水面显隐、频率、动画速度、波幅、颜色和边界坐标调整。
5. 根据 Cesium 内置 Water 材质参考实现，将水面渲染结构调整为 `GroundPrimitive`、`GeometryInstance` 和 `EllipsoidSurfaceAppearance`。
5. 新增 `.monkeycode/specs/table-points/` 与 `.monkeycode/specs/builtin-water/` 需求和设计文档。

### V2.8 地形加载提示与天气案例卡片统一

**目标**：统一涉及地形加载的案例提示文案，更新天气特效案例名称和卡片图标。

**实施内容**：

1. 将所有涉及 Cesium World Terrain 的案例加载提示统一为“正在加载Cesium World Terrain...”。
2. 为“天气特效-浓度积分高度雾”使用 `src/cases/integral-height-fog/icon.webp` 作为卡片图标。
3. 将“天气特效-雾效”更名为“天气特效-深度高度雾”，并使用 `src/cases/fog/icon.webp` 作为卡片图标。
4. 同步更新深度高度雾需求、设计文档和系统迭代记录中的案例名称。

### V2.7 统一地形加载与浓度积分高度雾

**目标**：统一所有地形案例的 World Terrain 加载形式，并新增支持线性、指数浓度积分的高度雾案例。

**实施内容**：

1. 在 `src/lib/cesium-scene.ts` 新增 `loadWorldTerrain(viewer)`，统一使用 `createWorldTerrainAsync({ requestVertexNormals: true })` 并设置 Viewer terrain provider。
2. 将现有“天气特效-深度高度雾”和“地形效果-显示与夸张”改为调用公共地形加载入口。
3. 新增 `src/cases/integral-height-fog/IntegralHeightFogDemo.vue` 与 `index.ts`，注册“天气特效-浓度积分高度雾”案例。
4. 新增 `INTEGRAL_HEIGHT_FOG_FRAGMENT`，实现起始距离裁剪、线性浓度积分和指数浓度积分。
5. 新案例支持效果开关、线性/指数模式、雾颜色、最大高度、全局浓度、指数衰减系数、起始距离和场景亮度调整。
6. 新增 `.monkeycode/specs/integral-height-fog/` 需求与设计文档。

### 验证标准

- 现有所有 World Terrain 案例调用同一公共地形加载入口。
- 新案例可从三维特效分类打开。
- 雾效开关和参数调整实时生效。
- TypeScript 类型检查和 Vite 生产构建通过。

### V2.6 深度纹理线性高度雾

**目标**：重写“天气特效-深度高度雾”，采用基于深度纹理、相机高度和世界坐标的高度雾实现。

**实施内容**：

1. 重写 `src/lib/weather.ts` 的 `FOG_FRAGMENT`，使用深度纹理恢复像素世界坐标。
2. 依据相机位置计算相机处地球半径与相机高度，依据像素世界坐标计算粗略高程。
3. 将参考实现的线性高度雾积分适配为 Cesium 后处理 shader，支持雾高、全局密度和雾颜色 uniform。
4. 移除旧雾效的程序化噪声、时间帧监听和距离滑杆，保留效果开关、浓度、高度和亮度控制。
5. 保留 Bing 影像、Cesium World Terrain、地形深度检测和后处理阶段卸载销毁逻辑。
6. 更新 `.monkeycode/specs/fog-effect/requirements.md` 与 `design.md`，记录本次实现模型和验证标准。

### 验证标准

- 雾案例使用深度纹理与世界坐标计算近地高度雾。
- 相机移动时相机高度与地球半径 uniform 实时更新。
- 背景深度为 1.0 时保留原始场景颜色。
- 关闭案例时移除后处理阶段并销毁 Viewer。
- TypeScript 类型检查和 Vite 生产构建通过。

## V0.3 初始化错误与完整案例入口修复

### 问题现象

1. 页面初始化请求 `fonts.googleapis.com` 返回 500，浏览器控制台出现 `net::ERR_ABORTED 500`。
2. Cesium 初始化地球弹窗出现 `An error occurred while rendering. Rendering has stopped.`。
3. Cesium 同时报告 `InvalidStateError: The source image could not be decoded`，画布显示黑屏，截图可见 Cesium ion 标识。
4. “打开完整案例”按钮仅有视觉样式，点击后没有业务动作。

### 根因判断

- 页面 CSS 通过外部 Google Fonts 加载字体，预览环境无法稳定访问该外部资源。
- Cesium Viewer 使用默认底图时会触发 Cesium Ion 影像资源加载；在未配置项目级 Ion token 或资源响应异常时，图片纹理解码失败会停止渲染。
- 详情弹窗按钮没有绑定点击事件，也没有独立的完整案例容器状态。

### 修复步骤

1. 删除 Google Fonts `@import`，改用系统字体栈，消除初始化阶段的外部字体请求。
2. 为 Cesium Viewer 显式设置 `baseLayer: false`，让初始化案例使用无外部影像依赖的椭球地球。
3. 保留北京位置点、标签和相机飞行，确保案例仍然验证真实 Viewer 初始化流程。
4. 为 Viewer 初始化增加 `try/catch`，失败时在案例区域展示可读错误信息，避免只显示黑屏。
5. 详情弹窗的“打开完整案例”按钮绑定 `launchSelectedCase`，将案例切换到独立的完整案例弹窗。
6. 为完整案例弹窗增加独立状态和关闭处理，保证 Viewer 组件挂载、卸载生命周期完整执行。
7. 没有真实实现组件的案例显示“案例开发中”，避免按钮产生无效点击反馈。

### 验证标准

- 页面初始化不再请求 `fonts.googleapis.com`。
- Cesium 初始化案例不依赖 Cesium Ion 影像资源即可完成 Viewer 创建和渲染。
- Viewer 初始化异常会显示具体错误信息。
- 点击第一个案例的“打开完整案例”会打开独立案例弹窗。
- 关闭完整案例后 Viewer 执行 `destroy()`，再次打开可以重新初始化。

## V0.4 卡片直达完整案例与 Cesium 默认纹理隔离

### 迭代目标

取消案例预览中间层，让可运行案例从卡片直接进入完整案例页面；针对 Cesium 渲染停止和图片解码异常继续降低默认资源加载范围。

### 实施步骤

1. 移除案例预览 `el-dialog` 和“打开完整案例”中间按钮。
2. 卡片点击直接调用 `openCase`，将当前案例切换到独立的完整案例页面视图。
3. 完整案例页面提供案例标题、分类、说明、真实案例组件和返回案例中心操作。
4. 在 Cesium Viewer 中关闭默认 `skyBox`、`skyAtmosphere` 和阴影资源，配合 `baseLayer: false` 形成无默认影像、无默认天空纹理的初始化场景。
5. 保留初始化错误面板和 Viewer 卸载销毁逻辑。

### 验证标准

- 点击“Cesium 初始化地球”卡片直接进入完整案例页面。
- 页面不再出现中间过程弹窗。
- Cesium 初始化流程不主动加载默认底图、天空盒和大气纹理。
- TypeScript 类型检查和 Vite 生产构建通过。

## V0.5 默认加载 ArcGIS 影像服务

### 迭代目标

为 Cesium 初始化地球案例增加默认 ArcGIS World Imagery 影像底图。

### 实施步骤

1. 引入 Cesium `ArcGisMapServerImageryProvider`。
2. 使用 `ArcGisMapServerImageryProvider.fromUrl` 异步加载 ArcGIS World Imagery MapServer。
3. Viewer 先以无默认底图模式创建，ArcGIS provider 加载成功后添加到 `viewer.imageryLayers`。
4. 组件卸载时设置销毁标记，避免异步 provider 完成后向已销毁的 Viewer 添加图层。
5. ArcGIS 服务加载异常沿用案例错误面板展示，保留基础地球和位置标记的诊断能力。

### 服务地址

```text
https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer
```

### 验证标准

- Cesium 初始化案例默认请求 ArcGIS World Imagery 服务。
- ArcGIS 图层加载完成后显示影像底图。
- Viewer 销毁期间不会继续写入异步影像图层。
- TypeScript 类型检查和 Vite 生产构建通过。

## V0.6 地图全屏自适应与影像服务降级

### 迭代目标

完整案例页的地图场景自动填充页面可用区域；提升影像服务接入稳定性，避免单一 ArcGIS 服务不可用时初始化失败。

### 实施步骤

1. 完整案例页改为 `100vh/100dvh` 的纵向 flex 布局，顶部标题栏固定，案例内容区 `flex: 1` 填满剩余空间。
2. 案例舞台 `flex: 1` 并让 Cesium 场景容器继承全部高度，实现地图自动填充页面区域。
3. 增加移动端适配，缩小标题区与舞台内边距。
4. 将影像服务改为候选降级链：ArcGIS World Imagery、ArcGIS World Street Map、OpenStreetMap。
5. 每个候选服务依次尝试，加载成功后添加到 `viewer.imageryLayers` 并显示当前底图名称。
6. 增加加载状态提示，全部候选失败时显示可读错误信息。
7. 关闭 ArcGIS provider 的 `enablePickFeatures`，减少额外的服务元数据请求。

### 服务探测结果

- ArcGIS World Imagery：HTTP 200，CORS 开放，瓦片返回 JPEG。
- 首次元数据请求响应约 5 秒，在预览代理下容易超时，故引入降级链。

### 验证标准

- 完整案例页地图自动填充页面剩余区域。
- 影像服务按候选链自动降级，任一服务可用即可显示底图。
- 加载中、底图名称、全部失败均显示明确状态。
- TypeScript 类型检查和 Vite 生产构建通过。

## V0.7 默认底图切换为天地图

### 迭代目标

将 Cesium 初始化案例的默认底图从 ArcGIS 切换为天地图影像，保留候选降级链兜底。

### 实施步骤

1. 新建 `src/cases/cesium-init/tianditu.ts`，封装天地图 WMTS 瓦片 URL 模板与 token。
2. 提供三个 provider 工厂：影像（`img_w`）、影像注记（`cia_w`）、矢量（`vec_w`）。
3. 候选链调整为先天地图影像、天地图矢量、ArcGIS World Imagery、ArcGIS World Street Map、OpenStreetMap。
4. 天地图影像加载成功后叠加影像注记层，保证地名标注可见。
5. 天地图不可用时按原降级链继续回退。

### 服务探测结果

- 天地图 token `0a94f560c3f216b0047de09d2861ed12` 权限类型为浏览器端。
- 服务端 curl 请求返回 403（`Key权限类型为:浏览器端，请使用浏览器访问`），符合天地图对浏览器端 token 的访问控制，浏览器端访问需该 token 已配置 IP 白名单。
- 子域 `t0`-`t7` 行为一致，CORS 头 `Access-Control-Allow-Origin: *` 正常返回。

### 验证标准

- 初始化地图默认请求天地图影像与注记层。
- 天地图失败时仍可回退 ArcGIS 与 OpenStreetMap。
- TypeScript 类型检查和 Vite 生产构建通过。

### 案例打开报错修复

1. 现象：打开案例报 `Uncaught (in promise) SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON`，源于某影像服务元数据请求返回 HTML 但被按 JSON 解析。
2. 诊断：天地图浏览器端 token 域名不匹配返回 403 JSON，瓦片图片加载失败但旧逻辑仍判定加载成功。
3. 修复：
   - 降级链改为瓦片级验证，通过 `ImageryLayer.errorEvent` 监听连续加载失败，达到阈值自动移除并回退下一候选。
   - 天地图影像成功后叠加的注记层独立容错，失败仅移除注记层。
   - 增加 `unhandledrejection` 全局捕获，Cesium 内部未处理响应异常转为可视化状态提示。
   - `vite.config.ts` 增加 `optimizeDeps.exclude: ['cesium']`，消除 cesium 预构建 Worker 路径缺失警告。
4. 依赖项：dev server 启动需 `max_open_fds: 4096`（`exclude: ['cesium']` 后需扫描大量 cesium 源码文件，1024 触发 EMFILE）。

## V0.8 仅保留天地图底图与依赖预构建修复

### 迭代目标

地图初始化只加载天地图影像与注记层，移除其他地图服务；修复 `mersenne-twister` 缺少 `default` 导出的模块加载报错。

### 实施步骤

1. 移除 ArcGIS World Imagery、ArcGIS World Street Map、OpenStreetMap 候选源及多源降级链逻辑。
2. 移除 `ArcGisMapServerImageryProvider`、`OpenStreetMapImageryProvider` 与 `ImageryProvider` 相关导入。
3. 加载流程简化为天地图影像层 + 影像注记层；影像层连续瓦片加载失败显示明确的 token 白名单提示，注记层失败仅移除注记层。
4. 移除 `vite.config.ts` 中 `optimizeDeps.exclude: ['cesium']`，恢复 Vite 对 cesium 的默认预构建。

### 问题根因

- `optimizeDeps.exclude: ['cesium']` 使 Vite 跳过 cesium 预构建，浏览器直接以 ESM 加载 cesium 源码。
- cesium 内部 `import MersenneTwister from 'mersenne-twister'` 指向 CJS 源码（`module.exports`，无 `default` 导出），触发 `Uncaught SyntaxError: ... does not provide an export named 'default'`。
- 恢复默认预构建后，`mersenne-twister` 被 esbuild 内联进 `node_modules/.vite/deps/cesium.js`，浏览器不再直接加载其 CJS 源码。

### 验证标准

- 初始化地图仅请求天地图影像与注记层，不再包含 ArcGIS、OSM 相关服务地址。
- 浏览器加载案例页面不再报 `mersenne-twister` 模块导出错误。
- dev server 与生产构建均通过。

## V0.9 地图初始化公共模块提炼

### 迭代目标

将 Cesium 场景初始化、天地图底图加载提炼为公共 TS 模块，后续新增案例直接调用；移除 Cesium ion 商标与全屏按钮。

### 实施步骤

1. 新建 `src/lib/tianditu.ts`（从 `src/cases/cesium-init/` 移入），封装天地图 WMTS provider 工厂。
2. 新建 `src/lib/cesium-scene.ts`，提供：
   - `createMapScene(container, callbacks)`：创建 Viewer，关闭默认底图与全部非必要控件，设置 `fullscreenButton: false`，隐藏 `creditContainer`（移除 Cesium ion 商标），设置 `Camera.DEFAULT_VIEW_RECTANGLE`（75, 0, 140, 60）并 `flyHome(0)` 应用中国视角。
   - `loadTiandituImagery(viewer, callbacks)`：加载天地图影像与注记层，瓦片连续失败回调状态，注记层失败仅移除。
   - `destroyScene(viewer)`：统一销毁。
3. `CesiumInitDemo.vue` 改为调用公共模块，仅保留案例自身内容（北京标记与标签）。
4. 场景回调（`SceneCallbacks`）支持 `onStatus`、`onBasemapReady`、`onError`，供 UI 展示加载状态。

### 工程约定

- 地图初始化统一从 `src/lib/cesium-scene.ts` 导入。
- 新增案例只需调用 `createMapScene` + `loadTiandituImagery`，并在卸载时调用 `destroyScene`。

### 验证标准

- 案例页不再显示 Cesium ion 商标与全屏按钮。
- 初始化视角为 `Camera.DEFAULT_VIEW_RECTANGLE` 定义的中国及周边区域。
- 新增案例可复用同一套场景初始化与底图加载。
- TypeScript 类型检查和 Vite 生产构建通过。

## V1.0 卡片信息重构与性能监控面板

### 迭代目标

卡片底部展示案例描述；完整案例页顶栏提供系统性能监控指标，便于判断系统性能。

### 实施步骤

1. 卡片底部 `Cesium Demo` 文字替换为案例描述，移除标题下独立的描述段落。
2. 完整案例页顶栏最右侧新增性能监控条，进入案例时启动、返回时停止，显示 8 项指标：
   - FPS：`requestAnimationFrame` 每秒帧数统计，按帧率着色（≥45 绿、30-44 黄、<30 红）。
   - FrameTime：每秒平均帧耗时（ms）。
   - JS 已用内存：`performance.memory.usedJSHeapSize`（MB，Chrome 有效）。
   - INP：Event Timing API 观察交互事件，记录本会话交互延迟峰值（ms）。
   - Triangles：遍历 Cesium `frameState.commandList` 累计顶点数除以 3 近似三角面数。
   - Queue：Cesium `globe.tileLoadQueueLength` 瓦片等待队列数。
   - DOM 节点数：`document.getElementsByTagName('*').length`。
   - 并发请求：Resource Timing 观察近 1.5 秒窗口内发起的资源请求数。
3. `cesium-scene.ts` 新增 `getCesiumStats()`，通过模块级 `activeViewer` 暴露当前 Cesium 场景的三角面数与瓦片队列，`destroyScene` 时清空引用。
4. 监控面板在移动端允许横向滚动。

### 工程约定

- Cesium 内部属性（`frameState`、`tileLoadQueueLength`、`interactionId`）因类型未暴露，统一通过类型断言访问。

### 验证标准

- 卡片底部显示案例描述。
- 完整案例页顶栏展示 8 项性能指标，返回案例中心后监控停止。
- TypeScript 类型检查和 Vite 生产构建通过。

## V1.1 案例截图 icon 参数与卡片缩略图

### 迭代目标

为每个案例增加 `icon` 参数用于卡片截图展示；无 icon 的案例显示"暂无截图"占位。cesium-init 案例使用用户上传的地球截图作为首个 icon 示例。

### 实施步骤

1. `DemoCard` 类型新增可选 `icon?: string`，记录案例截图资源。
2. `App.vue` 卡片缩略图改为有 icon 时以 `<img>` 展示，无 icon 时显示"暂无截图"占位状态。
3. `src/style.css` 缩略图样式替换为 `.thumbnail img` / `.no-image`，移除旧 CSS 场景主题样式（`.scene-*`、`.theme-*`）。
4. 用户上传地球截图作为 cesium-init 案例的 icon。
5. `npm run build` 验证通过，icon 作为独立资产打包。

### 工程约定

- 案例截图统一存放在案例目录内，与 `index.ts` 同级，文件名为 `icon.webp`。
- 元数据中通过 `import icon from './icon.webp'` 引入后赋给 `icon` 字段，由 Vite 打包为带 hash 的资源；不使用 `public/` 目录。
- 未配置 `icon` 的案例在卡片上显示"暂无截图"占位，不依赖 CSS 主题类。

### 验证标准

- 有 `icon` 的案例卡片展示截图缩略图。
- 无 `icon` 的案例卡片显示"暂无截图"占位。
- 构建产物中包含独立 icon 资产，TypeScript 类型检查和 Vite 生产构建通过。

## V1.2 整体代码清理与依赖精简

### 迭代目标

全量审查项目代码与文件，移除未使用依赖、死字段、未使用导出、残留样式和构建缓存，保证项目干净清晰。

### 实施步骤

1. 移除未使用依赖：`vue-router`、`@vue/runtime-dom`（后者由 `vue` 传递提供，非直接依赖），同步 `package-lock.json`。
2. 移除 `DemoCard.theme` 字段及全部案例的 `theme` 取值（V1.1 已无 CSS 主题消费方）。
3. 移除 `tianditu.ts` 未使用的 `createTiandituVectorProvider` 导出，`TiandituLayer` 收敛为 `img | cia`。
4. 移除 `cesium-scene.ts` 中从未被调用的 `SceneCallbacks.onError` 回调字段。
5. 移除 `App.vue` 未使用的 `DataLine`、`Fold` 图标导入。
6. 移除 `style.css` 中弹窗残留样式（`.dialog-*`、`.launch-button`），该类 DOM 已随详情弹窗移除。
7. 删除 TS 增量构建缓存 `tsconfig.app.tsbuildinfo`（已 gitignore）。

### 验证结果

- 顶层依赖收敛为 4 个实际使用包，`@vue/runtime-dom` 仅作为 `vue` 传递依赖存在于 lockfile。
- 全库无 `theme`/`vec`/`onError`/`dialog`/`launch-button` 残留引用。
- TypeScript 类型检查与 Vite 生产构建通过。

## V1.3 本地矢量数据加载案例

### 迭代目标

增加第二个案例"本地矢量数据加载"，支持在场景中加载并展示 SHP、GeoJSON、KML 三种格式的本地矢量数据。

### 实施步骤

1. 新增 `src/cases/vector-loader/` 案例目录，注册到"数据可视化"分类。
2. 新增 `shpjs@6.2.0` 依赖，将 SHP 解析为 GeoJSON 后交给 Cesium `GeoJsonDataSource` 加载。
3. `VectorLoaderDemo.vue` 复用 `cesium-scene.ts` 的场景初始化与天地图底图，提供：
   - 三个示例按钮，一键加载内置 GeoJSON / KML / SHP 示例数据。
   - 本地文件选择，支持 `.shp(+.dbf)`、`.zip`、`.geojson`、`.json`、`.kml`。
   - 加载状态、要素数量与错误提示，加载成功后 `flyTo` 适配视角。
4. 准备示例数据于 `sample-data/`：手写城市点 GeoJSON、手写 KML 要素集、Node 脚本生成的 Point 型 SHP+DBF。
5. 新增 `src/shims-shpjs.d.ts` 补充 shpjs 模块类型声明。

### 工程约定

- 案例内示例数据放在案例目录 `sample-data/`：文本用 `?raw` 导入，二进制用 `?url` 导入后 `fetch` 读取。
- 本地 SHP 导入时若同时选择同名 `.dbf`，几何与属性合并解析。
- SHP 示例的 DBF 属性使用英文取值，避免旧式 DBF 非 UTF-8 编码在 shpjs 下乱码。
- KML 加载必须传入 `camera` 与 `canvas` 选项。

### 验证标准

- 三个示例按钮分别加载 GeoJSON / KML / SHP 数据并在场景中渲染。
- 本地文件导入与示例加载均可用，要素数正确展示。
- TypeScript 类型检查与 Vite 生产构建通过，dev server 模块编译正常。

## V1.4 矢量图层清单与显隐移除

### 迭代目标

取消内置示例数据；在矢量加载案例中增加已加载数据清单，支持图层显隐控制与移除，实现连续加载不同的本地矢量数据。

### 实施步骤

1. 移除三个示例按钮及 `sample-data/` 目录下的全部示例数据文件（GeoJSON / KML / SHP+DBF）。
2. 新增图层清单：面板下半部分按加载顺序列出图层，展示文件名、格式、要素数。
3. 每个图层提供显隐开关（`dataSource.show`）与移除按钮（`dataSources.remove(dataSource, true)`）。
4. 加载策略由"加载前清空"改为"累加加载"：多次选择文件可持续追加图层，加载完成后自动 `flyTo` 最后一个成功的数据源。
5. 文件选择支持一次多选批量加载；`.shp` 自动配对同批的同名 `.dbf`，单文件失败不影响其它文件。

### 工程约定

- 图层清单用 `shallowRef` 存数组、整体替换触发更新，Cesium `DataSource` 实例不进入 Vue 深响应式代理，避免包装开销。
- 内置示例数据不再提供，数据全部来自用户本地文件。

### 验证标准

- 连续加载多个矢量文件，图层依次追加到清单。
- 图层显隐开关即时生效，移除按钮可删除图层。
- TypeScript 类型检查与 Vite 生产构建通过，dev server 模块编译正常。

## V1.5 图层显隐开关修复与要素属性拾取

### 迭代目标

修复图层显隐开关点击后样式不变的问题；新增点击地图矢量要素展示属性信息的能力。

### 实施步骤

1. 显隐开关修复：开关类绑定由 `:class="{ off: !visible }"` 改为 `:class="{ on: visible }"`，与 CSS 中的 `.layer-vis.on` 开启样式（蓝色滑块右移）对齐，点击后开关外观实时切换。
2. 要素属性拾取：
   - 使用 `ScreenSpaceEventHandler` 监听左键点击，`viewer.scene.pick` 拾取实体。
   - 通过 `entity.properties.getValue(JulianDate.now())` 提取属性键值，对象型值 `JSON.stringify` 展示。
   - 左下角新增属性面板，展示要素名称与属性表，支持关闭；点击空白处自动清除选择。
   - 移除图层时同步清除选中属性。

### 工程约定

- 拾取回调参数需显式标注 `ScreenSpaceEventHandler.PositionedEvent` 类型，`scene.pick` 入参为 `Cartesian2`。
- 案例卸载时 `clickHandler.destroy()`，避免事件残留。

### 验证标准

- 图层显隐开关点击后样式即时变化。
- 点击地图矢量要素显示属性面板，点击空白处清除。
- TypeScript 类型检查与 Vite 生产构建通过，dev server 模块编译正常。

## V1.6 矢量卡片图标、天地图署名与属性面板位置

### 迭代目标

为本地矢量数据加载案例补充卡片截图；恢复地图左下角天地图署名；属性面板移至地图左上角。

### 实施步骤

1. 用户上传截图存放至 `src/cases/vector-loader/icon.webp`，元数据通过 `import icon from './icon.webp'` 引用。
2. 恢复天地图署名：
   - `cesium-scene.ts` 移除 `creditContainer` 的 `display: none` 隐藏逻辑。
   - `tianditu.ts` 为影像与注记 provider 设置 `Credit`（"© 天地图"带官网链接），由 Cesium 左下角 CreditDisplay 渲染。
3. 属性面板由左下角移至地图左上角（`left: 12px; top: 12px`），与右上角图层面板错开。

### 验证标准

- 矢量加载卡片展示截图缩略图。
- 场景左下角显示"© 天地图"署名链接，全案例统一生效。
- 要素属性面板显示于地图左上角。
- TypeScript 类型检查与 Vite 生产构建通过。

## V1.7 隐藏 Cesium ion 默认署名

### 迭代目标

所有案例左下角仅保留天地图署名，隐藏 Cesium ion 品牌 logo。

### 实施步骤

1. 使用 Cesium 公开 API `CreditDisplay.cesiumCredit`（左下角 Cesium ion 品牌 credit 的 getter/setter）将其置为 `undefined`（私有属性类型断言访问）。
2. `CreditDisplay` 每帧 `beginFrame` 会用该静态值同步实例 credit，渲染阶段检测到为空后移除 ion logo，不追加任何内容。
3. 天地图 provider 的 `Credit`（"© 天地图"）走 `screenCredits` 正常渲染，不受影响。

### 工程约定

- ion 品牌 credit 的控制统一收敛在公共模块 `cesium-scene.ts`，所有案例场景创建时自动生效。
- Cesium 私有/静态属性通过类型断言访问，使用的 API 与副作用记录于此。

### 验证标准

- 案例左下角仅显示"© 天地图"署名，无 Cesium ion 品牌 logo。
- TypeScript 类型检查与 Vite 生产构建通过。

## V1.8 GeoServer 服务加载案例

### 迭代目标

新增「GeoServer 服务加载」案例（`src/cases/geoserver-loader/`），支持三类 OGC 服务：

- WMS：GetCapabilities 解析图层 → `WebMapServiceImageryProvider` 加载影像，点击查询要素属性。
- WFS：GetCapabilities 解析要素类型 → GetFeature（`outputFormat=application/json`）返回 GeoJSON → `GeoJsonDataSource.load` 加载。
- WMTS：GetCapabilities 解析图层 + TileMatrixSet → `WebMapTileServiceImageryProvider` 加载。

### 实施步骤

1. `capabilities.ts`：`parseCapabilities(xmlText, kind)` 用 DOMParser 按服务类型解析（WMS 递归 Layer 取 Name/Title，WFS 取 FeatureType，WMTS 取 Identifier/TileMatrixSet）；`capabilitiesUrlFor(kind, url)` 自动拼接 `service=X&request=GetCapabilities`（已有 query 则追加）；`stripQuery(url)` 去掉 capability 参数用于图层 URL。
2. `GeoserverLoaderDemo.vue`：地址输入 + 类型切换 + 获取图层列表 + 勾选加载；图层清单支持显隐开关（`imageryLayer.show` / `dataSource.show`）与移除；点击要素展示属性（WFS 走 `scene.pick` + `entity.properties`，WMS 走四角反算 bbox 的 GetFeatureInfo）。
3. 主组件注册进 `src/cases/index.ts`，分类 `tools`，无截图暂不引入 icon。
4. 首次构建暴露两个 TS 问题并修复：`Cartesian2` 需值导入（`new` 使用）；闭包内引用 `let viewer` 时 TS 不保留收窄，改为提取局部常量 `currentViewer`。

### 关键约定

- capabilities 解析工具放在案例目录内，不进入 `src/lib/`（仅该案例使用）。
- WFS 仅支持 GeoJSON 输出格式；非 JSON 响应（GML）未规划解析。
- WMS GetFeatureInfo 通过屏幕四角 `pickEllipsoid` 反算当前视口 bbox（EPSG:4326），按像素坐标请求，避免依赖 `scene.pick`（影像图层拾取不可靠）。

### 验证标准

- TypeScript 类型检查与 Vite 生产构建通过，HMR 无错误。
- dev server 模块编译正常（`src/cases/geoserver-loader/GeoserverLoaderDemo.vue` HMR 更新无报错）。
- 实际 GeoServer 实例端到端验证待后续补充（当前无可用实例）。

### V1.8.1 加载提示弹窗

面板标题右侧新增「?」提示按钮，点击弹出遮罩弹窗（纯 CSS 实现，与案例风格一致），分 WMS / WFS / WMTS 三段引导：

- WMS：地址 `http://<主机>:<端口>/geoserver/<工作区>/wms` → 获取图层 → 勾选加载 → 单击地图查询属性。
- WFS：地址 `http://<主机>:<端口>/geoserver/<工作区>/wfs` → 获取图层 → 勾选加载 → 单击要素查看属性。
- WMTS：地址 `http://<主机>:<端口>/geoserver/gwc/service/wmts` → 填写 TileMatrixSet（默认 EPSG:900913）→ 获取图层 → 勾选加载。
- 底部附通用提示：默认端口 8080、跨域需服务端开启 CORS。

弹窗内地址示例含尖括号，模板中以 `&lt;`/`&gt;` 实体转义，避免被当作标签解析。

### V1.8.2 图层范围跳转与定位

1. `capabilities.ts`：新增 `BBox` 类型 `[west, south, east, north]`（EPSG:4326），`CapabilityLayer` 增加 `bbox?`，按服务类型解析：
   - WMS：`EX_GeographicBoundingBox`（westBoundLongitude 等四子元素），退化到 `BoundingBox`（CRS/SRS 含 4326）的 minx/miny/maxx/maxy 属性。
   - WFS：`LatLongBoundingBox` 的 minx/miny/maxx/maxy 属性。
   - WMTS：`WGS84BoundingBox` 的 LowerCorner/UpperCorner（"lon lat" 两值）。
2. `GeoserverLoaderDemo.vue`：
   - `flyToBounds(bounds, padding)`：`camera.flyTo` 到带 8% 内边距的 `Rectangle`；退化范围（零跨度）退化为中心点定高飞行。实现上优先用合并的 bbox 跳转，WFS `flyTo(dataSource)` 仅作无 bbox 时的兜底。
   - 「加载所选图层」成功后合并所有成功图层 bbox 跳转一次。
   - 图层清单每项新增「⌖」定位按钮，点击跳转该图层 bbox；无 bbox 时禁用（opacity 0.35 + title 提示"该图层无范围信息"）。
   - `Cartesian3`/`Rectangle` 由 type import 改为值 import（`new`/构造需要）。

### 验证标准

- 勾选多个图层加载后，相机跳转到所有图层合并范围。
- 图层清单定位按钮可单图层跳转，无范围信息的图层按钮禁用。
- TypeScript 类型检查与 Vite 生产构建通过，HMR 无错误。

### V1.8.3 案例 icon 与可用图层筛选

1. 用户上传图片 `cb94b55a-image-1.webp` 复制为 `src/cases/geoserver-loader/icon.webp`，`index.ts` 按约定 `import icon from './icon.webp'` 引入（构建产物 `icon-*.webp` 112.72 kB）。
2. 可用图层面板新增关键字筛选：
   - `layerFilter` ref + `filteredLayers` computed，按 title 或 name 不区分大小写匹配。
   - 面板头部显示 `筛选数 / 总数`，无匹配时显示「无匹配图层」空态。
   - 切换服务类型（`switchKind`）时同步清空筛选词。

### 验证标准

- GeoServer 卡片展示上传图标缩略图。
- 可用图层列表可按关键字实时筛选。
- TypeScript 类型检查与 Vite 生产构建通过，HMR 无错误。

## V1.9 GeoServer 指定图层案例

### 迭代目标

新增「GeoServer 指定图层」案例（`src/cases/geoserver-layer/`），与 `geoserver-loader` 的区别：不解析 GetCapabilities 发现图层，而是直接输入服务地址 + 图层名加载**指定**的 WMS / WFS / WMTS 图层。

### 实施步骤

1. `GeoserverLayerDemo.vue`：
   - 表单：服务类型（WMS/WFS/WMTS）+ 服务地址 + 图层名 + （WMTS 时）TileMatrixSet + 可选范围 `west,south,east,north`。
   - 加载：WMS/WMTS 用 imagery provider 直接加载；WFS 走 GetFeature（GeoJSON，`srsName=EPSG:4326`）。
   - 图层清单：显隐开关 / ⌖ 定位按钮（范围来自手动输入，未填则禁用）/ 移除。
   - 交互：WFS 单击要素 `scene.pick` 展示属性；WMS 单击用四角反算 bbox 的 GetFeatureInfo 查询属性（复用 geoserver-loader 模式）。
   - 帮助弹窗：说明三种类型地址与图层名填写格式。
2. 元数据 `index.ts` + 注册 `src/cases/index.ts`（分类 `tools`，`geoserverLoaderCase` 之后）。
3. 首构建 TS 报错：`LoadedLayer` 无 `title` 字段，统一改为用 `name` 字段（组件内 `title` 本就与 `name` 相同）。

### 与 geoserver-loader 的边界

- `geoserver-loader`：GetCapabilities 自动发现全部图层 → 勾选加载，范围跳转基于解析的 bbox。
- `geoserver-layer`：手动指定单个图层直接加载，无 GetCapabilities；范围由用户填写，仅用于定位与加载后跳转。

### 验证标准

- 案例注册后列表出现「GeoServer 指定图层」卡片，切换渲染正常。
- TypeScript 类型检查与 Vite 生产构建通过，HMR 无错误。
- 端到端验证待有可用 GeoServer 实例后补充。

### V1.9.1 范围自动填充按钮

1. `capabilities.ts` 由 `src/cases/geoserver-loader/` 提升到 `src/lib/geoserver-capabilities.ts`（现被两个案例共用，符合"共享模块进 lib"约定），更新 geoserver-loader 的 import 路径。
2. `geoserver-layer` 案例范围输入行新增「自动」按钮（`autoFillBbox`）：
   - 校验服务地址与图层名，未填时提示。
   - 对当前服务类型发 GetCapabilities（`capabilitiesUrlFor`），`parseCapabilities` 解析后按图层名精确匹配，取其 bbox 填入输入框（数值保留 6 位小数）。
   - 未匹配到图层或无范围信息时提示「未找到该图层的范围信息」。
   - 本地 `BBox` 类型定义移除，改为从 `geoserver-capabilities` 导入。

### 验证标准

- 填写服务地址 + 图层名后点击「自动」可回填该图层范围。
- TypeScript 类型检查与 Vite 生产构建通过，HMR 无错误。

### V1.9.2 指定图层卡片 icon

用户上传图 `92c8fa35-image-1.webp` 复制为 `src/cases/geoserver-layer/icon.webp`，`index.ts` 按约定 `import icon` 引入（构建产物 `icon-*.webp` 130.19 kB）。

### V1.9.3 WMTS 请求 400 修复

用户实测 `https://www.larkview.cn/geoserver2/gwc/service/wmts`（GeoWebCache）加载失败：Cesium 默认请求 `?service=WMTS&...&tilematrix=12&...` 返回 400，而 GeoServer 自身浏览器成功请求 `?layer=...&style=&tilematrixset=EPSG%3A900913&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image%2Fpng&TileMatrix=EPSG%3A900913%3A13&TileCol=...&TileRow=...`。

**根因**（读 Cesium 源码 `WebMapTileServiceImageryProvider.js` 确认）：

1. url 不含 `{` 占位符时走 KVP 模式（`_useKvp=true`），参数名全小写且写死 `tilematrix/tilerow/tilecol`，与 GWC 期望的大小写混合格式不一致。
2. `getTileMatrix(level)`：未提供 `tileMatrixLabels` 时返回 `level.toString()`（纯数字），而 GWC 要求完整标识符 `EPSG:900913:<level>`。

**修复**：新建 `src/lib/wmts.ts` 工厂 `createWmtsImageryProvider`：

- 传入含大写占位符的 URL 模板，强制走模板模式（`_useKvp=false`），参数名与成功请求一致：`?layer={layer}&style={Style}&tilematrixset={tilematrixset}&Service=WMTS&Request=GetTile&Version=1.0.0&Format={format}&TileMatrix={TileMatrix}&TileCol={TileCol}&TileRow={TileRow}`。
- `style: ''`（成功请求 `style=` 空）。
- `tileMatrixLabels` 传数组 `EPSG:900913:{0..59}`（源码用 `labels[level]` 数组索引，不能用函数），保证 `TileMatrix` 替换为完整标识符。
- `geoserver-layer` 与 `geoserver-loader` 两个案例的 WMTS 分支统一改用该工厂。

**验证**：修复后生成的瓦片 URL 与 GeoServer 浏览器成功请求参数完全一致（URL 编码由浏览器自动处理）。

### 验证标准

- GeoServer 指定图层卡片展示上传图标。
- WMTS（GeoWebCache）加载不再 400，瓦片正常请求（`TileMatrix=EPSG:900913:<level>` 完整标识符）。
- TypeScript 类型检查与 Vite 生产构建通过，HMR 无错误。

### V1.9.4 WMS 图层名提示调整

「GeoServer 指定图层」图层名输入框按服务类型区分 placeholder（`layerNamePlaceholder` computed）：

- WMS：`图层名 layer，如 layername`（服务地址通常已含 workspace，layers 参数只需图层名）。
- WFS：`要素类型 typeName，如 ws:layer`（保持）。
- WMTS：`图层名 layer，如 ws:layer`（保持，WMTS 服务地址不含 workspace）。

帮助弹窗 WMS 的示例同步改为 `<图层名>`。

### 验证标准

- WMS 图层名提示不再出现 `<工作区>:<图层名>` 形式。
- TypeScript 类型检查与 Vite 生产构建通过，HMR 无错误。

## V2.0 天气效果案例（下雨 / 下雪）

### 迭代目标

将 effects 分类下的占位卡片「天气特效-下雨」「天气特效-下雪」实现为真实案例：

- `weather-rain`：基于后处理的实时雨景。
- `weather-snow`：基于后处理的实时雪景。
- 两者均支持效果开关、参数调整、场景亮度调整。

### 实施步骤

1. `src/lib/weather.ts`：公共 shader 常量 `RAIN_FRAGMENT` / `SNOW_FRAGMENT`（`PostProcessStage` 片段着色器，`mainImage` 风格）：
   - 雨：网格化雨丝，`time` 驱动下落，`density` 雨量、`speed` 下落速度、`wind` 风向倾斜、`len` 雨丝长度、`brightness` 亮度。
   - 雪：网格化随机雪花点下落，`density` 雪量、`speed` 速度、`wind` 横向漂移、`size` 雪花大小、`brightness` 亮度。
   - 注意：GLSL 内置函数名 `length` 不能作 uniform 名，雨丝长度用 `len`。
2. `src/cases/weather-rain/WeatherRainDemo.vue`、`src/cases/weather-snow/WeatherSnowDemo.vue`：
   - `PostProcessStage` 加入 `viewer.scene.postProcessStages`，`scene.postUpdate` 每帧以 `clock` 相对 startTime 的秒数更新 `uniforms.time`。
   - `watch` 监听参数 ref，变化时写回 `stage.uniforms` 与 `stage.enabled`（开关）。
   - 面板：开关 toggle + 滑杆（雨量/速度/风向/雨丝 与 雪量/速度/风向/大小）+ 亮度滑杆。
   - 卸载时移除 postUpdate 监听与 stage，销毁 viewer。
3. 注册 `src/cases/index.ts`：`weatherRainCase` / `weatherSnowCase` 替换原内联占位条目（保留 id/分类/标签）。
4. 首构建 TS 报错：`PostProcessStage` 同时出现在 type import 与值 import（重复标识符），合并为单值导入（`Viewer` 保留 type）。

### 工程约定

- 后处理 uniform 每帧更新挂在 `scene.postUpdate`（非 requestRenderMode 下随渲染帧触发）。
- 天气 shader 常量收敛在 `src/lib/weather.ts`，供案例复用。

### 验证标准

- 卡片切换后雨/雪实时渲染，开关可即时开启关闭。
- 参数滑杆实时生效，亮度滑杆调节整体明暗。
- TypeScript 类型检查与 Vite 生产构建通过，dev 编译正常（两个组件 HTTP 200）。

### V2.0.1 天气 shader 编译失败修复

预览报 `RuntimeError: Fragment shader failed to compile`（`resolution` 未声明、`texture2D` 无匹配重载）。根因：Cesium 1.144 的 `PostProcessStage` 只支持新式 GLSL（WebGL2 / GLSL 300 es），不再自动注入旧式 `mainImage` 包装所需的 `resolution`/`fragCoord`，且 `texture2D` 已被 `texture()` 取代。

**修复**：`src/lib/weather.ts` 两个 shader 重写为新式写法（与官方文档示例一致）：

- 删除 `void mainImage(out vec4 fragColor, in vec2 fragCoord)` 与 `resolution` 依赖。
- 改用 `void main()` + `uniform sampler2D colorTexture;` + `in vec2 v_textureCoordinates;` + `texture(colorTexture, v_textureCoordinates)` + `out_FragColor`（输出声明由 Cesium `ShaderSource` 自动注入）。
- 网格坐标改为 uv 空间计算：`cell = floor(uv * cellCount)`、`local = fract(uv * cellCount) - 0.5`，替代绝对像素 `fragCoord / cellSize`，与分辨率解耦。

### 验证标准

- 雨/雪后处理 shader 编译通过，效果正常渲染（需浏览器刷新预览确认，本地无 WebGL 无法自动验证）。
- TypeScript 类型检查与 Vite 生产构建通过。

### V2.0.2 雨雪无动画修复

**现象**：shader 编译通过、雨雪静止不动。

**根因分析**：`uniforms.time` 取自 `viewer.clock.currentTime` 相对 `startTime` 的秒差。Cesium Viewer 时钟默认 `shouldAnimate = false`（未点击动画控件播放按钮时时间不前进），`currentTime` 恒定，`time` 恒为 0，shader 中 `fract(local.y - time * speed * ...)` 不再变化 → 动画静止。

**修复**：不依赖 Cesium 时钟，改用独立计时器：

- 在 `scene.postUpdate`（每渲染帧触发）中用 `performance.now()` 计算与上一帧的毫秒差并累加为 `elapsed` 秒，写入 `stage.uniforms.time`。
- 帧差加 0.1s 上限，避免从后台标签切回时时间跳变导致雨雪瞬间加速。
- 移除 `JulianDate` 依赖与 `clock.startTime` 引用。

### 验证标准

- 雨/雪持续下落/飘落，开关关闭时 `time` 停止累积、重新开启后动画连续。
- TypeScript 类型检查与 Vite 生产构建通过。

### V2.0.3 雨雪视觉效果重制

**目标**：消除单层固定网格造成的重复感，为雨雪增加清晰的前、中、远景层次与更自然的运动。

**实现**：

1. `RAIN_FRAGMENT` 提炼 `rainLayer`，以独立网格、随机种子、速度、宽度和透明度叠加三层雨丝。
2. 雨丝按随机长度、风向倾斜和前端亮度变化渲染；远景更细、更透明，前景更长、更醒目。
3. `SNOW_FRAGMENT` 提炼 `snowLayer`，用独立网格、随机偏移、摆动和闪烁叠加三层雪花。
4. 雪花以核心与柔和光晕组成，按景深层级调整粒径、漂移速度与透明度，形成更自然的飘落感。
5. 保持原有 `density`、`speed`、`wind`、`len`/`size`、`brightness` uniform 契约，案例控制面板与动画生命周期无需新增耦合。

### 验证结果

- `npm run build` 通过：Vue TypeScript 检查和 Vite 生产打包完成。
- 现有 Vite 开发服务响应 HTTP 200，HMR 可加载更新后的 shader 模块。
- 本地环境缺少可用的 WebGL 无头浏览器，最终雨雪视觉效果需通过预览页面实际确认。

### V2.0.4 Shadertoy 多层视差下雪效果移植

**目标**：将用户提供的 Shadertoy「Just snow」效果应用到下雪案例，增强雪花的视差、随机性和景深表现。

**实现**：

1. `SNOW_FRAGMENT` 改用固定上限 56 层的视差算法，每层以独立的网格坐标、随机种子和深度系数计算雪花位置。
2. `density` 映射为参与渲染的有效层数；`speed` 映射为动画时间倍率；`wind` 控制每层横向偏移；`size` 控制雪花可见轮廓；`brightness` 保持场景整体亮度调节。
3. 保留参考实现的 `dof` 景深变化、非规则轮廓和逐层亮度衰减，适配 Cesium 1.144 的 GLSL 300 `PostProcessStage` 接口。
4. 源码内保留 Andrew Baldwin（2013）的来源地址与 `CC BY-NC-SA 3.0` 署名、非商业和相同方式共享许可声明。

### 验证标准

- 下雪案例显示多层、不同深度与方向的雪花，且控制面板参数即时生效。
- TypeScript 类型检查和 Vite 生产构建通过。

### V2.0.5 Shadertoy 噪声雨幕效果移植

**目标**：将用户提供的 Shadertoy「Tokyo by night in the rain」雨幕算法移植至 Cesium 下雨案例，营造密集、湿润且具空间变化的雨景。

**实现**：

1. `RAIN_FRAGMENT` 移植参考实现中署名为 Dave Hoskins 的相关噪声雨幕算法：两组不同尺度的平滑值噪声相乘，再经高对比阈值塑造出随机的雨丝簇。
2. `density` 控制噪声雨幕的颗粒密度与合成强度；`speed` 控制动画时间倍率；`wind` 控制屏幕空间的雨幕斜向；`len` 调节纵向伸展与阈值对比；`brightness` 延续地图整体明暗调节。
3. 在原始地图颜色上叠加冷色湿润感和高光雨滴，避免替换底图画面。
4. 源码内保留 Reinder Nijhoff（2014）、Dave Hoskins 的技术署名、来源地址与 `CC BY-NC-SA 4.0` 许可说明。

### 验证标准

- 下雨案例显示持续运动的随机雨幕，且控制面板参数即时生效。
- TypeScript 类型检查和 Vite 生产构建通过。

### V2.0.6 Banished 锐利雨丝效果移植

**目标**：替换 V2.0.5 的雨幕算法，采用用户提供的 Shadertoy「Banished」雨丝生成模型，突出更稀疏、细长且高对比的降雨细节。

**实现**：

1. `RAIN_FRAGMENT` 改用「Banished」的核心流程：将两个不同尺度的高频随机噪声相乘，再以 23 次幂筛选出少量明亮锐利的雨丝。
2. 为替代 Shadertoy 的 `iChannel3` 噪声纹理，实现可重复的双线性程序化噪声采样，避免增加纹理资源和外部依赖。
3. `density` 控制噪声采样密度与雨丝强度；`speed` 控制下落时间；`wind` 控制雨丝斜向；`len` 控制纵向拉伸；`brightness` 保持场景亮度控制。
4. 源码内保留 David Hoskins（2013）与 Shadertoy 来源地址署名。

### 验证标准

- 下雨案例显示移动的细长高光雨丝，且控制面板参数即时生效。
- TypeScript 类型检查和 Vite 生产构建通过。

### V2.0.7 雨丝分段与长度修正

**问题**：V2.0.6 的雨丝在纵向拉伸后形成连续长线，降雨的粒子感不足。

**修复**：

1. 缩短 `rainLength` 的纵向拉伸范围，雨丝长度随现有“雨丝”滑杆保持可调。
2. 在高光雨丝上叠加随机 `breakMask`：每个噪声单元按独立随机中心点和长度切出一段可见雨线，单元交界自然产生间隙。
3. 断点掩码沿雨线方向采样，保留风向与下落运动的连续性，同时让断点长度和位置保持随机。

### 验证标准

- 雨丝呈现不同长度的可见片段与自然断点，且无横向规律性切割痕迹。
- TypeScript 类型检查和 Vite 生产构建通过。

### V2.0.8 天气案例卡片图标更新

1. 用户上传的 `image-1` 作为下雨案例图标，保存为 `src/cases/weather-rain/icon.webp`。
2. 用户上传的 `image-2` 作为下雪案例图标，保存为 `src/cases/weather-snow/icon.webp`。
3. 两个案例的 `index.ts` 均通过 `import icon from './icon.webp'` 设置卡片图标，保持案例资源本地化约定。

### 验证标准

- 下雨和下雪卡片分别显示用户提供的对应缩略图。
- TypeScript 类型检查和 Vite 生产构建通过。

### V2.1 闪电效果案例

**目标**：在三维特效分类中增加可独立打开的闪电案例，移植 Shadertoy `fsdGWf` 的程序化雷电表现。

**实施内容**：

1. 新增 `src/cases/lightning/LightningDemo.vue` 和 `src/cases/lightning/index.ts`，沿用公共 Cesium 场景初始化、天地图底图、PostProcessStage 和卸载销毁约定。
2. 新增 `LIGHTNING_FRAGMENT`：使用一维和三维 Perlin 噪声、随机事件周期、分形路径、闪电主体、辉光与云层合成实现雷电效果。
3. 控制面板提供效果开关、闪电频率、闪电强度、云层强度和场景亮度调节。
4. `src/cases/index.ts` 注册“天气特效-闪电”卡片；用户未提供闪电图标时使用系统默认无图标卡片视觉。
5. 新增需求与设计文档：`.monkeycode/specs/lightning-effect/requirements.md`、`.monkeycode/specs/lightning-effect/design.md`。

### 验证标准

- 三维特效分类显示并可打开闪电案例。
- 闪电开关、频率、强度、云层和亮度参数可实时更新。
- 案例关闭后移除后处理阶段、帧监听器并销毁 Viewer。
- TypeScript 类型检查和 Vite 生产构建通过。

### V2.1.1 闪电位置上移

**问题**：闪电路径和高度遮罩的默认分布偏向场景下部。

**修复**：

1. 将闪电路径的屏幕空间锚点上移 `0.52`，使主体雷电集中在视口上半部。
2. 将闪电高度随机范围调整为 `0.18` 到 `0.82`，减少低位闪电事件。
3. 保留雷电横向随机位置、分形路径、辉光和云层闪光逻辑。

### 验证标准

- 闪电主体默认位于场景上部，并保留随机横向位置和高度变化。
- TypeScript 类型检查和 Vite 生产构建通过。

### V2.1.2 闪电贴顶部修正

**问题**：上一版高度遮罩保留了阈值以下区域，闪电视觉主体仍偏向下部。

**修复**：

1. 将高度遮罩改为保留阈值以上区域，匹配“闪电从顶部向下延伸”的视觉方向。
2. 将随机起始高度限制在 `0.45` 到 `0.86` 的屏幕上部区域，使闪电贴近顶部出现。
3. 保留分形路径、随机横向位置和辉光效果。

### 验证标准

- 闪电从场景顶部区域向下延伸，主体集中在视口上半部。
- TypeScript 类型检查和 Vite 生产构建通过。

### V2.2 闪电图标与深度高度雾效果

**目标**：补充闪电案例卡片图标，并增加具有远景深度雾、近地高度雾和动态雾团的独立天气案例。

**实施内容**：

1. 用户上传的 `image-1` 保存为 `src/cases/lightning/icon.webp`，闪电案例元数据通过 `import icon from './icon.webp'` 引用该图标。
2. 新增 `src/cases/fog/FogDemo.vue` 和 `src/cases/fog/index.ts`，沿用公共 Cesium 场景初始化、天地图底图、PostProcessStage 和卸载销毁约定。
3. 新增 `FOG_FRAGMENT`：读取场景深度并重建世界坐标，以相机距离计算远景雾，以近似海拔计算近地高度雾。
4. 基于 Shadertoy `Msf3zX` 的程序化噪声思路，以四层分形噪声调制雾团边界和缓慢运动。
5. 控制面板提供效果开关、雾浓度、雾高度、雾距离和场景亮度调节。
6. `src/cases/index.ts` 注册“天气特效-深度高度雾”卡片；新增需求与设计文档：`.monkeycode/specs/fog-effect/requirements.md`、`.monkeycode/specs/fog-effect/design.md`。

### 验证标准

- 闪电案例卡片显示用户提供的图标。
- 三维特效分类显示并可打开雾效案例。
- 雾效开关、浓度、高度、距离和亮度参数可实时更新。
- 案例关闭后移除后处理阶段、帧监听器并销毁 Viewer。
- TypeScript 类型检查和 Vite 生产构建通过。

### V2.2.1 雾案例地形与拖动稳定性

**目标**：为雾效果案例加载真实地形数据，并修复地图拖动时因地形深度变化产生的视觉闪烁。

**实施内容**：

1. 雾案例使用 `createWorldTerrainAsync({ requestVertexNormals: true })` 异步加载 Cesium World Terrain。
2. 地形加载完成后再创建和挂载雾后处理阶段，避免椭球地球、地形切片和雾 shader 同时切换造成画面跳变。
3. 开启 `depthTestAgainstTerrain`，并将地形最大屏幕空间误差设为 `2`，减少拖动时地形 LOD 变化幅度。
4. 雾 shader 使用当前像素与相邻深度样本的最小值平滑地形边界，降低瓦片接缝和细节切换的闪烁感。
5. 地形请求失败时显示状态提示，并继续使用基础地球渲染雾效。

### 验证标准

- 雾效果案例打开后显示 Cesium World Terrain 地形。
- 地形加载状态和失败降级状态可见。
- 地图拖动、旋转和缩放过程中雾层保持连续显示。
- TypeScript 类型检查和 Vite 生产构建通过。

### V2.3 动态多边形水面效果

**目标**：新增可根据经纬度多边形边界生成动态水面的三维特效案例，参考 Shadertoy `csc3RS` 的多缓冲水面模拟和最终合成表现。

**实施内容**：

1. 新增 `src/cases/water-polygon/WaterPolygonDemo.vue` 和 `src/cases/water-polygon/index.ts`，提供默认水面边界、参数面板和边界坐标输入。
2. 新增 `src/lib/water.ts` 中的 `DYNAMIC_WATER_MATERIAL`，使用 Cesium Fabric 材质实现波浪、分形扰动、法线、反射、高光和泡沫。
3. 参考原 shader 的 Common 与 Image 阶段保留程序化波形、法线梯度、折射色彩、天空反射和泡沫；以解析波和分形噪声替代 Buffer A/B/C 的离屏反馈水体模拟。
4. 边界输入接受以分号分隔的“经度,纬度”坐标，提交后更新多边形层级并飞行至首个边界点。
5. `src/cases/index.ts` 注册“水面效果-动态多边形”卡片；新增需求与设计文档：`.monkeycode/specs/dynamic-polygon-water/requirements.md`、`.monkeycode/specs/dynamic-polygon-water/design.md`。

### 验证标准

- 三维特效分类显示并可打开动态多边形水面案例。
- 水面显示连续动态波纹、反射高光和泡沫细节。
- 开关、流速、波纹、波高、清澈度与边界输入实时生效。
- TypeScript 类型检查和 Vite 生产构建通过。

### V2.3.1 全局 Viewer 调试入口

**目标**：为浏览器控制台提供当前 Cesium Viewer 的直接调试入口。

**实施内容**：

1. `createMapScene` 在设置 `activeViewer` 后同步设置 `window.mapViewer`。
2. 为 `Window` 增加 `mapViewer?: Viewer` 类型声明，控制台调试入口保持 TypeScript 可识别。
3. `destroyScene` 在销毁当前 Viewer 时清空 `window.mapViewer`，避免全局引用指向已销毁对象。

### 验证标准

- 打开任一 Cesium 案例后，浏览器控制台可访问 `window.mapViewer`。
- 关闭案例后，`window.mapViewer` 为 `undefined`。
- TypeScript 类型检查和 Vite 生产构建通过。

### V2.3.2 全局底图切换为 Bing 地图

**目标**：替换所有案例中的天地图请求，统一使用 Bing Maps 影像瓦片服务。

**实施内容**：

1. 新增 `src/lib/bing.ts`，通过 `UrlTemplateImageryProvider` 访问 `https://ecn.t{s}.tiles.virtualearth.net/`。
2. 实现 Bing 四叉树 `quadkey` 计算，并作为 URL 模板自定义标签生成影像瓦片地址。
3. 公共场景模块以 `loadBingImagery` 替换天地图加载器，保留影像请求失败状态提示与 Bing Maps 署名。
4. 所有 Cesium 案例统一切换到 `loadBingImagery`，加载状态文案同步为 Bing 地图。

### 验证标准

- 打开任一 Cesium 案例时，请求地址指向 `ecn.t*.tiles.virtualearth.net`。
- 所有案例显示 Bing 地图影像底图。
- 瓦片加载异常时，场景显示 Bing 地图服务状态提示。
- TypeScript 类型检查和 Vite 生产构建通过。

### V2.3.3 Cesium Ion 访问配置

**目标**：配置项目 Cesium Ion 访问凭据，使 World Terrain 等 Cesium Ion 资源可以正常加载。

**实施内容**：

1. 在公共场景初始化模块中设置 `Ion.defaultAccessToken`。
2. 所有使用 `createMapScene` 的案例共享该 Ion 配置，雾案例的 Cesium World Terrain 请求同步获得授权。
3. 保持 Bing 地图作为影像底图，Cesium Ion 仅用于 Ion 资源访问。

### 验证标准

- 创建任一 Cesium Viewer 前完成 Ion token 配置。
- 雾案例可以继续请求 Cesium World Terrain。
- TypeScript 类型检查和 Vite 生产构建通过。

### V2.4 初始化图标与地形控制案例

**目标**：替换 Cesium 初始化地球案例图标，并新增支持地形显示隐藏与高程夸张的地形案例。

**实施内容**：

1. 用户上传图片保存为 `src/cases/cesium-init/icon.webp`，Cesium 初始化案例继续通过本地 `icon.webp` 作为卡片图标。
2. 新增 `src/cases/terrain-control/TerrainControlDemo.vue` 和 `src/cases/terrain-control/index.ts`，放入地形影像分类。
3. 地形案例加载 Cesium World Terrain，并沿用公共 Cesium Ion token、Bing 影像和 Viewer 生命周期管理。
4. 地形显示关闭时切换到 `EllipsoidTerrainProvider`，保持 Bing 影像显示；地形显示开启时恢复 World Terrain。
5. 使用 `viewer.scene.verticalExaggeration` 提供 `1x` 至 `5x` 高程夸张控制。
6. 新增需求与设计文档：`.monkeycode/specs/terrain-control/requirements.md`、`.monkeycode/specs/terrain-control/design.md`。

### 验证标准

- Cesium 初始化地球案例显示用户上传的图标。
- 地形影像分类显示并可打开地形控制案例。
- 地形开关和高程夸张滑杆实时生效。
- TypeScript 类型检查和 Vite 生产构建通过。

### V2.5 Cesium 署名样式与代码清理审计

**目标**：统一隐藏 Cesium Ion 标识，保留数据来源入口，并依据项目代码清理标准完成可审计的工程优化。

**实施内容**：

1. 在全局 `src/style.css` 中设置 `.cesium-credit-logoContainer` 和 `.cesium-credit-textContainer` 的 `display: none !important`，全部案例自动继承。
2. 移除公共场景模块中与全局样式重复的 `CreditDisplay` API 设置，Viewer 生命周期和 Bing 数据来源逻辑保持不变。
3. 新增 `.monkeycode/specs/cesium-credit-and-cleanup/` 需求与设计文档，以及 `docs/code-cleanup-audit-v2.5.md` 清理审计记录。
4. 将无静态业务引用的 `src/lib/tianditu.ts` 标记为待确认候选项，保留文件与第三方服务配置风险记录。

### 验证标准

- 任一 Cesium 案例隐藏 Cesium Ion logo 与屏幕文本容器。
- `Data attribution` 入口可见并可展开数据来源。
- TypeScript 类型检查和 Vite 生产构建通过。
- `git diff --check` 通过。

### V2.6 三维风场粒子流线案例

**目标**：新增三维风场粒子流线案例，移植开源仓库 `lby0101/cesium-wind-layer-3d`（MIT）的 GPU 风场实现，并支持自定义四至范围构造、生成、下载 WindData3D 风场数据。

**实施内容**：

1. 在 `src/cases/wind-layer-3d/lib/` 下以 TypeScript 移植仓库风场库：`windLayer3d.ts`（主类）、`windParticleSystem.ts`、`windParticlesComputing.ts`（GPU 计算）、`windParticlesRendering.ts`（流线渲染）、`customPrimitive.ts`（Compute/Draw 命令封装）、`shaderManager.ts` 与 `shaders/*.ts`（4 个 `#version 300 es` shader）。
2. 使用 Cesium 私有渲染 API `Texture3D`（3D 风纹理）、`ComputeCommand`、`DrawCommand`、`Framebuffer` 实现 GPU 粒子迭代与流线绘制，补充 `cesium-render.d.ts` 类型声明；Cesium 1.144 `Sampler` 静态常量已移除，改用 `TextureWrap`/`TextureMinificationFilter` 构造。
3. `windDataGenerator.ts` 提供自定义四至（west/south/east/north）、网格（nx/ny/nz）与层级配置的合成风场生成，支持 JSON 序列化与浏览器下载。
4. `WindLayer3DDemo.vue` 提供示例数据加载、四至生成并加载、下载 JSON、粒子数/速度/高度/线长/动态开关控制与缩放，接入公共 `createMapScene`/`loadBingImagery` 场景生命周期。
5. 示例数据 `wind_3d.json`（464×374×6，约 16MB）通过 Vite `?url` 引用作为独立资源输出，不进入 JS 包。
6. 注册三维特效分类案例卡片，新增 `.monkeycode/specs/wind-layer-3d/` 需求与设计文档。

### 验证标准

- 三维特效分类显示"三维风场-WebGL2&GPU效果"案例卡片。
- 打开案例可加载真实风场数据并渲染粒子流线，地形遮挡正确。
- 自定义四至可生成并加载、下载 WindData3D 数据。
- 粒子数、速度、高度、线长、动态开关控制实时生效。
- 案例卸载释放纹理、帧缓冲、命令与事件监听。
- TypeScript 类型检查和 Vite 生产构建通过。

### V2.7 风场案例图标与数据替换

**目标**：将风场案例卡片图标替换为用户上传的 `image-1.webp`，并将 `wind_3d.json` 示例数据替换为用户上传的 JSON 数据。

**实施内容**：

1. `src/cases/wind-layer-3d/icon.webp` 替换为用户上传的 1237×655 深色调风场主题图片。
2. `src/cases/wind-layer-3d/data/wind_3d.json` 替换为用户上传数据（80×75×6，范围 110/25/120/32，层级 500~12000m，约 2MB），WindData3D 契约与现库完全兼容，无需改动加载逻辑。
3. 替换后风场数据经 Vite `?url` 作为独立资产输出，图标经 `index.ts` 引用展示于案例卡片。

### 验证标准

- 三维特效分类中风场案例卡片显示上传图标。
- 打开案例加载新范围（东南沿海 110~120°E / 25~32°N）风场数据并渲染粒子流线。
- TypeScript 类型检查和 Vite 生产构建通过。

### V2.8 风场案例名称调整

**目标**：将"三维风场-粒子流线"案例名称改为"三维风场-WebGL2&GPU效果"。

**实施内容**：

1. `src/cases/wind-layer-3d/index.ts` 中 `title` 更新为"三维风场-WebGL2&GPU效果"。
2. 同步更新需求文档与迭代日志中的案例名称引用。

### 验证标准

- 三维特效分类中风场案例卡片显示新名称。
- TypeScript 类型检查和 Vite 生产构建通过。

### V2.9 滑坡与泥石流案例（Three.js + Cesium 双端）

**目标**：基于参考文件《滑坡与泥石流对比演示_3D》分别新增滑坡、泥石流两个独立 Three.js 案例，并将两种效果移植到 Cesium 场景形成两个新案例，保持播放、进度、速度、视角预设、要素标注、图例与阶段讲解等功能完整。

**实施内容**：

1. 新增共享层 `src/cases/geo-hazard-lib/`：`model.ts`（框架无关的解析式地形/滑体/泥石流路径数学与阶段、时间曲线、配色）、`three-base.ts`（`HazardThreeBase` Three.js 演示基类）、`three-parts.ts`（材质、地形块、滑体、裂缝、房屋树木构件）、`cesium-base.ts`（`HazardCesiumBase` Cesium 演示基类）、`knowledge.ts`（滑坡/泥石流科普条目）。
2. 新增 Three.js 案例 `src/cases/landslide-three/` 与 `src/cases/debris-flow-three/`，分类为 `three`，各自包含 Scene、Demo.vue 与 index.ts。
3. 新增 Cesium 案例 `src/cases/landslide-cesium/` 与 `src/cases/debris-flow-cesium/`，分类为 `analysis`，复用 `src/lib/cesium-scene.ts` 的 `createMapScene`/`destroyScene`/`loadBingImagery`，以顶点着色 Primitive 实时形变网格、PointPrimitiveCollection 碎屑、Entity 标注与降雨粒子系统呈现。
4. 基类统一提供播放/进度/速度/阶段跳转/视角预设/标注/防治工程/降雨/自动旋转等控制接口，子类通过 `bootstrap()` 模式在字段初始化完成后构建内容。
5. 新案例不配置 icon 字段；运行 `npm run sync` 后由案例清单扫描自动注册，四个案例分类与卡片正常生成。

### 验证标准

- 三维特效分类显示两个新 Three.js 案例卡片，分析分类显示两个新 Cesium 案例卡片。
- 两个 Three.js 案例可播放/暂停、拖动进度、切换速度与四个视角预设，阶段卡与要素标注联动。
- 两个 Cesium 案例在真实底图场景中呈现滑坡/泥石流过程，标注、降雨、防治工程开关与科普弹窗可用。
- 案例卸载时释放渲染器、Primitive、标注与事件监听。
- TypeScript 类型检查与 Vite 生产构建通过。

### V2.10 滑坡/泥石流 Cesium 案例命名、图标与三维要素修复

**目标**：为滑坡、泥石流两个 Cesium 案例配置标题与卡片图标，并修复村庄房屋、防治工程、降雨在 Cesium 场景中不可见的问题。

**实施内容**：

1. 命名：`landslide-cesium` 标题改为「滑坡形成与运动演示」，`debris-flow-cesium` 标题改为「泥石流形成与运动演示」，`barrier-lake-cesium` 保持「堰塞湖形成与溃决演示」，三者的 Demo 面板标题与 `index.ts` 同步更新。
2. 图标：三个案例目录分别新增 `icon.webp`（用户上传的 image-1/image-2/image-3），`index.ts` 通过 `import icon from './icon.webp'` 引用并写入 `icon` 字段；`npm run sync` 重新生成清单后卡片显示图标。
3. 村庄与防治工程由 Entity 图形改为 Cesium 标准几何管线：新增 `HazardCesiumBase.makeBoxes()`（`BoxGeometry` + `PerInstanceColorAppearance` 批量 GeometryInstance，`boxMatrix()` 提供 ENU 对齐的模型矩阵）与 `HazardBox` 描述类型，村庄、拦挡坝、排导槽、停淤场、截排水沟、抗滑桩、抗滑挡墙全部改为实心盒体 Primitive。
4. 盒体尺寸语义修正：`BoxGeometry` 的 `dimensions` 依次为东向、北向、天向（此前 Entity 版把高度与北向写反），村庄房屋放大到 32m×28m×26m 以便远景辨识。
5. 堆积扇改用与 Three.js 版一致的扇形网格（±0.52π 半椭圆扇面，15×12 模型单位随进度外扩），并以半透明顶点色绘制，随进度重算、整体显隐。
6. 降雨修复：`ParticleSystem` 在 1.144 已无 `gravity` 选项，`BoxEmitter` 的初速方向为「由盒心向外」，因此补充 `updateCallback` 按世界坐标朝地心方向施加恒定下落速度；发射盒尺寸改为 62×62×18 模型单位覆盖整个地块，发射高度 26 模型单位，发射率 150→620。
7. 时钟修复：Cesium 粒子系统按 `frameState.time` 计算 dt，`Viewer` 默认 `clock.shouldAnimate = false` 时 dt 恒为 0（粒子永不发射也不移动），因此 `HazardCesiumBase` 构造时显式开启 `viewer.clock.shouldAnimate = true`。

### 验证标准

- 分析分类中三个 Cesium 案例卡片显示各自上传图标与更新后的标题，案例面板标题一致。
- 滑坡案例在末段进度可看到坡脚村庄房屋、防治工程（截排水沟/抗滑桩/抗滑挡墙）与覆盖全场的降雨粒子。
- 泥石流案例在末段进度可看到沟口堆积扇扩展并淤埋村庄，防治工程（拦挡坝/排导槽/停淤场）与降雨粒子正常显示。
- TypeScript 类型检查（`vue-tsc`）与 Vite 生产构建通过，四个案例运行无 pageerror。

### V2.11 首页导航滚动与三个 Three.js 地质灾害案例面板统一

**目标**：首页左侧功能导航支持纵向滚动；将堰塞湖、泥石流、滑坡三个 Three.js 3D 演示案例的面板统一为其他 Cesium 案例的样式与风格，移除「不止DILI」品牌信息，并为三个案例配置卡片图标。

**实施内容**：

1. `src/style.css`：`.sidebar` 由整体 `overflow-y: auto` 改为 `overflow: hidden`，`.category-list` 设为 `flex: 1 1 auto; min-height: 0; overflow-y: auto` 并追加与 `.demo-grid` 一致的浅色滚动条样式；`.sidebar-heading` 与 `.sidebar-footer` 设为 `flex: 0 0 auto`，使 15 个分类在纵向空间不足时由「功能导航」列表独立滚动。
2. 三个 Three.js 演示改用与其他 Cesium 案例一致的浮层布局：画布铺满 `.fy-shell`，左上 `.step-info`（阶段序号/名称/阶段说明），右上 `.control-panel`（「科普知识」入口、阶段演化、播放控制、显示开关、视角），底部居中 `.stage-bar`，左下 `.legend`，科普内容移入 `.route-overlay` 弹窗。
   - `barrier-lake`：8 阶段状态机，保留上一步/下一步/自动播放/重置与四个视角预设，并接入了场景已提供但此前未暴露的 `setRainManual`（叠加降雨）。
   - `landslide-three` / `debris-flow-three`：保留播放/进度条/时间/速度（0.5、1、2、4 倍）/标注/防治工程/自动旋转/叠加降雨与四个视角预设，控制项全部改为 Cesium 面板样式。
3. 移除全部「不止DILI」「不止DILI · 地理可视化」「制图 · 不止DILI」品牌文案（顶部 HUD、侧栏标题区与页脚签名共 5 处）；面板底部保留一行交互提示（拖动旋转/缩放/平移、空格与方向键、点击标注查看解释），避免丢失场景自带的键盘与标注交互的可发现性。
4. 抽取共享科普数据：将 `barrier-lake-cesium` 内联的 `knowledge` 数组移入 `geo-hazard-lib/knowledge.ts` 并导出 `BARRIER_LAKE_KNOWLEDGE`，Cesium 版改为导入；Three 版与滑坡/泥石流一致直接引用共享知识库，避免同一份科普文案在两端重复维护。
5. 图标：三个案例目录分别新增 `icon.webp`（用户上传的 image-1/image-2/image-3），`index.ts` 通过 `import icon from './icon.webp'` 写入 `icon` 字段，`updatedAt` 更新为 2026-09-15，运行 `npm run sync`（228 条）重新生成清单。

### 验证标准

- 首页左侧「功能导航」在分类总高度超出视口时出现纵向滚动条，页脚提示卡保持在侧边栏底部。
- 三个 3D 演示案例的右上控制面板、左上阶段信息、底部阶段条与左下角图例与其他 Cesium 案例视觉一致，页面内不再出现「DILI」相关文案。
- 三个案例的播放/进度/速度/阶段跳转/标注/防治工程/降雨/自动旋转/视角预设与「科普知识」弹窗功能可用，运行无 pageerror。
- 三个案例卡片显示新图标；`barrier-lake-cesium` 科普弹窗内容与重构前一致（7 个小节、2 个表格）。
- `vue-tsc` 类型检查与 Vite 生产构建通过。

## 后续迭代记录方式

每次系统迭代按以下顺序追加内容：

1. 记录版本、日期和迭代主题。
2. 记录用户目标与可验证的实施步骤。
3. 记录工程结构、依赖版本和关键约定。
4. 记录构建、预览和功能验证结果。
5. 记录会影响后续案例开发的稳定规则。
