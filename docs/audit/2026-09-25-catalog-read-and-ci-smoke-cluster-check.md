# 结构复核：`electron/catalog` 与 `.github/workflows` 各再多一份合同（2026-09-25）

> 触发：`check:symptom-cluster`。本分支 `claude/canvas-follow-hand` 新增的两份合同各落进一个已成簇的模块：
> `2026-09-25-model-catalog-sync-read-per-mount`（`electron/catalog`）和 `2026-09-25-canvas-video-players-always-mounted`（其 `scope_paths` 含 `.github/workflows/quality-gate.yml`）。
> 这两个簇 09-22～09-24 已有结构评审：[`catalog-and-ui-cluster-structure`](./2026-09-22-catalog-and-ui-cluster-structure.md)、[`model-integration-layer-structure`](./2026-09-22-model-integration-layer-structure.md)、[`quality-gate-workflow-structure`](./2026-09-22-quality-gate-workflow-structure.md)、[`ci-release-validation-structure-review`](./2026-09-23-ci-release-validation-structure-review.md)、[`release-critical-evidence-structure`](./2026-09-24-release-critical-evidence-structure.md)。本文只回答一件事：新来的这两份，是在加重那些评审点名的结构问题，还是另一回事。

## `electron/catalog`：同层，但是另一种形状

- **这一份是什么**：选中画布卡片时，提示词面板经同步 IPC 按模式逐个读目录（7–12 次/挂载）；主进程每次在 `readCatalog` 里重读、重解析、迁移、逐家解密 300 KB 的目录再深拷贝。修在 `readCatalog`：按「路径 + 原始字节」缓存、钥匙串锁着不缓存、写流程拿深拷贝、只读列表拿深冻结的共享快照；渲染层一次计算内同一供应商只问一次。
- **和簇里已有的形状比**：09-22 评审归纳的是正确性形状——「没有声明位的属性继承邻居的值」「白名单式保留而非覆写」「用户配置可能被静默丢」。本份是**成本形状**：读的代价随调用方数量涨，而不是随目录变化涨。它没有新增 owner，也没有新增读口。
- **它站在已有结构上**：09-21 的 `config-never-silently-lost` 把目录的读法收成唯一读口（`catalogFileAccess.ts` / `readCatalog`）。正因为只有一个读口，这次缓存加在一处就覆盖了全部 52 个读者（`node scripts/door-map.mjs readCatalog`）。这说明那次收口是对的，不是反证。
- **结构欠账（不在本次做）**：目录这一整组桥（`electron/preload/modelOnboardingBridge.ts`）都是同步 IPC。只要渲染路径上有人同步读，阻塞就还在，只是每次更便宜了（本次实测挂载仍有 3 次）。根治是把目录桥改成异步、由渲染层按主进程广播维护一份只读快照。前提是**每一次写目录都广播**——今天只有两处广播（`vendorHealth.ts`、`validateCandidateCredential.ts`），普通写入不广播，所以本次刻意没做跨调用的渲染层缓存，否则它会静默过期。登记为后续：先让 `writeCatalog` 成为唯一的广播点，再谈异步化。

## `.github/workflows`：顺带碰到，不是同层问题

- **这一份是什么**：视频播放器合同的防回措施，在 `Core Flow Smoke (empty)` 那一格冒烟之后加一步 `xvfb-run -a node tests/ux/canvas-follow-hand.perf.mjs --structural`（计数型断言：空闲 `<video>` = 0、同时在播 ≤ 1、叠放拖出粘住 0 等）。
- **为什么算顺带**：合同的类根因在画布（「画布只画封面」与「卡片自己挂播放器」两个 owner），工作流文件只是承载防线的地方。这正是 09-22 `quality-gate-workflow-structure` 第 1 节说的「一半不是同层」的那一类。
- **是否加重了那份评审点名的问题**（车道、证据、判决挤在一份手写 YAML）：没有新开车道、没有新判决逻辑，复用 empty 格的触发条件、安装与构建，结果 JSON 跟着 `core-smoke-evidence-empty` 上传。唯一新增的是一条命令行。那份评审第 4 节的结构欠账（车道声明与证据收集分离）不因本次变化。

## 裁决

两份都不需要结构重构，理由如上。唯一真实的结构欠账是目录桥同步化，已写明前提与顺序，不在本分支做。
