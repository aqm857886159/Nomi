# 2026-08-31 供应商模型雷达 · 分诊

雷达轮次（`pnpm run radar:models` 真网实跑）：

| 供应商 | 盯住 | 新增 | 下架 | 备注 |
|---|---|---|---|---|
| apimart | 127 | 0 | 0 | 08-31 起 llms.txt 改为两级索引（模型页移入 `/_llms/en/api-manual.md`），slug 宇宙与 08-27 基线完全重合 = 纯文档重组，目录无变化 |
| kie | 142 | 1 | 0 | 见下 |

> 当天雷达曾因 apimart 改版整轮 abort；已修（两级索引适配 + 供应商级失败隔离），
> 合同 `docs/fixes/2026-08-31-model-radar-vendor-isolation.root-cause.json`。

## 新增分诊（🟢 值得接 / 🟡 观望 / ⚪ 忽略）

### 🟢 kie · `google/gemini-omni-flash-1-1` — Gemini Omni 1.1 Flash（生视频）

- **页面**：<https://docs.kie.ai/market/google/gemini-omni-flash-1-1.md>（2026-08-31 实抓）
- **是什么**：Google Gemini Omni 1.1 的 Flash 档多模态视频生成，走 kie 统一
  `POST /api/v1/jobs/createTask` 异步任务协议（与已接 kie market 模型同通道）。
- **实抓到的能力面**：参考图 `image_urls` **最多 7 张**；`first_frame_url` /
  `last_frame_url` 首尾帧（尾帧必须伴随首帧）；另收 `video_list`、`audio_ids`
  素材输入；素材按 unit 计费（每图 1 unit）；参考图与首帧互斥。
- **对 Nomi 哪个痛点**：跨镜身份一致性（reference relay）——7 张参考图上限显著高于
  常见 2-4 张，直接利好「一名角色跨多镜」的身份锚定；首尾帧原生支持转场镜。与今日
  论文雷达结论（跨镜 coherence 杠杆在镜间与规划，见 `2026-08-31-radar.md`）同向。
- **覆盖现状**：目录/档案零命中（`gemini-omni` 全仓 grep 无）——真缺口，不是改名。
  已接 Veo 3.1（`veo31.ts`）是另一族；Flash 档定位预期是快/便宜，但**价格页面未给**，
  留到接入方案阶段实查。
- **判断**：🟢 值得接。理由：贴核心痛点 + 复用 kie 现有通道接入成本低。
  按 2026-08-27 拍板流程：**用户点头 → 先出接入方案**（契约摘要 + 档案设计 +
  与 Veo/现有 kie 视频档案合分理由）**→ 再写码**，本轮不动代码。
