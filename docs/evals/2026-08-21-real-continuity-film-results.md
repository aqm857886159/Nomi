# 真实 30 秒连续性片：根因—证据—修复记录

## 结论

这次验收使用 Nomi 已配置的 APIMart key，通过 Nomi capability core 真生成 Seedream 4.5 静态首帧和 Seedance 2.0 I2V。最终片子位于：

`/Users/aoqimin/Documents/Nomi Projects/真实连续性片 2026-08-21-mt2gt25u-c8f3544b/exports/nomi-real-continuity-30s.mp4`

项目证据目录：

`/Users/aoqimin/Documents/Nomi Projects/真实连续性片 2026-08-21-mt2gt25u-c8f3544b/.nomi/runs/run-real-continuity-a1f5911d/`

最终验收：29.4 秒、H.264/AAC、字幕流 29.32 秒；6 镜、5 个有意编排的边界转场；抽帧后的 18 张镜头帧和 15 张边界帧均落在项目目录内。真实验收命令 1/1 通过。

## 旧片的真实失败，不是“播放器能不能打开”

旧项目 `未命名项目 08_21 03_57-mt1xzh1c-31b70fdc` 的事件记录只有六次独立 I2V 请求：

- 没有 `StoryboardPlan` 的目标、动作链、结果和状态锁；
- 镜头 2–6 没有 `previousShotId`、`firstFrameRef`、`lastFrameDesc`；
- 所有请求都复用了角色参考图，却没有上一镜尾帧接力；
- 6 个画面可以各自漂亮，但请求层没有“这一镜必须承接上一镜什么”的可对账证据。

因此旧片在 `real-film-continuity-contract.test.mjs` 中必须红灯。它不是质量分低，而是生产信息在生成请求前已经丢失。

## 这次测试如何和问题一一对应

| 真实问题 | 红灯条件 | 修复后的证据 |
|---|---|---|
| 每镜各自生成，故事变成拼接稿 | 少于 6 镜、缺 `narrativeGoal/actionChain/dramaticBeat` | `storyboard-v1.json` 逐镜保存目标、动作链、戏剧结果 |
| 跨镜状态蒸发 | 镜头 2+ 缺 `previousShotId` 或 `firstFrameRef` | `generation-record-v1.json` 的每个视频请求带前镜、首帧、尾帧和 references |
| 片长/字幕假绿 | MP4 不是约 30 秒，或字幕流超出视频 | ffprobe 实测 29.4/29.32 秒；验收断言二者对齐 |
| 只看文件能播放，不看画面 | 抽帧缺 early/middle/late 或边界 verdict 不是 pass | `frame-analysis.json` 记录 18 张镜头帧、15 张边界帧和逐边界 verdict |
| 供应商动作提示产生空间幻觉 | 真实抽帧发现第 4 镜桌下出现第二张脸 | 只重试第 4 镜；记录 `retryCount=1`、`parentUrl`、`retryReason`，重试 prompt 明确“桌下为空” |

## 实际抽帧审阅

审阅文件：

- `frame-analysis/shot-contact-sheet.jpg`：每镜 early/middle/late；
- `frame-analysis/boundary-contact-sheet.jpg`：每个边界 fromTail/cut/toHead；
- `frame-analysis/frame-analysis.json`：机器可复核的路径、时间戳、结论和审阅依据。

边界逐一核对：

1. 雨夜门口 → 门把近景：门、人物、暖灯和纸条保持同一空间；
2. 门把 → 跨门槛：门被打开，下一镜出现同一门槛和雨水脚印；
3. 跨门槛 → 木桌：工作室木桌从上一镜前景变成下一镜主要动作位置；
4. 木桌画卡 → 俯拍排卡：纸条、暖灯、桌面状态延续；
5. 排卡 → 屏幕收尾：卡片和屏幕从上一镜的动作结果变成最后一镜的完成结果。

第 4 镜第一次生成的静态首帧没有异常，但 I2V 结果在桌下生成了第二张脸。根因是动作描述“女性双手从下方进入”给模型留下了错误的空间解释；重写为“只有一个人、双手始终在桌面、桌下为空”后，重试帧不再出现该人脸。这个过程保留了父素材和重试原因，而不是覆盖掉失败证据。

## 可复跑命令

```bash
pnpm vitest run tests/production/real-film-continuity-contract.test.mjs
pnpm vitest run tests/production/real-film-acceptance.test.mjs
node scripts/analyze-real-film.mjs --film "$FILM" --run "$RUN" --out "$RUN/frame-analysis"
```

重新生成后的 `frame-analysis.json` 会回到 `pending-human-review`，这是刻意设计的：不能把上一轮人工结论自动冒充下一轮证据。

## 限制

这次是通过 Nomi capability core 的真实供应商生成和项目目录证据包，验证了“生成—抽帧—发现根因—定向重试—再验收”链路；它不是把项目 UI 的每个点击都自动化录制，也没有把静音 AAC 轨道冒充真实配乐。下一步如果要做可发布样片，应再接真实音频/对白和最终导出 UI 走查，但这不影响本次连续性合同的结论。
