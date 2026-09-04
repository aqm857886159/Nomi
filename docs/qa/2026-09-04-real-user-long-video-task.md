# 真实用户长视频创作任务骨架

## 当前结论

本分支只新增 manifest、runner、provider preflight、Electron/UI boundary harness、测试和本文档；没有修改 #468/#469 或设计稿相关文件。

截至 2026-09-04，本机检查结果是：

- 合法长视频样本：`marketing/assets/demo.mp4`，仓库已跟踪，`ffprobe` 时长 60.096 秒；它是 fixture，不是假装 live provider 产物。
- 最小 live profile：provider `apimart`，model `gemini-3.5-flash`，类型为 text-vision。仓库的 APIMart 档案包含 `supportsImageInput`，视频拆解只需要参考帧视觉分析，不调用视频生成模型。
- 本机 Nomi model catalog 存在 APIMart vendor、目标 model 和加密 credential record；检查只输出 record 是否存在，不输出任何 secret 值。这个 record 的可解密/可用性不能由磁盘 JSON 单独证明。
- 当前 shell 没有 `APIMART_API_KEY`、`NOMI_LONG_VIDEO_PATH`、`NOMI_LONG_VIDEO_LIVE_CANARY=1` 或预算确认值，因此 live canary 状态是 `blocked-live`。
- 本次没有运行任何 live API call，也没有产生 provider 费用。loopback 走查若显式运行，只能证明本地 UI/bridge 路径，费用证据为 0 USD，不能证明 live 成功。

## 红 → 绿证据

先加入的红测是 `real-user-long-video.boundary.test.mjs`：它给 runner 一个暴露 `injectStore` 的 driver，必须失败并返回 `ui_boundary_required`；在 runner 尚不存在时，首轮失败为 module-not-found。补齐 runner 后，红测和顺序/证据测试通过。

当前 focused 绿测命令：

```bash
pnpm exec vitest run tests/ux/real-user-long-video.boundary.test.mjs tests/ux/real-user-long-video.runner.test.mjs
```

它验证：动作顺序、直接 store 注入拒绝、`pass + blocked-live` 拒绝、blocked 后不继续执行、缺少 live gate/credential/sample 时只返回 blocked。

## Electron/UI boundary 路径

显式 loopback 走查通过用户可见边界开始：进入 Nomi → 新建项目已通过；随后在 Agent 菜单查找 `workbench.storyboard.planner` 时发现当前 UI 不暴露它，因此走查在 Skill 步骤诚实返回 `blocked-live`，后续步骤为 `blocked_by:load-skill`。它不访问 `window.__nomiCanvasStore` 或任何 Zustand store；项目 readback（若到达该步）使用公开 Electron project bridge。

当前 build 还没有独立的 deconstruction “批准/拒绝”控件，预览也没有稳定的统一 selector。因此即使 Skill 暴露，harness 也会在 `approve-result` 返回 `blocked-live`，不会把结果可见误判为用户批准；其后的审批拒绝、重启回读、重复幂等和失败回滚保持 blocked-by 证据。这是当前真实缺口，不是伪造 pass。

已执行的 loopback 命令实际结果：`enter-nomi=pass (loopback)`；`load-skill=blocked-live (skill_not_exposed_in_current_agent_menu)`；没有向 loopback provider 发起模型请求，live provider 请求数仍为 0。

## live canary profile

文件 `tests/ux/real-user-long-video.live-canary.json` 要求同时满足：

```bash
NOMI_LONG_VIDEO_UI_E2E=1 \
NOMI_LONG_VIDEO_LIVE_CANARY=1 \
NOMI_LONG_VIDEO_BUDGET_CONFIRM=I_UNDERSTAND_ONE_REQUEST \
APIMART_API_KEY='(secret, do not print)' \
NOMI_LONG_VIDEO_PATH=/absolute/path/to/long-video.mp4 \
node tests/ux/real-user-long-video.e2e.mjs --live
```

profile 限定单次、单并发、每镜头一帧、不生成视频、不重试、隔离 userData、只清理 runner 自有临时目录；请求 ID 与费用/额度证据是硬要求。缺任一项只能是 `blocked-live`。当前由于环境变量不齐，上述命令不会启动 provider 请求。

## 证据状态定义

manifest 对每一步标注 H/B/E/T/N：Human、Behavior、Evidence、Technical boundary、Negative path；并区分 `loopback`、`recorded`、`blocked-live`。loopback/recorded 只能证明本地或磁盘事实，不能升级成 live provider 成功。

## 独立检查命令

```bash
node tests/ux/real-user-long-video.provider-check.mjs
node tests/ux/real-user-long-video.runner.mjs
NOMI_LONG_VIDEO_UI_E2E=1 node tests/ux/real-user-long-video.e2e.mjs --loopback
```

Electron 走查要求先有最新构建产物：

```bash
pnpm run build
NOMI_LONG_VIDEO_UI_E2E=1 node tests/ux/real-user-long-video.e2e.mjs --loopback
```

该 PR 不合并、不发布；live canary 仍需后续补齐审批/拒绝 UI、稳定预览边界、请求 ID/费用 receipt 出口后，才有资格产生 live 证据。
