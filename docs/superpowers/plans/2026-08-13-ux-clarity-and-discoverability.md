# 体验清晰度与可发现性实施计划

## 目标

交付滚轮隔离、暗色对比度、拆镜入口简化、移除错误转视频入口、技能化创作入口和 APIMart 模型迁移。

## 步骤

1. 先补回归测试：提示词滚轮事件阻断、拆镜卡不再渲染三种模式、旧模型迁移只命中 APIMart 精确键。
2. 实现滚轮根因修复：提示词滚动容器 `onWheel.stopPropagation` + `overscroll-contain`。
3. 统一暗色叠加 token：PromptCard、PromptPreviewOverlay、NodeMediaPreviewDialog 使用 strong token、边框和焦点态。
4. 简化拆镜 UI：单一“拆成镜头” CTA，保留内部兼容参数和计划编辑器逐镜头媒体类型。
5. 删除 ConvertShotToVideoButton 的可见入口，并清理仅供该入口使用的死代码/文案。
6. 将创作区模式选择替换为工作方式/技能入口；把素材规划注册为置顶内置技能，并提供系统提示词预览。
7. 将 APIMart 内置 DeepSeek 键迁移到 `deepseek-v3.1-250821`，更新 catalog、fixtures 和测试；两处模型选择器复用同一目录。
8. 用真实浏览器走查：提示词边界滚动、暗色提示词库卡片、全屏关闭、拆镜、素材规划启用和两处模型选择。
9. 运行 `pnpm run check:filesize && pnpm run check:tokens && pnpm run check:i18n && pnpm run lint:ci && pnpm run typecheck && pnpm run test && pnpm run build`。

## 回滚

所有变更集中在本分支；可单独回滚拆镜/技能 UI或模型迁移提交。不得修改共享 main 工作树。
