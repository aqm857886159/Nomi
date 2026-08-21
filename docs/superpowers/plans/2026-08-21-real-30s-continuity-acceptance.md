# 真实 30 秒片：连续性根因测试与迭代计划

## 目标

把 2026-08-21 的真实片问题从“看起来能播放”改成可复查的失败合同，然后用 Nomi 当前配置的真实供应商生成一条新的约 30 秒粗剪。测试必须先对旧片打红灯，再对新片逐镜抽帧、逐剪辑边界审查；只有项目产物、生成请求、抽帧证据和最终 MP4 全部对应，才算通过。

## 已确认的旧片根因

旧片 `project-1787255846399-rc9057` 的事件日志显示 6 次独立的 `image_to_video` 请求都只复用了同一张角色参考图；没有 StoryboardPlan、没有 `previousShotId`、没有首/尾帧、没有场景/道具状态。六条 prompt 各自描述“好看的镜头”，没有可见的目标—行动—结果链。后期把所有边界套成 fade，只改变剪辑形式，不能修复“门外→街上→室内”这类空间反转。

## 验收合同（红灯必须有证据）

1. 生产计划：至少 6 镜；每镜有 `shotId`、`narrativeGoal`、`actionChain`、`dramaticBeat`、`continuityLocks`、`ffDesc`、`motionDesc`、`lfDesc`；第 2 镜起必须声明 `previousShotId` 和上一镜尾帧/状态引用。
2. 请求守恒：每个视频请求必须携带镜头 ID、前镜 ID、参考资产、首/尾帧描述或显式状态回退说明；不能用裸的低级 `image_to_video` 请求冒充生产批次。
3. 真实媒体：最终 MP4 可解码，视频约 30 秒，字幕流不越界，音频存在，镜头时间连续。
4. 抽帧证据：每镜保存早/中/晚三帧，每个边界保存前镜尾帧—切点—后镜首帧三联图；`frame-analysis.json` 必须逐边界记录 `spatialContinuity`、`causalHandoff`、`characterState` 和 `verdict`，不能只记录 ffprobe 数字。
5. 叙事质量：开场目标、发展行动、转折/决定、结果收束至少各出现一次；相邻镜头不得出现未经计划的空间倒退、道具消失或角色状态重置。
6. 项目可恢复：剧本、分镜、请求记录、抽帧证据、QA/重试 lineage、时间轴和导出都在同一个 Nomi 项目目录中。

## 实施顺序

### A. 先写会打红的测试

- 新增纯连续性合同校验器和测试：旧的 `real-ai-film-30s.generation-record.json` 必须失败；缺前镜引用、缺首尾状态、只有口号字幕的计划必须失败；完整的六镜示例通过。
- 新增真实媒体抽帧脚本：使用 ffprobe/ffmpeg 输出技术统计、逐镜早中晚帧、边界三联图和可人工/模型复核的 JSON。
- 新增真实片验收测试：没有 `frame-analysis.json` 或任何边界没有 verdict 时失败；不能只通过“MP4 存在”。

### B. 再接根因修复

- 让 StoryboardPlan 保存故事结构与连续性字段，并在 converter、node metadata、Production binding、生成请求中守恒。
- 生成采用“静态首帧 → 视频运动 → 静态尾帧”的两跳；相邻镜头使用上一镜尾帧/状态作为下一镜首帧候选，不再只复用一张角色图。
- 在 QA 中增加边界审查和定向重试：重试只改红镜头的状态/动作指令，保留原结果和 lineage。

### C. 真实生成与迭代

- 使用 Nomi 已存在的 APIMart 配置和 Seedream/Seedance 模型，不伪造 provider 结果。
- 故事采用“雨夜捡到一张画着门的湿纸条 → 推门进入同一间工作室 → 把纸条变成第一张分镜卡 → 排成时间线并点亮成片 → 清晨看见完成结果”的单一空间因果链。
- 每轮生成后运行抽帧脚本；若边界空间、动作或状态不成立，先修对应 shot plan/request，再定向重跑，不用 fade 掩盖问题。

## 验收命令

```bash
pnpm vitest run tests/production/real-film-continuity-contract.test.mjs tests/production/real-film-acceptance.test.mjs
node scripts/analyze-real-film.mjs --film <project>/exports/<file>.mp4 --run <project>/.nomi/runs/<run>
NOMI_REAL_FILM_DIR=<project> pnpm vitest run tests/production/real-film-acceptance.test.mjs
```

## 不把什么算作通过

- 只有 `ffprobe` 能读、或只有字幕/转场数量通过，不算质量通过。
- 用仓库 launch film、静态 fixture 或“所有边界自动标 cut/fade”替代真实供应商片，不算真实生成通过。
- 测试从自己刚写入的“pass=true”字段读回再断言，不算证据；边界 verdict 必须来自抽帧复核记录，并保留原始三联图。
