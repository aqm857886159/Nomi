/**
 * 「提取深度」的界面文案（zh-CN / en，R15）。
 *
 * 三条写作纪律，都是产品决定不是排版偏好：
 * ① **没有第一屏**（2026-09-07 用户两次拍板）。第一版是整节点八行参数 + 四行说明，
 *    用户原话「不够简单、丑、不知道怎么用」；第二版收成一个小面板，用户原话
 *    「其实如果这么砍了之后 也没啥设计的」。所以现在一个字的表单文案都不剩：
 *    一个动作名、一句悬停说明、几句进度、几句错误。
 * ② **诚实边界不许消失**（§12.4）。深度参考不承载手指细节、表情、衣物飘动，而且那次真实
 *    付费 A/B 里原片在「具体手部动作」上是**赢**的。面板砍了，它搬进 `action.hint`——
 *    用户在按下之前唯一会读的那一处。是换位置，不是删掉它。
 * ③ **每条错误都要能说出下一步**。压成一句「处理失败」等于没说
 *    （check:outbound-policy 规则 4 抓的正是那一族）。
 *
 * 一路删掉的键（P1：没有消费方就不留）：`source.*`（源就是被选中的那个节点）、
 * `direction.*` / `people.*`、`resolution.*` / `fps.*` / `smoothing.*` / `trim.*`
 * （配方固定，界面上没有它们的位置）、`mode.*`（输出只剩深度一种，骨架链同 commit 删）、
 * `advanced.*`（「高级」不存在了，那句边界搬进 action.hint）、`action.start`（没有开始按钮，
 * 点动作就是开始）、`progress.frames|bytes|measuring`（卡顶只报阶段名 + 预计剩余）。
 */
export const zhVideoDepth = {
  action: {
    label: '提取深度',
    /** 产物标题的后缀：`镜头 1 · 深度`。比动作名短——标题里已经有「镜头 1」在前面了。 */
    productSuffix: '深度',
    /** 悬停说明 = §12.4 那句诚实边界的新家。按下之前唯一会读到的一处，所以它必须说全。 */
    hint: '在本机把这段视频跑成深度视频，拿去当动作参考。保留动作结构与远近；不含手指、表情、衣物细节，也不保证比直接喂原片更准。',
    desktopOnly: '这个动作要在桌面版里跑（推理在本机）。',
  },
  phase: {
    downloading: '正在下载模型权重',
    extracting: '正在抽帧',
    warming: '正在预热 GPU',
    processing: '正在逐帧推理',
    encoding: '正在合成视频',
    done: '完成',
    cancelled: '已取消',
  },
  progress: {
    eta: '预计还要 {{eta}}',
    /** 权重只下这一次。进度和推理进度共用派生卡顶那一条，不弹窗。 */
    download: '下载模型 {{size}}… {{percent}}%',
  },
  error: {
    'source-unavailable': '读不到那段源视频。它可能已经被移出项目——重新选一段再试。',
    'source-unmeasurable': '量不出这段视频的尺寸或时长，没法开跑。换一段视频，或先把它导出成 mp4。',
    'over-budget': '这段片子太长，跑完要等很久。先把它剪短一点再提取深度。',
    'model-download-failed': '模型权重没下完。检查网络或代理后重试——已经下的部分不会留下坏文件。',
    'webgpu-unavailable': '这台机器上没有可用的 WebGPU，这个动作跑不了。我们不退 CPU：那会把几秒的处理变成十几分钟。',
    'inference-failed': '推理中途出错了。重试一次；一直失败就换一段视频。',
    'media-failed': 'ffmpeg 抽帧或合成失败。确认这段视频能正常播放，再重试。',
    'already-running': '这个项目已经有一个深度任务在跑。等它结束或先取消它。',
  },
} as const

export const enVideoDepth = {
  action: {
    label: 'Extract depth',
    productSuffix: 'Depth',
    hint: 'Run this clip through a local depth pass to use as a motion reference. Keeps body motion and near/far; no finger, face or cloth detail, and not guaranteed to beat the original clip.',
    desktopOnly: 'This action runs in the desktop app (inference happens on your machine).',
  },
  phase: {
    downloading: 'Downloading model weights',
    extracting: 'Extracting frames',
    warming: 'Warming up the GPU',
    processing: 'Running inference',
    encoding: 'Encoding the video',
    done: 'Done',
    cancelled: 'Cancelled',
  },
  progress: {
    eta: 'About {{eta}} left',
    download: 'Downloading model {{size}}… {{percent}}%',
  },
  error: {
    'source-unavailable': 'That source video could not be read. It may have been removed from the project — pick another one.',
    'source-unmeasurable': 'The size or duration of this video could not be measured, so the run was not started. Try another clip, or export it to mp4 first.',
    'over-budget': 'This clip is too long to finish in reasonable time. Trim it down first, then extract depth.',
    'model-download-failed': 'The model weights did not finish downloading. Check your network or proxy and retry — no partial file is kept.',
    'webgpu-unavailable': 'No usable WebGPU on this machine, so this action cannot run. There is no CPU fallback on purpose: it would turn seconds into a quarter of an hour.',
    'inference-failed': 'Inference failed partway through. Retry once; if it keeps failing, try another clip.',
    'media-failed': 'ffmpeg could not extract or encode the frames. Check that the clip plays, then retry.',
    'already-running': 'This project already has a depth run going. Wait for it or cancel it first.',
  },
} as const
