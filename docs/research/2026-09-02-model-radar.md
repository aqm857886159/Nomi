# 2026-09-02 供应商模型雷达 · 分诊

雷达轮次（`pnpm run radar:models`，今晨 09:57 实跑，`latest.json`；`failures: []` 两家都查成）：

| 供应商 | 盯住 | 新增 | 下架 | 备注 |
|---|---|---|---|---|
| apimart | 128 | 1 | 0 | `minimax-h3/max`——**我们已有 `MINIMAX_H3_MAX_ARCHETYPE`**（源为一手 minimaxi），这是同一模型的 apimart 新渠道页，非新能力 |
| kie | 142 | 1 | 0 | `google/gemini-omni-flash-1-1`——**我们已有 `GEMINI_OMNI_11_ARCHETYPE`**，identifierPatterns 精确命中；纯基线滞后，非缺口 |

> **本轮核心结论：两条「新增」都不是新东西，是快照滞后。** 脚本报的 `added` 是「现网目录 vs 上次基线快照」的差；这两个模型我们**都已经建了档案**，只是快照没更新（按铁律 3，快照要等用户看过本轮差异才 `--update-baseline`，所以它们会持续显形直到用户点头更新）。逐个 grep 复核见下，均已交叉引用到具体文件。**本轮无 🟢（无需新接）。**

---

## 逐条分诊

### ⚪ apimart · `minimax-h3/max` · video — 已有档案，仅新增渠道源
- **文档页**（2026-09-02 实抓）：<https://docs.apimart.ai/en/api-reference/videos/minimax-h3/max.md>
- **是什么**：apimart 为 **MiniMax-H3-Max** 单独开的视频生成页。页面明写 H3-Max 是**独立于 MiniMax-H3 的模型**（"Use MiniMax-H3-Max when speed matters and you only need text-to-video or first/last-frame control. For 2K, reference images/videos/audio, use MiniMax-H3."）——速度档，只做 T2V + 首/尾帧。
- **实抓到的能力面**：`POST https://api.apimart.ai/v1/videos/generations`，Bearer 鉴权，**异步**（返回 `task_id`，轮询 `GET /v1/tasks/{task_id}`）。`model=MiniMax-H3-Max`（大小写不敏感）；`prompt` ≤7000 字符；`duration` 5–15s（默认 5）；`resolution` `768P`(默认)/`480P`；`aspect_ratio` 21:9/16:9/4:3/1:1/3:4/9:16（T2V 默认 16:9）；`first_frame_image`/`last_frame_image`（或 `image_with_roles` 数组）；`watermark`(默认 false)；`webhook`。**不支持**参考图/视频/音频、2K、中间帧。图片：≤2 张（首帧+尾帧），单文件 ≤30MB，尺寸 256–5760px。**定价（该中转页）**：768P **$0.075/秒**、480P **$0.0495/秒**、输入图免费。
- **对 Nomi 哪个痛点**：T2V + 首尾帧转场镜，速度/成本档。
- **覆盖现状**（grep 复核，铁律 7）：**已覆盖**。`electron/shared/videoCapabilities/minimaxH3Max.ts` 的 `MINIMAX_H3_MAX_ARCHETYPE` `identifierPatterns:["minimax/h3-max","MiniMax-H3-Max"]`，模式 t2v + i2v(首尾帧)、480P/768P、5–15s，与本页一致。其 `sources` 现指向**一手 `platform.minimaxi.com`**（checkedAt 2026-08-30），**未声明 apimart 这条渠道源**。另 `MINIMAX_H3_APIMART_ARCHETYPE`（`minimax-h3-apimart`）只覆盖非 Max 的 H3（源 `docs.apimart.ai/.../minimax-h3/generation`）。
- **判断**：⚪ 忽略（无需新接）。**唯一可做的小事**（非本轮必做）：若将来要走 apimart 通道跑 H3-Max，可把本页作为**补充源**加进 `MINIMAX_H3_MAX_ARCHETYPE.sources`，并留意两处**差异待实测**——① 分辨率档：一手页写 480P/768P，apimart 页也写 768P/480P（一致）；但 `MINIMAX_H3_APIMART_ARCHETYPE`（非 Max）写到 2K，别混档；② **定价 $0.075/$0.0495/秒是 apimart 中转价**（铁律 5，一手 minimaxi 价可能不同，真接时交叉核）。这属档案维护、不属新接模型。

### ⚪ kie · `google/gemini-omni-flash-1-1` · video — 已有档案，基线滞后显形
- **文档页**（2026-09-02 实抓，08-31 亦抓过）：<https://docs.kie.ai/market/google/gemini-omni-flash-1-1.md>
- **是什么**：Google Gemini Omni 1.1 Flash 多模态视频生成，走 kie `POST /api/v1/jobs/createTask` 异步（`taskId` 轮询或 `callBackUrl`）。
- **实抓到的能力面**：`image_urls` **≤7 张**（单张 ≤20MB），**与 `first_frame_url` 互斥**；`first_frame_url`/`last_frame_url`（尾帧需伴随首帧）；用 `first_frame_url` 时 `image_urls`/`video_list`/`character_ids`/`audio_ids` 全禁；`duration` 4/6/8/10s（有视频输入时忽略）；`resolution` 360p/720p(默认)/1080p/4k；`aspect_ratio` 16:9/9:16。**配额系统**：共 7 units（图 1/张、视频 2/最多 1、character_ids 1/最多 3）。计费回调报 `creditsConsumed`（具体价文档未给）。
- **对 Nomi 哪个痛点**：跨镜身份（7 张参考图上限高）+ 首尾帧转场。
- **覆盖现状**（grep 复核，铁律 7）：**已覆盖**。`electron/shared/videoCapabilities/geminiOmni11.ts` 的 `GEMINI_OMNI_11_ARCHETYPE` `identifierPatterns:["google/gemini-omni-flash-1-1","gemini-omni-flash-1-1"]` 精确命中该 slug；三模式 t2v / firstlast / reference(≤7) 全在，4k、audio_ids≤3、video_list≤1 均已在 `sources.covers` 记录（同一 kie 页，checkedAt 2026-08-30）。
- **判断**：⚪ 忽略。**并订正 08-31 radar**：`docs/research/2026-08-31-model-radar.md` 当天把此模型判为「🟢 真缺口，`gemini-omni` 全仓 grep 无命中」——**该结论现已不成立**（档案已建，很可能就是那次点头后接的，或另一路并行接入）。这正是铁律 7 的教训：断言缺口前先按归一 token grep，别只按报错串。今日 `added:1` 是**基线未更新**的显形，不是回归、不是缺口。

---

## 底部

- **`uncovered` 抽样**：本轮不抽。理由——两条 `added` 已确认「已覆盖」，无新接需求；`uncovered`（apimart 89 / kie 76，共 ~165 条）是首次建基线的存量池（铁律 6），与今日痛点（Agent 界面实施准备、跨镜身份）无新增交集，逐条分诊只会把报告变收件箱。如需清存量另开专项，不塞进日课雷达。
- **本轮忽略**：2 条（均因已覆盖）。**无 🟢 / 无 🟡。**
- **快照纪律**：**未跑 `--update-baseline`**（铁律 3，等用户看过本轮差异）。用户看过后若认可「两条都已覆盖」，可更新快照，下轮这两条即不再显形。
- **给用户的动作项**：无需接新模型。可选的档案维护（非阻塞）：给 `MINIMAX_H3_MAX_ARCHETYPE` 补 apimart 渠道源；确认 08-31 那条 gemini-omni「缺口」结论作废。这两件都是清理级，按 P0 卫生清理可直接做，但因涉及改档案文件、留给用户一并决定是否随快照更新一起处理。
