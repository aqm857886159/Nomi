## 概述
CI 安装前统一恢复 Electron 与 Playwright Chromium 二进制缓存，避免每个任务重复请求外部下载服务。保持版本、下载源、校验和、安装身份检查以及现有 Chromium 超时策略不变。

## ★0 先查别人
- https://www.electronjs.org/docs/latest/tutorial/installation#cache · 官方缓存默认位置为 Linux `~/.cache/electron`（或 XDG 缓存）、macOS `~/Library/Caches/electron`、Windows `%LOCALAPPDATA%/electron/Cache`；支持 `electron_config_cache` · 确认用这个变量固定安装器实际读取的缓存目录；同时设置 `ELECTRON_CACHE` 为同一路径供打包阶段消费。
- https://github.com/electron/get/blob/v3.1.0/src/GotDownloader.ts · lockfile 对应 @electron/get 3.1.0 把 downloadOptions 交给 got，支持其 retry/timeout 选项；进度条的 timeout 不是请求超时；Electron install.js 没有把这些选项作为环境变量传入 · 确认此次不动安装器、不新增整次安装重试，避免叠加或伪称已有退避；没有查到官方推荐重试整个安装器的依据。
- https://github.com/actions/cache#usage · key 精确匹配，restore-keys 按有序前缀回退，成功任务结束时写入 · 确认 key 按 runner 系统、架构和 lockfile 解析出的版本分隔，旧版本回退只复用有效文件；缓存命中也照常执行安装和身份校验；浏览器缓存仅在 6 个实际安装浏览器的 job 开启，避免空目录保存警告与空缓存抢占。
- https://github.com/electron-userland/electron-builder/blob/master/.github/workflows/test.yaml · 大型 Electron 工程按平台缓存 Electron，key 包含 Electron 版本，Linux/macOS/Windows 使用各自缓存目录 · 确认共享动作覆盖全部平台及全部安装入口，而非只改本次红灯任务。
- https://playwright.dev/docs/ci#caching-browsers · 官方不推荐为提速缓存浏览器，恢复耗时可能接近下载；允许按 Playwright 版本缓存浏览器目录，Linux 系统依赖不能缓存 · 本次目标是下载可用性，确认增加浏览器缓存但保留 install-deps 与安装脚本，不跳过安装步骤。

## 短版设计卡
- ★1：CI 在 Linux/macOS/Windows 安装依赖与浏览器时复用校验过的二进制；量具为 `node --test scripts/ci-external-download-cache.node-test.mjs` 和真实 CI 缓存日志；不改产品界面、版本或下载源，老用户数据不涉及；首次冷缓存与缓存失效仍依赖上游，真实 CI 待协调。
- ★2：唯一 owner 为 `.github/actions/cache-external-downloads/action.yml`；24 个 pnpm 安装入口和 6 个 Chromium 入口消费同一组 job 环境；`node scripts/door-map.mjs scripts/install-electron-runtime.mjs --roots=scripts` 只覆盖 JS，YAML/shell 全量入口用 `git grep` 和结构测试补齐。
- ★3：任务书已定不删 Electron、不放宽门岗；沿原方向补 actions/cache，换镜像不在授权内，删除运行时会破坏真实验收；复用现有安装器、校验和与 Chromium 脚本，不添加重试、依赖或第二个安装入口。
- ★4：空缓存正常下载；加载时恢复；成功照常校验；失败保留原始报错；取消由 Actions 终止；过期用同平台前缀回退后补缺版本；上游不可用且缓存缺失仍失败，协调待服务恢复重跑，不绕过门岗。
- ★9：动手前验收清单：所有 24 个 pnpm 入口安装前无条件调用共享动作；6 个浏览器入口显式开启浏览器缓存且路径一致；版本确从 lockfile 取；系统/架构隔离、旧版本前缀回退；缓存命中不跳安装；Contracts 自动跑结构测试；逐条反例改坏→红、按字节还原→绿：删任一缓存步骤、步骤挪到安装后、加条件跳过、改错缓存目录环境变量、改错 cache path/key/restore-keys、覆盖消费者 env、漏新 job、破坏 lockfile 版本、漏浏览器缓存开关；不加重试所以三次失败反例不适用；真实 CI 首轮保存/重跑命中和无 Electron Releases 下载均待协调；回滚本分支提交。

## 系统改进
- 症状：多个 CI 任务在 Electron ZIP 返回 504 时一起失败。直接原因：pnpm store 不含 Electron 外部二进制。类根因：CI 没有一个统一、可检查的外部二进制缓存边界。
- 结构性预防：共享复合动作在安装前固定下载器的环境并恢复缓存；读取全部工作流的 node 测试拦住漏接、时序错、环境错、版本键错，Contracts 常驻运行。
- 根因合同：docs/fixes/2026-11-09-ci-external-download-cache.root-cause.json

## 碰到的规则与门岗
- `.github/workflows/quality-gate.yml`：仅新增缓存动作和结构测试执行步骤；原检查集合、条件与阈值不变。
- `scripts/ci-external-download-cache.node-test.mjs`：新增安装缓存结构测试，覆盖所有工作流；无跳过或豁免。

## 验证
待本地验证后回填。真实 CI 缓存写入、命中和网络日志待协调推送及重跑。

## 11-09 续跑设计补充（范围上限 20）

- 授权：补概念 owner、SCAN_GUARDS 与正文点名，另把打包和 installer 编译测试的工具链缓存收进本动作；不改版本、源或测试重试。
- ★0：https://github.com/electron-userland/electron-builder/blob/master/website/docs/troubleshooting.md · 官方要求持久化 ELECTRON_BUILDER_CACHE；三平台默认分别为 macOS ~/Library/Caches/electron-builder、Windows %LOCALAPPDATA%/electron-builder/Cache、Linux ~/.cache/electron-builder（尊重 XDG_CACHE_HOME） · 确认用绝对路径 runner.temp/nomi-electron-builder-cache，缓存整个工具链目录；当前 26.15.3 的 app-builder-lib/out/util/electronGet.js#getCacheDirectory 实查相同，不把 next 文档当锁定版本的源码。
- ★1：保住 NSIS 非法指令反例真正到达编译器、Mac 打包不重复下载已缓存工具；量具仍为工作流结构测试及真实 CI 日志，实际 CI 待协调。
- ★2：同一复合动作拥有三种缓存；概念登记收 action.yml#runs；SCAN_GUARDS 收工作流、动作、package.json 和 lockfile。现批次仅支持 Vitest，因此以同表分 node/Vitest 两个批次，测试守住不漏跑、不交叉、不吞失败。
- ★3：沿已有缓存边界补 builder，换源不选、删除编译器不选；不复制第二份安装逻辑。builder key 含系统、架构、锁定 builder 版本和 workflow/job，前缀回退可先复用同平台内容后保存该任务的完整工具集，避免某个打包目标先存不完整缓存后永久命中同 key。
- ★4：builder 开关仅在实际打包/单测任务开启；冷缓存照常下载、热缓存照常编译、下载失败保留错误；无重试。其余状态沿原卡。
- ★9：新增验收：所有直接 electron-builder、package.json 打包别名、完整/相关单测入口在执行前启用 builder 缓存；Unit 全分片统一开启；环境、缓存路径、版本 key 和同平台回退一致。动手前反例：逐个去掉 10 个任务的 builder 开关→红、还原→绿；错 builder 环境/path/key/前缀→红；删除 owner 或扫描登记→对应检查红；把 node 批次送去 Vitest 或漏入口→结构测试红；node 批次执行已知失败夹具必须返回非 0。原 12 条缓存反例继续适用。快检槽 A 等到运行完，不取消；正文六项全 0。总文件预计 19，不推送。

续查：RC validate 的 gates 经 run-gates-tests 也会跑 installer 编译，因此 builder 共 10 个 job 定义、全量展开 12 个任务；已纳入同一反例集合。
