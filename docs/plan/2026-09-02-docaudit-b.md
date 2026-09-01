# DOCAUDIT-B：非 KIE/APIMart 官方文档对账与封印

状态：🚧 进行中

## 范围

- 对账并覆盖 `electron/catalog/` 与 `electron/shared/videoCapabilities/` 中 fal、Runway、MiniMax、ElevenLabs、Wan、Suno、Veo、Gemini、Agnes、Volcengine、HappyHorse 等非 KIE/APIMart 入口。
- KIE/APIMart 文件和模型不改；模型雷达产生的 A 班 `latest.json` 不纳入本分支。
- 每个 mapping 记录官方 URL、检查日期、字段/模式结论；文档与网关冲突时双源记录，不用 200/余额响应冒充契约正确。

## 交付单元

1. 遗产 B2：已对照 Runway OpenAPI 与 ElevenLabs SFX 文档，保留正确修复并补回归测试。
2. Runway 参考模式：以 `/v1/text_to_video` 官方 union 为准修正多模态 reference mapping，补首帧/首尾帧/参考模式干跑合同。
3. 文档证据：按 vendor 分节写入 `docs/research/2026-09-02-docaudit-fal-runway-etc.md`，包含全量 mapping 表、未证项与官方链接。
4. 真实封印：仅对 acceptance matrix 中非 ✅ 的已解锁模型按参考输入优先选择最大覆盖模式；每笔记录 mapping 哈希、产物、内容双验、精确花销和余额阻断。
5. 收尾：contracts、focused tests、`pnpm run gates`；最终报告写入 worktree 根且不提交。

## 根因与验收

- 供应商按 endpoint discriminator 声明字段，不能由一个“视频”模板猜测；共享 reference 模式必须与实际 endpoint、task kind、payload union 同时一致。
- 先运行新增失败回归，再在最早的 mapping factory 边界修复；无 UI 分支、无第二套 fallback。
- 生产请求的真实证据需同时具备：HTTP/任务状态、下载产物可解码、提示词特征和参考图特征；余额/校验通过只记为 wire-valid。

## 回滚与边界

- 映射修复可按单个 commit 回滚；不改用户数据迁移、不改 KIE/APIMart、不合并或 push `main`。
- 预算上限 ¥35；只使用现有本机凭证，任何 key 不进入仓库、日志或报告。
# DOCAUDIT-B 执行计划

状态：🚧 进行中
