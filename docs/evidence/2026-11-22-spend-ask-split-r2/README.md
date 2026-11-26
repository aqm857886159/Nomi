# 付费确认拆开 · 第 2 轮证据（PR #1548 · `feat/spend-ask-split`）

## 1. 停点：付费工具审批卡（改前 vs 改后，真 Electron 1280×800，待用户点头）

> **场景怎么造**：按 `electron/shared/agentCapabilities/verbDeclaration.ts:389`，内置 Agent profile 当前禁止注册 `effect: "spend"` 工具（`nomi_try_model` 是 MCP 入口弹独立确认窗）。为在真窗口里直观核对「所有 `kind === 'spend'` 统一切到 `V4SpendBar`」对付费工具审批卡的影响，脚本在隔离资料的真 Electron 桌面窗（1280×800）新建项目并展开 Agent 面板后，按该窗口活 `workspaceId` 通过主进程 `nomi:agent-lane:projection` 推送一条 `effectClass: "spend"`、`toolName: "nomi_try_model"` 的 `LanePendingApproval`，经真实 `useAgentPanelV4Data` → `projectV4Intervention` → `V4Intervention` 渲染；分别在改前（`f58bf8dbd`，旧 `V4Intervention`）与改后（`1a0998643`，新 `V4SpendBar`）拍摄中文浅色 / 英文深色各一组整窗与卡片特写。

| 组别 | 改前（`f58bf8dbd`） | 改后（`1a0998643`） | 实测变化 |
| --- | --- | --- | --- |
| 中文浅色 · 整窗 | `before-tool-spend-zh-light.png` | `after-tool-spend-zh-light.png` | 取消 / 确认按钮 `28px / 12px / 500` → `32px / 13px`（主按钮 `600`、`⏎` `400`），卡片高 `149.9px → 153.9px`，无页脚横线 |
| 中文浅色 · 卡片 | `before-tool-spend-zh-light-card.png` | `after-tool-spend-zh-light-card.png` | 同上 |
| 英文深色 · 整窗 | `before-tool-spend-en-dark.png` | `after-tool-spend-en-dark.png` | `Cancel / Confirm ⏎` 同上：`28px / 12px / 500` → `32px / 13px`（主按钮 `600`、`⏎` `400`），卡片高 `149.9px → 153.9px` |
| 英文深色 · 卡片 | `before-tool-spend-en-dark-card.png` | `after-tool-spend-en-dark-card.png` | 同上 |

## 2. D2 / D3 / D4 实测对照（`spend-card` 屏，`cellWidth 438`）

| 场景 | 改前（`f58bf8dbd`） | 改后（`1a0998643`） | 截图 |
| --- | --- | --- | --- |
| `spend-batch`（zh-CN 浅色） | 按钮 `28px / 12px / 500`，确认条高 `72px`；镜号胶囊 `镜 01` `24×48.75px`（`py:2px px:8px r:6px`） | 按钮 `32px / 13px / 600`（取消 `500`），确认条高 `76px`；镜号胶囊 `镜 01` `20×44.75px`（`py:0px px:6px r:6px`）；托管告知 `0` | `before-spend-batch-zh-light.png` / `after-spend-batch-zh-light.png` |
| `spend-batch-en-dark`（en 深色） | 主按钮 `Generate 3 videos⏎`（`28px / 12px / 500`），条高 `72px`；胶囊 `Shot 01` `24×62.66px`（`py:2px px:8px r:6px`） | 主按钮 `Generate 3⏎`（无名词，`32px / 13px / 600`），条高 `76px`；胶囊 `Shot 01` `20×58.66px`（`py:0px px:6px r:6px`）；托管告知 `0` | `before-spend-batch-en-dark.png` / `after-spend-batch-en-dark.png` |

## 3. 两个「没做完」跑红 + 反例 + 真窗口走查摘要

- **RED #1（什么都不做）**：在改前提交 `f58bf8dbd` 的临时 worktree 中拷入第 2 轮测试，运行 `vitest` 3 处必红（`spendButtonCount.test.mjs` 报 `Received "Generate 1 videos"`、`NodePointer.test.tsx` 报缺 `[&_[data-shot-number]]:px-1.5`、`agentPanelV4Blocks.test.ts` 报缺 `h-8`）；改后 `1a0998643` 全部 261/261 绿。
- **RED #2（全拦）**：将 `V4SpendBar.tsx` 主按钮 `onClick` 改为 `() => undefined` 并构建后运行 `NOMI_TEST_NETWORK_GUARD=1 node tests/ux/core-smoke-spend-confirm.walk.mjs`，按期报红（`Expected: "sent" / Received: "waiting"`）；还原并重建后 `core-smoke-spend-confirm`（confirm / cancel）、`agent-spend-card`、`agent-spend-generate-remaining` 全部通过（`paidCalls: 0`）。
- **第三方托管关 + 上传一致性真窗口走查（`NOMI_TEST_NETWORK_GUARD=1`，`NOMI_WALK_NET_LOG`）**：
  - `anonymousAssetHosting`: `deny`（默认关）
  - 第三方图床 `blocked` 行：`0`（总 `blocked` 行 `0`）
  - 确认条路径供应商上传数 `1` === 画布同节点点「生成素材」上传数 `1`
  - 确认条托管告知：`0`
  - 逐控件点击全部通过：行点定位节点、展开「还有 1 个镜头」、悬停 `×` 去掉（5→4）、点「恢复」（4→5）、取消（0 上传）、画布点生成、确认条点生成剩余。
- **反例「破坏→红、恢复→绿」**：
  - 设置关仍放行第三方托管（`assetLocalization.ts` `anonymousHostingEnabled → true`）→ `hostingSettingOnly.test.ts` 7/13 失败 → 还原 13/13 绿；
  - 确认条挂托管告知（`agentPanelSpendCard.ts` `notices` 注入托管提示）→ `agentPanelSpendCard.test.ts` 失败 → 还原 40/40 绿；
  - 英文主按钮带 `videos` → `spendButtonCount.test.mjs` 失败 → 还原 4/4 绿；
  - 行折起阈值改 999（`nodePointerRows.ts`）→ `NodePointer.test.tsx` 2/41 失败 → 还原 41/41 绿。
- **老数据核验**：`ui.mjs up --data v0.24.0-library --vendor fake-apimart` 打开 `v0.24.0` 项目进画布并展开 Agent 面板，`errors.log` 零报错。
- **door-map（唯一决定点）**：
  - `anonymousAssetHosting`：0 写入口 / 3 读入口（`electron/catalog/assetLocalization.ts:48`、`electron/settings/automationPolicyContract.ts:55-64`、`src/workbench/settings/AiModelsSection.tsx:296`），主进程设置是唯一决定点；
  - `assetLocalization`：0 扇额外门。
