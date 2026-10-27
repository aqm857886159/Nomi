# 导入转码不抢电脑、可见进度设计卡

改动名：导入视频可播放归一化收进有界进程门
线/负责人：fix/import-transcode-honest / 第 1 轮 Codex（I-import-transcode），第 2 轮 Claude（I-import-transcode-r2），第 3 轮 Claude（I-import-transcode-r3：并成一份在途请求登记）
类别：[长跑][可打断][数据格式]

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [x] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [x] 数据格式
- [ ] 新增功能 / 性能

| 格 | 结论 | 证据 |
|---|---|---|
| ★0 先查别人 | ① [Adobe Premiere：Ingest and Proxy workflow](https://helpx.adobe.com/premiere/desktop/organize-media/ingest-proxy-workflow/ingest-and-proxy-workflow.html) 明确把拷贝与转码分开，并保留原片；确认本次保留导入原片回退、只在可播放性需要时生成 MP4。② [Apple Final Cut Pro：Create optimized and proxy files](https://support.apple.com/en-gb/guide/final-cut-pro/verb8e5f6fd/mac) 说明导入后在后台做转码、可查看 Background Tasks 进度且始终保留原片；确认本次必须让导入状态说清「转换格式」和可取消生命周期。③ [Blackmagic DaVinci Resolve：Proxy Media vs. Other Playback Optimizations](https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_17_New_Features_Guide.pdf) 区分可携带 proxy 与仅本机的 optimized media；确认本次不造第二份用户可见代理体系，只在落盘边界生成可播放 MP4，删半成品即收场。 | 公开官方原文；链接及上述三条影响记录在本卡 |
| ★1 用户怎么用 | 当用户从画布文件选择、素材库上传、Finder 拖放/粘贴或 `nomi_asset_import` 导入视频时，我想在必要的转换阶段看到「导入中 · 转换格式 · x%」，以便知道电脑在做什么且不会被一个 ffmpeg 抢满。步骤：选择/拖入视频 → 卡片先显示检查中 → 仅容器不兼容时快速换容器 → codec 不可播时显示转换格式进度 → 完成后卡片进入已导入。已知坑：不提供本次取消按钮；切项目、窗口销毁或应用退出会取消并清理，不回退成半成品。真实任务：登记的 `video-ai-shot-640x360` 派生 MKV 导入；登记的 `video-4k-hevc-10bit` 仅留给待 main 合入后的走查。目标→信号→指标：用户能判断导入仍在工作→`AssetLocalizationEvent.phase=converting`→转换阶段事件比例单调上升（`electron/assets/videoImportNormalize.integration.test.ts`）；CPU 不抢前台→ffmpeg 进程优先级与 `-threads` 参数→单测/集成断言；取消不留孤儿→子进程 PID 与 scratch 目录→取消集成测试。 | 上述测试、`tests/ux/real-media-fixtures.json`、待走查截图 |
| ★1b 连带界面 | 画布导入卡沿用现有 `NodeImportingOverlay`：中文「导入中 · 转换格式 · {{percent}}% · {{size}}」，英文「Importing · Converting · {{percent}}% · {{size}}」；检查中、拷贝中、收尾中保持原有文案；取消不新增错误卡，不写 missing 事实。 | `NodeImportingOverlay.tsx`、i18n key parity、进度 store 测试 |
| ★2 谁说了算 | 导入转码进程生命周期 owner：`electron/assets/videoImportNormalize.ts` 的 `transcodeFileToPlayableMp4IfNeeded`；子进程所有权与取消边界：`electron/export/mediaProbe.ts` 的 `runBoundedProcess`；阶段契约唯一 owner：`electron/shared/assets/assetLocalizationEvent.ts`；卡片状态消费者：`assetImportProgressStore`/`NodeImportingOverlay`。事实只存一份：输入 codec/container 判定一次，阶段与比例通过事件投影；没有调用方猜测用户意图。 | `node scripts/door-map.mjs runFfmpeg transcodeFileToPlayableMp4IfNeeded ensurePlayableVideoBytes` |
| ★3 一致与复用 | 复用 `runBoundedProcess`（已有 AbortSignal、进程组清理、超时）和 `ffmpegProgress` 解析；复用 `createAssetImportProgressReporter` 与现有 localization 事件；删除 `videoImportNormalize.ts` 私有 `spawn`。不迁移其余 11 个既有直接 ffmpeg/ffprobe 启动，本次只冻结为基线（扫描只许减不许增）。 | `git grep`、`check:root-cause-contracts`、源码静态测试 |
| ★4 全状态 | 空：没有导入卡；加载：`导入中 · 检查中`；转换中（知道片长）：「导入中 · 转换格式 · x% · 大小」；转换中（探不到片长）：「导入中 · 转换格式 · 大小」/「Importing · Converting · size」，没有大小就只有前半句，不挂 0%；只换容器：视频 h264/hevc/vp9/av1（且本机能放）原样拷，音轨 aac/mp3 原样拷、其它（FLAC / Vorbis / Opus / AC-3…）转 AAC；VP8 等进不了 MP4 的视频整段重编码；长转码：不因 stderr 量被杀（tail 模式只留最后 128 KB 做错误信息，`-loglevel error`），超时 = max(30 分钟, 片长秒数 × 10 秒)、探不到片长 2 小时；成功：节点进入已导入；失败（ffmpeg 非 0）：日志记真正的错误行（滤掉进度记录），回退原样导入，由播放守卫兜底；部分成功：批量导入只报告失败项；取消中：不落资产、不记 missing、进程组与半成品、临时目录清理后请求结束；过期：项目绑定失效时同取消；能力不可用：ffmpeg/ffprobe 缺失时沿现有回退原文件并由既有播放守卫提示下一步重试。 | `mediaProbe.test.ts`、`videoImportNormalize.test.ts`、`videoImportNormalize.integration.test.ts`、`NodeImportingOverlay.test.ts`（中英） |
| 5 中途表 | 进行中 + 关窗口 / 换项目：请求信号（窗口销毁、`assertCurrent` 轮询，由补预览、视频拆解、导入共用的中立登记 `electron/ipcRequestRegistry.ts` 汇成）→ 杀进程组、删半成品和临时目录、以取消结束；懒自愈（`ensure-playable`）同样挂在这张登记上。进行中 + 退出：按 `registerQuitDrain` 的语义分两步——可选项在 will-quit（不可撤销）那一刻就停掉所有导入转码，不论哪扇门起的（界面导入、拷贝文件、懒自愈、Agent 的 asset.import；Agent 那扇的请求信号过不了回环 RPC 的 JSON，靠转码在途表停），不排在 Agent 收尾后面（它可能正等着这个转码落定）；必选项排进串行收尾链，等进程真没了、半成品和临时目录真删了，最多 3 秒（退出预算封顶）；退出开始后不再起新的导入转码。进行中 + 警告刷屏 / 长片慢机器：tail 模式与按片长超时，不会被自己杀掉退回原片。断网：本地转码不依赖网络；连点：每次请求独立 controller / 临时目录，完成者只发布自己的产物。花费：本地 CPU/磁盘只在请求存活期间使用；回执：现有 IPC failure envelope，不新增 missing。 | `electron/ipcRequestRegistry.test.ts`（登记本身：窗口销毁、项目会话失效、`drain` 等落定、`drain` 之后不接新请求）、`importTranscodeLifecycle.integration.test.ts`（按 PID 查进程、查系统 tmp） |
| 6 外部数据与失败 | 来源只有用户本机文件、已登记真实视频和打包 ffmpeg/ffprobe；格式判定依 `probeMediaMetadata` 与 `playableVideoCodecs`，官方 ffmpeg 进度协议输出经既有解析器；探测/转换失败继续沿既有「原样导入」回退，取消单独识别，不把半成品发布。 | `mediaProbe.ts`、`ffmpegProgress.ts`、官方先例见 ★0 |
| ★7 性能 | 新增操作：导入容器换装、不可播 codec 转码、取消清理；最坏规模：登记的 4K HEVC 10-bit 1.38GB（走查待 main 合入后），CI 真实 640×360 MKV；预算：转换阶段前台 CPU 不以全核运行，进程参数线程数 ≤ `max(1, cores-2)`，优先级 below-normal；事件比例单调、首个转换事件在 ffmpeg 启动后 1s 内（此项没有独立性能量具，记未验证）；以后重跑用 `videoImportNormalize.integration.test.ts`，不新增 perf 场景，因为本次是根因明确的小修而非新增交互。 | 集成/单测；「首个转换事件 1s」未验证：缺专用量具 |
| 8 真实条件 | Mac：单测与真实仓库素材 MKV 派生已验证；Windows：未验证；中英 UI：待「走查不抢前台」合入 main 后再跑；最小窗口/真 4K/干净安装：unverified；不花钱、不用真实账号。 | 测试输出、待走查截图路径 |
| ★9 验收与回滚 | 独立验收清单：① 假子进程吐 1 MB 以上 stderr（进度块 + 告警行）：tail 模式不被杀、进度回调一直来、留下的 stderr ≤ 上限；默认模式同样的输出照旧 `output_limit`；② 超时：9 分钟片 → 90 分钟，没有片长 → 2 小时；③ 从登记素材（`video-ai-shot-640x360`、`video-canvas-follow-hand-1080p15`）用打包 ffmpeg 派生、只落测试 tmp：H.264 + FLAC 的 MKV 只换容器、音轨探出来是 aac、视频包 MD5 与登记素材相同（= 没重编码；不拿墙钟判快慢）；H.264 + Opus 同上；VP8 的 MKV 整段重编码成 H.264；④ 结构扫描：`electron/` 非测试源码里直接起 ffmpeg/ffprobe 的只有 owner + 11 个冻结基线，新增一处 `spawn(resolveFfmpegPath(), …)` 必红，基线里已不再起的必红（提示从基线删掉）；它在 vitest 车道（`scripts/**/*.test.mjs`），`pnpm run gates` 动到 electron/ 时走全量 `pnpm run test` 跑到；推送前改到 electron/ 就跑（登记在 `scripts/pre-push-scan-guards.mjs` 的扫描型守卫表）；⑤ 转码进行中中止 → PID 没了、半成品删了；转码进行中退出（界面 + Agent 两扇门同时在转）→ 两个 PID 都没了、系统 tmp 一个文件都不剩、导入以取消结束、项目里没有新资产；Agent 收尾等着这个导入时退出仍是 completed 而不是到期限；退出后任何一扇门都不再起转码；⑥ 片长未知的卡片中英都不带百分比；⑦ 反例（拿掉改动必红）：tail 当 limit 用；flac 放回原样拷集合；新增直接 spawn / 基线留着已迁走的文件；退出排空回到「只发中止不等」、去掉可选项、只停请求表；⑧ 中英卡片真机截图 Read（只差真机核对：走查不抢前台的修复未进 origin/main）。实现线自验，独立验收线编号与报告待协调派发；`## 独立验收` 写「待协调派验收线」。回滚：revert 实现提交，无开关、无回退路径。 | 测试退出码、`git diff --check`、`check:root-cause-contracts`、报告 |

## 系统改进

系统此前没有把所有 ffmpeg 启动收进共享有界运行器：导入归一化私有 `spawn` 缺少 AbortSignal、进程组清理、优先级/线程策略和进度回调。此次把导入这一扇收进 `runBoundedProcess`，并在同一边界加入低优先级与 ffmpeg progress；其它 11 扇直接 ffmpeg/ffprobe 启动只冻结为基线，0.25 再迁。

第 2 轮补的是「长跑进程不能按输出量杀」这一类：共享运行器原来只有一种 stderr 策略（超上限就杀），对短命的探测是对的，对把进度写进 stderr 的长转码就是定时炸弹。现在运行器多一个 `stderrMode: "tail"`（只留最后那段做错误信息、进度照解析、不因量杀），默认不变；超时按片长算。门岗从「只看导入那一个文件」换成扫 `electron/` 全部非测试源码：新增直接起 ffmpeg/ffprobe 的子进程当场红，基线只减不增。退出排空改成「will-quit 立刻停 + 收尾链里等落定」，停的对象是转码在途表，不靠调用方有没有传信号。

第 3 轮补的是「长请求的停止只许有一个主人」这一类：导入线与拆解取消线同一天并行开发，各写了一份在途请求登记（补预览 + 拆解合并成中立的 `electron/ipcRequestRegistry.ts`，导入另写了一份）。按用户 10-27 拍板并成一份：中立登记的退出方法换成 `drain`（立刻中止全部在途、此后不接新请求、等它们连收尾都做完才兑现），导入改用它，导入专用的那份和它的单测同一提交删掉；拆解的退出调用只换方法名，仍然只中止、不等。门岗侧：概念门 `ipc.inflight-request-stop` 的 `forbidden_derivations` 加上导入专用登记的定义，再写第二份当场红。
