# apimart Seedance 2.0 接入补全（R5 照官方文档对账）

> 触发：用户指出"你整的不够全面，以后这种问题不能发生"。R5 抓官方文档全覆盖。
> 官方文档：https://docs.apimart.ai/cn/api-reference/videos/doubao-seedance-2-0/generation
> 端点：单端点 `POST /v1/videos/generations`，模式由参数组合决定（不分 endpoint）。

## 官方能力全表

**变体（model）**：`doubao-seedance-2.0`（标准，支持 1080p）· `doubao-seedance-2.0-fast`（快速，≤720p）· `doubao-seedance-2.0-face`（真人，1080p）· `doubao-seedance-2.0-fast-face`（真人快速，≤720p）。功能均"与标准版一致"。

**模式（参数驱动）**：文生(prompt) · 图生首帧(image_urls) · 首尾帧(image_with_roles first_frame/last_frame) · 全能参考/多模态(image_urls≤9 + video_urls≤3 + audio_urls≤3) · 有声(generate_audio) · 连续(return_last_frame) · 参考人像(image_with_roles role=reference_image)。

**参数**：model · prompt(≤4000) · duration(4–15,默5) · size(16:9/9:16/1:1/4:3/3:4/21:9/adaptive,默16:9) · resolution(480p/720p/1080p,默480p) · seed · generate_audio(默false) · return_last_frame(默false) · image_urls(≤9) · image_with_roles · video_urls(≤3) · audio_urls(≤3)。互斥：image_urls ⊥ image_with_roles；首尾帧时 video/audio_urls 不可用。

## 现状（改前）

- 目录 `apimartVideos.ts`：只有 `doubao-seedance-2.0` 一个变体。
- 档案 `seedanceApimart.ts`：只有 t2v + i2v（image_urls）两模式；参数 size/resolution/duration/generate_audio。

## 本次补（B-clean，低风险、transport 可行）

1. **全能参考（omni）模式**：image_ref(≤9,image_urls) + video_ref(≤3,video_urls) + audio_ref(≤3,audio_urls)。走档案级 image_to_video 桶（同 kie omni"一条 body 覆盖多模式，空键自动丢"），i2v body 补 video_urls/audio_urls/size。
2. **Fast 变体**：`doubao-seedance-2.0-fast` → 独立 fast 档案（resolution 仅 480/720），同模式同结构（仿 kie SEEDANCE_2_FAST_ARCHETYPE）。

## 暂缓（需构造层 / 额度 E2E，单列后续）

- **首尾帧（image_with_roles）**：需条件构造 `[{url,role}]` 对象数组（模板只能丢空键、丢不掉空数组元素）→ 要 archetypeInput 构造支持。kie Seedance 已有首尾帧（分离键），需首尾帧的用户暂走 kie。
- **face / fast-face 变体**（真人版）、seed / return_last_frame 参数。
- **真实生成 E2E 验证**（接入即验证铁律，烧额度）：补完后跑一条 apimart Seedance 全能参考真实生成确认 transport。

## 验收门
五门全过；真实 E2E（额度门，待跑）。
