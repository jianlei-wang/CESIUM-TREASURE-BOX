# Cesium酱の百宝箱 · CESIUM-TREASURE-BOX

[![stars](https://img.shields.io/github/stars/jianlei-wang/CESIUM-TREASURE-BOX?style=social)](https://github.com/jianlei-wang/CESIUM-TREASURE-BOX/stargazers)
[![forks](https://img.shields.io/github/forks/jianlei-wang/CESIUM-TREASURE-BOX?style=social)](https://github.com/jianlei-wang/CESIUM-TREASURE-BOX/network/members)
[![watchers](https://img.shields.io/github/watchers/jianlei-wang/CESIUM-TREASURE-BOX?style=social)](https://github.com/jianlei-wang/CESIUM-TREASURE-BOX/watchers)

> Cesium 三维地球示例案例库：汇集三维特效、天气、粒子、水面、标绘、测量、空间分析、数据可视化、三维数据加载、大气环境、光照、大屏、D3 地理大数据与海洋温盐深体渲染等多种 Cesium / Three.js 实战案例，持续更新中。

仓库地址：<https://github.com/jianlei-wang/CESIUM-TREASURE-BOX>

在线预览：<https://jianlei-wang.github.io/CESIUM-TREASURE-BOX/>

## ✨ 特性

- **313 个案例**：覆盖 17 个分类（系统 DEMO、三维特效、天气特效、粒子特效、水面效果、标记标绘、空间测量、空间分析、数据可视化、D3 地理大数据、三维数据加载、场景示例、大气环境、光照效果、界面控件、可视化大屏、ThreeJS 样例）
- **全局搜索 / 排序**：按名称、描述关键词检索，支持最新收录排序
- **性能监测**：内置 FPS 监视、Cesium 渲染统计与卡顿排查清单
- **按需加载**：案例组件懒加载，Cesium 大体积脚本延迟注入，首屏轻量
- **多源底图**：内置天地图、高德、百度、腾讯、Google、Bing、GeoVis 等多种影像/注记提供器
- **完整案例清单**：[`CASE_LIST.md`](./CASE_LIST.md) 由脚本自动生成，并记录每篇公众号文章的产出与在线地址；已输出文章 56 篇

## 🆕 最近更新

- **2026-10-21 · 三维场景演示漫游制作系统上线**：新增「三维场景演示漫游制作系统」案例，对标 Skyline Presentation 的 Step + Action 编排模式，支持步骤分段与动作串行、定点飞行、航线录制、图层显隐、建设时序、字幕弹窗、场景效果，配套播放 / 暂停 / 停止 / 单步 / 倍速 / 进度跳转、工程保存与 `.cesium.presentation` 导入导出，以及基于 Canvas + MediaRecorder 的 1080P / 2K / 4K 视频导出。
- **2026-10-13 · 海洋分析-温盐深三维体上线**：新增「海洋分析-温盐深三维体」案例，以东海陆架坡折、黄海中部陆架为研究区，支持温度 / 盐度 / 密度 / 流速实时切换，月份演变、水平切片、A–B 断面、T–S 散点、等值面、流场箭头、垂向层结与全域统计；配套 `scripts/ocean-tsd` 数据管线（样本生成、NetCDF 预处理、数据校验），浏览器端只读取预处理后的轻量二进制数据。
- **2026-10-06 · 公众号文章回填**：新增 `npm run sync-articles` 同步脚本，按案例名称回填 `CASE_LIST.md` 的文章产出状态与在线地址，当前已回填 56 篇。
- **2026-10-06 · D3 地理大数据专题上线**：新增「D3地理大数据」功能分类，收录 13 个 D3 × Cesium 案例，覆盖数据接入与坐标映射、统计图形地球化、网络关系、时空动态、空间分析、屏幕空间增强、叙事与数字孪生、格网聚合与蜂窝表达等方向；新增 `src/lib/d3geo` 通用渲染外壳与工具库（渲染助手、数据生成、色带、hexbin/网格聚合），每个案例以声明式 `D3CaseSpec` 驱动。
- **2026-09-29 · 工程仿真 CFD 多物理场体升级**：`volume-cfd` 案例由单场体渲染升级为三维多物理场工程工作台，新增程序化街区建筑白模工程几何层、KPI 指标卡、四组相机预设、正负压双等值面、流线 / 粒子 / 剖面箭头三种向量表达与场景背景三模式；修复参数切换后体块错位、返回列表白屏崩溃与等值面渲染异常等问题。
- **2026-09-29 · 数据可视化扩容**：新增海量动态点 / 线 / 多边形案例，并补齐案例卡片图标。
- **2026-09-29 · 体渲染场景化 UI**：体渲染 5 案例完成场景化 UI 重构，并修复剖切面板显隐。

## 🧱 技术栈

| 类别 | 技术 |
| --- | --- |
| 框架 | Vue 3 + TypeScript |
| 构建 | Vite 6 |
| 三维引擎 | Cesium 1.144、Three.js、three.quarks |
| UI | Element Plus |
| 空间计算 | turf、jsts、proj4、geotiff、shpjs |
| D3 可视化 | d3、d3-geo（`src/lib/d3geo` 声明式渲染外壳） |
| 格网编码 | h3-js、s2js、a5-js、ngeohash、open-location-code |
| 图表导出 | echarts、html2canvas、jspdf、xlsx、docx |

## 🚀 快速开始

要求 Node.js ≥ 18。

```bash
# 安装依赖
npm install

# 本地开发（自动执行 predev 同步案例清单）
npm run dev

# 生产构建
npm run build

# 预览构建产物
npm run preview
```

> 提示：`npm run dev` / `npm run build` 前会自动执行 `npm run sync`，扫描 `src/cases` 目录并重新生成 `src/cases/manifest.ts`。新增案例请创建 `src/cases/<case-id>/index.ts`，并确保 `id` 与目录名一致。

## 📦 脚本说明

| 命令 | 说明 |
| --- | --- |
| `npm run sync` | 扫描 `src/cases`，生成案例清单 `manifest.ts` |
| `npm run case-list` | 生成 `CASE_LIST.md` 案例列表文档 |
| `npm run sync-articles` | 拉取公众号专栏文章，按案例名称回填 `CASE_LIST.md` 的文章产出与在线地址 |
| `npm run dev` | 启动开发服务器（0.0.0.0） |
| `npm run build` | 类型检查（vue-tsc）+ Vite 打包 |
| `npm run preview` | 预览 `dist` 产物 |

海洋温盐深案例的数据管线位于 `scripts/ocean-tsd`：`generate-sample-data.mjs` 生成演示样本，`preprocess_ocean.py` 从 NetCDF 再分析数据裁剪研究区，`validate_ocean_dataset.py` 校验二进制数据。浏览器端只读取 `public/data/ocean-tsd` 下的预处理产物。

## 📁 目录结构

```
.
├── public/            # 静态资源（模型、影像、视频、LUT、海洋数据等）
│   ├── data/          # 三维模型与业务数据（含 ocean-tsd 温盐深数据）
│   ├── dayanta/       # 雁荡山三维切片
│   ├── draco/         # Draco 解码器
│   ├── geo/           # 大气/云 LUT 等着色器资源
│   ├── images/        # 贴图素材
│   ├── models/        # 三维模型素材
│   └── videos/        # 视频素材
├── scripts/           # 案例同步、文章回填与数据管线脚本
│   └── ocean-tsd/     # 海洋温盐深数据生成、预处理与校验
├── src/
│   ├── cases/         # 案例集合（每个案例一个目录 + index.ts）
│   ├── components/    # 公共组件
│   ├── datav/         # 可视化大屏示例
│   ├── lib/           # 工具库（Cesium 场景、底图提供器、d3geo、空间计算等）
│   ├── App.vue        # 案例库主界面
│   └── main.ts        # 入口
├── CASE_LIST.md       # 全部案例清单与文章产出状态
├── index.html
└── vite.config.ts     # Vite 配置（Cesium 集成、路径与优化）
```

## 🌐 部署

`vite.config.ts` 已设置 `base: './'`，产物可直接部署到任意静态服务器或子路径（如 GitHub Pages）。

### GitHub Pages（推荐：GitHub Actions 自动构建）

仓库已内置 `.github/workflows/deploy.yml`，配置步骤：

1. 确保工作流文件已提交到仓库根目录 `.github/workflows/deploy.yml`
2. 进入仓库 **Settings → Pages → Build and deployment → Source**，选择 **GitHub Actions**
3. 推送到 `main` 分支即自动构建 `dist/` 并发布；也可在 **Actions** 页手动触发（workflow_dispatch）

> ⚠️ 不要把项目源码目录直接作为 Pages 目录：源码版 `index.html` 引用 `/src/main.ts`，仅在 dev 模式下由 Vite 提供，线上会 404。

### 手动部署

```bash
npm run build
npx gh-pages -d dist   # 将 dist/ 发布到 gh-pages 分支
```

然后在 **Settings → Pages → Source** 选择 **Deploy from a branch → gh-pages / (root)**。

## 📄 许可

本项目仅作学习交流用途。Cesium 相关商标与版权归属其各自所有者。

## 🔗 相关链接

- GitHub 仓库：<https://github.com/jianlei-wang/CESIUM-TREASURE-BOX>
- Cesium 官网：<https://cesium.com/>
