# pi R0 兼容验证实施卡

> 执行：subagent-driven-development + test-driven-development。用户已授权实施，R0 不需要 UI 样张。
> 状态：R0 本地验收通过。48/48 兼容测试、独立规格/质量复验、主仓 gates、开发及 ASAR 探针均 exit 0。详细证据和未覆盖项见 [验收记录](../audit/2026-08-26-pi-r0-verification.md)。产品仍未切换。

**目标：** 用真正的 pi SDK、可控的本机模型 HTTP 服务和真实 Electron 产物，证明能保留 Nomi 的现役接口行为。不是接一个能回话的演示。

**基线：** `84abca8d`，任务分支 `codex/unified-agent-pi-20260826`；#179 合同仅只读对照，不擅自合入。

**范围：** `experiments/pi-agent-runtime/` 独立 ESM package，固定 pi `0.84.3`；根 lint 仅增加该实验生成的 dist/release 路径排除，源码仍检查。R0 不改产品依赖/启动入口、项目文件、密钥、MCP、Skill、预算或 UI；本地 HTTP fixture 不花模型额度。三个现役协议是 OpenAI-compatible Chat Completions、OpenAI Responses、Anthropic Messages（不是 Google 原生协议）。

**回滚：** 此阶段没有产品切换；删除独立实验包即可撤销，不改变用户数据。R1 才将通过的 adapter 移入 `electron/harness` 并删除实验及旧 Agent 运行实现。

## 文件与任务

### 1. 固定依赖与基线

- [x] 刷新 `origin/main`，在现有隔离 worktree 创建任务分支；保留两份已确认方案。
- [x] 安装主仓冻结 lockfile，运行原 Agent 相关测试与构建作为回归基线：10 文件、80 测试，exit 0；主应用构建 exit 0。
- [x] 独立 `package.json` / `pnpm-lock.yaml` 固定 SDK；`tsconfig.json` 检查实验的全部源码和测试，不以排除测试换绿灯。

### 2. 受控 Session 与工具（TDD）

文件：`src/session.ts`、`src/model.ts`、`tests/session.test.ts`、`tests/httpFixture.ts`。

- [x] 先运行要求无默认工具、精确模型/端点/鉴权、只注入 Nomi 上下文的失败测试。
- [x] 实现公开 `createAgentSession`、自有 `ResourceLoader`、内存 settings/credentials/session、显式工具白名单；不写 SDK fork 或第二个循环。
- [x] 本地 HTTP 服务捕获真实 SDK 请求并回放协议响应；测试文本/工具往返、错误、拒绝/取消、参数规范化、零工具模式、工具不重复执行。

命令：`pnpm --dir experiments/pi-agent-runtime test`。预期首次 RED 为缺失行为断言，实施后 PASS；工具调用数和 wire 请求必须实断言，不只检查 mock 被调用。

### 3. 附件与恢复（TDD）

文件：`src/attachments.ts`、`src/snapshot.ts`、`src/snapshotSchema.ts`、`tests/attachments.test.ts`、`tests/snapshot.test.ts`、`tests/context.test.ts`。

- [x] 先运行原生 PDF 不得丢失、图片字节一致、完整 tool pairs/compaction/leaf 往返的失败测试。
- [x] 仅使用公开 provider payload/stream 接缝保留 PDF；不把文本抽取冒充原生文件。
- [x] 稳定点导出完整工作快照，用受控临时 JSONL 和公开 SessionManager 加载恢复；销毁临时文件只针对本次生成路径。
- [x] 恢复后继续一轮真实 SDK 请求；确认工具结果仍在、历史副作用不重放、压缩摘要/当前叶子未丢。另测损坏和中断状态。

### 4. Electron / ASAR

文件：`electron-main.cjs`、`src/electronProbe.ts`、`electron-builder.cjs`、`scripts/run-electron-probe.mjs`。

- [x] CJS 宿主经原生动态 import 加载 ESM SDK；真实 Electron 主进程执行受控会话和快照 probe。
- [x] 打包同 Electron `43.4.1` 的隔离 ASAR 应用，从打包二进制运行同一 probe；不能借外部开发 node_modules 通过。
- [x] 记录 Node/Electron 版本、包体、依赖和资源影响；限定证据为 macOS arm64 隔离产物，不冒充已完成 Nomi R1 真入口或其他平台验证。

### 5. 审查与出口

- [x] 独立规格审查，修复后再独立质量审查。
- [x] 主仓完整 gates 与实验 `test` / `typecheck`、开发 Electron / 打包 Electron 各自给最终退出码。
- [x] 回填逐项结果和已知边界；若原生 PDF、恢复、打包不能等价，停止正式切换并报告具体原因，不偷偷加旧引擎 fallback。

**R0 通过仅说明可以接；不代表 R1 已接产品，更不代表 R2-U1 三空间 Agent 已统一。**
