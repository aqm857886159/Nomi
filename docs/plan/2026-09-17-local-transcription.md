# 本地转写 provider（批次 3 · T-MO-11）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：已实现，真机验收过（mac arm64）。基线 e96614e14。任务书编号与 TODO 里已完成的模型可用性任务同号，本计划以 09-17 批次 3 任务书为准，不改旧 TODO 身份。

## 用户镜头

拆解视频的对白，今天只能走云端（APIMart Whisper / ElevenLabs Scribe）——没网、不想把素材传出去、额度用完，对白列就只能是空的。这次补的是第三条线：**在这台电脑上离线转写**，不联网、不花钱，语言从音频自己听出来。

首次用它要先下一次引擎与权重（≈575 MB），这件事**开跑前就说**，下载期间节点上有一行走着的进度；任何一步失败都说清是哪一步、为什么，并在分镜表上给一颗**「改用云端重试」**按钮。切换只能是用户点的那一下——代码不许在失败时自己切云端，那样用户会在不知情的情况下花钱，本地那条坏了也就再没人知道。

## 范围与不动项

**做**：`transcribe` taskKind 的第三个 provider（声明驱动，不是新概念）；可信下载（钉死版本 + 逐文件 sha256 + 原子落盘 + 进度 + 磁盘满单独成档）；sidecar 生命周期；长音频分段与接缝；错误分类与云端出口；供应链版本钉登记与门岗。

**不动**：云端那两条线的任何行为；拆解的切点 / 抽帧 / 报价 / 令牌那几段；引擎不进安装包（见下「打包边界」）。

**不做**（明确划掉，不是没做完）：第二个 ASR 引擎（sherpa-onnx / Parakeet）——单引擎裁决；Python 依赖或 native addon——前者被 Kdenlive 验证是坑，后者无 prior-art；自研解压器——系统自带 bsdtar 已经有。

**回滚**：逐里程碑 revert 本分支提交。缓存只写 `userData/model-cache/local-speech/`，不碰用户项目与原始素材。

## 先查别人

调研正本：`~/Desktop/nomi-scratch-0917/batch3/T-MO-11-local-transcription-prior-art.md`（比较了 whisper.cpp / sherpa-onnx / faster-whisper / Moonshine / Parakeet / 平台自带 / WASM 七条路，以及 OpenWhispr / Vibe / Buzz / Whishper / Kdenlive 五个近邻实现）。以下每条都是 2026-09-17 亲自打开读过的，不是凭印象：

- **同类桌面应用怎么接**：OpenWhispr（Electron + React，MIT）https://github.com/OpenWhispr/openwhispr/blob/main/src/helpers/whisperServer.js —— spawn 预编译 `whisper-server` 到本机随机端口、POST `/inference`、用 `response_format` 取时间戳。**我们照抄这条路线**（sidecar 而不是 native addon），因为查到的活跃桌面转写应用里没有一个走 node-gyp 编译。
- **为什么钉死版本**：https://github.com/OpenWhispr/openwhispr/blob/main/scripts/download-whisper-cpp.js 顶注原话——跟 latest 会让上游一次 bump 在两次发版之间静默改变转写输出而没有 diff 可审；同一个文件的注释还记着 Windows 缺 MSVC 运行时 DLL 会 0xC0000135 闪退（CUS-113）。**两条我们都吃下来了**（`docs/engineering/supply-chain-pins.json` + 成员清单里那四个 DLL）。
- **接口契约**：whisper.cpp 官方 server 文档 https://github.com/ggml-org/whisper.cpp/blob/master/examples/server/README.md ——`/inference` 的 multipart 字段与 verbose_json 响应形状。文档之外还用 0.0.10 二进制对真素材**实跑**逐字核对过（文档给依据，实跑给封印）。
- **权重来源**：https://huggingface.co/ggerganov/whisper.cpp ——官方 ggml 权重仓库，按 commit `5359861c` 钉死；每个权重的 sha256 由 HF 的 LFS 元数据给出，与我们实下载后算出的值逐字相同（两个独立来源对上）。
- **反例（这条路别走）**：Kdenlive 的 speech-to-text 让用户自己 `pip install` https://docs.kdenlive.org/en/effects_and_filters/speech_to_text.html ——社区正在推 `pywhispercpp` 想换成 sidecar 式 https://discuss.kde.org/t/support-whisper-cpp-for-speech-to-text-using-pywhispercpp/49900 。「让用户装 Python 依赖」已被验证是坑，不考虑。
- **仓库内现状**：`electron/catalog/elevenlabs.ts:109` 与 `electron/catalog/apimartAudios.ts:111` 是现有两条云端转写线，`electron/audioTaskRunner.ts:141` 是它们共用的解析器——本地这条接的是**同一个** taskKind、同一段结果处理，不是新概念。
- **共用地基**：`electron/video/depthVideoModelCache.ts:1` 原本独占「下载+校验+原子落盘」那份实现；本次抽成 `electron/downloads/verifiedAssetCache.ts:1` 两家同用，深度那份主体已删。

| 它提供 | 我们用 | 我们另写 | 我们拆散 |
|---|---|---|---|
| whisper.cpp 的多语言识别与 auto 语言检测 | whisper-server `/inference`，verbose_json | 不写任何 ASR 推理 | 不拆解码器内部 |
| 预编译 sidecar + Windows 的 MSVC 运行时 DLL | 同样钉死版本、逐文件 sha256、spawn 回环生命周期 | Nomi 自己的资产清单、缓存目录、取消与错误投影 | 不照搬它的多引擎与 GPU 静默 fallback |
| server 给的段级时间戳 | 折进统一的结果形状（与云端 verbose_json 同形） | 长素材按 30 秒窗口整数倍切、按句子边界续接、全局时间偏移归并 | 不重写模型内部那 30 秒推理窗口 |
| 系统自带 bsdtar（`tar -xf` 认 zip） | 直接用它解包 | 解包后逐成员 sha256 复验 | 不自研 zip 解析 |
| 既有 depthVideoModelCache 的 hardenedFetch + sha256 + 原子落盘 | 抽成共用原语两家同用 | 新增磁盘满分类 | **删掉** Depth 独占的那份下载主体 |

## 参考实现逐层对照

| 层 | 它怎么做 | 我们怎么做 | 判定 | 若没想到补在哪个阶段前 |
|---|---|---|---|---|
| 工具 | whisper-server HTTP multipart `/inference` | 同一 taskKind 声明 `localEngine`，走同一个 multipart | 一致 | 无 |
| 转录渲染 | OpenWhispr 把听写文字直接贴进输入框 | Nomi 把 segments 按时间归属到镜头，显示检测到的语言与失败原因 | 有意不同：视频分镜领域 | UI 接线前 |
| 会话 | server 常驻保温，供连续听写 | 一次任务一个进程，`finally` 必收 | 有意不同：批处理不是听写，保温换不来后台常驻 600 MB | 无 |
| 上下文 | prompt 字典 + 音频 | 只给音频，`language` 恒 `auto` | 有意不同：用户硬约束②，不留「选错语言」的路 | 无 |
| 模型与花费 | 多引擎 / 多 GPU 档，用户自己挑 | 单引擎单档（实测裁掉另外三档），本地不花钱；改用云端要重新走付费授权 | 有意不同：单引擎裁决 + 档位算式 | 无 |
| 控制流 | 自动 GPU fallback 与重试 | 每段重试一次，再失败带段号抛出；**禁止自动换云端** | 有意不同：硬约束要求失败可见 | 无 |
| 扩展 API | `/inference` 与 `/health` 都开放 | 只用固定 loopback endpoint、固定字段、受控二进制 | 一致 | 无 |
| 观测与测试 | 日志与健康检查 | 分段进度与错误类别；真素材 CER 与接缝复核；失败路径八条注入测试 | 一致 | 最终验收前 |
| 安全 | 固定 release，DLL 随 exe 分发 | 固定 sha256（含逐成员复验）、完整安装校验、只听回环、退出回收 | 一致 | 发布资产与打包验收前 |
| 出站 | 自己开 fetch | 走 `hardenedFetch` + `allowedPrivateOrigins` 精确到本次端口 | 有意不同：目的地策略只有一个 owner | 无 |

## HTTP 接触面裁决

`file` 派生自当前音频分段；`language` 常量 `auto`（用户硬约束）；`response_format` 常量 `verbose_json`（与云端解析契约同形）；`translate` 不用（要原语种）；`prompt` 不用（避免 UI locale 污染）；`temperature` 常量 `0.0`（否则「重试一次」变成掷骰子）；`model` 派生自校验通过的权重路径；`host` 常量 `127.0.0.1`；`port` 由 OS 分配；`threads` 由主机核数派生（夹在 2–8）。规范：whisper.cpp `examples/server/README.md`。偏差：只开放上述子集，不新增上游字段；分段进度与错误是**宿主事件**，不伪装成上游协议。

## 档位的算式（实测，不是拍脑袋）

真素材（`NOMI_REAL_MEDIA_DIR` 登记的中英混口播 120 秒，M5 / Metal），另用三段真素材复核：

| 档位 | 体积 | CER | 速度 | 裁决 |
|---|---|---|---|---|
| large-v3-turbo-q5_0 | 574 MB | 6.5% | 11.5× 实时 | **唯一入选** |
| large-v3-q5_0 | 1081 MB | 6.8% | 7.1× 实时 | 砍。贵 507 MB、慢 1.6 倍、质量在噪声里持平；产品演示那 40 秒它整段幻听成「请不吝点赞 订阅…」而 turbo 转对了。挂成「更稳」是卖降级 |
| medium-q5_0 | 539 MB | 8.2% | 13.3× 实时 | 砍。只小 35 MB 却更差 |
| small-q5_1 | 190 MB | 36.8% | 30× 实时 | 砍。对普通话输出**繁体**，把 "web coding" 听成「外部 coding」 |

只剩一档，所以**档案里连那个下拉都不要**（R2：没有行动价值的信息就删）。档位这套结构留着，是因为「弱机器 / 纯 CPU 的 Windows 要一个轻量档」是真实需求——但它得先有自己的实测数字。

## 打包边界（与任务书的一处有意偏离）

任务书写「`asarUnpack` + macOS 签名公证要覆盖该二进制」。实际裁决是**二进制根本不进安装包**，理由三条：① 权重 574 MB 进包等于让每个不用它的用户白下；② 这台打包链今天是 `identity: null` + afterPack 一次 ad-hoc `codesign --deep --sign -`，**没有 Developer ID、没有公证**——真做签名那天，一个第三方构建的二进制躺在包里只会更难；③ 它住在 userData、由我们 spawn，不掺进 app bundle 的签名边界，也就不需要被公证，同时天然绕开 asar 里放可执行文件那条坑。`electron/localSpeech/localSpeechPackaging.test.ts` 守的是**反方向**：哪天有人顺手把它打进包里就红。

## 里程碑与状态

1. ✅ 框架四列表登记（`docs/engineering/framework-boundaries.json`）。
2. ✅ 共用下载原语 + 删 Depth 那份主体；本地引擎五模块 + 接进 transcribe。
3. ✅ 拆解侧的转写线选择、进度 detail、失败类别与「改用云端重试」。
4. ✅ 供应链版本钉登记 + `check:supply-chain-pins` 门岗（含会红的判据测试）；R21 合同带门表。
5. ✅ Windows 真机（10.0.26200，20 核 CPU）：五个文件的 sha256 与清单逐字相同、`tar -xf` 解包、exe 起得来、120 秒音频 115.1 秒出稿（检测 chinese 0.998，88 段）——**约 1× 实时，比 mac 的 Metal 慢一个数量级**。这条实测直接改了产品行为：清单多一格 `gpuAccelerated`、每档多一个 `measuredCpuRealtimeFactor`，开跑前按**这台机器**的倍率报预计耗时，不拿 mac 的数字去糊 Windows。
6. ◻︎ 未完：英文真素材（本机没有，已登记欠账 `local-speech-english-real-media`）；拆解参数行里的「转写」下拉（等批次 2 的 T-DS-13 参数行组件，socket 已留在 `payload.transcribe`）；Windows 的 cuda / vulkan 加速档（上游有，但要按显卡分发 + 判驱动，等有真机数字再谈）。
7. ✅ 09-18 验收脚本复活 + 五条真素材跑通（`dec36f71f` / `dcdd0f74c`）：第 5 条那次提交给进度加了 `starting` 阶段，`scripts/local-speech-live-check.ts` 的二元三目把它当 transcribing 读 → 从 09-17 22:29 起脚本一条素材都跑不完（此前三张收据都在 21:56–21:59）。现在进度 switch 穷尽三阶段、默认素材集从登记表 `coverage[].test` 反查（transcription + transcription-english 一起跑），`scripts/**/*.ts` 收进 `check:test-types` 棘轮让 tsc 看得见这个目录。mac Metal 复验：zh-mixed 527s→380 段 13.2×、zh-only 547s→287 段 11.9×、en-librivox 180s→45 段（english 1.000）、en-nasa 240s→58 段（english **0.385**）、en-prelinger 240s→65 段（english 1.000），接缝时间倒退全 0。
8. ✅ **片头静音幻听已修（09-18）**：开引擎自带 VAD（`--vad` + 钉死的 Silero v5.1.2，885 KB，已进供应链登记）。没有 VAD 时 NASA 那条前 26 段全是 "Thank you."、第一句真内容被推到 126.0 秒、**约 72 秒真人讲话被吞掉**，语言探测采在静音上（置信 0.385）。四组参数同素材实测：`--vad` 幻听 0 段 / 首句 54.56s（与实测静音结束 54.17s 吻合）/ 置信 1.000；`-mc 0` 只断复读且首句时间戳报错成 30.0s；`-sns` 名字最像对症实测零作用。**不叠 `-mc 0`**——VAD 已解决，再加一道是并行版（P1）。argv 抽成纯函数 `buildServerArgs`，「VAD 必开」「语言必须 auto」由测试盯着。五条真素材复跑全绿：接缝倒退与相邻整句重复全 0，语言 en/zh 全部高置信。根因合同 `docs/fixes/2026-09-18-local-speech-silence-hallucination.root-cause.json`。
9. ◻︎ **两条没验到的，明说**：① **CER 未复算**——仓库里没有提交过参照真值，档位表那个 6.5% 在本机无法复现；VAD 改变了分段，中文两条的转写文字确有变化（「一堂客」→「一堂课」变好，也有变差的），这个差值**未量化**。要么把参照真值连同算 CER 的脚本提交进仓库，要么这一格永远只能靠人肉印象。② **Windows 的 `measuredCpuRealtimeFactor=1.04` 是 VAD 之前测的**——VAD 多一趟检测但又跳过非语音，净效应未知，本机测不了；「预计 N 分钟」那句提示在 Windows 上因此未复核。
10. ◻︎ **生产链路真发现（en-nasa）**：那条片头 54 秒是静音（`silencedetect -35dB`），引擎在上面幻听「Thank you.」×26 成为前 26 段，语言探测也因取样落在静音窗里跌到 0.39——用户镜头是「导入一条开头静场的采访，转写前半屏全是同一句废话」。**这条已由第 8 条解决，且当时我判的修法是错的**：我写的是「修在分段层，自己扫静音」，而引擎 0.0.10 自带 `--vad`——自研一份等于重复造轮子（R5）。留着这条记录是因为「先查别人」这一步我当时跳过了。
