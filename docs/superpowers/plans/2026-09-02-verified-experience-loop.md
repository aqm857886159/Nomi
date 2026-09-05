# Verified Experience Loop 实现计划

> 状态：🚧 canonical Host 替换接线已完成；真实用户任务与打包运行证据待补
> 设计规格：`docs/superpowers/specs/2026-09-02-verified-experience-loop-design.md`
> 目标：完成自动候选提炼、证据闸门、路由、生命周期与会话完成接线；不做远端训练、不自动合并代码。

## 任务 1：建立严格领域合同（TDD）

- 新增 `electron/experience/experienceTypes.ts`，用 zod 定义轨迹、证据、候选、复用结果和事件 payload；限制长度、枚举和 scope。
- 先写 `electron/experience/experienceTypes.test.ts`：合法样本通过；缺问题/动作/验证、超长、数组越界、非法状态失败；JSON round-trip 保持稳定。
- 运行单测确认先红，再实现 schema 使其变绿。

## 任务 2：实现脱敏轨迹与候选提炼（TDD）

- 新增 `electron/experience/experienceExtractor.ts`：把完成的 Agent 轨迹归一化为最小证据；支持注入 extractor，默认只接受结构化候选，不猜测未验证结论。
- 先写测试覆盖：敏感字段、长文本、无验证结果、成功/失败/错误/拒绝、trajectoryId 幂等输入。
- 默认 extractor 只将明确的 `learning` envelope 解析为候选，普通回答生成 incident/空候选，避免幻觉污染。

## 任务 3：实现路由与生命周期状态机（TDD）

- 新增 `electron/experience/experiencePolicy.ts`：依据证据完整度、候选 kind、风险、独立复用次数决定目的地和初始状态；提供 `recordReuse`、`promote`、`demote`、`expire`。
- 先写红测试：green 直接 active；yellow shadow→两次独立成功 promotion；red quarantine；缺证据 incident；失败/矛盾/过期回滚；重复 hash 合并。
- 实现后补不变量断言，禁止 active 候选缺证据或 scope 越权。

## 任务 4：实现本地 EventLog 投影与重建（TDD）

- 新增 `electron/experience/experienceRepository.ts`：追加 `experience.candidate.*` 与 `experience.reuse.*` 事件；写 `.nomi/experience/index.json` 作为可删投影；从 EventLog 重建结果等价。
- 在 `electron/events/types.ts` 增加类型别名/注释，保持未知事件可回放。
- 先写测试：append/read、重复处理幂等、投影损坏重建、redact/大小上限、删除/回滚只追加事件。

## 任务 5：接入会话完成旁路（TDD）

- 在 canonical `ProjectAgentHost` 的 `async.result` 提交并确认终态后调用 `electron/experience/projectAgentExperience.ts`；完成投影是异步旁路，不能阻塞 `execution-result`。
- 先写 Host coordinator/experience bridge 测试：提交终态后只触发一次；旁路异常不阻塞；没有真实 EventLog seq 的 envelope 不落 candidate。
- 默认处理器调用 repository；测试注入 fake handler 验证失败隔离。

## 任务 6：现有 Memory 投影边界与提示文档

- 仅允许 green `fact` 通过显式适配器写入现有 memory 事件；yellow/red 不注入 prompt。
- 为 extractor 的结构化 envelope 写开发者文档和示例；明确 Git/Skill/Runbook/ADR/training-data 的边界。
- 更新 `docs/ARCHITECTURE-NOW.md` 一行，标注当前实现的触发器和“不自动改生产”的边界。

## 任务 7：验证与交付

- 先跑新增 focused tests，再跑 `pnpm run typecheck`、`pnpm run lint:ci`、`pnpm run check:filesize`、`pnpm run check:heavy-path`、`pnpm run check:root-cause-contracts`、`pnpm run test:system:focused`。
- 当前单测使用显式 envelope 验证“问题→动作→验证→候选→重建”合同；真实 Electron/打包用户任务仍是独立验收门，不能由该 fixture 代替。
- 检查 diff 与样例，提交任务分支、推送并创建 PR；不合并、不直接 push main。
