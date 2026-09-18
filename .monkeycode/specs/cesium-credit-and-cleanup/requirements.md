# Cesium 署名显示与代码清理需求

## 简介

本次迭代统一管理 Cesium credit 显示，并依据项目代码清理标准完成可审计的工程优化。

## 术语

- **Data attribution**：Cesium credit 面板中的数据来源展开入口。
- **Cesium credit 容器**：Cesium 注入的 logo 和屏幕文字署名容器。
- **清理候选项**：存在无用代码或过时配置迹象，等待证据和确认的项目内容。

## 需求

### 需求 1：统一 Cesium credit 显示

**用户故事：** 作为案例使用者，我希望所有案例统一隐藏 Cesium Ion 标识，同时保留数据来源入口。

#### 验收标准

1. 当全局样式加载时，系统应隐藏 className 为 `cesium-credit-logoContainer` 的元素。
2. 当全局样式加载时，系统应隐藏 className 为 `cesium-credit-textContainer` 的元素。
3. 当任一案例创建 Cesium Viewer 时，系统应保留 `Data attribution` 展开入口。
4. 当新增案例复用全局样式时，系统应继承相同的 credit 显示规则。

### 需求 2：代码清理审计

**用户故事：** 作为维护者，我希望代码清理过程具有可复核的证据和风险记录。

#### 验收标准

1. 当扫描完成时，系统应将候选项分类为可保留、待确认或安全审查。
2. 当候选项存在动态引用或凭据风险时，系统应保留文件并记录风险。
3. 当实施可确认优化后，系统应通过 TypeScript 类型检查和生产构建。
