# 设计实验室截图比对搬进 CI（macOS 机器）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

日期：2026-10-18 · 状态：用户已确认，实现中 · 方向：用户 2026-10-18 拍板方案 A

## 问题

`check:design-lab` 的像素比对只在 `calibratedPlatform: darwin` 上跑（`scripts/check-design-lab.mjs` 第 286 行），Linux CI 明说跳过。合并流程里没有任何一台机器比对截图，于是：

- 2026-10-18 在用户 Mac（macOS 26.5.1）上，322 张基准里有 97 张不符，干净的 origin/main 同样如此。
- 抽样看过的差异有两类：真实的界面改动（外壳重做、焦点环改深色、去强调色描边等，分镜行菜单的差异图能直接看到焦点环）；以及不同机器录的基准之间的字体抗锯齿差异（基准提交来自 +0800 和 -0300 两类机器）。
- Windows 实现线录不了 darwin 基准，`calibration.json` 的 `pendingApprovalScreens` 已积了 18 屏「等在 mac 上录」。

类根因：基准没有唯一的录制机器，合并路径上也没有比对点，所以基准必然越积越旧。

## 用户确认（2026-10-18，四项都选默认）

1. 首次整体重录合进去之后，CI 比对不符就拦合并。
2. 本机 Mac 跑 gates 时只报差异、不红，以 CI 为准。
3. 首次重录只给用户看有实质差异的那批，其余字体抗锯齿差异直接接受。
4. 更新基准用 `design-lab:accept` 本地取回再提交，工作流不拿写仓库权限。

## 改法

1. **CI 新增一个 `visual` 道**（`scripts/validation-policy.mjs`）：改动命中界面路径才开（默认：`src/**/*.{tsx,css}`、`src/theme/**`、`src/design/**`、`tailwind.config.ts`、`tests/ux/design-lab/**`、`design-lab.html`）。
2. **`.github/workflows/quality-gate.yml` 新增 `Design Lab (macOS)` 任务**：`runs-on: macos-26`（固定版本，不用 `macos-latest`，避免 GitHub 换默认镜像时整片变红）；跑 `pnpm run check:design-lab`；失败时把 `test-results/` 里的 actual / expected / diff 打包成 artifact。并进 Quality Gate 的 needs。
3. **基准只认 CI 那台机器**：`calibration.json` 增加 `calibratedRunner`（镜像名 + macOS 版本），CI 上命中才硬比；本机（包括用户的 Mac）只报差异、不让 gates 红，明说「本机不是基准机，以 CI 为准」。这与现有「未校准平台明说没跑」是同一条原则，只是把校准单位从「操作系统」细化到「那台机器」。
4. **更新基准不靠机器人推提交**：新增 `pnpm run design-lab:accept -- --run <CI 运行号> [--screen <id>]`，用 `gh run download` 把 CI 那次的 actual 图取回、替换进 `__baselines__`，人在本地看接触表后再提交。不给工作流写仓库的权限（`check:workflow-protected-writes` 不放宽）。旧的本机录制命令 `design-lab:update` 删除（加新必删旧）；新状态缺基线时，CI 的 macOS 任务不在结构关拦，交给视觉关判「快照缺失」并产出新图。
5. **首次整体重录**：在 CI 机器上录全部 322 张，作为新的唯一基准。97 张有实质差异的出一张接触表给用户过目，其余是字体抗锯齿差异，直接接受。`pendingApprovalScreens` 18 条登记保持原意：拍板前不录。

## 设计卡

- **★1 用户怎么用**：任何一条线改了界面、开 PR，CI 在 macOS 机器上比对截图；不符就红，artifact 里有差异图。确认是想要的改动后，跑 `design-lab:accept` 取回新图提交。不做：不改实验室本身的状态注册表和拍板流程；不在 Linux 上比像素。已知坑：GitHub 每周更新镜像小版本，字体可能随之变化（见残留风险）。
- **★2 谁说了算**：基准图唯一来源 = CI 的 `macos-26` 任务；`calibration.json` 的 `calibratedRunner` 是唯一判据；本机比对只是参考。
- **★3 一致与复用**：复用现有 `check-design-lab.mjs`、`validation-policy.mjs` 的道机制、`mac-package` 任务的 macOS 装配写法；artifact 上传沿用工作流里现有写法。不新写截图工具。
- **★4 全状态**：CI 绿 = 全部相符；红（像素）= artifact 有差异图，PR 上点名哪几屏；红（基础设施，例如实验室服务起不来）= 沿用 `failureTriage.mjs` 的大声报错，不说「像素不符」；本机运行 = 只报告不阻断；未命中 `visual` 道的 PR = 不跑，Quality Gate 显示 skipped。
- **★9 验收与回滚**：验收 = 一个改了按钮颜色的探针 PR 在 CI 红并产出差异图，`design-lab:accept` 后变绿；一个只改文档的 PR 不触发该任务。回滚 = revert 本 PR（基准图回到旧版本，视觉比对回到只在本机跑）。

## 代价

- 公开仓库的 GitHub 托管 macOS 机器不计费；GitHub Free 账户 macOS 同时最多 5 个任务。
- 每个界面 PR 多一个 macOS 任务，耗时以首次实测为准（写进 PR）。

## 残留风险

- `macos-26` 镜像的小版本每周更新，系统字体可能变化，届时会整片红。对策：`calibratedRunner` 记录到小版本，CI 发现版本不符时报「镜像漂移，需要重录」而不是「像素不符」。

## 参考

- macOS 26 托管机器已正式可用，标签 `macos-26`（arm64）：https://github.blog/changelog/2026-02-26-macos-26-is-now-generally-available-for-github-hosted-runners/
- `macos-latest` 迁到 macOS 26，可用固定标签留在旧版：https://github.blog/changelog/2026-05-14-github-actions-upcoming-image-migrations
