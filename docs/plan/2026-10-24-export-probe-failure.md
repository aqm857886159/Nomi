# 设计卡：导出时读不出素材信息，不再当「没音轨」悄悄导出

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：导出前的素材探测失败 = 导出失败   线/负责人：I-export-probe   类别：[长跑][可打断]
```

来源：10-24 全量对账读代码发现（未复现过的用户报告）。`electron/export/exportJobs.ts` 的 `tryBuildFiltergraphExport` 对每个视频 / 音频素材调 `probeMediaMetadata`，抛错时 `catch { // 探测失败不致命：按无音频处理 }`——这一段按「没有音轨」进 ffmpeg 计划，成片少了这段的声音（全是这种素材时整片无声），导出却报成功。

方向检查：`node scripts/fix-churn.mjs electron/export/exportJobs.ts electron/export/mediaProbe.ts electron/export` → 未命中热点；但要加两句失败文案的 `electron/desktopStrings.ts`（桌面文案词典，14 天第 10 个 fix）和概念 `delivery.money-copy-truth`（第 19 个）命中——是词典计数口径造成的，复盘见 `docs/engineering/direction-checks/2026-10-24-export-probe-failure.md`，交协调定。补还是换：**换**——删掉「探测失败 → 当没有」这条静默降级，改成明确失败；不新增回退。纯 bug 修复：★0 不要求；逻辑 bug，不出样张（`docs/engineering/design-card.md`「逻辑 bug 不出样张」）。

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [x] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [x] 新增功能 / 性能（路径推出：`electron/export/**`、新增 `AbortController`；本卡 ★7 写「不适用」及理由）

## 门表（`node scripts/door-map.mjs probeMediaMetadata`，13 扇）

导出路径上只有一扇：`electron/export/exportJobs.ts`（`tryBuildFiltergraphExport`，被 `startExportJob` 与 `executeProductionRunExport` 两个导出入口共用）。其余 12 扇不在导出路径上，只列进报告、不改（任务书停点）。

| 入口 | 在不在导出路径 | 探测失败时今天怎样 | 本 PR |
|---|---|---|---|
| `electron/export/exportJobs.ts` `tryBuildFiltergraphExport` ← `startExportJob`（预览顶栏导出、片段节点导出、Agent `export_timeline`、旧版制作 Run 经渲染层）/ `executeProductionRunExport`（语义制作 Run） | 是 | 吞掉，按无音轨继续，报成功 | **改**：经唯一探测口 `probeExportAssets`，失败即导出失败 |
| `electron/assets/assetPreview.ts` | 否（画布预览派生） | 吞掉 → 没有预览、源即预览（取消照抛） | 不改，列报告 |
| `electron/assets/localizedAsset.ts` | 否（生成产物落地时长） | 吞掉 → 时长 undefined | 不改，列报告 |
| `electron/assets/videoImportNormalize.ts` | 否（导入可播性） | 吞掉 → 按 `probe_failed` 转码（偏安全） | 不改，列报告 |
| `electron/localSpeech/localSpeechTranscribe.ts` | 否（本地转写） | 往上抛 | 不改 |
| `electron/providerAdapter/certificationMedia.ts` | 否（模型认证） | 一律 `media_corrupt` | 不改 |
| `electron/review/technicalCheck.ts` | 否（技术体检，只标记） | 标成可疑（undecodable），不吞 | 不改 |
| `electron/settings/attentionSoundIpc.ts`（2 处） | 否（提示音导入） | 判 invalid | 不改 |
| `electron/video/deconstructVideo.ts` | 否（拆解） | 往上抛 | 不改 |
| `electron/video/detectShotCuts.ts` | 否（镜头切点） | 往上抛 | 不改 |
| `electron/video/extractAudioTrack.ts` | 否（抽音轨） | 往上抛 | 不改 |
| `electron/video/extractVideoFrame.ts`（2 处） | 否（抽帧） | 指定秒数时吞成 0 秒；其余往上抛 | 不改，列报告 |
| `electron/video/trimVideo.ts` | 否（剪片段成新素材） | 吞成时长 0 再夹范围 | 不改，列报告 |

导出路径上同一族（「拿不到 → 当没有」）但不是探测的，只列报告、不改：素材解析不成本地文件 → 整体退回无声 WebM；filtergraph 编译失败 → 记 ERROR 后退回 WebM；字幕 PNG 写盘失败 → 那条字幕静默丢掉（`writeTextOverlayFiles`）。

## 9 格

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我剪好片子点导出、时间轴里有一段素材 Nomi 读不出它的信息时，我想在开始编码前就知道是哪一段、该怎么办，而不是拿到一个没声音、却报「导出完成」的成片。步骤：① 时间轴放好片段（视频自带声 / 音频轨配乐）；② 点顶栏「导出 MP4」（或片段节点导出、Agent 导出）；③ 主进程逐个探测视频 / 音频素材；④a 全部读得出 → 照常导出，有声的有声、真没声的没声；④b 某个文件读不出 → 停在编码前，失败面写「读不出素材「文件名」…下一步：换掉用到它的片段，或重新导入」；④c ffprobe 不可用 → 失败面写「读取素材信息的组件不可用…下一步：重新安装 Nomi」；⑤ 换掉 / 重新导入后再导出。**不做**：不自动跳过坏片段（那是另一种「静默少一段」）、不改 WebM 回退、不新增界面组件。**已知坑**：现有失败面原样显示 Electron 的 IPC 外壳前缀（存量，所有导出失败都这样，报告里交协调）；一次只点名第一段读不出的素材。**真实任务**：① 登记素材 `speech-zh-only-hevc`（`8月12日.mov`，HEVC 1080p + AAC）截一段放进时间轴导出 → MP4 有音轨；② 同一文件截断一半（丢 moov）放进时间轴导出 → 失败面点名文件 + 下一步，中英各一张；③ ffprobe 指向不存在的路径 → 能力不可用文案。**指标**：主指标「探测失败的导出被报成成功的比例」目标 0（基线 100%：改前每一次都报成功）——量具 `electron/export/exportJobs.probeFailure.test.ts`；质量指标「探测失败文案带素材名（文件级）与下一步的比例」目标 100%——量具 `electron/export/exportAssetProbe.test.ts` 文案用例；护栏「探测成功的导出与改前一致（有音轨 / 真没音轨）」——量具同上回归用例 + 真导出 `ffprobe` 输出 | 测试文件 + 真导出截图 |
| ★1b 连带界面 | 预览上方失败行 `data-preview-export-error`（人在预览页）/ 后台通知 `export:<项目>`（离开了预览页）——都显示同一句主进程文案；片段节点导出的反馈条——同一句；Agent `export_timeline` 工具回执——启动即拒，错误正文就是这句（拿不到 jobId，`inspect_export_job` 无从查起）；任务面板——**没有行**（失败发生在建任务之前，与「项目不存在 / 清单不合法」同一类预检失败）；语义制作 Run——`needs_attention`，原文进 `production-run` 日志 | `previewExportFeedback.ts`、`exportToolCall.ts`、`productionRunDriverOps.ts` 读码 |
| ★2 谁说了算 | 概念「导出前的素材探测」（新登记 `export.asset-probe`）→ 唯一 owner `electron/export/exportAssetProbe.ts` 的 `probeExportAssets`：每个视频 / 音频素材要么拿到确定的探测结果（`hasAudio` 显式 true / false），要么整次导出失败；探测口径（ffprobe 可执行文件、失败分类码）的 owner 仍是 `electron/export/mediaProbe.ts`。允许的消费者：`electron/export/exportJobs.ts`。碰了 1 个概念；「这段有没有声音」只有一份（探测结果），不再有「没探到 = 没有」的第二种来源 | `node scripts/door-map.mjs probeMediaMetadata`（上表） |
| ★3 一致与复用 | 探测用现成的 ffprobe（`probeMediaMetadata`，不自写解析）；失败分类做在 ffprobe 唯一出口 `mediaProbe.ts`（加机器码 `probe_unavailable`，两条探测函数共用一个分类器，删掉两份重复的 catch）；取消沿用导出现有的 `ExportCancelledError`；文案走 `desktopT`，沿用 `network.unreachable` 那种「原因 + 下一步：…」写法；能力不可用的下一步沿用现有 `export.codecMissing` 的「重新安装 Nomi、不需要单独装 FFmpeg」（`ensureExecutable.ts` 只做执行位自愈、不提示，修复入口就是重装） | `git grep` / `check:self-written` |
| ★4 全状态 | 空（无视频 / 音频素材）：不探测，照常；加载（探测中）：预览仍显示「准备中」；成功有音轨：照常有声；成功真没音轨：照常无声（与改前一致）；**失败（单个文件读不出）**：停在编码前，失败面点名文件 + 下一步「换掉用到它的片段，或重新导入」；**能力不可用（ffprobe 找不到 / 起不来）**：停在编码前，文案「读取素材信息的组件不可用」+ 下一步「重新安装 Nomi」；**取消中**：探测被中止 → 报取消（`ExportCancelledError`），不报「读不出」；部分成功：不存在（任一段失败整次失败，不出缺一段声音的片子）；过期：不适用（探测结果不落盘）。文案中英各一条，不谈钱 | `check:i18n` + 文案测试 |
| 5 中途表 | 探测中关窗 / 退出：App 退出时 `abortAllActiveExports` 一并中止探测子进程（不留孤儿 ffprobe），导出以取消收场，不落任务；断网：探测纯本地，不受影响；重启：探测结果不落盘，重新点导出重新探测；连点：顶栏按钮忙态期间禁用（现有）；探测期间用户**没有可点的取消**（任务在探测之后才建）——见报告「要协调定的事」。全程不涉及花费 | `exportJobs.probeFailure.test.ts` 取消用例 |
| 6 外部数据与失败 | 外部来源：用户素材文件（导入 / 生成落盘）、随包 ffprobe（`@ffprobe-installer`，可被 `NOMI_FFPROBE_PATH` 覆盖）。偏差：截断 / 损坏的文件、没下载完整的产物、被外部程序删掉的文件、ffprobe 丢执行位或不存在；失败时用户看到上面两句之一，原始 ffprobe 输出只进日志（`logError`，路径脱敏），不进界面 | `electron/export/mediaProbe.ts` |
| ★7 性能 | 不适用：纯 bug 修复，不新增用户操作；每个视频 / 音频素材仍是一次 ffprobe（次数不变），结构校验提前到探测之前只会少起注定被拒的子进程 | 读码 |
| 8 真实条件 | macOS 本机真导出（中 / 英界面各一次失败面截图，自己 Read 过）；Windows / 最小窗口 / 干净安装 `unverified`（本线没有那台机器）；不花钱 | 截图路径见报告 |
| 拍板图清单 | 不适用：逻辑 bug，不改布局、不增删元素，只换主进程失败文案（`pure-bugfix`） | — |
| ★9 验收与回滚 | 见下（协调写，验收线只核这份）；回滚 = revert 本 PR 的修复提交（特征测试会重新变红） | `## 独立验收` |

## ★9 验收清单与反例（协调写；验收线只核这份）

| # | 检查 | 怎么证 |
|---|---|---|
| ① | 视频素材探测失败 → 导出不开始编码，状态「失败」，原因带素材名 | 单测（改前红、改后绿） |
| ② | 音频素材探测失败 → 同 ① | 单测 |
| ③ | ffprobe 不可用 → 「能力不可用」+ 下一步（中英） | 单测 + 文案测试 |
| ④ | 单个文件读不出 → 说清哪一段 + 下一步（中英） | 单测 + 真导出截图 |
| ⑤ | 探测成功有音轨 / 真没音轨 → 和改前一样 | 单测 + 真导出 `ffprobe` 输出 |
| ⑥ | 探测进行中点取消 → 照常取消，不报「探测失败」 | 单测 |
| ⑦ | 门表里导出路径上其它「探测失败当没有」的入口：逐个改掉或写明不改的理由；导出路径外的列进报告 | 门表 + 报告 |
| ⑧ | 真导出：真素材 MP4 有音轨；坏文件看到失败面，中英截图 | 截图路径 + `ffprobe` 输出 |

反例（每条都要红）：
- 把 catch 改回「按无音频处理」→ ①② 红；
- 只对 audio 报错、video 仍静默 → ① 红；
- 取消被报成探测失败 → ⑥ 红；
- 失败文案不带素材名 / 没有下一步 → ③④ 红。

这一类还会从哪回来（实现线逐条写清现在被什么挡住）：新的媒体类型、新的导出 profile、别的调用方自己 try/catch 探测。

### 「状态『失败』」在这里落成什么

探测发生在 `startExportJob` 建任务**之前**（任务的审计清单要用探测结果定音频 profile，没法先建任务再探测）。所以「失败」= 导出请求被拒、编码器一次都没被调用、任务表里不新增任务；界面上是现有的导出失败面（预览失败行 / 后台通知 / 片段节点反馈 / Agent 工具报错），与「项目不存在 / 清单不合法」这些预检失败同一个出口。要不要另外落一条「失败」的任务行，交协调定（见报告）。
