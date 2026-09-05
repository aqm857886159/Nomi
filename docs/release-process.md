# Nomi 开发版与正式版发布流程

## 1. 日常功能开发

每个功能从最新远端主线创建独立分支和 sibling worktree：

```bash
git fetch origin
git worktree add ../Nomi-feature-name -b feat/feature-name origin/main
cd ../Nomi-feature-name
pnpm install --frozen-lockfile --prefer-offline
pnpm dev
```

每个 worktree 必须拥有自己的 `node_modules` 目录，禁止把它软链接/junction 到主仓或其他 worktree，也不能复制其他 worktree 生成的包链接。pnpm store 已经会在机器范围内复用包内容；共享或串仓的链接会把 Electron 解析到旧 worktree，出现“声明 Electron 43.4.1、实际运行 31.7.7”。`pnpm dev`、`pnpm run build` 和 `pnpm run gates` 会在使用前核对声明、安装包、dist 与真实二进制四份身份。

`pnpm dev` 默认把设置、密钥、缓存和项目放进当前 worktree 的 `.tmp/electron-user-data/dev-<port>`，不会读取正式版的 `~/Documents/Nomi Projects`。

开发完成后运行：

```bash
pnpm run gates
pnpm run test:e2e
pnpm run test:journeys
```

推送任务分支并创建 PR。禁止直接推送 `main`。

PR 合入后运行 `pnpm run delivery:verify-merged -- --expected-sha <SHA>`：它按该 SHA 拉取 checks，即使 `origin/main` 已前进也会记录当前 `tip` 与 `relation=ancestor`；文档门岗补齐则由 `Docs Gate Autosync` 另开 PR 回写，禁止直推受保护主线。

## 2. 生成可安装的开发预览版

在 PR 上添加 `desktop-preview` label，或者手动运行 GitHub Actions 的 `Desktop Preview` 工作流并填写分支名。

工作流会生成：

- `Nomi Preview` macOS Apple Silicon DMG；
- `Nomi Preview` Windows x64 安装包。

Preview 使用 `com.nomi.app.preview` 和 `Nomi Preview Projects`，可以与正式 Nomi 同时安装。Preview 不接收 stable 自动更新。

预览包只用于确认单个 PR 或临时集成分支，不是正式发布源。

## 3. 选择正式版内容

选择单位是完整 PR，不是某几个文件。

1. 从 `origin/main` 创建 `release/0.20.0`。
2. 只把本次确定发布的 PR 合入 release 分支。
3. 在 release 分支把 `package.json` 版本改为 `0.20.0`，补齐 CHANGELOG 和 release notes。
4. 未选中的 PR 保持独立，不进入 release 分支。

release 分支仍通过 PR 进入 `main`。为保持 RC commit 可追溯，release PR 使用 merge commit 或 fast-forward，不能 squash。

## 4. 构建 Release Candidate

在 GitHub Actions 手动运行 `Desktop Release Candidate`：

- `ref`: `release/0.20.0`；
- `version`: `0.20.0`。

RC 工作流会：

1. 验证输入版本与 `package.json` 一致；
2. 运行完整 gates、Electron smoke 和真实用户 journey；
3. 构建 macOS arm64、macOS Intel、Windows x64；
4. 保存自动更新需要的 zip、blockmap 和 yml；
5. 生成绑定 commit SHA 与 workflow run ID 的 `release-manifest.json`。

验收以下真实场景：

- 从上一正式版升级，项目和设置不丢；
- 创建、保存、关闭并重开项目；
- 密钥、安全存储、MCP 和单实例；
- 图片/视频生成与任务恢复；
- FFmpeg、MP4 导出和文件选择器；
- macOS 双架构与 Windows 安装包；
- 官网下载和应用内检查更新。

RC 发现问题时，在原功能分支或 release 分支修复并重新运行 RC。不要修改已经生成的安装包。

## 5. 晋级正式版

RC 验收通过后：

1. 通过 PR 把 release 分支合入 `main`；
2. 记下成功 RC 工作流页面中的 run ID；
3. 手动运行 `Desktop Release`：
   - `rc_run_id`: 成功 RC 的 run ID；
   - `tag`: `v0.20.0`。

正式发布工作流会验证 RC commit 已包含在 `origin/main`，然后：

- 创建不可变版本标签；
- 从指定 RC run 下载原始产物；
- 检查三个公开安装包和更新元数据齐全；
- 生成 `SHA256SUMS.txt`；
- 创建 GitHub Release 并上传同一批已验收产物。

正式发布不会重新构建。

## 6. 发布后直链验收

正式 Release 公开后、对外宣布版本前，必须完成以下检查。不能只检查 HTML 里存在链接，必须真实发起请求并确认没有停在 Releases 页面。

1. 确认 `https://github.com/aqm857886159/Nomi/releases/latest` 指向刚发布的 tag。
2. 分别请求以下 GitHub 直链，跟随重定向后必须返回安装包内容，不能落到 `/releases/latest` 或 `/releases/tag/...` 页面：
   - `https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-arm64.dmg`
   - `https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-intel.dmg`
   - `https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-windows-setup.exe`
3. 在 `https://nomiaqm.com/` 和 `https://nomiaqm.com/en/` 实测下载按钮：已知平台应直接请求对应的 `releases/latest/download/...` 安装包；无法判断 Mac 芯片时应在站内提供三个直链选项，不能把用户送到 Releases 列表。
4. 实测应用更新入口 `https://nomiaqm.com/?download=1&source=app-update&platform=darwin&arch=arm64`，确认只触发一次对应 DMG 下载，并清除一次性查询参数。
5. 检查 `latest-mac.yml`、`latest.yml` 和三个稳定安装包别名都属于本次版本，文件大小非零，下载响应不是 `text/html`。

任一检查失败都不宣布发布完成；先修复 Release 资产或官网路由，再重新执行整套直链验收。

## 7. GitHub 仓库设置

在仓库设置中完成一次性配置：

1. `Settings -> Environments` 创建 `production-release`，设置 required reviewer。
2. 保护 `main`：禁止直接 push，要求 PR，要求 `Quality Gate` 和 `Mac Package` 通过。
3. 创建 `desktop-preview` label。
4. 不允许 force-push 或删除 release tag。

## 8. macOS 官网直接下载

未签名 macOS 版本无法在应用内直接替换。Nomi 会打开：

```text
https://nomiaqm.com/?download=1&source=app-update&platform=darwin&arch=arm64
```

`arch` 来自桌面主进程真实的 `process.arch`，Intel Mac 会传 `x64`。官网删除一次性参数后立即下载对应 DMG；如果参数无效，则停留在官网并保留普通下载按钮，不把用户丢到 GitHub Release 资产列表。
