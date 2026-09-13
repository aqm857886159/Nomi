# 音频参考一等公民化：历史记录与当前状态

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：PR #737 已合并（merge `fab88dac`）；本分支仅保留本计划文档的历史对账修订。
> 原实现分支：`fix/audio-first-class-reference-20260911`，原提交 `28a1e997`、`2f23cbac`。

## 用户摩擦

声音节点曾无法连接视频节点的音频参考槽；ComfyUI 的 `LoadAudio` 输入也曾退化为文本框。根因是共享边界多处把媒体类型写死为 image/video，修复覆盖画布连线、ComfyUI 扫描、契约校验、任务类型判定、角色菜单和上传提示。

## 先查别人

1. Seedance 2.0 omni 官方约束已由 `electron/config/modelArchetypes/seedance20Contract.test.ts:9-19` 对账：最多三段参考音频，但必须同时有图片或视频；`electron/shared/videoCapabilities/seedance.ts:96` 保留该约束。
2. ComfyUI 官方 `LoadAudio` 源码：<https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/comfy_extras/nodes_audio.py>。`class_type=LoadAudio`、输入键 `audio` 与仓内 `MEDIA_INPUT_KEYS` 对齐。
3. 仓内教训 `docs/lessons/nomi-reference-slots-are-already-declarative.md:8` 明确参考槽应由声明式通用渲染器承载，不为单模型另造 UI。

## 修复与证据（已随 PR #737 合入）

- `ReferenceAssetKind`、`SLOT_ACCEPTS.audio_ref`、`referenceAssetKindForNode` 纳入 audio。
- `electron/catalog/comfyuiWorkflowImport.ts` 识别 `LoadAudio`，并将音频排除出首尾帧启发式。
- `parameterReferenceContract.ts`、`modelCatalogMeta.ts` 放行 audio；纯音频工作流不再误判为有图输入；音频上传提示走对应 i18n 键。
- 回归测试与 schema-v3 根因合同：`docs/fixes/2026-09-11-audio-reference-slot-gate.root-cause.json`。

## 当前验收边界

PR #737 的实现、单测、类型检查、lint 与真实 Electron 走查已随合并提交交付。此前付费 smoke 记录使用过无效的 `tests/ux/fixtures/test-upload.png`（100×100 占位图），不能作为当前成功证据；主线脚本 `scripts/audio-ref-paid-smoke.mjs` 已改为真实 `kid.jpg`，并在 APIMart smoke 中成功。不要把旧 `AUDIO-LAST.md` 的“环境阻塞”表述当作当前状态。

本分支不新增生产代码、不重做音频功能；本次提交只校正文档历史、当前源路径与证据边界。
