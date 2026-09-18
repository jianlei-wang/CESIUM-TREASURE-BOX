# Cesium 署名显示与代码清理设计

Feature Name: cesium-credit-and-cleanup
Updated: 2026-08-23

## 描述

全局样式负责 Cesium credit 容器的显示策略，公共场景模块仅负责 Viewer 生命周期、Ion 资源访问和影像加载。清理工作以静态引用、构建结果和运行时风险为依据。

## 组件与接口

- `src/style.css`：定义全局 `.cesium-credit-logoContainer` 与 `.cesium-credit-textContainer` 的显示规则。
- `src/lib/cesium-scene.ts`：保留 Viewer 创建、Bing 影像、状态回调和销毁职责；移除与全局样式重复的 credit API 设置。
- `docs/code-cleanup-audit-v2.5.md`：记录扫描证据、候选分类、执行动作和遗留风险。

## 正确性约束

- 全局样式须在 `src/main.ts` 中随应用入口加载。
- `Data attribution` 展开链接不匹配隐藏选择器。
- `createMapScene` 创建的 Viewer 继续使用既有的资源、影像和销毁流程。
- 清理候选项在获得人工确认前保持原文件状态。

## 错误处理

- Viewer 创建和 Bing 影像失败继续通过现有 `SceneCallbacks` 向案例展示状态。
- 凭据风险只记录文件和风险类别，不记录凭据值。

## 测试策略

- 执行 `npm run build` 验证类型检查与生产构建。
- 执行 `git diff --check` 验证差异格式。
- 通过现有开发预览打开 Cesium 案例，确认左下角保留 `Data attribution` 入口。
