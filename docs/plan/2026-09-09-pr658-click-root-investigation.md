# PR #658 点击超时：根因调查

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：历史调查记录。用户已于 2026-09-09 裁决，实施与验收见 `2026-09-09-pr658-neighbor-placement.md`；以下保留当时证据。调查分支 `feat/process-feedback-phases-20260908`，HEAD `d2ea66f8cc5a56e48f09ef430b16c806ff1009f7`。

## 已证实的事实

CI run 34252289801 测试 SHA 是 `614de8cbe28769690b86f662e5747d295ed39722`，不是当前 HEAD。原始日志每次（包括最后 58 次）都写 `element is visible, enabled and stable`，紧接着另一个 selected 节点的 `subtree intercepts pointer events`。截掉后半段会把命中遮挡误读成几何不稳定。

`canvas-batch-production.walk.mjs:410` 点击 `sourceId`；前面第 409 行选中了 `retryImageId`。源图已成功生成，此时不是生成中节点。本地对同一位置添加只读探针：每 250ms 采样一次，共 20 次；全部为 x=342.3999938964844、y=-113.63999938964844、width=340.0000305175781、height=280，status=success，animations=[]。

另由真实 UI 创建项目、创建图片节点、调用隔离回环供应商，保持生成中。20 次采样全部为 x=705、y=245、width=340、height=280；期间文案从“已等 20 秒”变到“已等 25 秒”。旧产品在这条采样上实际是绿，不能交“旧代码尺寸抖动先红后绿”。没有改生产尺寸、没有停止动画或冻结时钟。

## 症状 / 直接原因 / 类根因

- 症状：locator.click 超时。
- 直接原因：点击点被另一个选中节点的浮层内容拦截。不是 rect 不稳定，不是秒数字宽，不是扫光。
- 类根因候选：节点外 composer 的空间避让边界不包含相邻节点的可点击区域。`src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx:535` 外层为 absolute / z-8，按上下连接侧伸到节点外；`useComposerViewportPlacement.ts:211` 起的测量仅考虑 stage、浮动工具条与底部 dock，没有其他节点矩形。浮层覆盖附近媒体是现有浮层设计允许出现的结果，不能靠 tabular-nums 修复。若要保证节点任意点永不被浮层遮挡，需要明确交互或布局约束，不能靠给所有节点提高 z-index（会反过来挡住参数卡）。
- 分类：recurring。图片到图片（CI）与图片 composer 到生成中视频（本地真实页面）均可触发。

真实页面原走查在 `process-feedback-electron.e2e.mjs` 选择视频处复现同类阻挡：日志明确为 `generation-canvas-v2-node__composer-card ... subtree intercepts pointer events`。截图中参数卡盖住视频左上点击点；该视频本身 stable。

## 证据

均在 `process-feedback-evidence/ci-658-investigation/`：

- `ci-click-failure.txt`：原始 CI 点击日志（含稳定通过及遮挡原因）。
- `batch-source-rect.json`：CI 对应步骤、本地 20 次采样。
- `generating-image-rect.json`：生成中真实节点 20 次采样和同期秒数。
- `before-generating.png` / `before-saved.png`：本次真实页面现状。
- `composer-obstruction.png`：本次真实页面浮层遮挡失败现场。

## 布局需求冲突（已提问，尚未收到答复）

追加 1/2：全部标签放媒体上方固定高度行，媒体零覆盖；动作条在节点外上方。
追加 3：状态条固定在媒体内部左上，镜头号在其下或右上。
两者互斥。推荐采用追加 1/2，符合用户“媒体零覆盖”的明确目标。依 AGENTS.md“遇到样张/需求自相矛盾：停下上报，不许自己挑一条实现”，不擅自选其中之一。

## 范围与后续验收

本轮调查没有更改等待、超时、点击方式，也没有 force click、skip、重载或安装包。没有修改禁区。保留现有三处同句断言。布局裁决后需将 5 秒采样正式纳入真实页面，撤掉把实验室几何当真实页面保证的断言；对实际遮挡建立先红后绿检查，而不是编造几何红证据。随后再走根因 v3 合同、产品修复、四种选中/hover 截图、gates 和正常 commit/push。

开工已有 5 个未跟踪文件。delivery:preflight 报 dirty_worktree；远端 main 已是 HEAD 祖先，pull 为 Already up to date。调查期间 package.json / pnpm-lock.yaml 被其他执行者加入 img-fx；本轮未操作依赖文件。原 `real/` 跑图覆盖已恢复到本轮开始的 HEAD，新的调查截图另存，未更新任何设计实验室基线。

## 本地套件结果

原始未加诊断、未改等待/点击的 full shard 2/2：6/7；batch-production 通过。随后 critical：3/4。两组均卡在 `canvas-card-stack.walk.mjs:223` 的“2 版”按钮，日志是 `element is outside of the viewport`，非不稳定。收据为 `full-2of2-summary.json` 和 `critical-summary.json`。本地平台 macOS，不把本地通过称为 Linux 验证。

本轮没有修改生产代码，故没有运行交付 gates、提交或推送；未声称修复完成。

## 先查别人

本节补齐已有调查的来源索引。用户明确裁决为现有避让规则延伸、不需外部调研；没有新增框架或另造内核。

- 现有共享放置 owner：`src/workbench/generationCanvas/nodes/useComposerViewportPlacement.ts:34`；原调查已确认它只避让视口和 dock，本轮在此补入邻居矩形。
- 真实触发入口：`tests/ux/canvas-batch-production.walk.mjs:410`；重试后点击已成功的邻近节点，故不是生成中尺寸抖动。
- 同类入口与版本托盘：`tests/ux/canvas-card-stack.walk.mjs:170`；同一参数卡的矩形断言与原版本切换全链验收。
- 结论：沿用现有 composer；无需新增依赖、替换 React Flow 或另建浮层体系。依据 `src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx:535` 的真实宿主。
