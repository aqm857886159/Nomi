> 模板：这是 2026-10-08 一份真实任务书（宿主层边界 lint）的原样，作为「结构改动：协调会话定合同 + 必红测试，Codex 先交测试再实现」的范例。用时替换合同、规则、交付三节。

# L-hostlint：宿主层边界「写错地方就红」（架构评审拍板点 1，用户 10-08 批准）

先完整读公共规矩 docs/engineering/codex/rules.md，尤其「交付前必跑 CI 同款门岗」「不许为跑通而改含义」。worktree：<worktree>（分支 arch/host-boundary-lint，最新 origin/main），先 `pnpm install`。背景读：docs/audit/2026-10-08-architecture-review.md（PR #1119，若 main 上还没有就 `git show origin/docs/lifecycle-structural-program:docs/audit/2026-10-08-architecture-review.md`）§7.1 宿主层 / 横切层的「结构约束」列；协调会话给的相关调研报告。

## 用户拍板原话
「宿主层边界做成『写错地方就红』的结构约束（ESLint / 依赖检查），新违规即红，存量进棘轮只减不增；概念 owner 门岗仍保持只提示。」

## 合同（协调会话定，按此实现；不在合同里的规则这次不做）
规则（P0：只用仓库已有的 ESLint 规则 / 插件与已装的 dependency-cruiser 18.2.0，不新加依赖，不自写 AST 扫描脚本）：
- R1 IPC 注册位置：`ipcMain.handle / handleOnce / on / once / removeHandler` 只许出现在 IPC 注册模块（按仓库现状确定一个可描述的路径集合，如 `electron/**/*Ipc.ts` + 现有 ipc 目录；写进报告并说明依据）；`ipcRenderer` 只许在 preload。
- R2 环境变量：electron/ 生产代码读 `process.env` 只许在配置 owner 模块（找仓库现有的 env 读取 owner；没有就指定一个现有最接近的文件作为唯一入口，**这次不搬存量**）。
- R3 裸网络：electron/ 生产代码里直接 `fetch(` / `net.request` / `http(s).request` / `undici` 只许在网络 owner（appFetch / hardenedFetch / vendorHttp 所在文件）。先看仓库已有的出站门岗（CI 日志里「outbound policy OK — appFetch importers …」那道）覆盖了什么：已覆盖的不重复做，只补缺口，并在报告里说明。
- R4 依赖方向（dependency-cruiser）：`electron/shared/**` 不许依赖 `electron/**` 其它实现与 `src/**`；`src/**` 不许依赖 `electron/**`（`electron/shared/**` 除外）；测试文件除外。
- 生命周期事件（will-quit / before-quit / quit / app.exit 等）**不在本刀**：F-quitdrains 线正在加这条，别碰，避免冲突。
棘轮：每条规则的存量违规进一份基线（文件 + 次数），**新文件或次数增加即红；基线里的文件不再违规而没删基线行也红（防陈旧）**；基线只许减。用 ESLint 自带能力实现（例如 overrides 精确列出存量文件、或仓库已有的基线机制），说明为什么选这种。
接进 gates：新检查必须登记进 gates:contracts 链（`check:gates-chain` 会查，#1114 就栽在这）。

## 先测试、后实现（必须两个提交）
- 提交 1 **只有测试**：每条规则至少一个「违规写法 → 红」「允许位置 → 不红」的证明（ESLint RuleTester 或最小 fixture + 跑 eslint 断言），棘轮三条（新增红 / 增量红 / 陈旧红）各一个。此时跑测试**必须红**（规则还没配），把红的输出贴进报告。
- 提交 2 实现：配置规则 + 基线 + 接进 gates，测试转绿。
- 不许为了过把存量违规改到别处（这次只登记、不搬家）；不许放宽现有任何 ESLint 规则。

## 交付
设计卡 ★5 格 docs/plan/2026-10-08-host-boundary-lint.md（格子用列表行「- ★1 …」）；`.tmp-pr-body.md`（「## 碰到的规则与门岗」点名 eslint 配置、dependency-cruiser 配置、基线文件、package.json；「## 功能分类」）。按公共规矩跑 CI 同款门岗、贴退出码。本地提交（两个），不推送。报告即最后一条消息：每条规则的位置集合与依据、存量数、两次提交 SHA、提交 1 的红输出摘要、门岗退出码。
