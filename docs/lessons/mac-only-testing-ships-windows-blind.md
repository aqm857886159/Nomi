# 只在 Mac 上测，就是让 82% 的用户替我们测

> 📎 教训 · 首次记录 2026-09-24 · 状态：现行
> **触发场景**：发版前；Windows 用户报「卡死 / 点了没反应 / 保存失败 / 导入失败」而 Mac 上复现不了；任何碰到路径、文件句柄、文件锁、着色器/GPU、进程与 shell 的改动；看到某条测试「只在 Windows 红」而想把它当环境噪音时。

**结论**：开发机是 Mac，而用户里 Windows 占 82%（`.github/workflows/win-gate.yml` 头注释，v0.20.1 真实下载 Windows 234 / mac 53）。Mac 上全绿证明不了 Windows 上能用——v0.22.0 在 Windows 上同时带着 5 个 Mac/Linux CI 都测不出来的问题出了门，其中 2 个让核心功能直接不可用。**Windows 必须有自己的真机验证，并且在发版前跑**；「只在 Windows 红」的测试默认当成真 bug 查，不当环境噪音。

**为什么会踩**：

同一个结构性盲区，同一天挖出五个问题，机制各不相同，所以不能指望「写代码时多想着 Windows」：

| # | 用户看到 | Windows 为什么不一样 | 出处 |
|---|---|---|---|
| 1 | 导入/生成后整个应用卡死 ~100 秒，GPU 进程崩溃 | 等待动效的 26 分支 uber-shader 走 ANGLE→D3D11，FXC 编译器内联展开后同步编译 100 秒；Mac 用 Metal，Linux CI 用 SwiftShader 且关掉了这个动效 | PR #862，`docs/fixes/2026-09-24-waiting-effect-shader-compile-freeze.root-cause.json` |
| 2 | 「项目保存失败，请检查本地磁盘权限」，之后每次都失败 | 项目文件夹在同步盘/被杀毒扫描时，对方用 FileShare.Read 打开文件，Windows 拒绝 rename/delete（EPERM/EBUSY）；POSIX 允许 | PR #862，`…-manifest-lock-sharing-violation.root-cause.json` |
| 3 | 素材其实导进来了，却报「复制失败」 | 同上，清理暂存目录失败把成功改写成失败 | `…-asset-import-sharing-violation.root-cause.json` |
| 4 | 创作助手点发送没有任何反应 | 对话身份 `/nomi-lane/main` 被 `path.resolve` 补成 `C:\nomi-lane\main`，列表按前缀一条都认不出 | `…-lane-identity-host-path.root-cause.json` |
| 5 | （测试层）12 条「项目被替换必须拒绝写入」的保护在 Windows 上恒红、从没真正生效 | 测试用正斜杠匹配路径 | `electron/assets/projectArtifactImport.test.ts` |

而这些都没被发现，是因为**没有任何东西在 Windows 上跑**：
- `quality-gate.yml` 全在 ubuntu / macOS；`win-gate.yml` 是手动触发，且只跑 e2e/journeys，不跑单测、不跑 `tests/agent-runtime`；
- `tests/agent-runtime` 在 Windows 上（用 Electron 自带的 Node）仍有约 19 条红，从没人看过；
- 同一个根上还长着另一种死法：不在任何 CI 链里的走查会整批过期——工具 2026-09-14 从 `read_full_text` 改名 `read_script`，6 条 Agent 走查仍在调旧名，10 天没人发现（见 [不在任何 CI 链里的走查会一批腐烂](unwired-walks-rot-as-a-batch.md)）。**没人跑的测试不是测试。**

**怎么用**：
- 发版前在 Windows 真机上跑 `docs/release-process.md` §4 的「Windows 卡顿巡检」（正常 + `--held` 两遍，0 红 0 残留锁），并用真实文本模型在 Agent 面板里发一句话、让它建一个节点再改一次（2026-09-24 实测 3/3 回合、4/4 工具调用无错）。
- 在 Windows 上判测试红绿，**用 Electron 自带的 Node 跑**（`ELECTRON_RUN_AS_NODE=1 <electron.exe> --test …`）：本机 Node 22.15（libuv 1.49.2）的 `lstat` 在 Windows 上报 `dev: 0`、`fstat` 报卷序列号，会造出几十条假红；Electron 43 自带 Node 24.18.1 两边一致。先确认运行时，再下结论。
- 碰路径时问一句：这个串是**宿主路径**还是**身份/键**？身份不许交给 `path.resolve`（Windows 会补盘符）。碰文件时问一句：别的程序开着它时，我的 rename/delete/rmdir 会怎样？统一走 `retryOnSharingViolation` / `scratchCleanup`。
- 「只在 Windows 红」先当真 bug 查，查清楚是测试假设（POSIX 权限位、bash、symlink）还是产品行为，再决定改测试还是改产品；不许直接当噪音跳过。

**出处**：2026-09-24 Windows 用户 Alex 反馈（v0.22.0 几乎不可用）→ PR #862 与后续 Windows 批次；`tests/ux/windows-freeze-sweep.walk.mjs`；apimart DeepSeek V4 Pro 真模型实测（Windows 11，隔离 profile）；用户原话「because i only tested mac」。
