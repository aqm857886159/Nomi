# 方向检查：外壳 Agent「叫回」信号（#1136，2026-10-09）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 触发：`node scripts/fix-churn.mjs src/ui/app-shell/shell/ShellAgentHost.tsx` 命中——文件近 14 天 3 个 fix、本刀第 4 个；目录 `src/ui/app-shell/shell/` 第 5 个。
> 说明：这四个 fix 全在 #1136 这条还没合入 main 的分支上（文件本身就是本 PR 的 `f59b38d80` 新建的），分别是：静态门岗补洞 `aed983058`、
> 左栏网格 `dd6ec9a17`、评审阻断 1 的 portal 重挂 `fa68dc032`、本刀。前三个不是同一类问题，本刀是新的一类。仍按规则走一遍复盘，
> 结论交协调会话 / 用户拍板；本刀的修法单独一个提交（`fix(shell): 重开项目时小球形态的 Agent 不再自己弹成浮窗`），不同意可整提交丢掉。

## 0. 一句话根因

把一个**派生投影的翻转**当成了**一次事件**：`projectAgentDockCollapsed` 是 `editingPanelLayout.visibility.assistant` 的投影，关项目重置、开项目还原都会翻它，
订阅它的外壳小球却把「收起→展开」读成「有人叫回 Nomi」，于是用户什么也没点，Agent 自己弹成浮窗。

## 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 评测 j5 重开项目后 composer / 生成钮点不中（本刀） | `ShellAgentHost` 订阅 `projectAgentDockCollapsed` 的翻转；`releaseProject` 直接 setState 重置成 false、`restoreWorkbenchProjectPayload` 用 `setEditingPanelLayout(…, false)` 还原成可见，两者都让它 true→false | 派生投影当事件 |
| `fa68dc032` 三形态切换重挂面板 | 面板挂在随形态换的 DOM 位置，换位置 = 卸载重挂 | 状态住在会被搬家的容器里 |
| `aed983058` / `dd6ec9a17` | 门岗、布局网格补洞 | 与本类无关 |

## 2. 为什么这一类会一直出现

「Agent 占不占位」同时有两份表示：外壳形态（`agentFormStore`，应用级偏好）和 `visibility.assistant`（随项目落盘的旧字段，Agent 的 `layout.read/write`
契约还在读写它）。设计卡把形态定为唯一写入者、旧字段降为投影，但**反向的「别处叫回面板」**没有自己的信号，只能借投影的翻转偷渡——
而投影的翻转来源不只有「叫回」（还有重置、还原、undo）。表示层没有「事件」这个东西，所以每多一个写入口，就多一种误触发。

铁律归属：⑫ 点了=以为的（用户没点，界面自己动了）。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 切换项目 / 撤销布局 / 预设切换时，小球形态的 Agent 再次自己弹开 | 本刀的走查断言「回项目库再重开，小球仍是小球」；`agentDockPersistence.test.ts` 的「叫回计数」三条 |
| 有人新增一个写 `visibility.assistant` 的入口却没想到要计数 | 新入口必须经 slice 的 action（`recallIfReopened`）；绕过 slice 直接 setState 的不计数（重置就靠这点） |

## 4. 靶子独立性检查

- 评测 j5 是 2026-09 的老旅程，不是外壳线写的；它红在「控件被盖住」这个用户可见后果上，靶子没错。
- 无「修对了反而掉分」的先例。

## 5. P0：这些是我们独有的吗？现成方案有哪些

「叫回 Nomi」是外壳与 Agent 契约之间的领域信号（任务中心定位到制作、Agent 自己的 layout.write 要把面板叫出来），不是通用能力，没有现成库。
状态管理用的就是现成的 zustand（`subscribeWithSelector` 订阅计数字段），没有自写订阅机制。自写登记无命中。

## 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 无（见 §5） | — | — | — |
| 补（本刀） | slice 里加单调计数 `agentRecallNonce`，只在「用户 / Agent 动作把 Nomi 栏从收起翻成展开」时 +1；外壳订阅计数；还原 / 重置不计 | 1 个字段 + 4 处 action + 单测 | 新增写入口漏计数（有 §3 的单测与走查守） | 推荐：改动最小，且让「事件」第一次有了自己的表示 |
| 重写 | 删掉 `visibility.assistant` 旧字段，让 Agent 的 `layout.read/write` 直接读写形态 store | 动 Agent 契约与落盘格式，要迁移老项目 | 大 | 以后做，不在本 PR |
| 删 | 删掉「别处叫回面板」这条订阅 | 任务中心「定位到制作」、Agent layout.write 失去叫出面板的能力 | 丢功能（违反「原有功能一个不少」） | 否 |

## 7. 用户要权衡的核心

现在只是给「叫回」补了一个独立信号；要不要进一步把 Agent 契约里的 `visibility.assistant` 彻底并进形态 store（消灭双表示），是另一个更大的 PR。

## 特征测试清单

- `src/workbench/preview/agentDockPersistence.test.ts`：新增「叫回 Nomi 的计数」三条（动作计、还原不计、重置不计）；原有开合偏好四条不动。
- `tests/ux/shell-redesign.walk.mjs`：新增「回项目库再重开，小球仍是小球、面板没自己弹开」真实路径断言。
- 评测旅程 `evals/journeys/j5-edit-export.mjs`（CI 的 `test:journeys`）：重开项目后 composer 与生成钮同时可点。
