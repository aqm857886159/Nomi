# PR #696：首次成功旅程节点定位修复

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：本地验收通过，交付 PR #696 · 2026-09-10

## 范围与证据

用户指定保留当前分支、PR #696，只修 CI-safe journey composer 不可见。实际失败是 j3-first-success，而非需模型的 j1-promo。1280×933 本地原样复现 `locator.waitFor: Timeout 8000ms`；截图在 `evals/runs/2026-09-09-21-27-journeys-ci/screenshots/j3-first-success-t1-error.png`：选中的是拆解表，镜头与角色节点仍存在。

## 先查别人

`evals/journeys/j3-first-success.mjs` inspect-node 用任意 `.generation-canvas-v2-node.first()`，把展示顺序当成有生成参数的节点身份。`src/workbench/onboarding/journeyTourStore.ts` 通过 setStoryboardPlan 建表，然后 create_canvas_nodes 创建镜头，表先出现合法。`BaseGenerationNode.tsx` 已提供 data-kind 与 data-node-id；生成 composer 仅生成类节点单选挂载。复用现有语义锚点，无需新增 DOM 属性、依赖或生产逻辑。

- 现有 DOM 身份边界：`src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:281` 提供 data-node-id、data-kind；复用它定位。
- 现有引导生产者：`src/workbench/onboarding/journeyTourStore.ts:96` 先 setStoryboardPlan 再创建镜头，表先出现是合法顺序。
- 现有稳定旅程：`evals/journeys/j5-edit-export.mjs:201` 用 NODE_ID 点指定镜头，无需修改。

同类扫描：guided-canvas 的 first 仅检查画布存在，不承诺参数，不受影响；j5-edit-export 通过固定 NODE_ID 定位镜头；j3 inspect-node 需明确 video kind。属于 recurring 测试目标身份漂移，修复边界是该旅程选择交互对象的位置。生产数据 owner 与投影不变。独立探针将记录真实 DOM，验证同屏 video 点击后原参数断言通过。

## 实施、回滚与验收

只将 inspect-node 点击对象限定到现有 video 语义锚点；保留所有断言及 8000ms 超时。回滚此定位修改即可。先红后绿真实 Electron 旅程是回归证据，非新增镜像单测。两条 CI-safe 旅程全过，完整 `python3 scripts/with-gates-lock.py -- pnpm run gates` exit 0，经过提交/推送 hooks 推送原分支。更新 SIDEBAR-LAST.md 并复制至指定 scratchpad。

## 现场与验证结果

合入 main 后重新安装锁文件依赖并成功 build。新构建独立 DOM 探针重现同一 8000ms 超时：节点顺序为 shot_table → character ×2 → scene → video ×8，落盘数据也保留各镜头。表节点合法存在，没有替代镜头。首次探针选择 image 未找到节点，现场证据修正为 video；最终定位直接使用 video，不含回退路径。

修复后原命令 `node scripts/eval-journey.mjs --ci` exit 0，pass@1 2/2、infra errors 0、tokens 0。报告 `evals/runs/2026-09-09-21-35-journeys-ci/report.md`；前后截图分别为 red run 的 `j3-first-success-t1-error.png` 与 green run 的 `j3-first-success-t1-inspect-node.png`，均 1280×933，已人眼检查。j5 的修改、重开持久化、最小窗口 composer 几何和真实 MP4 导出均通过。首次基线运行的 j5 窗口关闭不作为产品回归证据；最终完整运行已通过。

本次仅修改旅程定位，不修改生产路径，因此不新增生产根因 JSON 合同。无需依赖升级或数据迁移；失效的无类型点击定位原位替换，无并行路径。Linux CI 执行留待推送后的 PR 检查，本地证据来自 macOS Electron。

完整 gates 最终 exit 0：76 项合同门岗中 73 通过、0 阻断、3 非阻断文档 advisory；Vitest 1315 文件通过、1 跳过，11993 条测试通过、2 跳过；Agent runtime、stats 与 renderer/Electron build 通过并生成五门戳。命令 `python3 scripts/with-gates-lock.py -- pnpm run gates`，完整日志 `/private/tmp/sidebar-cifix-gates-final.log`。第一轮仅本文标题格式触发 prior-art 门岗，修正文档后第二轮完整通过。

推送前整合最新 main `447e48949`（PR #697 创作区列布局），无冲突。合并提交 `9d7c71c23e2c` 上再次完整 gates exit 0：73 blocking contracts 通过、0 阻断、3 advisory，Vitest 1316 文件/11996 条通过、2 条跳过，runtime/stats/build 通过。最终日志 `/private/tmp/sidebar-cifix-gates-merged.log`。新构建再次执行两条 CI-safe 旅程 exit 0、2/2、infra 0、tokens 0，报告 `evals/runs/2026-09-09-22-25-journeys-ci/report.md`。
