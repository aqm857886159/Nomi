# 供应商模型雷达 — 2026-09-01

发现层脚本已跑（`docs/research/model-radar/latest.json`），本文件是判断层分诊。
**结论先行**：今天两家各报 1 个「新增」，但**两个都在昨天（2026-08-30）就已经建好档案并注册进 `MODEL_ARCHETYPES`**。之所以还被脚本报成新增，是快照基线尚未更新（技能铁律 3 禁止自动更新）+ `isCovered` 刻意偏保守（铁律 7），二者叠加导致「已接的被重报成新增」。**两条均判 ⚪ 忽略（已接，无需动作）**，唯一待办是等用户确认后更新快照基线把它们吃掉。

## 轮次表

| 供应商 | 盯住 | 新增 | 下架 | 未覆盖存量 | 没查成 | 备注 |
|---|---|---|---|---|---|---|
| kie | 142 | 1 | 0 | ~74 | 无 | 新增项 `google/gemini-omni-flash-1-1` 昨日已接 |
| apimart | 128 | 1 | 0 | ~96 | 无 | 新增项 `minimax-h3/max` 昨日已接 |

`failures: []` —— 两家都查成了，没有「没查成」的家。

## 分诊条目

### ⚪ kie · `google/gemini-omni-flash-1-1` · video —— 已接，忽略

- **文档**：https://docs.kie.ai/market/google/gemini-omni-flash-1-1.md （实抓 2026-09-01）
- **是什么**：Gemini Omni 1.1 Flash 生视频。异步（`POST /api/v1/jobs/createTask` + 回调/轮询）。
- **实抓到的能力面**（本轮复核，与档案一致）：
  - `model` 固定 `google/gemini-omni-flash-1-1`；`input.prompt` ≤20000 字。
  - 时长 `duration` ∈ {4,6,8,10} 秒；`aspect_ratio` ∈ {16:9, 9:16}；`resolution` ∈ {360p,720p,1080p,4k}，默认 720p；`seed` 支持。
  - 首尾帧：`first_frame_url`（+可选 `last_frame_url`，需先有首帧）。
  - 参考图 `image_urls` ≤7 张（角色/场景/风格/分镜），各 ≤20MB。
  - 进阶：`audio_ids` ≤3、`video_list` ≤1（≤30s，取段 ≤10s，占 2 配额）、`character_ids`（占 1 配额/组，双图组占 2）。总配额 7：`图×1 + 视频×2 + 角色×1 ≤ 7`。
- **对 Nomi 哪个痛点**：跨镜角色身份一致（≤7 参考图 + character_ids）、镜间转场（首尾帧）、原生音频。都是招牌痛点。
- **覆盖现状**：**已接**。`electron/shared/videoCapabilities/geminiOmni11.ts` → `GEMINI_OMNI_11_ARCHETYPE`（id `gemini-omni-1.1`，family `gemini-omni`，`identifierPatterns: ["google/gemini-omni-flash-1-1","gemini-omni-flash-1-1"]`），三个 mode（t2v / firstlast / reference≤7），`sources` 就指向本页、checkedAt 2026-08-30。已在 `src/config/modelArchetypes/index.ts` 的 `MODEL_ARCHETYPES` 注册。档案里已记：typed UI 暂封 audio_ids/video_list/character_ids 三类，headless 契约放行。
- **判断与下一步**：⚪ 忽略（已接）。脚本仍报新增是因快照未更新。**待办仅：用户确认后更新快照基线**，别当成待接。

### ⚪ apimart · `minimax-h3/max` · video —— 已接，忽略

- **文档**：https://docs.apimart.ai/en/api-reference/videos/minimax-h3/max.md （实抓 2026-09-01）
- **是什么**：MiniMax-H3-Max 生视频，主打速度。异步（`POST /v1/videos/generations` + `GET /v1/tasks/{task_id}` 轮询）。
- **实抓到的能力面**（本轮复核，与档案一致）：
  - `model` 固定 `MiniMax-H3-Max`（大小写不敏感）；`prompt` ≤7000 字。
  - `duration` 5–15 秒，默认 5；`resolution` ∈ {768P(默认), 480P}，**无 2K**；`aspect_ratio`（T2V：21:9/16:9/4:3/1:1/3:4/9:16，默认 16:9）。
  - 首尾帧：`first_frame_image` / `last_frame_image`（或 `image_with_roles`，每个 role 最多 1 张）；图 ≤2 张、≤30MB、256–5760px、比例 0.4–2.5。
  - **明确不支持**：参考图/参考视频/参考音频、多模态参考、跨帧角色/主体一致、中间帧、4 秒时长、2K。不能再生成、不能作为下游源。
  - **价格（中转页）**：768P $0.075/秒；480P $0.0495/秒；首尾帧图免费。产物 URL ~24h 过期。
- **对 Nomi 哪个痛点**：镜间转场（首尾帧）+ 极速/低价快出档位。定位是「快而便宜」，**不碰**跨镜身份一致（明确不支持）。
- **覆盖现状**：**已接**。`electron/shared/videoCapabilities/minimaxH3Max.ts` → `MINIMAX_H3_MAX_ARCHETYPE`（id `minimax-h3-max`，family `minimax`，`identifierPatterns: ["minimax/h3-max","MiniMax-H3-Max"]`），两个 mode（t2v / i2v 首尾帧），480P/768P、5–15s。已在 `MODEL_ARCHETYPES` 注册。注：档案 `sources.url` 指向厂商一手 `platform.minimaxi.com`（比中转页更权威，符合铁律 5），本轮同时复核了 apimart 中转页作为该接入通道的实测口径。
- **判断与下一步**：⚪ 忽略（已接）。同 Gemini Omni：脚本报新增只因快照未更新。**待办仅：用户确认后更新快照基线**。

## 底部说明

- **`uncovered` 抽样**：kie ~74 条、apimart ~96 条存量缺口，本轮**未逐条分诊**（默认只挑与当前痛点最相关的 ≤5 条，铁律 6）。因为今天两个 `added` 都是「已接误报」、无真新增，且 `uncovered` 是首次建基线的存量池、非本轮变化，故本轮不额外抽样打扰。若需系统清存量缺口，另起一轮专门做（可优先看：kie 的 `omnihuman-1-5*`/`kling/v3-omni-*`/`volcengine/video-to-video-lip-sync`——都咬跨镜身份/唇形痛点）。
- **本轮忽略**：2 条（均为「已接被脚本重报」，非质量问题）。
- **未做**：未跑 `-- --update-baseline`（铁律 3，等用户看过本轮确认后再更）；未 commit/push/开 PR。
