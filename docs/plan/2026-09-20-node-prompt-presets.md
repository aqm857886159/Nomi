# 节点预设恢复

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：实施中。用户要求恢复提示词库预设，选择体验对齐现有 Skill。

## 原因与范围

981858b719（09-09）把旧提示词 picker 替换为 NodeEffectChips，公共库被限制为 curated effect；2a3b6d05a（09-11）又把入口压成 sparkle。普通提示词失去入口，文字列表也失去了预览。恢复 image/video 节点可用的完整公共库与我的库，预设用 IconFileText，与优化语义区分。保留 28px 工具区、追加/撤销/参考图逻辑及确认面板不显示写作工具的既有规则。

## 先查别人

- `src/workbench/ai/v4/AgentPanelV4Composer.tsx:421`：用户指定的近邻 Skill 弹层，有搜索、分类、分组、缩略图和 hover 预览。提取同一 LibraryPicker 内容组件，让两处共用，避免平行样式。
- `src/design/AnchoredPopover.tsx:8`：已有富内容浮层负责 portal、避让、Esc 与外点关闭；直接使用，不添加第三方框架或手写定位。
- `src/workbench/api/promptLibraryApi.ts:162`：filterPrompts 已处理双语标题、正文、标签搜索；复用搜索，不另造匹配协议。
- `src/workbench/library/LibraryGroup.tsx:5`：原生 details/summary 折叠规则共用；有搜索时展开命中项，避免用户搜到却看不到。

通用能力采购结论：本仓已有全部能力，本次仅提取成熟界面，不买/造另一套选择器。未接入新框架层或外部格式。

## 实施与边界

1. 先写回归，证明普通公共图片/视频提示词及精选适用类型可选，搜索对齐库；IPC 读取失败必须显式抛出，不能伪装空库。
2. 提取 LibraryPicker，V4SkillPopover 保留宿主控制/管理入口/既有锚点。节点使用相同内容组件，分类为全部/效果/公共库/我的库，打开时刷新我的库，带加载、空态、失败重试。
3. 不新增执行器、存储格式、供应商条件或生成请求；不把节点预设变成 Agent Skill 执行。
4. 真机通过 UI 建提示词、建 image/video 节点、搜索选择、检查追加与撤销、重新打开可见新条目；检查键盘/关闭/视口可达，zh/en、light/dark 截图。

## 六角色审视

- CTO：共享选择壳、各宿主保留数据与执行所有权，无新运行时。
- 设计：用户指定 Skill 模式是样式基准；遵循既定工具区大小与图标词典。
- PM：恢复已有任务；不扩展为全量 Skill 配置或生成服务。
- 前端：复用 portal 和搜索；刷新在显式打开动作执行，避免不稳定 reload 导致循环请求。
- 后端：IPC 失败与成功空库区分；不改写提示词数据或请求协议。
- 用户：找到预设、预览、选中即用、可撤销；我的新建项重开即出现。

独立反方评审：preset_review，六角色均通过共享选择壳方案。提出的三项风险已处理：reload 在打开动作执行、不吞 IPC ok:false、精选按 appliesTo 而非单值 promptType（electron/promptLibrary/curatedPrompts.ts:10 的投影会取首种媒介）。保留 Agent 数据锚点和节点追加/撤销/参考图路径。反方不接受只松开过滤却保留无搜索文字菜单，也不接受节点直接 import Agent 专属弹层；本方案提取公共内容组件。

## 验收与回滚

小 UI 恢复并沿用用户指定的现有样式，按 docs/lessons/mockup-approval-gates-only-big-ui.md 直接实现，交付真实截图，不需要额外拍板。回归红绿、根因合同、风险分层 gates、真实任务走查、整分支 Ponytail、PR 交付。回滚使用 PR revert，不改用户数据。未合并前不标已解决。

## 实测证据

- `tests/ux/node-prompt-presets.walk.mjs --before`：真实旧构建只有文字效果菜单，普通公共条目不可选。
- 新版真实 UI 建项目/节点、公共预设搜索和插入、无匹配空态、追加/撤销、个人图片与视频预设新建和立即调用、跨类型排除、Escape/外点、浮层可达、Agent Skill 搜索/预览/引用均通过。
- zh/en × light/dark 实际设置切换后截图；效果预览图片实际解码 naturalWidth > 0；无图个人预设用 FileText 占位。
- [截图与旅程记录](../design/verification/2026-09-20-node-prompt-presets/)；主代理亲眼查看旧菜单、公共搜索、效果带图预览、个人库、英文暗色、Agent 共享选择器。
- 11 个专门回归单测通过；读取失败用真实 IPC 返回形状 `ok:false` 做 API 回归（修改前返回空数组而失败，修改后抛错通过）。没有付费生成；真实网络故障重试未注入。
