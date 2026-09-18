# Cesium酱の百宝箱 · CESIUM-TREASURE-BOX

[![stars](https://img.shields.io/github/stars/jianlei-wang/CESIUM-TREASURE-BOX?style=social)](https://github.com/jianlei-wang/CESIUM-TREASURE-BOX/stargazers)
[![forks](https://img.shields.io/github/forks/jianlei-wang/CESIUM-TREASURE-BOX?style=social)](https://github.com/jianlei-wang/CESIUM-TREASURE-BOX/network/members)
[![watchers](https://img.shields.io/github/watchers/jianlei-wang/CESIUM-TREASURE-BOX?style=social)](https://github.com/jianlei-wang/CESIUM-TREASURE-BOX/watchers)

> Cesium 三维地球示例案例库：汇集三维特效、天气、粒子、水面、标绘、测量、空间分析、数据可视化、三维数据加载、大气环境、光照、大屏等多种 Cesium / Three.js 实战案例，持续更新中。

仓库地址：<https://github.com/jianlei-wang/CESIUM-TREASURE-BOX>

在线预览：<https://jianlei-wang.github.io/CESIUM-TREASURE-BOX/>

## ✨ 特性

- **200+ 案例**：覆盖 16 个分类（三维特效、天气特效、粒子特效、水面效果、标记标绘、空间测量、空间分析、数据可视化、三维数据加载、场景示例、大气环境、光照效果、界面控件、可视化大屏、ThreeJS 样例等）
- **全局搜索 / 排序**：按名称、描述关键词检索，支持最新收录排序
- **性能监测**：内置 FPS 监视、Cesium 渲染统计与卡顿排查清单
- **按需加载**：案例组件懒加载，Cesium 大体积脚本延迟注入，首屏轻量
- **多源底图**：内置天地图、高德、百度、腾讯、Google、Bing、GeoVis 等多种影像/注记提供器

## 🧱 技术栈

| 类别 | 技术 |
| --- | --- |
| 框架 | Vue 3 + TypeScript |
| 构建 | Vite 6 |
| 三维引擎 | Cesium 1.144、Three.js |
| UI | Element Plus |
| 空间计算 | turf、jsts、proj4、geotiff、shpjs |
| 图表导出 | echarts、html2canvas、jspdf |

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
| `npm run dev` | 启动开发服务器（0.0.0.0） |
| `npm run build` | 类型检查（vue-tsc）+ Vite 打包 |
| `npm run preview` | 预览 `dist` 产物 |

## 📁 目录结构

```
.
├── public/            # 静态资源（模型、影像、视频、LUT 等）
│   ├── data/          # 三维模型与业务数据
│   ├── dayanta/       # 雁荡山三维切片
│   ├── draco/         # Draco 解码器
│   ├── geo/           # 大气/云 LUT 等着色器资源
│   ├── images/        # 贴图素材
│   └── videos/        # 视频素材
├── scripts/           # 案例同步与列表生成脚本
├── src/
│   ├── cases/         # 案例集合（每个案例一个目录 + index.ts）
│   ├── components/    # 公共组件
│   ├── datav/         # 可视化大屏示例
│   ├── lib/           # 工具库（Cesium 场景、底图提供器、空间计算等）
│   ├── App.vue        # 案例库主界面
│   └── main.ts        # 入口
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
