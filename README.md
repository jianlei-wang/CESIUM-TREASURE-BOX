# Cesium酱の百宝箱 · CESIUM-TREASURE-BOX

[![stars](https://img.shields.io/github/stars/jianlei-wang/CESIUM-TREASURE-BOX?style=social)](https://github.com/jianlei-wang/CESIUM-TREASURE-BOX/stargazers)
[![forks](https://img.shields.io/github/forks/jianlei-wang/CESIUM-TREASURE-BOX?style=social)](https://github.com/jianlei-wang/CESIUM-TREASURE-BOX/network/members)
[![watchers](https://img.shields.io/github/watchers/jianlei-wang/CESIUM-TREASURE-BOX?style=social)](https://github.com/jianlei-wang/CESIUM-TREASURE-BOX/watchers)

> 面向 Cesium 与 Three.js 的三维地球案例库，覆盖三维特效、天气、粒子、水面、标绘、测量、空间分析、数据可视化、三维数据加载、大气环境、光照、大屏、D3 地理大数据、海洋温盐深体渲染与 Cesium + Three.js 工程仿真。

仓库地址：<https://github.com/jianlei-wang/CESIUM-TREASURE-BOX>

在线预览：<https://jianlei-wang.github.io/CESIUM-TREASURE-BOX/>

## 特性

- **338 个案例，18 个分类**：系统 DEMO、三维特效、天气特效、粒子特效、水面效果、标记标绘、空间测量、空间分析、数据可视化、D3 地理大数据、三维数据加载、场景示例、大气环境、光照效果、界面控件、可视化大屏、ThreeJS 样例、Cesium + ThreeJS。
- **20 个 Cesium + Three.js 工程仿真案例**：覆盖落体、建筑破坏、滑坡、溃坝、车流、风场、路径规划、塔吊、桥梁、膜结构、林火、城市内涝、船舶、地震、挖掘机、巡检、疏散、盾构、烟羽与消防调度。案例内置确定性求解器、指标面板、参数标定与合成数据来源说明。
- **三维场景演示漫游制作系统**：对标 Skyline Presentation 的 Step + Action 编排，支持步骤分段、定点飞行、航线录制、图层显隐、建设时序、字幕弹窗、场景效果、播放控制、工程导入导出与 1080P / 2K / 4K 视频导出。
- **全局搜索与按需加载**：按名称、描述检索，支持最新收录排序；案例组件懒加载，Cesium 大体积脚本延迟注入，首屏保持轻量。
- **案例浏览量统计与运营后台**：每张案例卡片底部右侧展示累计浏览量，打开案例即累加并持久化到文件；`/admin/` 提供总量、今日、近 7 天、趋势、Top 10、分类分布与可检索/排序/导出 CSV 的明细，随系统一并启动与部署。
- **多源底图**：内置天地图、高德、百度、腾讯、Google、Bing、GeoVis 等影像与注记提供器。
- **工程化质量门禁**：TypeScript 类型检查、ESLint、Prettier、案例求解器单元测试、演示系统自检、Playwright 输出回归、长时浸泡测试、依赖审计、许可证检查、锁文件检查与构建体积检查。
- **完整案例清单**：[`CASE_LIST.md`](./CASE_LIST.md) 由脚本自动生成，并记录公众号文章的产出与在线地址；当前已输出文章 56 篇。

## 最近更新

- **2026-10-25 · CIM 场景专题**：新增倾斜模型分区分类高亮、热力采样三维曲面、无人机航线漫游、体素云团光线步进与着色器地形沙盘 5 个案例，覆盖分类体拾取、纹理抬升、闭合航线跟随、三维纹理步进与片元程序化地形。
- **2026-10-21 · 三维场景演示漫游制作系统升级**：演示系统完成生产内核重构，新增草稿自动保存、项目包版本迁移、数据源绑定、图层注册、导出任务队列、失败诊断与 SDK 接口，并接入 `.cesium.presentation` 工程包与视频导出流水线。
- **2026-10-20 · 质量门禁与回归体系**：新增 `quality`、`test:studio`、`test:output`、`test:soak` 脚本，接入 GitHub Actions 的 lint、格式、审计、许可证、锁文件、输出快照与构建体积检查。
- **2026-10-20 · Cesium + Three.js 仿真闭合**：20 个工程案例完成物理量闭合与调度模型校准，统一提供指标读数、参数标定、数据来源说明与确定性测试。
- **2026-10-13 · 海洋分析-温盐深三维体**：新增东海陆架坡折、黄海中部陆架研究区，支持温度 / 盐度 / 密度 / 流速切换、月份演变、水平切片、A-B 断面、T-S 散点、等值面、流场箭头与垂向层结分析；配套 `scripts/ocean-tsd` 数据管线，浏览器端只读取预处理后的轻量二进制数据。
- **2026-10-06 · D3 地理大数据专题**：新增 13 个 D3 x Cesium 案例，覆盖坐标映射、统计图形地球化、网络关系、时空动态、空间分析、屏幕空间增强、叙事与数字孪生、格网聚合与蜂窝表达；新增 `src/lib/d3geo` 声明式渲染外壳。

## 技术栈

| 类别 | 技术 |
| --- | --- |
| 框架 | Vue 3 + TypeScript |
| 构建 | Vite 6 |
| 三维引擎 | Cesium 1.144、Three.js 0.185、three.quarks |
| 物理求解 | Rapier 0.12、确定性解析求解器 |
| UI | Element Plus |
| 空间计算 | turf、jsts、proj4、geotiff、shpjs |
| D3 可视化 | d3、d3-geo（`src/lib/d3geo` 声明式渲染外壳） |
| 格网编码 | h3-js、s2js、a5-js、ngeohash、open-location-code、DGGRID / DGGAL |
| 图表与导出 | echarts、html2canvas、jspdf、xlsx、docx、MediaRecorder |
| 测试与质量 | Node Test、tsx、Playwright、ESLint、Prettier、vue-tsc |
| 部署 | GitHub Pages、Docker + nginx |

## 快速开始

要求 Node.js 20 或更高版本。

```bash
# 安装依赖
npm ci

# 本地开发（自动同步案例清单并复制 Rapier 运行时）
npm run dev

# 生产构建（类型检查 + Vite 打包 + 体积检查）
npm run build

# 预览构建产物
npm run preview
```

`dev` 与 `build` 前会自动执行 `npm run sync`，扫描 `src/cases` 并重新生成 `src/cases/manifest.ts`。新增案例请创建 `src/cases/<case-id>/index.ts`，并确保 `id` 与目录名一致。

## 脚本说明

| 命令 | 说明 |
| --- | --- |
| `npm run sync` | 扫描 `src/cases`，生成案例清单 `manifest.ts` 与后台案例目录 `public/data/cases.json` |
| `npm run case-list` | 生成 `CASE_LIST.md` 案例列表文档 |
| `npm run sync-articles` | 拉取公众号专栏文章，按案例名称回填文章产出与在线地址 |
| `npm run dev` | 同时启动浏览量服务与 Vite 开发服务器（`/api` 反向代理到浏览量服务） |
| `npm run dev:frontend` | 仅启动 Vite 开发服务器（需自行运行 `npm run server`） |
| `npm run server` | 单独启动浏览量服务与 `/admin/` 后台托管 |
| `npm run build` | 类型检查、Vite 打包与构建体积检查 |
| `npm run preview` | 预览 `dist` 产物（需先启动 `npm run server` 才能访问浏览量统计） |
| `npm run test:views` | 浏览量服务存储与 API 单元测试 |
| `npm run lint` | ESLint 检查 |
| `npm run format` / `format:check` | Prettier 格式化 / 格式校验 |
| `npm run audit` | 依赖安全审计 |
| `npm run licenses` | 第三方许可证检查 |
| `npm run lockfile:check` | 锁文件一致性检查 |
| `npm run quality` | 依次执行 lint、格式、审计、许可证与锁文件检查 |
| `npm run test:cases` | 20 个工程仿真求解器的确定性单元测试 |
| `npm run test:studio` | 演示系统 schema、轨道、导出配置与数据源自检 |
| `npm run test:output` | Playwright 输出回归与截图快照 |
| `npm run test:soak` | 长时浸泡与重复切换测试 |
| `npm run bundle:check` | 检查入口与异步 chunk 体积 |

运行 `test:output` 前需安装 Playwright 浏览器与 ffmpeg：

```bash
npx playwright install --with-deps chromium
sudo apt-get update && sudo apt-get install -y ffmpeg
```

海洋温盐深案例的数据管线位于 `scripts/ocean-tsd`：`generate-sample-data.mjs` 生成演示样本，`preprocess_ocean.py` 从 NetCDF 再分析数据裁剪研究区，`validate_ocean_dataset.py` 校验二进制数据。浏览器端只读取 `public/data/ocean-tsd` 下的预处理产物。

## 测试与质量

- `src/cases/cesium-three-lib/simulations/*.test.ts`：覆盖 S01-S20 的核心守恒量、边界条件与参数标定，使用固定时间步与可复现随机数。
- `scripts/studio-selfcheck.mjs`：检查演示工程的 schema 版本、轨道求值、导出配置、数据源绑定与图层注册。
- `tests/output/output.spec.mjs`：在真实浏览器中加载演示工程，校验导出流程与关键界面快照。
- `tests/soak/soak.spec.mjs`：重复加载、切换案例与长时间运行，验证资源释放与稳定性。
- `.github/workflows/deploy.yml`：推送 `main`、`master` 或 `jianlei_wang` 时执行质量门禁、输出回归、构建与 GitHub Pages 发布。
- `.github/workflows/output-e2e.yml`：Chromium 与 Firefox 矩阵回归。
- `.github/workflows/soak.yml`：每周定时执行长时浸泡测试。

## 目录结构

```
.
├── public/            # 静态资源（模型、影像、视频、LUT、海洋数据等）
│   ├── data/          # 三维模型与业务数据（含 ocean-tsd 温盐深数据）
│   ├── dayanta/       # 雁荡山三维切片
│   ├── draco/         # Draco 解码器
│   ├── geo/           # 大气 / 云 LUT 等着色器资源
│   ├── images/        # 贴图素材
│   ├── models/        # 三维模型素材
│   └── videos/        # 视频素材
├── server/            # 浏览量服务（存储、鉴权、统计接口、静态托管）
│   └── test/          # 服务端单元测试
├── scripts/           # 案例同步、质量门禁、文章回填与数据管线脚本
│   ├── dev.mjs        # 一体化开发启动（浏览量服务 + Vite）
│   └── ocean-tsd/     # 海洋温盐深数据生成、预处理与校验
├── src/
│   ├── cases/         # 案例集合（每个案例一个目录 + index.ts）
│   │   ├── cesium-three-lib/      # Cesium + Three.js 工程仿真共享底座
│   │   └── presentation-studio-lib/ # 三维场景演示漫游制作系统
│   ├── components/    # 公共组件
│   ├── datav/         # 可视化大屏示例
│   ├── lib/           # 工具库（Cesium 场景、底图提供器、d3geo、空间计算等）
│   ├── App.vue        # 案例库主界面
│   └── main.ts        # 入口
├── tests/             # Playwright 输出回归、浸泡测试与夹具
├── public/
│   ├── admin/         # 运营后台静态页面（/admin/）
│   └── data/cases.json # 后台与浏览量服务使用的案例目录（自动生成）
├── data/              # 运行时浏览量数据与后台口令（不入库）
├── docker/            # 容器入口脚本
├── CASE_LIST.md       # 全部案例清单与文章产出状态
├── index.html
├── Dockerfile
├── nginx.conf
└── vite.config.ts     # Vite 配置（Cesium 集成、路径与优化）
```

## 运行时配置

浏览器启动时读取 `public/runtime-config.js` 中的 `window.__CESIUM_STUDIO_CONFIG__`：

```js
window.__CESIUM_STUDIO_CONFIG__ = {
  appTitle: 'Cesium酱の百宝箱',
  apiBaseUrl: '',
  cesiumIonToken: '',
  whiteModelTilesetBase: ''
}
```

`whiteModelTilesetBase` 可选，用于覆盖建筑白模的 3D Tiles 数据源根地址（默认 `https://data.3dbag.nl/v20250903/cesium3dtiles`，需包含 `lod12`、`lod13`、`lod22` 三个子目录）。当官方数据源迁移或需要走镜像时，填入镜像根地址即可，无需重新构建。

当 3DBAG 官方数据源不可达时，案例会自动降级到 PDOK 3D Basisvoorziening 全国建筑白模（数据来源：PDOK / Kadaster，CC BY 4.0），并在界面提示当前数据来源。

部署到子路径时通过构建变量 `BASE_URL` 调整资源前缀。Docker 运行时可使用环境变量覆盖配置：

```bash
docker build -t cesium-treasure-box .

docker run --rm -p 8080:80 \
  -v cesium-views-data:/app/data \
  -e APP_TITLE="Cesium酱の百宝箱" \
  -e API_BASE_URL="" \
  -e CESIUM_ION_TOKEN="" \
  -e WHITE_MODEL_TILESET_BASE="" \
  -e ADMIN_TOKEN="请替换为你的后台口令" \
  cesium-treasure-box
```

容器内由 Node 浏览量服务同时提供静态站点、`/api` 接口与 `/admin/` 后台，`/app/data` 为数据卷，需挂载持久化目录以保留浏览量。

## 浏览量统计与运营后台

### 启动方式

开发环境执行 `npm run dev`，会同时启动：

- 浏览量服务：`http://127.0.0.1:8787`（数据写入 `data/case-views.json`）；
- Vite 开发服务器：`http://localhost:5173`，并把 `/api` 反向代理到浏览量服务。

后台入口为 `/admin/`，开发态直接访问 `http://localhost:5173/admin/`。

### 后台口令

口令来源按优先级：

1. 环境变量 `ADMIN_TOKEN`；
2. 数据目录下的 `data/admin-token.txt`；
3. 两者都不存在时，服务首次启动生成随机口令，写入 `data/admin-token.txt`（权限 600）并在启动日志中打印一次。

后台口令保存在浏览器 `sessionStorage`，关闭标签页后自动清除；统计接口需要携带 `Authorization: Bearer <token>`。

### 运行参数

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 浏览量服务端口（Docker 镜像内默认为 `80`） |
| `HOST` | `0.0.0.0` | 监听地址 |
| `VIEWS_DATA_FILE` | `data/case-views.json` | 浏览量数据文件 |
| `ADMIN_TOKEN` | 空 | 后台口令；留空时读取或生成口令文件 |
| `ADMIN_TOKEN_FILE` | `data/admin-token.txt` | 口令文件路径 |
| `STATIC_ROOT` | `dist` | 静态站点目录 |
| `VIEWS_CATALOG_FILE` | `public/data/cases.json` | 案例目录文件 |
| `VIEW_RETENTION_DAYS` | `90` | 每日明细保留天数；累计浏览量永久保留 |
| `CORS_ORIGINS` | `*` | 允许跨域调用 `/api` 的来源，逗号分隔；`*` 表示允许任意来源 |

浏览量口径为「每次打开可演示案例即 +1」，持久化采用临时文件加原子重命名，进程退出前会强制落盘。每日明细按保留天数清理，案例累计值永久保留。

## 部署

### GitHub Pages

仓库已内置 `.github/workflows/deploy.yml`：

1. 进入仓库 **Settings -> Pages -> Build and deployment -> Source**，选择 **GitHub Actions**。
2. 推送到 `main`、`master` 或 `jianlei_wang` 分支即自动构建并发布；也可在 **Actions** 页面手动触发。
3. 构建产物为 `dist/`，`vite.config.ts` 已设置 `base: './'`，可部署到任意静态服务器或子路径。

不要把项目源码目录直接作为 Pages 目录：源码版 `index.html` 引用 `/src/main.ts`，仅在 dev 模式下由 Vite 提供。

### 浏览量服务与运营后台

GitHub Pages 只能托管静态文件，`/api` 与 `/admin/` 需要独立的 Node 服务。部署步骤：

1. 使用仓库内置的 `deploy/render.yaml` 在 Render 创建 Blueprint（`New -> Blueprint`），或自行用 `Dockerfile` 部署到任意容器平台；
2. 把服务地址写入 `deploy/api-base-url.txt`（单行，不带 `/api`）并提交，或在仓库 Variables 中设置 `VIEWS_API_BASE_URL`；
3. 等待 Pages 工作流重新构建，前端即可跨域访问浏览量接口与后台。

服务端已支持跨域：`CORS_ORIGINS` 默认 `*`，生产建议收敛为 `https://jianlei-wang.github.io`。

### 手动部署

```bash
npm run build

npx gh-pages -d dist
```

然后在 **Settings -> Pages -> Source** 选择 **Deploy from a branch -> gh-pages / (root)**。

## 数据与边界

工程仿真案例默认使用程序化合成工况，界面中的“数据来源”会标注数据类型、坐标基准、垂直基准、单位与限制说明。这些案例用于教学演示与交互验证，不构成工程校核结论。

## 许可

本项目仅作学习交流用途。Cesium 相关商标与版权归属其各自所有者。

## 相关链接

- GitHub 仓库：<https://github.com/jianlei-wang/CESIUM-TREASURE-BOX>
- Cesium 官网：<https://cesium.com/>
