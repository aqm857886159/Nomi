# 打包 MCP 冒烟 capability 目录装配修复

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：实施中。范围仅 tests/ux、scripts、docs；不改生产代码、不重打包、不安装 app。

真实摩擦：GUI 已启动但 helper 找不到它，resources/list 在发现/冷启阶段先撞 15s 超时。
共享启动器把调用方 env 指定的 capability 目录覆盖成新临时目录，导致 advert 与 token 分家。

方案：在 launchNomiApp 单点按显式 capabilityDir > 调用 env > 继承 env > 隔离派生目录解析，返回值、mkdir、GUI env 同源。未隔离且无配置时不派生。保留必需 E2E 环境保护。
先查别人：本仓 _launchApp.mjs 的目录装配与 packaged-mcp-smoke.e2e.mjs 的 helper env 是直接证据；plan-gate.walk.mjs、mcp-client-activation.walk.mjs、_mcpJourney.mjs 有同类 env 调用。无外部协议或框架变更，不涉及第三方升级。

步骤：同一个现成 app 打印 GUI/helper 目录并复现红；node:test mock Electron spawn 捕获真实启动参数，先红后绿；共享边界修复；原包冒烟与启动/走查门岗；schema-v3 合同与教训；contracts 后提交 PR。
验收：env 不覆盖、显式参数优先、继承 env、无配置隔离派生/非隔离不派生；三签名客户端资源读取和完整 smoke 绿，未签名写拒绝仍成立。
回滚：整体 revert 本次 scoped commit；不迁移用户数据。包内 helper 若另有真 bug 只报告，不修改。

验证证据（2026-09-09）：本 worktree 执行 build:electron 只生成 smoke 期望目录模块，未打包/安装 app；现成 switch-gate Nomi.app 修前 resources/list 15s 红且打印目录分离，修后 25 tools / 34 resources / 7885 chars，claude/codex/cursor/external 通过，未签名写拒绝。node:test 原始 5 例中 env/inherited 两例先红，修后 5/5 绿。日志保留于 .tmp/packaged-smoke-{red,green}.log、.tmp/capability-node-{red,green}.log。


## 先查别人

- 仓库已有唯一装配边界：[launchNomiApp](../../tests/ux/_launchApp.mjs) 的目录解析与 buildNomiLaunchEnv。复用此边界，不增加第二份启动器；故障由本仓默认值覆盖顺序决定，外部 SDK 不负责这条规则。
- 仓库已有双进程调用：[packaged smoke](../../tests/ux/packaged-mcp-smoke.e2e.mjs) 与 [plan-gate](../../tests/ux/plan-gate.walk.mjs) 均给 GUI/helper 同一个 env 目录。两条独立入口证明应修共享装配，不能只改 smoke 参数。
- 仓库已有规避例：[mcp-lease-project-binding](../../tests/ux/mcp-lease-project-binding.e2e.mjs) 用显式 capabilityDir 避开覆盖。保留优先级并删除过期的“env 不可用”说明；[隔离教训](../lessons/iso-walkthrough-key-seeding-traps.md) 同步更新。

结论：用已有启动器恢复配置优先级，不引入依赖或格式。本次没有生态选型、自研通用能力或外部协议变化，外部文档和自媒体无法裁决内部路径装配；不声称做过无关联网调研。
