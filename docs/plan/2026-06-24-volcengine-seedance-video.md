# 2026-06-24 火山方舟 Seedance 视频接入

## 范围

- 给火山方舟 `volcengine` 供应商补 Seedance 2.0 视频模型 curated seed。
- 支持文生视频、首帧图生视频、首尾帧、全能参考四种 Nomi 已有 Seedance 体验形态。
- 复用现有 catalog mapping、archetype、variant 机制，不新增火山专属运行器。

## 不动项

- 不改画布 UI 布局和设计系统。
- 不接 Draft、正式片二段式、视频编辑、延长视频等更宽能力，避免把第一版参数面铺太大。

## 实现

- 新增 `electron/catalog/volcengineVideos.ts`：声明 create/query/status/result mapping；`image_to_video` 用一条 mapping 覆盖首帧、首尾帧、全能参考。
- 新增 `src/config/modelArchetypes/seedanceVolcengine.ts`：声明火山 Seedance 2.0 档案和标准/Fast/Mini 变体，Fast/Mini 统一收窄到 480p/720p。
- 在 `seedBuiltins` 和 `MODEL_ARCHETYPES` 注册。
- 补单测锁住请求体、任务轮询响应、图片 content role 和 seed 对账。

## 验收

- 火山方舟模型目录出现 `doubao-seedance-2-0-260128`，模型档案为 `volcengine-seedance-2`，变体可发 `doubao-seedance-2-0-fast-260128` / `doubao-seedance-2-0-mini-260615`。
- create 使用 `POST /api/v3/contents/generations/tasks`，query 使用 `GET /api/v3/contents/generations/tasks/{id}`。
- 图像 content item 统一带 role：首帧为 `first_frame`，全能参考图为 `reference_image`。
- 创建响应 `{ id }` 可进入异步轮询；查询响应 `content.video_url` 可解析为视频资产。
- `pnpm exec vitest` 跑相关单测通过。
