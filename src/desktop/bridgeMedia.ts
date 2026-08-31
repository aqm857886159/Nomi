/**
 * 媒体类桥口（抽帧 / 胶片条 / 按镜头拆 / 全局截图）的类型。
 * 从 bridge.ts 摘出来：那个文件已经顶到 800 行上限（R9），而这几口本来就自成一族（都走 electron/video、
 * electron/screenshot，与项目/模型/浏览器那几族无关）。
 */

export type ScreenshotHotkeyStatus = {
  enabled: boolean
  accelerator: string
  /** 键真抢到了吗——被别的应用占用时 Electron 的 register 只静默返回 false。 */
  registered: boolean
  /** macOS 屏幕录制权限：granted / denied / restricted / not-determined / unknown。 */
  screenAccess: string
}

export type DesktopMediaBridge = {
  video: {
    /** 视频抽帧（首/尾帧/指定秒）→ 项目素材 nomi-local:// URL。通用基建，见 electron/video/extractVideoFrame.ts。 */
    extractFrame: (payload: {
      videoUrl: string
      which: 'first' | 'last' | number
      projectId: string
      forceRerun?: boolean
    }) => Promise<{ url: string }>
    /** 胶片缩略图条：16 帧横向拼条 jpg → 项目素材 URL（时间轴 clip 全员真帧渲染用）。 */
    extractFilmstrip: (payload: {
      videoUrl: string
      projectId: string
      forceRerun?: boolean
    }) => Promise<{ url: string; tiles: number; tileHeight: number }>
    /**
     * 按切镜检测：找出视频里的画面切点 + 一张对齐的联系表缩略图。见 electron/video/detectShotCuts.ts。
     * cuts 是**低阈值全集带分数**——灵敏度滑杆在前端按 score 过滤，不重跑 ffmpeg。
     */
    detectShotCuts: (payload: {
      videoUrl: string
      projectId: string
    }) => Promise<{
      cuts: { seconds: number; score: number }[]
      durationSeconds: number
      sheetUrl: string | null
      sheetColumns: number
      sheetTileHeight: number
      truncated: boolean
    }>
    /**
     * 视频拆解：切镜 + 每镜多帧读图 + 音轨转写 → 结构化分镜表。见 electron/video/deconstructVideo.ts。
     * 与 detectShotCuts 的区别：那个只找切点（本地 ffmpeg、秒级、零成本），这个**读得懂内容**（要调模型、慢、花钱）。
     * `failedShotIndexes` 是画面分析没成功的镜号——诚实回报，那几镜其余字段（如对白）仍可用。
     */
    deconstruct: (payload: {
      videoUrl: string
      projectId: string
      threshold?: number
      framesPerShot?: number
      customColumns?: { name: string; hint?: string }[]
      concurrency?: number
    }) => Promise<{
      shots: {
        index: number
        startSeconds: number
        endSeconds: number
        durationSeconds: number
        sourceFrameUrl: string
        shotSize: string
        mood: string
        visual: string
        onScreenText: string
        dialogue: string
        carriedOver: boolean
        imagePrompt: string
        motionPrompt: string
        custom: Record<string, string>
        visionFailed?: boolean
      }[]
      durationSeconds: number
      hasAudio: boolean
      failedShotIndexes: number[]
    }>
  }
  /**
   * 全局截图热键（默认关，见 electron/screenshot/screenshotHotkey.ts）。
   * `registered=false` 表示这组键**没抢到**（被别的应用占了，Electron 的 register 只静默返回 false）。
   * `screenAccess !== 'granted'` 表示 macOS 屏幕录制没授权——这项**没法程序化申请**，只能指路系统设置。
   */
  screenshot: {
    get: () => Promise<ScreenshotHotkeyStatus>
    set: (payload: { enabled: boolean; accelerator: string }) => Promise<ScreenshotHotkeyStatus>
    openPermissionSettings: () => Promise<{ ok: boolean }>
    setProjectId: (projectId: string) => Promise<{ ok: boolean }>
    /** 走查专用：handler 只在主进程 NOMI_E2E=1 时注册（全局热键是 OS 级按键，Playwright 发不出去）。 */
    e2eCapture?: () => Promise<{ ok: boolean }>
    onCaptured: (cb: (payload: { url: string; width: number; height: number }) => void) => () => void
    onDenied: (cb: (payload: { screenAccess: string }) => void) => () => void
    onFailed: (cb: (payload: { reason: string }) => void) => () => void
  }
}
