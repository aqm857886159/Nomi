# 撤掉节点锁（短版设计卡）

## 先查别人
- `src/workbench/generationCanvas/nodes/NodeLockBadge.tsx:1-2`、`generationCanvasTypes.ts:190-193`：这个锁是 2026-06 为防助手误改加的软门，只有创作者手点才会锁。
- `src/workbench/generationCanvas/runner` 生成路径不读 `locked`：锁只拦助手改提示词、删除、接线，生成从来不看（`applyCanvasToolCall.ts:700` 是唯一的拦截）。
- `src/workbench/creation/storyboard/exec/storyboardRowActions.ts:322-327`：分镜里的「锁定」读写的是 `meta.frozen`（定妆），与 `node.locked` 是两套，本次不动。
- 2026-11-17 用户决定：删掉节点锁，不再留「基于错误防守」的东西。

## ★1 要保住的结果与量具
- 创作者不用再学「锁」；助手改节点只走批准那一条路。量具：结构检查（浮条无 `data-node-lock`、store 无 `setNodeLocked`、读画布结果无 `locked`），单测，真窗口截图。
- 未验证：缺量具——「助手误改的次数会不会变多」，没有这类线上数据（使用数据里没有这个按钮，反馈里与锁有关的失败 0 条）。

## ★1c 老用户
1. 旧项目里 `locked:true`：读盘规整（`canvasSnapshotNormalizer.ts` 的 `normalizeStoreSnapshot`）丢掉，普通节点，不弹提示。
2. 旧事件 `canvas.node.locked/unlocked`：重放落 default，静默跳过。
3. 助手记忆里 `lock:*` 约束：`projectMemory.ts` 读盘时，文字与系统模板逐字相同的清掉；创作者改过的文字保留，脱钩成普通约束（id 改 `note:*`）。各一条测试。
4. 退回上一版：旧版读没有 `locked` 的节点当未锁。

未验证：没有真实旧数据（`tests/fixtures/old-user-data` 里没有带锁节点的旧项目），上面几条用旧版节点形状造的样本测，不是真实旧项目。

## ★2 方案与删掉的
沿原方向（继续保留锁，补拦截）被用户否决；换做法（让助手自己找对节点）已由别的线做；本卡 = 删。同提交删：按钮、字段、动作、事件、拦截、只读分支、记忆约束、读出口字段、词条、实验室格子、只为锁的测试。

## ★3 边界
不动：3D 导演台物体锁、白板图层锁、分镜定妆的行为（meta.frozen）、「出过图不重做」规则。
分镜里原来写「锁定」的文字（镜头行与参考卡两侧）给创作者看的词和图标一律保持主分支原样；分镜的叫法与图标等「出过图的默认要不要重做」定了再整体看（协调会话 11-17 拍板）。仅内部键名改 frozen 系，处理函数 `toggleNodeLock` → `toggleNodeFrozen`（它读写的是 `meta.frozen`）。内部状态值 `locked`（`SHOT_ROW_STATUSES`）不改。

## ★4 影响面
助手可见合同变化：读画布的节点没有 `locked`、读画布文字没有「已锁定」、写 / 删证据没有 `locked`、`delete_from_canvas` 的描述少了「locked nodes … are rejected」、没有 `node_locked` 拒绝、记忆不再产生「已被用户锁定」约束。`check:model-face-frozen` 基线一行变（用官方命令重算）。未验证：缺量具（评测里没有点名改节点的用例）。拍板图 `keep.host.locked` 等标撤掉。

## ★9 验收与反例
- 浮条上没有锁按钮（中英）；旧锁住节点提示词可编辑；助手改旧锁住节点不被拦；读画布结果无 `locked`；带 `locked:true` 的旧节点不显示成锁定、照常进分镜批量（反向测试），`meta.frozen` 的行为不变（一条测试）；导演台物体锁与白板图层锁照常。
- 反例（改坏必红）：恢复按钮、恢复字段写入、恢复拦截、读出口再带 `locked`、词条回来——各一条结构检查或测试。再加一条 eslint 禁令（`node-lock-removed`）：产品源码里写 `setNodeLocked` / `NodeLockBadge` / `canvas.node.(un)locked` / `node_locked` 即红，已用探针文件验过会红。拦不住：换个名字重做一把锁，靠 `GenerationCanvasNode` 类型里没有 `locked` 字段（`node.locked` 编译不过）和评审。
