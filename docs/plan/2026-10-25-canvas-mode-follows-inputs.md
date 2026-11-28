# 设计卡：画布生成方式跟着输入

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：画布生成方式跟着输入  线/负责人：fix/canvas-mode-follows-inputs  类别：其他（纠正已有状态规则）

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [x] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [ ] 新增功能 / 性能

| 格 | 结论 | 证据 |
|---|---|---|
| ★0 先查别人 | React 官方《You Might Not Need an Effect》· 派生状态应在已有 state/props 上计算，事件触发的写入放在事件/共享写口，避免 effect 造成一次旧渲染再补写 · **确认**删除生成框 effect，把模式纠偏放进画布 store 写口；ComfyUI 官方节点文档 · 连接和断开都是图结构操作，断开输入后连接本身立即消失 · **确认**断线必须在同一次图写入后立即重算目标模式，不依赖面板挂载；Blender 官方节点编辑文档 · 断开 socket 等同于删除 link，未连接的 socket 会重新显示可编辑输入 · **确认**我们的 invariant 以活边/输入为准，断线后回到可用的文字模式；React `useEffect` 官方参考 · effect 是同步外部系统的逃生口，不应用来编排应用数据流 · **确认**不保留一个仅为同步画布数据的 React effect。 | https://react.dev/learn/you-might-not-need-an-effect · https://react.dev/reference/react/useEffect · https://github.com/Comfy-Org/docs/blob/main/basic-concepts/nodes.mdx · https://docs.blender.org/manual/en/latest/interface/controls/nodes/editing.html |
| ★1 用户怎么用 | 当创作者在画布上把最后一条参考线断开、删除参考源、让 Agent 删除/改掉参考或撤销/重做这些动作时，我想让生成方式立刻与当前输入一致，以便提交前检查和生成框收起时看到同一个状态。路径：①节点已在参考/改图方式；②断开最后参考线或删源；③不打开生成框也读取节点；④确认 modeId 立即回到文生；⑤重新连参考；⑥确认立即升格；⑦撤销一次同时恢复边与 mode。真实任务：参考图→图片改图；角色图/视频→视频参考；导演台退出预演参考。主指标：目标“输入变化后模式一致”→信号“store 写完成后的 modeId 与输入推导相等”→指标“相关类测试通过比例 100%”；质量指标同一；护栏指标“单次撤销不留边/模式中间态”→信号 undo 后快照→指标 100%。量具：`src/workbench/generationCanvas/store/canvasModeFollowsInputs.test.ts`、`tests/ux/group-reference-direction.walk.mjs`、`tests/ux/director-reference-attach.walk.mjs`；中英走查截图逐张人工核对。已知坑：没有可用模型或真实媒体时记录 `unverified`，不以 mock 绿灯代替。 | 测试与走查脚本；截图路径见交付报告 |
| ★1b 连带界面 | 生成框只读 store 中的 modeId；画布收起时不显示滞后模式。走查中英文各记录“断线后模式/重连后模式/撤销后模式”的预期与实际；没有新增文案。 | `check:i18n`；走查报告 |
| ★2 谁说了算 | 概念“画布生成方式跟随输入”由两个明确写口共同负责：`deriveTargetAfterConnect` 内的 `promoteTargetMode` 只处理连线手势升格；generation canvas store 写入订阅只调用 `revertTargetModeForEmptyInputs`，处理参考全空时回文生。消费者：生成框只读、提交咽喉只读兜底、付费卡不改。状态只存 `node.meta.archetype.modeId` 一份；输入事实来自 `nodes + edges + reference slots`，不靠“面板消失”猜意图。 | `node scripts/door-map.mjs promoteTargetMode`；`node scripts/door-map.mjs revertTargetModeForEmptyInputs` |
| ★3 一致与复用 | 复用 `resolveTargetModeForEdge`、`textModeToReturnTo`、`applyArchetypeModeSwitch`、`resolveReferenceSlots` 和现有 store undo/event 写口；升格只留在连线手势，store 订阅只做空输入回文生，不新增第二套模型/槽位判据。 | `git grep`；`pnpm run check:self-written` |
| ★4 全状态 | 空：节点显示当前可用的文生方式；加载：读取快照后 store 写口立即收敛；成功：参考存在时显示能消费它的模式，参考移除时显示文生；失败：无法找到可消费模式时保留原模式并让提交现有能力门说明原因；部分成功：多条输入只被部分模式接收时按现有 `resolveModeForConnectedReferences` 的最多需求规则；取消中：撤销/重做作为一次图写入，边和模式一起回退/前进；过期：旧快照加载后同一写口重算；能力不可用：无模型档案时保留原状态，下一步由现有模型选择/提交提示处理。无新增文案，沿用现有中英文 i18n。 | 相关单测；`check:i18n` |
| ★9 验收与回滚 | 验收清单：A 断开最后参考边且生成框未挂载→立即文生；B 删除参考源→目标立即文生；C Agent 改掉参考→目标立即文生；D 重新连图/视频参考→立即升格；E 撤销一次同时恢复边与 mode；F 重做同时移除边并回文生；G 导演台删除预演参考仍按文生出；H 中英文各跑同一链路并逐张读截图；反例：只保留 effect、删除 store 写口调用、文本 prompt 边、首尾帧空槽、无档案模型、多个输入只剩一条。类回归测试覆盖 A–F，走查覆盖 G–H。回滚：revert 本 PR 的实现提交；设计卡和根因合同保留。独立验收：验收线：待派。未验证项：无真实付费，不花钱；真实外部模型资源若环境不可用记 `unverified`。 | `canvasModeFollowsInputs.test.ts`；两条 `tests/ux` 走查；独立验收报告 |

### 结构决定
模式纠偏按写入边界分开：连线手势在边落地后由 `promoteTargetMode` 升格；所有 store/document 写入完成后，订阅只在参考全空时由 `revertTargetModeForEmptyInputs` 回文生；生成框不再写状态。

### 拍板图清单：链接
不适用：这是已有逻辑的状态归属修复，没有新增或重排界面。
