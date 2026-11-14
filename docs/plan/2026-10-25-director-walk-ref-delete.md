# 导演台参考真删除与退出预演（第 4 轮）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：导演台删掉预演参考 = 这一镜退出这份预演
线/负责人：`fix/director-walk-ref-delete` / Codex
类别：[花钱][其他]

## ★0 先查别人

- [组件实例脱离官方帮助](https://help.figma.com/hc/en-us/articles/360038665754-Detach-an-instance-from-the-component) · 显式执行 detach 后对象保留当前内容、移除与原组件的链接，之后不再接收原组件变化 · **确认了**删掉预演参考应写成显式“退出”事实，后续模型对账不能把同一份预演自动加回来。
- [模板文档官方帮助](https://helpx.adobe.com/no/dreamweaver/using/dreamweaver-templates.html) · 模板文档保持连接时可被模板更新，用户可通过断开连接让文档脱离模板；可编辑区域的用户修改不应被锁定区域的模板更新覆盖 · **改了**本轮的边界：新网址代表新预演，旧网址的退出只绑定旧网址；重新挂接是明确的“恢复连接”动作。
- [内容包更新官方参考](https://helpx.adobe.com/pdf/incopy_reference.pdf) · 更新包默认只追加新内容，已有内容是否覆盖由用户选择，保留既有编辑 · **确认了**对账器只能在模型身份变化这类系统事件下运行，不能用参考列表或提示词差异猜用户意图，也不能覆盖用户删除。
- [删除与撤销可用性指南](https://m1.material.io/usability/accessibility.html) · 破坏性删除应有可见确认或可撤销反馈，能用撤销恢复就应保留清晰的恢复路径 · **确认了**删除必须在同一 `updateNode` 中写入可撤销的退出事实；Cmd+Z 要同时恢复参考、提示词和退出状态。

## ★1 用户怎么用

当创作者在镜头 B 的参考条上点掉唯一的 3D-BOX 预演参考时，我想让这一镜立即回到普通文生状态并继续生成，以便“删掉”真的表示这一镜不用这份预演；若想恢复，再从导演台点“出成片”。

1. 在导演台生成并挂上镜头 B 的预演。
2. 在节点参考条用真实鼠标点这份预演参考的 ×。
3. 等待 1.5 秒，确认参考为空、方式回到文生、提示词没有 `@` 和运镜句、生成钮可点且没有花钱闸原因。
4. 点 ↑ 进入确认框，确认请求没有参考视频和运镜句。
5. 换模型“有槽 → 无槽 → 有槽”，确认不自动挂回、不写 `3D-BOX 预演运镜：`。
6. 回导演台点“出成片”，确认同一份预演重新挂回，之后换模型仍按既有规则重挂。
7. Cmd+Z 撤销后确认参考、@、运镜句和退出事实一起恢复。

真实任务：唯一预演参考、同时含用户视频的预演参考、首尾帧方式下淡显“未用到”的预演参考。主指标：删除后仍能完成生成的比例 → `director-reference-attach.walk.mjs` B/B2 请求断言 → 中英文 A/B/B2/C/D 全通过；质量指标：参考数组、边、@、运镜句与退出事实一致 → focused Vitest + 走查截图；护栏指标：付费脚本调用数为 0、真实资料目录未改 → 命令记录与隔离资料路径。基线：第 3 轮 B 删除后生成被错误挡住；目标：删除后 1.5 秒内生成钮可点、花钱闸为空。量具：Vitest、`tests/ux/director-reference-attach.walk.mjs`、截图目录、`git diff --check`。

### 功能分类

- [ ] 新界面 / 改交互
- [x] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [x] 大数据量 / 画布 / 长列表
- [x] 生成效果
- [ ] 数据格式
- [x] 新增功能 / 性能

## ★1b 连带界面

节点生成钮悬停、runner 生成错误卡和 Agent `directorPreviewBlocksForOperation` 必须共用 `directorPreviewSpendBlockMessageKey`。新增的“预演未挂上”原因提供中英文文案，按钮名复用词典已有 `produce` 文案；渲染中、失败、超长三种旧原因和文案不改。

## ★2 谁说了算

概念 `director.preview.reference-delete` 的唯一 owner 是导演台模块导出的预演参考生命周期函数（写入退出、读取退出、显式挂接清除退出）；通用删除 owner `referenceWrites.removeFromArray` 与 `removeUnusedReference` 只把被删 URL 交给该函数，不写导演台句子或正则。视频节点存一份按 URL 绑定的退出事实（例如 `directorPreviewDismissedUrl`）；导演节点仍存 `preview.targetNodeId`、`preview.videoUrl`、状态和修订，二者不是重复事实：前者是用户意图，后者是预演产物/目标。提示词运镜句和参考数组是派生载荷，不是意图存储。

只有显式删除事件写退出；不能从参考列表变短、提示词变化、模型切换或对账键变化猜退出。花钱闸、Agent 阻断器和预演挂接核通过同一读取函数判断；`prepareProduceFromPreview` 的显式挂接成功后清除退出。删除入口保留 `preview.targetNodeId`，让导演台可以直接恢复。

证据：`node scripts/door-map.mjs removeFromArray removeUnusedReference directorPreviewSpendBlock directorPreviewBlocksForOperation previewAttachReconciler prepareProduceFromPreview`；`git grep -n "referenceVideoUrls\|cameraMoveAttachedUrl\|targetNodeId\|removeUnusedReference" src tests`。

## ★3 一致与复用

复用 `attachCameraMoveToTarget.ts` 的 `withoutVideoDirective` / `withoutPreviewLines` 清理规则；复用 `attachCameraMoveForNode` 作为唯一显式挂接入口；删除写入经导演台导出的生命周期函数收口。节点、runner、Agent 只读取 `directorPreviewState` 的统一判据和文案键，不复制三元分支。检查：`git grep`、`node scripts/check-concept-owners.mjs`、`pnpm run check:i18n`。

## ★4 全状态

- 空：没有预演或预演已显式退出，节点没有预演参考，生成钮可点。
- 加载：预演渲染中，生成钮按既有渲染原因挡住，提示渲染完成后再生成。
- 成功：用户显式删除后，参考数组、@、运镜句在同一写入中清掉，退出 URL 写入，B3 回文生，花钱闸放行；从导演台重新“出成片”后清除退出并恢复挂接。
- 失败：渲染失败仍按既有失败原因挡住；删除写入或请求断言失败则走查退出并保留截图。
- 部分成功：同时有用户片和预演片时只删除预演对应 tile；用户片、顺序和 @ 保持。
- 取消中：删除是本地同步编辑，无异步取消态；预演渲染取消仍沿用现有状态机。
- 过期：旧预演 URL 的退出不影响新 URL；导演工程变更仍显示既有 stale。
- 能力不可用：没有可挂接参考槽时，显式挂接走既有文字兜底；没有导演台或上游不可用时沿用现有错误卡，下一步是重试预演或换支持参考的视频模型。文案走中英文 i18n。

## 5 中途表

本轮不改变生成/预演的异步事务，只新增本地删除事实：

| 状态 | 停止/关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|
| 删除已写入 | 撤销栈保留；不扣取；回执在节点状态 | 不依赖网络；不扣取 | 持久化后保留退出 URL | `updateNode` 原子写，重复删除无操作 |
| 预演渲染中 | 按既有渲染状态恢复；不触发生成 | 按既有失败/重试回执 | 按既有状态恢复 | 既有去重/看门狗生效 |
| 显式重新挂接 | 退出被清除并进入撤销栈 | 仍是本地准备，不提交生成 | 持久化后恢复挂接事实 | 既有 attach 核 noop 去重 |

## 6 外部数据与失败

不新增供应商或外部格式；预演 URL、导演节点 meta、视频节点 meta 和提示词都是 Nomi 内部状态。坏 URL / 缺字段按现有 `readDirectorPreview` 无效处理，花钱闸 fail-closed；生命周期字段缺失按“未退出”兼容旧数据，不猜测历史删除；提示词清理只复用现有标记句规则。证据：现有类型与 focused tests。

## 7 性能

不新增用户操作和数据规模；删除仍是一次 `updateNode`，显式读取只做字符串比较，预演对账仍按现有节点规模运行。最坏规模按当前画布 100 节点：删除到可见反馈 ≤100ms（p95 ≤150ms），对账不增加哈希或网络调用，长任务 0。性能场景不适用：本轮仅改变本地同步字段和已有判据，未新增功能；回归由走查 1.5 秒窗口和现有画布性能门覆盖。

## 8 真实条件

Mac 本机隔离资料目录，中英文两轨走查；真实素材 URL 由走查 fixture 提供，真实上游生成与付费未跑（任务书明确禁止）；截图逐张人工读取。Windows、真付费、干净安装未验证。

## ★9 验收与回滚

实现线自验与独立线只核下面清单：

1. 工作树、分支、基线正确且开工前干净；文档先单独提交，代码提交只含范围文件。
2. 唯一预演参考用真实鼠标点 ×，1.5 秒内参考空、B3 文生、无 @、无运镜句、生成钮可点、花钱闸为空。
3. ↑ 确认请求不带参考视频和运镜句。
4. 删除后换模型有槽→无槽→有槽，不挂回、不写 `3D-BOX 预演运镜：`。
5. 导演台点“出成片”重新挂回，退出清掉，后续换模型照旧重挂。
6. 首尾帧方式下淡显“未用到”预演参考的 × 也写退出并清理同样字段。
7. Cmd+Z 同步恢复参考、@、运镜句、退出事实和生成钮状态。
8. 导演台重渲新 URL 后旧退出不再命中；花钱闸显示新“预演还没挂上，先在导演台点出成片”原因，不显示 stale。
9. 从未挂过但预演就绪、指向镜头的节点显示同一新原因；真实 stale 仍只在工程改动后出现。
10. Agent 路径：已退出镜头不报 `not_referenced`；未退出且候选没带预演仍报。
11. 反例：删用户自己的参考不写退出；任何订阅者不比较前后列表猜意图；通用删除代码不含导演台句子/正则；不清 `preview.targetNodeId`；不为 B3 加特例；渲染中/失败/超长原因不变。
12. 所有删除入口（在用 ×、未用 ×、Agent/画布写入口）逐一有证据：显式用户删除走退出，系统写入不算用户删除且不写退出。

反例 → 结果 → 证据表在实现后附本文件末尾或交付报告；走查删除若真鼠标未命中，必须报失败，不能静默退到 DOM/onClick。回滚为 revert 本轮代码提交；保留设计卡、报告和独立验收证据。

花钱走查只跑免费演练；付费脚本产物必须包含本轮新增原因码或文案键后由协调抽样，当前报告写 `spend-paid-sample：未验证：协调付费抽样待跑`。

拍板图：不适用，本轮是逻辑修复和既有控件文案调整，不新增界面布局。

## 第 4 轮反例 → 结果 → 证据（实现后填写）

| 反例 | 结果 | 证据 |
|---|---|---|
| 删的是用户自己的参考，不是当前挂着的预演 | 不写 `directorPreviewDismissedUrl`，只清用户参考和对应 @ | `referenceWrites.director.test.ts` 的用户片反例；中英文走查 C 请求仍保留用户片 |
| 对账器 / 重渲写口靠参考列表变短猜用户退出 | 已退出镜头跳过自动挂回；新 URL 进入 `not_attached` | `directorPreviewState.test.ts`、`directorProduce.reference.test.ts` 新 URL 测试、B 中英文换模型断言 |
| 通用删除代码写导演台句子或正则 | 删除入口只调用导演台生命周期函数；运镜句清理复用导出函数 | `referenceWrites.ts` 与 `attachCameraMoveToTarget.ts` 导入关系、`git grep` |
| 清掉 `preview.targetNodeId` 或给 B3 加特例 | target 保留；B3 仍由方式派生回 t2v，退出字段独立存在 | `directorProduce.reference.test.ts`、B-node-after-delete 截图 |
| 把未挂接误报 stale 或改动渲染中/失败/超长原因 | 新增 `not_attached` 及中英文文案，旧三类保持原语义 | `directorPreviewState.test.ts`、`directorPreviewStatus.test.ts`、i18n 检查 |
| 删除后 Cmd+Z 只恢复部分字段 | 一次画布历史恢复参考、@、运镜句和退出事实 | 中英文走查 B 的真实 `Meta+z`；`referenceWrites.director.test.ts` 原子写断言 |
