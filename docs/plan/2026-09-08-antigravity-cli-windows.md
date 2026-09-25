# Antigravity CLI Windows 契约修复

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：实现与本地验证完成，待 PR 审查；Windows 真机待群里那位用户用 RC 验。

## 范围与验收

六条现场记录仅作线索，以当前源码与官方契约复核。改动限定 Antigravity 集成、shared 契约、i18n、对应测试与文档。为完成用户要求的直接可见错误解释，最小接线涉及现有 AntigravityConnectionCard 与 useAntigravityModelWorkspace，不改布局或新增控件。不碰 electron/agentLane、不装依赖。

## 核实表（基线 87087c345ff7e34ab8ac38b4225d6d8a331a3888）

| 现场结论 | 源码 | 判定 | 证据 |
| --- | --- | --- | --- |
| Windows 拦截发现 | electron/ai/antigravityConnection.ts:72；antigravityProcess.ts:138 | 部分对 | 发现始终拦 win32，且丢弃已探测版本；运行却允许 prepared invocation 绕过，没有进程树保证。 |
| 媒体只准 1.1.21 | electron/ai/antigravityMedia.ts:35 | 对 | 非 text 严格比较版本字符串，1.1.27 被拒。 |
| hook 只有 Unix 命令 | electron/ai/antigravityMediaHook.ts:114 | 当前源码不对 | 已有 win32 set/call 分支，但路径转义与二次展开仍需按 cmd 语义修复。 |
| hooks 位置错误 | electron/ai/antigravityMedia.ts:70-77 | 部分对 | 官方 Hooks 页推荐 customization 目录；官方 CLI Plugins 页明确 plugin 根也支持 hooks.json。故旧位置本身不证错误，本次统一 workspace .agents；stream-json 未执行根因未证实。 |
| handshake 错报 hook | electron/ai/antigravityProcess.ts:255 | 对 | 文本不匹配与重复准备都抛 HOOK_UNVERIFIED。 |
| drain 固定两秒 | electron/ai/antigravityProcess.ts:248 | 部分对 | 固定 2000ms 属实；现场是否因此失败尚无受控复现。用模拟慢退出复现机制。 |

## 先查别人 / 取舍

- 官方安装与 Windows 路径：https://antigravity.google/docs/cli/install/
- Node 子进程：https://nodejs.org/api/child_process.html （detached 在 Windows 创建独立控制台，不等于 Job Object；windowsHide 只控制窗口）。
- Microsoft taskkill：https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill （/T 杀指定 PID 的子树，不提供父进程退出后的持续所有权）。
- 官方 Job Object：https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects
- 不引入 tree-kill 等包装依赖：其 taskkill 机制不自动补齐早退孤儿所有权，且用户禁止新增包。

本次平台策略按用户允许的最低交付路径：若 Node 内置能力不能证明与现有 Unix 进程组同等的早退后所有权，则统一返回 WINDOWS_UNSUPPORTED，前台说清取消清理保证未完成。Windows 实现留在本计划：需取得 Job Object 或有同等保证的受控宿主，验证取消、父进程先退出、继承管道、静默后代、拒绝退出、应用退出。不能把 taskkill 的成功退出当没有孤儿进程的证明。

版本契约：最低 1.1.21；已验证媒体上限 1.1.22（本次真实试跑）仅作为协议档案旁注，>= 最低版本仍需通过既有逐模型能力试跑与授权标记。未知/低版本在共享边界拒绝；未来版本不由精确白名单拒绝。

生命周期：drain 由能力导出（text 2 秒、媒体 30 秒），总运行上限包含工作与 drain 预算，仍须退出并完成清理后才能交付产物。

回滚：revert 本 PR 的 scoped commit；无持久化迁移，临时 workspace 每次重建。旧成功证据继续按准确 CLI 版本匹配。

## 验证

生产修改前先跑六条红证；之后对应类测试、错误码穷尽映射、check:i18n、schema-v3 合同检查、pnpm run gates。模拟 Windows 不等于 Windows 真机支持。PR 明示 RC 待验，禁止声称 Windows 已支持。

## 官方核实补充（2026-09-08）

- https://antigravity.google/docs/hooks/ ：Configuration 指定 customization directory，例如 workspace `.agents/`；named hook → event 配置与本次结构一致。
- https://antigravity.google/docs/cli/plugins/ ：目录树明确包含可选 `hooks.json`。不能把 plugin 位置一概说成错误。
- 本机官方 `agy --version` 为 1.1.22；二进制内置 Hooks 文档的 Hook Handler Fields 原文：`sh -c` on Unix、`cmd /c` on Windows，working directory 为 containing hooks.json。不把本机版本当用户 1.1.27 的实测。
- 最低 1.1.21 是 Nomi 既有媒体证据所支持的应用策略，不是官方承诺向前兼容；1.1.27 仍需真实试跑，不用版本门槛代替 hook 授权。
- 删除旧 agent frontmatter plugin 引用和空 plugin.json，防止同一 hook 两个加载入口；task-gate 保留 gate.cjs、初始化和就绪 nonce 标记。

## 接手记录

preflight 刷新远端成功，HEAD 与 origin/main 同为 87087c345；因前轮未提交修改返回 dirty_worktree，按接手指令保留现场继续。无新增依赖，无 lane 文件改动。

接手后先跑测试，Windows 文案用例确实失败（尚未接线）；随后找回上一段保留的 `/tmp/nomi-agy-red.log`：18:15 六条机制共 8 红 / 1 绿；`/tmp/nomi-agy-green.log`：18:16 三文件 68 绿。红证分别为 NOT_INSTALLED、MEDIA_VERSION_UNVERIFIED、Unix 命令串、.agents/hooks.json ENOENT、HOOK_UNVERIFIED、DRAIN_TIMEOUT。第三条红证验证新注入平台包装契约，不证明基线 Windows 没有 set/call 分支。当前回归覆盖六条机制与错误码穷尽映射。原命令 `pnpm run test -- electron/ai src/ui/onboarding` 未传递过滤器，改用 `pnpm exec vitest run electron/ai src/ui/onboarding --maxWorkers=3`，86 文件 / 1041 测试通过（后续新增映射与包装测试另跑）。


真实媒体验收：本机官方 agy 1.1.22，用当前生产 runAntigravityProcess、真实账号、image 任务生成蓝色圆形。1/1 回合成功，返回 1 张 image/png；授权与单次工具约束由生产 finishAntigravityMedia 校验（1/1 工具流程通过）。usage input=16356、output=967、thinking=830、total=17323；CLI 未报告金额。Windows 1.1.27 不在此证据覆盖范围。

门岗联动：删除旧 plugin.json 后，check:standard-formats 要求同步移除 `scripts/standard-formats-baseline.json` 中唯一一条已消失的债务；仅做减项，不改变门岗实现、不新增豁免。这是限定生产范围外唯一必需的门禁元数据清理。


平台策略复查：Context7 `/nodejs/node` 引用 Node 官方 `deps/uv/src/win/process.c` 的 `uv__kill`：Windows SIGTERM/SIGKILL 用单进程 `TerminateProcess`，不是进程树所有权；`windowsHide` 仅隐藏窗口。因此本次不把 taskkill 或 detached 包装当 Job Object 等价实现。

Electron 界面走查：隔离 profile，新建空白项目 → 模型设置 → Antigravity CLI，IPC 夹具返回 WINDOWS_UNSUPPORTED；真实连接页直接显示短状态「Windows 暂不支持」及原因/替代动作，没有「尚未检测」「尚未获取模型清单」「已启用」。截图 `/tmp/nomi-agy-ui-windows.png`；这是 macOS 上的 Windows 状态呈现验证，不是 Windows 进程生命周期验证。


最终验证：`pnpm run gates` 退出 0，73 项阻断门岗通过，Vitest 1285 文件通过 / 1 文件跳过，11966 tests passed / 2 skipped；agent-worktree-janitor、agent-runtime、test:stats 与 renderer/Electron 构建通过。文档索引/状态/研究来源仅保留现有 advisory，未绕过任何阻断门岗；Ponytail 提交与推送评审由版本化钩子运行。

R31 收尾：登记 antigravity-hooks 格式，保留官方 Hooks 页第一份完整 JSON 示例于 tests/fixtures/standard-formats/antigravity-hooks/hooks.json；writer 测试读取官方样例，核对 flat PreInvocation 和 grouped PreToolUse 的结构。Ponytail 单独复核：无可执行精简项。
