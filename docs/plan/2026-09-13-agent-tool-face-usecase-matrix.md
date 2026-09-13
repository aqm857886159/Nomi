# Agent tool face · 真实用户任务验收矩阵

状态：实施中。本文把 20 个 canonical verbs 转成用户会说的话；每条任务必须经过真实 Electron 页面输入，记录 Agent 首个动作、工具轨迹、页面反应、持久化和冷启动回读。

## 通过标准

- 不允许直接注入 store、调用 renderer bridge 改状态、重开窗口绕过审批或用截图代替结果。
- 每条任务保存：用户原话、首个工具、完整工具序列、助手答复、页面截图、项目落盘快照、冷启动读回结果。
- 计算 8 个数字：首调工具写对率、回合成功率、读后写遵守率、错误 verb 拦截率、审批正确率、持久化成功率、冷启动成功率、页面点击成功率。
- loopback 只证明流程；真实 provider 另跑少量图 2 张、视频 2 段、导出 1 次，并单独记账。

## 先查别人

本轮先复核已有实现和公开契约，再建立矩阵：

- 依赖里已有：Playwright 的 Electron 启动与页面交互能力由 `tests/ux/**/*.spec.mjs`、`playwright.config.mjs`（见 `tests/ux/design-lab/design-lab.visual.spec.mjs:1`）提供；MCP 工具列表与输入 schema 由 `electron/capabilityCore/mcpCapabilityProjection.ts:1-2` 统一投影。矩阵只编排这些入口，不另造页面驱动层。
- 仓库里已有：`tests/ux/storyboard-agent-canonical-patch.e2e.mjs:1-6` 已覆盖真实 Electron/MCP lease、elicitation、patch、receipt 和冷启动；`electron/agentLane/laneDesktopReads.test.ts:1-12` 覆盖 lane 读工具边界。新矩阵补用户任务和状态分母，不复制这些底层夹具。
- 生态里已有：MCP 工具发现和调用遵循官方规范 [Model Context Protocol Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)；Electron 页面验收遵循 [Playwright Electron](https://playwright.dev/docs/api/class-electron)。
- TikHub 自媒体来源：本矩阵验证的是本地 Electron 工具契约和真实页面状态，不采用自媒体作为行为标准；用户任务来源是产品现有 canonical verbs 与已落盘的真实轨迹，避免把营销案例当作验收依据。

结论：复用现有 Electron、MCP、Playwright 和轨迹落盘边界；本任务自研的是跨空/非空/审批/持久化/冷启动状态的用户任务编排与证据汇总，因为这些状态组合不是任一单一依赖提供的能力。

## 任务矩阵

| ID | 用户会说的话 | 预期首个动作 | 证明什么 |
|---|---|---|---|
| U01 | 画布上现在有什么？ | `look_at_canvas` | 只读入口与自然语言概览 |
| U02 | 把文稿里“雨夜”那段读出来 | `read_script(selection)` | 选择范围不猜测 |
| U03 | 时间轴 0:20 到 0:30 发生了什么？ | `read_timeline` | 秒转帧且不写入 |
| U04 | 素材库里有雨天视频吗？ | `look_at_media` | 搜索结果可供后续引用 |
| U05 | 现在能用哪些视频模型？ | `list_models` | 模型 key 不凭空编造 |
| U06 | 这个生成任务完成了吗？ | `check_job` | 状态查询不重试/重提任务 |
| U07 | 读取一下分镜技能 | `read_skill` | 技能读取不等于授权 |
| U08 | 把结尾改得更克制，追加一句 | `read_script` → `write_script` | 写入前读，文稿真实落盘 |
| U09 | 把这段拆成六个镜头，先别生成 | `read_script` → `draft_shots` | 草稿与生成严格分离 |
| U10 | 就生成刚才那六个镜头 | `generate` | 只出现确认卡，不直接花费 |
| U11 | 把角色参考连到第二镜 | `look_at_canvas` → `arrange_canvas` | 只改现有关系 |
| U12 | 做一张镜头对照表放画布上 | `make_artifact` | 手工产物不走生成模型 |
| U13 | 给第四镜加一个推进镜头参考 | `look_at_canvas` → `stage_shot` | staging 与生成分开 |
| U14 | 把开头剪短两秒并加字幕 | `read_timeline` → `edit_timeline` | revision 保护与 review card |
| U15 | 撤销你刚才的时间轴改动 | `undo` | 只撤销明确 changeId |
| U16 | 删除画布上的旧海报 | `look_at_canvas` → `delete_from_canvas` | 精确节点 + 确认卡 |
| U17 | 导出当前视频 | `read_timeline` → `export_video` | revision 与导出作业 |
| U18 | 停止正在导出的任务 | `check_job` → `cancel_job` | 取消确认与状态收敛 |
| U19 | 把这个写作方法保存成技能 | `save_skill` | 技能写入与持久化 |
| U20 | 帮我接入一个视频模型 | `start_model_setup` | 页面设置入口，不泄漏密钥 |
| U21 | 感觉画布不对，帮我整理一下 | `look_at_canvas` → 解释或 `arrange_canvas` | 模糊意图不能直接破坏状态 |
| U22 | 先等等，别动刚才的东西 | 无写工具，steer 当前回合 | 中途插话优先级 |
| U23 | 英文：make the opening shot vertical | `read_*` → `draft_shots` | 英文措辞仍遵守同一契约 |
| U24 | 生成可以，但先告诉我会发生什么 | `look_at_canvas` / `generate` | 费用和影响先可见 |

## 当前证据与缺口

- 已通过：canonical storyboard patch 的真实 Electron + MCP + elicitation + 落盘 + 冷启动回读，15 项断言。
- 部分通过：B1 真实模型样本，任务成功 2/3；试拍没有进入真实生成闭环。
- 未通过：U01–U24 尚未全部由真实页面输入跑完；Composer 走查启动时出现导航上下文被销毁。
- 只有当 U01–U24 有逐条轨迹和截图，且页面点击成功率、读后写遵守率、持久化成功率都有分母，才可以宣布 20 verbs 验收完成。

## 2026-09-13 执行收据

- usecase manifest：通过，20/20 canonical verbs，20/20 用户任务，8 个指标。
- `check:agent-tool-face-usecases` 已接入 `gates:contracts`；本轮合同门岗 81 项中该项通过，整体 77 项通过、1 项阻断（历史 Ponytail 延后账本）、3 项 advisory。
- TypeScript 双向检查：通过。
- Electron 构建：通过，产物和 build stamp 已生成。
- `mcp-generation-elicitation-first.e2e.mjs`：通过，6 项断言；elicitation 确认后进入 execute，GUI 卡为 0。
- `storyboard-agent-canonical-patch.e2e.mjs`：通过，真实 Electron/MCP 启动、lease、elicitation、精确 patch、receipt、冷启动回读共 15 项断言。
- 相关回归单测：通过，4 个文件 33/33。
- 自然语言页面输入：通过一次真实 Electron 走查；实际输入「请把开场镜头改成雨夜便利店，并先给我一个可撤销的分镜修改提案，不要直接生成。」并保存截图证据。
- 真实供应商素材 canary：未通过；打包版走查在输入控件挂载点上失败，未产生供应商请求，故没有虚报素材产出。
- 当前判定：**仍未通过，不创建 PR**。剩余门槛是完整 gates、真实 provider 素材 canary，以及 U01–U24 的完整页面轨迹覆盖。
