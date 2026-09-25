# B1c-fix2：测试从源码加载

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：已实现，局部与真实旅程验证通过；完整 gates 与远端交付见 PR #646。

症状：#646 head 2632e87be 的 Unit / walkthrough contracts 找不到 dist-electron；resident bash denial 超时待独立验证。
根因分类 recurring：测试进程的模块依赖混入了可选的本机构建产物，使干净 checkout 与开发树执行不同模块图。

范围：复用 tests/ux/canvas-perf/waitingFxScenario.mjs:2 的 tsx/esm/api 源码加载模式；本机 Node 24 的 scoped tsImport 遇扩展名省略的 CJS 图会把 namespace 编入路径，实测同一 tsx 的公开 cjs/api scoped require 正常，采用它把测试进程的产物模块导入迁到源码；check:test-waits 加 AST 硬零规则和正反夹具。跨进程 app.evaluate 中读取被测应用自身模块与启动应用产物属于实际被测对象，不能用测试进程源码替代。
不动项：不加 CI build、不打包、不改等待时长；SWITCH 文件不提交。不修改 UI。

## 先查别人

- 仓库源码加载：`tests/ux/canvas-perf/waitingFxScenario.mjs:2` 已用 tsx；`tests/agent-runtime/lane-switch-prefix.test.mts:6` 直接引用 lane 源码。复用现有依赖，不写新 loader。
- 已安装依赖：`node_modules/tsx/dist/cjs/api/index.d.cts:17` 公开 scoped require；`node_modules/tsx/dist/esm/api/index.mjs:1` 是 tsImport 实现。实际试跑 cjs/api 可读 lane 混合 .ts/.mts 图，无产物单测 49/49。
- 已有宿主 admission：`electron/agentLane/laneHost.mts:345` 的 before_tool 已通过 block.reason 把 surface 拒绝回传模型；原生工具的 durable coding 权限由 `electron/agentLane/laneNativeAssembly.mts:39` 查询。复用此 owner，不改 SDK 或 shell classifier。
- 结构背景：[既有切换评审](../audit/2026-09-08-agent-lane-cutover-structure.md) 与 [本次顺序评审](../audit/2026-09-10-agent-lane-admission-order.md)。本次是内部接线纠正，不涉及生态选型、外部格式或面向创作者的新操作；未以自媒体材料替代源码证据。

## 验证与回滚
防线：测试文件静态 import/export、动态 import、require 直接模块声明均不得指向 dist/dist-electron；注释、示例字符串和第三方包内部 dist 不误报。
验收：新增门岗先在现有违规导入上报红；删除 dist-electron 后单测与 walkthrough contracts 通过。Electron 启动器 tests/ux/_launchApp.mjs:237 要求 app 编译产物，已向用户说明无产物完整 E2E 的矛盾；任务书指定 gates 已含本地正常 build，按既有授权执行本地正常 build 并跑 resident、7 条真实旅程，最后完整 gates 和正常 hooks push。
回滚：revert 本次 scoped commit，禁止恢复 CI build 依赖。

## 独立根因：权限检查晚于审批

无沙箱 loopback：bash safe-auto/step 与 write step 三条先红，write safe-auto 阳性通过。审批已挂起，执行 wrapper 的 coding 拒绝还未运行。native assembly 提供同一 toolAccessDenial 查询，laneHost 的既有 before_tool 在 prepare/approval 前调用，直调 execute 仍复用同一查询。保留 read 的可信技能路径权限；不放宽沙箱策略、不增加等待时间。新增 schema-v3 合同，真实工具结果/模型 wire/可写哨兵联合验证。

## 已有证据

- `.tmp/b1c-fix2/unit-red.log`：删除本树 dist-electron 后两个 Agent runtime 套件模块加载失败。
- `.tmp/b1c-fix2/gate-red.log`：新门岗先拦住 5 个文件 9 处导入；`gate-tests.log` 包含正反 AST 夹具。
- `.tmp/b1c-fix2/unit-green.log`：源码加载后 3 文件 49 条通过；`support-source.log`：全部共享支持层无需产物即可加载。
- `.tmp/b1c-fix2/resident-no-build.log`：无产物 resident 已过模块加载，在真实 Electron 启动器显式拒绝缺失的被测应用；不能伪称完整 E2E 通过。
- `.tmp/b1c-fix2/authority-red.log`：bash safe-auto/step、write step 三条错误进入审批；修复后 `authority-green.log` 25/25。
- CI run 34375552000 的 linux-walkthrough-evidence 原始 summary：resident 已发送 9 个 HTTP 请求、删除拒绝已返回，随后 bash 超时。这证明 E2E 是独立审批顺序根因，不是模块没加载。

- `.tmp/b1c-fix2/test-no-build-final.log` exit 0：dist-electron 全程不存在，Vitest 11884 passed / 2 skipped，runtime 412/412；walkthrough contracts 亦通过。
- `.tmp/b1c-fix2/resident.log` exit 0：本地正常 build 后真实 Electron 收据闭环通过，人工查看拒绝截图。
- `.tmp/b1c-fix2/journeys.log` exit 0：7 passed / 0 failed / 0 blocked；报告 `tests/system/runs/2026-09-09T16-58-15.136Z-real-user-journeys/report.md`。零付费调用、未打包。
- 首次 contracts 76 项完整执行，仅 prior-art 章节形状和当天症状簇结构评审两项阻断，补齐后两项复验通过；完整 gates 在最终提交上执行。
