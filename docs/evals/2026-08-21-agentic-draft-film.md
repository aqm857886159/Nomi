# Agentic production 30 秒样片验收（2026-08-21）

## 验收对象

- 项目样例：`artifacts/nomi-agentic-draft-film-2026-08-21/`
- Run：`run-agentic-draft-film-30s`
- 导出：[nomi-agentic-draft-film-30s.mp4](/Users/aoqimin/Desktop/Nomi-production-pipeline/artifacts/nomi-agentic-draft-film-2026-08-21/exports/nomi-agentic-draft-film-30s.mp4)
- 产物目录：[.nomi/runs/run-agentic-draft-film-30s](/Users/aoqimin/Desktop/Nomi-production-pipeline/artifacts/nomi-agentic-draft-film-2026-08-21/.nomi/runs/run-agentic-draft-film-30s)

## 真实走查结果

本次样片不是新花费模型额度生成的素材：视觉源是仓库已有的高质量 Nomi launch film，经过本地 30 秒裁切、中文 WebVTT 字幕封装和项目产物归档。这样做是有意的诚实拆分：它验证“稿件/分镜/时间轴/字幕/转场元数据/MP4 导出”这条生产合同，不能冒充“模型新生成质量”评测。

人眼检查了 0、5、10、15、20、25 秒六个画面：画面连贯、字幕可读、音轨存在，粗剪没有黑帧或破损。输出是 1280×720、30 fps、30.000 秒，包含 H.264 视频、AAC 音频和 `mov_text` 字幕流。

## 合同核对

| 项目 | 结果 |
|---|---|
| 完整时长 | 900 帧 / 30 秒 |
| 镜头数量 | 8 镜，区间连续覆盖 0–900 帧 |
| 字幕 | 10 条时间化字幕；MP4 内有字幕流 |
| 转场 | 3 个明确声明的 `cut`（shot-2→3、4→5、6→7） |
| 导出 | MP4 可播放，H.264 + AAC + mov_text |
| 项目可恢复 | script/storyboard/timeline/run 均在 `.nomi/runs/...` |
| 来源追溯 | storyboard 保存 approved script 的 artifactId/version/hash |

这里的 `cut` 是正常硬切，不是假装成 dissolve。未声明的相邻镜头边界不会被合同自动算成“转场”；如果未来要验收淡入淡出，需要再把视觉 xfade 接进 exporter，而不是只改一个枚举。

## 自动化证据

```text
pnpm run typecheck                                  PASS
pnpm vitest run electron/capabilityCore/mcpConversationJourney.test.ts  PASS (2)
pnpm vitest run electron/productionRun/productionRunE2eFixture.test.ts  PASS (2)
pnpm vitest run src/workbench/preview/timelineSubtitleTransitionContract.test.ts  PASS
pnpm vitest run src/workbench/timeline/timelineMath.test.ts  PASS
pnpm vitest run tests/production/real-draft-film.test.mjs electron/productionRun/agenticProductionAdversarial.test.ts  PASS
```

这条媒体合同测试会在 `artifacts/` 还没有生成物时先运行
`node scripts/benchmarks/build-agentic-draft-film.mjs`，再用 ffprobe 和项目内 JSON 对账；因此
它不是只检查“文件存在”，而是检查 30 秒、音视频编码、字幕流时长、镜头连续性、
显式转场、剧本→分镜 provenance 和项目归档。

外部 Agent 旅程覆盖：方向 → 剧本 candidate → `nomi_review_artifact` → 分镜 candidate → `nomi_review_artifact` → `nomi_materialize_storyboard`。Nomi 画布侧和外部 MCP 共享 `production.materialize-storyboard` renderer seam；没有另造一套转换器。

## 已知边界

1. 当前样片验证的是生产合同和导出，不是新模型生成的身份一致性/动作质量；要做那项评测，需要可用的 provider key 和真实生成额度。
2. 转场当前验收的是显式硬切；导出器还没有把 `dissolve`/`fade` 元数据渲染成视觉 xfade。
3. 零额度 fixture 仍然保留，用于 CI 的协议/文件/编解码回归；它不作为画面质量样片。
