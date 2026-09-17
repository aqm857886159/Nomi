/**
 * 本地转写（离线）—— sidecar 引擎与权重清单（白名单，唯一 owner）。
 *
 * 用户硬约束（2026-09-17）：
 *  ① 权重**必须多语言**——`ggml-*.en` 一条都不许进这份清单。不是「先不列」，是列进来就会有人顺手选，
 *     而英语权重对中文输入只会输出英文翻译或垃圾，那是静默错误（P1：不留逃生口）。
 *  ② 语言由**音频自动检测**（`language=auto`），UI 语言只作提示不作判据。
 *  ③ 引擎二进制**不进安装包**，首次使用才下载；来源钉死版本 + sha256。
 *  ④ **VAD 必开**（2026-09-18 加）：whisper 碰到没人说话的音频不会输出空，它会从训练语料里挑一句
 *     最常见的话填进去（英文 "Thank you."、中文「请不吝点赞 订阅」），而且默认会把上一窗口的文字
 *     当下一窗口的提示词，于是复读停不下来、**把后面的真人讲话一起吞掉**。NASA 那条真素材实测：
 *     片头 54 秒静音 → 前 26 段全是 "Thank you."、第一句真内容被推到 126 秒，**约 72 秒讲话凭空消失**，
 *     语言探测也因为只取最前面 30 秒而采在静音上（置信 0.385，等于拿一段空气判断这条片子说什么语言）。
 *     开 VAD 后同一条：幻听 0 段、首句真内容回到 54.56 秒（与实际静音结束 54.17 秒吻合）、置信 1.000。
 *
 * ── URL 为什么钉死、为什么不跟 latest ─────────────────────────────────────────
 * 上游 whisper.cpp 每天出 `bNNNN` 构建，**升一版就可能静默改变转写输出**（解码器阈值、VAD 默认值、
 * 分段规则都在动），而我们这边 diff 是空的——「同一条视频，昨天和今天出的字不一样」这种回归
 * 没人查得出来。OpenWhispr 的 `scripts/download-whisper-cpp.js` 顶注踩的正是这条，原话：
 * "Pinned to a tested build. Tracking the latest release let an upstream whisper.cpp bump change
 *  transcription output between app releases with no diff to review."
 * 所以：**引擎钉 release tag，权重钉 HuggingFace commit sha**（不用 `resolve/main`，分支会前进）。
 * 升版走 `docs/engineering/supply-chain-pins.json` 的巡检项，是一次带真素材复测的动作，不是顺手改个数字。
 *
 * ── 引擎二进制为什么取 OpenWhispr 的 fork 而不是上游 ───────────────────────────
 * 2026-09-17 实查两边的 release 资产：
 *  · 上游 `ggml-org/whisper.cpp` 的 `bNNNN` 构建**只出 Windows 与 Linux**，macOS 侧只有
 *    `whisper-*-xcframework.zip`（Apple 框架，不是可执行的 server）——mac arm64 无官方二进制可取。
 *  · 上游 Windows 包 `whisper-bin-x64.zip` 是 40 个文件的 `Release/` 目录，且**不带 MSVC 运行时**
 *    （实测无 msvcp140/vcruntime140）——在没装 VC++ 运行时的机器上是 0xC0000135 闪退（OpenWhispr CUS-113）。
 *  · `OpenWhispr/whisper.cpp` 0.0.10 两边都正好补上：mac 是单文件静态二进制（ad-hoc 签名，可直接跑），
 *    Windows 是单个 exe **外加 msvcp140 / vcruntime140 / vcruntime140_1 / vcomp140 四个运行时 DLL**。
 * 代价是「二进制由第三方组织托管」。这条用两道办法压住：**每个成员文件逐个 sha256 钉死**
 * （托管方换一个字节我们立刻红），加上 `docs/engineering/supply-chain-pins.json` 里那条带到期日的
 * 「改成我们自己构建/托管」欠账——登记不是防线（R17），所以它带到期日、到期即红。
 *
 * ── 为什么清单里只有一档（实测，不是拍脑袋）─────────────────────────────────────
 * 2026-09-17 用真素材（`NOMI_REAL_MEDIA_DIR` 登记的中英混口播 120 秒，M5 / Metal）逐档实测 CER，
 * 又拿另外三段真素材（技术口播 90s、产品演示 40s、纯中文口播 90s）复核，结论是**只有一档挣得到位置**：
 *
 *   档位                 体积     CER    速度      裁决
 *   large-v3-turbo-q5_0  574 MB   6.5%   11.5×实时  ← 唯一入选
 *   large-v3-q5_0       1081 MB   6.8%    7.1×实时  砍。贵 507 MB、慢 1.6 倍，质量在噪声里持平；
 *                                                  更要命的是产品演示那 40 秒它整段幻听成
 *                                                  「请不吝点赞 订阅 转发…」（Whisper 中文字幕语料的
 *                                                  经典幻觉），而 turbo 把同一段正确转了出来。
 *                                                  把它挂成「更稳」是在卖降级。
 *   medium-q5_0          539 MB   8.2%   13.3×实时  砍。只小 35 MB 却更差，没有存在理由。
 *   small-q5_1           190 MB  36.8%   30× 实时   砍。对普通话输出**繁体**、把 "web coding" 听成
 *                                                  「外部 coding」——省下的 384 MB 换来一份要逐句改的稿子，
 *                                                  不满足「中英都能用」。
 *
 * 所以这里**不摆一个只有一项的下拉**（R2：没有行动价值的信息就删）。档位这套结构留着，是因为
 * 「弱机器 / 纯 CPU 的 Windows 要一个更快的轻量档」是一条真实需求——但它得先有自己的实测数字，
 * 而不是先摆个选项再说。加第二档 = 补一段同样规格的实测（同素材、同表格），不是改个常量。
 */

import type { VerifiedAsset } from "../../downloads/verifiedAssetCache";

/** 缓存家族名：`userData/model-cache/local-speech/`。 */
export const LOCAL_SPEECH_CACHE_FAMILY = "local-speech";

/** 引擎 release 的钉死版本。改这个数字 = 换引擎，必须连带重测真素材（见文件头）。 */
export const LOCAL_SPEECH_ENGINE_RELEASE = "0.0.10";

/** 压缩包里的一个成员文件：解包后逐个按 sha256 复验，压缩包本身校验过不等于里面的东西没被换。 */
export type LocalSpeechEngineMember = Readonly<{ fileName: string; sizeBytes: number; sha256: string }>;

export type LocalSpeechEnginePlatform = Readonly<{
  /** `${process.platform}-${process.arch}`。没有这一条 = 这个平台不支持本地转写（显式 unsupported，不是 undefined，R17）。 */
  platformKey: string;
  /** 下载的压缩包本身（zip）。 */
  archive: VerifiedAsset;
  /** 解包后要落到磁盘的全部文件——少一个都算没装好。 */
  members: readonly LocalSpeechEngineMember[];
  /** 这些成员里哪一个是 whisper-server 可执行文件。 */
  executableFileName: string;
  /**
   * 这个构建有没有 GPU 加速。**它决定用户等多久，所以必须是实测出来的事实，不是猜的**：
   * mac 两条是 Metal 构建（2026-09-17 实测 120 秒音频 10.4 秒出结果，11.5× 实时）；
   * Windows 那条是 `-cpu` 构建，同一段音频在真机 20 核 CPU 上跑了 115.1 秒——**约 1× 实时**。
   * 差了一个数量级：十分钟的视频在 mac 上一分钟出稿，在 Windows 上要等十分钟。
   * 不把这件事说在前面，用户只会以为卡死了。
   */
  gpuAccelerated: boolean;
}>;

const ENGINE_BASE = `https://github.com/OpenWhispr/whisper.cpp/releases/download/${LOCAL_SPEECH_ENGINE_RELEASE}`;
const ENGINE_SOURCE_PAGE = "https://github.com/OpenWhispr/whisper.cpp/releases/tag/0.0.10";

/**
 * 每条的 `sha256` / `sizeBytes` 都是 2026-09-17 **实下载一次算出来的**（压缩包与解包后的每个成员各算一遍），
 * 不是抄 release 页面的。许可证：whisper.cpp 本体 MIT；Windows 那三个 vcruntime/msvcp/vcomp DLL 是
 * 微软 VC++ 可再发行运行时，按 Visual Studio 的 Redistributable 条款随应用分发。
 */
export const LOCAL_SPEECH_ENGINE_PLATFORMS: readonly LocalSpeechEnginePlatform[] = [
  {
    platformKey: "darwin-arm64",
    archive: {
      id: "whisper-server-darwin-arm64",
      fileName: "whisper-server-darwin-arm64.zip",
      downloadUrl: `${ENGINE_BASE}/whisper-server-darwin-arm64.zip`,
      sizeBytes: 1_326_241,
      sha256: "6a5f794e42549d61e7b46e1c1f296f05ec6569bfcb81b7e39c14860021f477de",
      license: "MIT",
      sourcePage: ENGINE_SOURCE_PAGE,
    },
    members: [
      {
        fileName: "whisper-server-darwin-arm64",
        sizeBytes: 3_651_584,
        sha256: "c990bc17e15a4e72d0a633b1a8d7538dc923a1539c6499e7308ad2cc204e60f0",
      },
    ],
    executableFileName: "whisper-server-darwin-arm64",
    gpuAccelerated: true,
  },
  {
    platformKey: "darwin-x64",
    archive: {
      id: "whisper-server-darwin-x64",
      fileName: "whisper-server-darwin-x64.zip",
      downloadUrl: `${ENGINE_BASE}/whisper-server-darwin-x64.zip`,
      sizeBytes: 1_368_068,
      sha256: "000395055f5cf058562e4fb8a882b679657beb02d6cbd890cb336fa789365e14",
      license: "MIT",
      sourcePage: ENGINE_SOURCE_PAGE,
    },
    members: [
      {
        fileName: "whisper-server-darwin-x64",
        sizeBytes: 3_460_376,
        sha256: "dd4a00a3cff4086c1533a7ee130e9cadb4dfe3bd5b421106e2a45595444f4f6c",
      },
    ],
    executableFileName: "whisper-server-darwin-x64",
    gpuAccelerated: true,
  },
  {
    platformKey: "win32-x64",
    archive: {
      id: "whisper-server-win32-x64-cpu",
      fileName: "whisper-server-win32-x64-cpu.zip",
      downloadUrl: `${ENGINE_BASE}/whisper-server-win32-x64-cpu.zip`,
      sizeBytes: 1_288_803,
      sha256: "360c35ae259c75d8846de97fd0db499448ed019c04fb96dc3807ededd8b41f3f",
      license: "MIT (whisper.cpp) + Microsoft VC++ Redistributable terms (vcruntime/msvcp/vcomp DLLs)",
      sourcePage: ENGINE_SOURCE_PAGE,
    },
    // 四个 DLL 少一个就是 0xC0000135 闪退（OpenWhispr CUS-113）——所以它们和 exe 一样是成员，不是「可选依赖」。
    members: [
      {
        fileName: "whisper-server-win32-x64-cpu.exe",
        sizeBytes: 2_081_792,
        sha256: "45b7bb48b87793b0bb7c8d0b278904c53b72598d17a6e23edfb9d15a41a23a51",
      },
      { fileName: "msvcp140.dll", sizeBytes: 557_728, sha256: "0f885b509a685d2bbfa652fed26b5fb31d88fbdab0a978c641d1c7b8aa460aa9" },
      { fileName: "vcruntime140.dll", sizeBytes: 124_544, sha256: "d5e4d9a3e835fa679450145d6a7d94e36573a509317111904d9b3712c30d9066" },
      { fileName: "vcruntime140_1.dll", sizeBytes: 49_792, sha256: "1f2d41c4aa5db0bc33ebf7b66d72943a817d7ce6cbe880502a9403823633093f" },
      { fileName: "vcomp140.dll", sizeBytes: 193_152, sha256: "55aba23cdcd6484fbb06f4155b8ca75adfce7a881f10afd0c49457165e677164" },
    ],
    executableFileName: "whisper-server-win32-x64-cpu.exe",
    // `-cpu` 构建，没有 GPU 加速。上游同版本有 cuda / vulkan 变体（773 MB / 24 MB），
    // 但那要按显卡分发、还要判有没有驱动——先用一定跑得起来的这条，等有真机数字再谈加档。
    gpuAccelerated: false,
  },
];

/** 权重档位。`id` 进用户设置、进 modelKey，改名等于换模型身份。 */
export type LocalSpeechTierId = "balanced";

export type LocalSpeechTier = Readonly<{
  id: LocalSpeechTierId;
  model: VerifiedAsset;
  /**
   * 实测 CER（字错率）。**算法与参照语料都在仓库里**：`scripts/local-speech-cer.ts` +
   * `tests/ux/fixtures/localSpeechReferences/`，收据 `docs/engineering/local-speech-cer-receipt.json`。
   *
   * 这个数**只覆盖有真外部真值的那部分素材**：语料五条里只有 LibriVox 那条读的是公有领域出版原文
   * （Project Gutenberg #21279），因此只有它算得出 CER。中文两条是用户自己的录音、NASA 与 Prelinger
   * 在 archive.org 上要么没有转写稿、要么只有 `.asr.` 开头的机器转写（拿 Whisper 的输出给 Whisper 当真值
   * 是循环论证），这三条目前只有冻结稿、只报漂移率。**所以这个数不代表中英混说那种输入的难度**，
   * 想让它代表，需要有人逐字校对中文那两条（manifest 里 provenance 改成 human-verified 即可，脚本不用改）。
   */
  measuredCer: number;
  /** 实测相对实时倍率（M5 / Metal，有 GPU 加速时）。 */
  measuredRealtimeFactor: number;
  /** 实测相对实时倍率（真 Windows 11 / 20 核 CPU，无 GPU 加速时）。开跑前的耗时提示按它算。 */
  measuredCpuRealtimeFactor: number;
}>;

/** HuggingFace `ggerganov/whisper.cpp` 的钉死 commit（2026-09-17 实查；仓库自 2024-10-29 起未动）。 */
const WEIGHTS_COMMIT = "5359861c739e955e79d9a303bcbc70fb988958b1";
const WEIGHTS_BASE = `https://huggingface.co/ggerganov/whisper.cpp/resolve/${WEIGHTS_COMMIT}`;
const WEIGHTS_SOURCE_PAGE = "https://huggingface.co/ggerganov/whisper.cpp";

/** HuggingFace `ggml-org/whisper-vad` 的钉死 commit（2026-09-18 实查）。 */
const VAD_COMMIT = "9ffd54a1e1ee413ddf265af9913beaf518d1639b";

/**
 * Silero VAD（ggml 转换版），whisper.cpp 官方 `models/download-vad-model.sh` 取的就是这个仓库。
 * **不自研静音预扫**：引擎自己带 `--vad`，系统已经给的能力不许再长一份自研版（R5「先查别人」）。
 *
 * 为什么是 v5.1.2 而不是同仓的 v6.2.0：2026-09-18 拿 NASA 那条片头静音素材两个都实测，
 * 幻听段数、首句位置、语言置信三项完全一致（0 段 / 54.5s / 1.000），没有可测得的差别；
 * 同分就取 whisper.cpp 文档与下载脚本列在前面的那个，少一份「我们为什么和上游不一样」要解释。
 * 885 KB，相对权重的 574 MB 可以忽略，所以**不做成开关**——没有「要不要防幻听」这种选择题（P1）。
 */
export const LOCAL_SPEECH_VAD_MODEL: VerifiedAsset = {
  id: "ggml-silero-v5.1.2",
  fileName: "ggml-silero-v5.1.2.bin",
  downloadUrl: `https://huggingface.co/ggml-org/whisper-vad/resolve/${VAD_COMMIT}/ggml-silero-v5.1.2.bin`,
  sizeBytes: 885_098,
  // 2026-09-18 实下载后 shasum -a 256 得到。
  sha256: "29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf",
  license: "MIT",
  sourcePage: "https://huggingface.co/ggml-org/whisper-vad",
};

export const LOCAL_SPEECH_TIERS: readonly LocalSpeechTier[] = [
  {
    id: "balanced",
    model: {
      id: "ggml-large-v3-turbo-q5_0",
      fileName: "ggml-large-v3-turbo-q5_0.bin",
      downloadUrl: `${WEIGHTS_BASE}/ggml-large-v3-turbo-q5_0.bin`,
      sizeBytes: 574_041_195,
      // 实下载后 shasum -a 256 得到，与 HF LFS 元数据逐字相同（两个独立来源对上）。
      sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
      license: "MIT",
      sourcePage: WEIGHTS_SOURCE_PAGE,
    },
    // 2026-09-18 由 scripts/local-speech-cer.ts 实测：LibriVox 那条（唯一有出版原文当真值的素材）
    // 编辑距离 65 / 参照 1109 字 = 5.86%，其中约 12 字是纯数字写法差异（thirty-five ↔ 35，口径有意不折叠）。
    // 取代此前的 0.065：那个数声称测自「中英混口播 120 秒」，但参照真值与算法都没进过仓库，本机复现不出来。
    // 两者口径不同、素材也不同，**不是同一个数变好了**，别当成质量提升读。
    measuredCer: 0.0586,
    // 2026-09-18 同法实测（同一条登记素材的前 120 秒，端到端含起进程与取音轨，开 VAD，三次）：
    // 9.6 / 9.9 / 10.2 秒 → 12.5 / 12.2 / 11.7× 实时。
    measuredRealtimeFactor: 12.1,
    // 2026-09-18 在同一台真 Windows 11（10.0.26200，20 核）上重测，因为 1.04 那个数是开 VAD **之前**测的：
    // 同一条素材的同一段 120 秒，生产同款线程数（-t 8），五次取样 88.0 / 87.4 / 89.8 / 88.2 / 89.2 秒
    // → 1.34–1.38×，取 1.35。**VAD 不额外花时间**：开与不开在同一轮里差 0.6 秒，因为这条素材只有 0.9%
    // 的非语音（引擎 stderr 原话 "Reduced audio from 1920000 to 1902399 samples"），VAD 没什么可摘。
    // 权重冷盘（换个文件名逼它真读 574MB）也是 89.2 秒，载入只占 0.8 秒，不是瓶颈。
    // 2026-09-17 那次记的 115.1 秒（1.04×）没能复现，而当时的条件（哪一段音频、几个线程、机器多忙）没有记录——
    // 这正是本次把算法与素材一起钉进仓库的原因。
    measuredCpuRealtimeFactor: 1.35,
  },
];

export const LOCAL_SPEECH_DEFAULT_TIER: LocalSpeechTierId = "balanced";

export function localSpeechTier(id: string): LocalSpeechTier | undefined {
  return LOCAL_SPEECH_TIERS.find((tier) => tier.id === id);
}

/**
 * 当前平台的引擎。**没有就是没有**——返回 undefined，由调用方翻成一句「这台机器不支持本地转写，
 * 改用云端」的显式错误，而不是让下载那一步以空路径失败（R17：能力可能不存在时用显式 unsupported）。
 */
export function localSpeechEngineForPlatform(
  platform: string = process.platform,
  arch: string = process.arch,
): LocalSpeechEnginePlatform | undefined {
  const key = `${platform}-${arch}`;
  return LOCAL_SPEECH_ENGINE_PLATFORMS.find((entry) => entry.platformKey === key);
}

/** 清单里所有下载源的 origin——出站白名单与 `check:outbound-policy` 共用。 */
export function localSpeechAssetOrigins(): readonly string[] {
  const urls = [
    ...LOCAL_SPEECH_ENGINE_PLATFORMS.map((entry) => entry.archive.downloadUrl),
    ...LOCAL_SPEECH_TIERS.map((tier) => tier.model.downloadUrl),
    LOCAL_SPEECH_VAD_MODEL.downloadUrl,
  ];
  return [...new Set(urls.map((url) => new URL(url).origin))];
}
