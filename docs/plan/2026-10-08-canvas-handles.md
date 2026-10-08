# 设计卡：画布左右拉环 / 拉环菜单 / 空节点「试试」

改动名：canvas-handles　　线：I-handles（实现）　　类别：[新界面]

- 用户原话（10-08）：「左边是添加上下文，右边是引用该节点输出；有时候拉环只有一侧，意味着它是一个视频或者图片了，只能引用该节点输出了。」
- 拍板（10-08 晚，Design 画布，三条都选推荐）：① 拉环只出现在用得上的一侧；② 左右两个菜单讲两件事（右「用这个节点生成」、左「给它加输入」）；③ 空节点「试试」替换那一句操作说明，空画布一排任务卡。
- 样张：设计实验室屏 `canvas-handles`（`src/devlab/designLab/canvasHandles/`，本 PR 起它渲染的是生产组件）。
- 方向检查：`docs/engineering/direction-check/2026-10-08-canvas-handles.md`；根因合同：`docs/fixes/2026-10-08-canvas-node-input-owner.root-cause.json`。

## 九格

- ★1 用户怎么用：当我在画布上看到一张卡，我想一眼知道它能接什么、能拿去生成什么，以便少试错、少读说明。步骤：选中卡 → 看到只在用得上的一侧有「+」→ 点一下「+」（不用拖）→ 右边出「用这个节点生成」、左边出「给它加输入」→ 选一类 → 得到连好线的空节点，或从素材库挑一张、或进点选模式在画布上点一张已有的。真实任务：①新手建空视频卡，点「首帧生视频」，得到一张连好首帧的空图片卡、视频切到首帧模式、光标在提示词里；②老手选中一张出好的图，点右「+」→ 视频，得到连好的视频卡；③给视频卡点左「+」→ 在画布上点选，点中已有角色图作参考。不做：生成、花钱、双击新入口、新节点种类。已知坑：老项目里已连进素材 / 文本卡的旧线（照常显示、可断开，不再能新建）。主指标：新建节点后 60 秒内建立第一条连线的比例；质量：左菜单「能选」的项点了 100% 连得上；护栏：连反方向 / 无意义边新建数 = 0。证据：`tests/ux/canvas-handle-menus.walk.mjs`。
- ★2 谁说了算：「这一类节点收不收输入、有没有可引用产出」→ 唯一 owner = 节点种类定义 `src/workbench/generationCanvas/nodes/registry.ts` 的 `connects` 字段（类型必填）；读它的：拉环（`generationCanvasReactFlowVisualContract.ts`）、左判据 `connectionCreateVerdictsForTarget`（与右判据同在 `agent/referenceEdgeCapability.ts`、同一套原因文案）、连线总闸 `validateReferenceEdge`、「试试」配方（`quickActions/nodeTryRecipes.ts`）。点选模式状态 → `store/canvasPickMode.ts` 一份。同一事实存 1 份；不靠「东西不见了」猜意图。证据：`node scripts/door-map.mjs validateReferenceEdge`（6 扇门，全部经同一函数）。
- ★3 一致与复用：两侧菜单同一个 `WorkbenchMenu` 原语、同一个组件 `quickActions/NodeDeriveMenu.tsx`（按 side 出两套项）、同一套置灰 + 第二行原因；「从素材库添加…」复用 `AssetPicker` / `AssetPickerPopover` 与素材库拖到画布那条建卡函数；「试试」一个列表组件 `quickActions/NodeTryList.tsx` 所有种类共用；空画布任务卡 = `canvasToolbarModel.canvasResidentAddIntents`（同左缘工具条一张意图表，含用户的显隐 / 排序偏好），执行走工具条同一个动作钩子。没有第二份种类表（样张里的 `RECEIVES_WITHOUT_ARCHETYPE` 已并进种类定义）。
- ★4 全状态：未选中 = 只在存在的一侧有小圆点；唯一选中 = 那一侧「+」圈；多选 = 全体小圆点；起线中 = 起点小圆点；右菜单 / 左菜单（接不进来的灰掉 + 第二行原因：「没有能接收视频的图片模型」「当前模型不收视频」「剪辑节点不收文字」）；素材选择器（按目标收得下的种类过滤）；点选模式（变暗、可点的描边、悬停加粗、其余变灰含本卡、顶部「选择要引用的节点 · Esc」）；空节点「试试」（图片 / 视频 / 文本；剪辑「把视频节点连进来」+「在画布上点选」）；空画布任务卡；能力不可用 = 没有模型能收某类 → 那一项灰掉 + 原因，下一步是左菜单里其余可选项或「在画布上点选」，与生成框里现有「没有可用模型 · 去配置」同屏。zh / en 全量，文案不谈钱（`check:i18n`）。
- 5 中途表：菜单开着时 Esc / 点外面 → 关菜单、不建节点、取消那条未落地的线；选一项 → 建节点 + 连线 + 模式切换是一步撤销；「试试」点完立刻 Ctrl+Z → 一步撤掉整组新建；点选模式中 Esc / 点空白 → 回原状、不建边；点选模式中点了不可点的卡 → 不选它、不退出；点选模式中切走项目 / 关窗 → 模式随画布卸载消失、不建边；素材选择器上传中关掉 → 走现有导入那条（文件已导入的留成素材卡，不连线）。全部不花钱：不派发、不签额度。
- 6 外部数据与失败：不调外部服务；判据只读本地模型档案（`electron/shared/modelArchetypes`）与种类定义；素材选择器读项目素材池（`useAssetPool`），读失败时选择器自己的空态。不适用其余。
- 7 性能预算：拉环只多读一次种类定义（常量表查找），不新增每帧计算；点选模式每张卡多一个 zustand 选择器（未进入点选时返回常量 null，不重渲）。实测：`pnpm run test:canvas:performance` 未在本线跑（Windows 上门岗链走不完，见交付报告 unverified）；200 节点下用设计实验室真 React Flow 截图观察无掉帧，记 unverified。
- 8 真实条件：Windows ✓（本机真 Electron 离屏窗口）；中文 ✓ / 英文 ✓；亮 ✓ / 暗 ✓（一张）；最小窗口 unverified；真规模 unverified；干净安装 不适用；真付费 不适用（不花钱）；键盘全程：Esc 关菜单 / 退点选 ✓，Tab 进菜单走 Radix 现有行为。
- ★9 验收与回滚：独立验收线按 ★1 三条真实任务真窗口走一遍 + 变异（把左判据改回以源计算 → `connectionCreateVerdictsForTarget` 测试与走查必红）；硬门 ⑫ 对账：左菜单「能选」= 点了真连上（走查断言边方向 + 模式）。回滚：revert 本 PR 的实现提交（数据结构无迁移，旧边一直可加载）。独立验收报告：待协调会话派线（不得与 I-handles 同线）。

### 功能分类
- [x] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [x] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
