import { app, ipcMain } from "electron";

// locale 归一是纯逻辑，住在 electron-free 的 desktopLocale.ts（打包裸 Node launcher 也要 require 它，
// 不能碰 electron）。本地引来给 setDesktopLocale 用，再原样导出——保持 i18n 对既有消费者的公开面不变
//（P1：函数只此一处定义，i18n 只是转口）。
import {
  normalizeDesktopLocale,
  getDesktopLocale,
  setDesktopLocale,
  type DesktopLocale,
} from "./desktopLocale";
export { normalizeDesktopLocale, getDesktopLocale, setDesktopLocale, type DesktopLocale };

const translations = {
  "zh-CN": {
    "workspace.selectTitle": "选择 Nomi 项目文件夹",
    "workspace.openButton": "打开文件夹",
    "workspace.invalidFolder": "未选择有效的文件夹",
    "workspace.protectedFolder": "“{{path}}” 是主目录或系统关键目录，不能作为 Nomi 项目文件夹（会污染你的照片/音乐/系统文件）。请新建或另选一个空文件夹。",
    "workspace.initializeTitle": "初始化 Nomi 项目文件夹？",
    "workspace.initializeDetail": "Nomi 会在此文件夹创建 .nomi/，并把生成的图片、视频保存到 assets/ 和 exports/.\n\n{{path}}",
    "common.cancel": "取消",
    "common.initialize": "初始化",
    "common.unknownError": "未知错误",
    "dreamina.reusedLogin": "即梦已复用本机登录态，无需重新扫码。Nomi 会刷新当前登录状态。",
    "dreamina.loginStartFailed": "发起即梦登录失败：{{message}}",
    "dreamina.missingDeviceCode": "缺少 device_code",
    "dreamina.loginSuccess": "登录成功",
    "dreamina.waiting": "等待授权中…",
    "dreamina.loginFailed": "登录失败",
    "dreamina.installed": "即梦 CLI 已安装",
    "dreamina.windowsInstall": "Windows 暂请在 WSL 或手动安装即梦 CLI（curl -fsSL https://jimeng.jianying.com/cli | bash）。",
    "dreamina.installTimeout": "安装超时，请稍后重试或终端手动安装。",
    "dreamina.installFailed": "安装失败：{{message}}",
    "dreamina.installComplete": "即梦 CLI 安装完成。",
    "dreamina.installIncomplete": "安装未完成：{{message}}",
    "tasks.trackingLost": "本地任务追踪已丢失（可能因并发过高被清理）。该任务可能已在供应商侧完成——请稍后重试或在供应商后台查看。",
    "tasks.unknown": "未知任务：该任务不在本地待办缓存中（可能从未受理或 id 有误）。",
    "tasks.unrecognizedStatus": "上游返回了无法识别的任务状态：「{{status}}」。连续查询 {{polls}} 次、持续 {{seconds}} 秒都是这个状态，Nomi 按失败处理。该任务也可能仍在供应商侧运行——请到供应商后台核对。",
    "tasks.pollTimedOut": "等待生成结果超时（已等 {{seconds}} 秒，最后状态：{{status}}）。任务可能仍在供应商侧运行——请到供应商后台核对，或稍后重新拉取结果。",
    // ⚠️ 长度纪律：错误卡大标题走 classifyError.truncateLine，**超 100 字会被截尾**（那正是
    // 「该怎么办」那半句）。这两条 key 因此写得短，完整上下文留在 raw / 上游原话里。
    "tasks.noQueryOperation": "这个模型没有配置「查询结果」接口，而本次创建也没有返回任何产物——没有第二次查询可发，已按失败处理。请检查该模型的接入配置。",
    "tasks.completedWithoutOutput": "供应商报告任务完成，但没有返回可用产物；已按失败处理。请检查该模型的结果接口。",
    "tasks.missingTaskId": "供应商没有返回任务编号，无法安全查询结果；已按失败处理。请检查该模型的创建接口。",
    "tasks.upstreamSaid": "（上游原话：{{detail}}）",
    "textTask.imagesUnreadable": "参考图都读不出来（{{count}} 张），没法让模型看图作答。请检查素材是否还在项目里。",
    "updater.devUnavailable": "开发模式下不可用，请在安装版中检查更新",
    "agent.confirmTimeout": "工具确认超时（长时间无响应，已自动跳过）",
    "agent.sessionCancelled": "会话已取消",
    "experience.untitled": "未命名经验",
    "browser.promptCategory.image": "图片提示词",
    "browser.promptCategory.video": "视频提示词",
    "export.missingWebmInput": "导出失败：缺少 WebM 输入数据",
    "export.missingProjectId": "导出失败：缺少项目 ID",
    "export.projectNotFound": "导出失败：找不到项目",
    "export.reveal.missingProjectId": "打开导出位置失败：缺少项目 ID",
    "export.reveal.missingPath": "打开导出位置失败：缺少导出文件路径",
    "export.reveal.outsideExports": "打开导出位置失败：只能打开当前项目 exports 文件夹内的文件",
    "export.reveal.fileMissing": "打开导出位置失败：导出文件不存在",
    "export.codecMissing": "导出失败：MP4 编码组件缺失，请重新安装 Nomi。你不需要单独安装 FFmpeg。",
    "export.inputMissing": "导出失败：输入视频不存在",
    "export.inputEmpty": "导出失败：输入视频为空",
    "export.detail": "导出失败：{{detail}}",
    "export.mp4NotProduced": "导出失败：MP4 文件未生成",
    "export.mp4Empty": "导出失败：MP4 文件为空",
    "production.reconcile.noTaskId": "供应商任务标识尚未收到，不能自动对账",
    "production.export.mustBeRelative": "导出必须返回项目目录内的相对路径",
    "production.export.escapesProject": "导出路径不能离开项目目录",
    "production.export.fileMissing": "导出文件不存在",
    "production.export.notAFile": "导出结果不是文件",
    "production.resume.noTaskId": "尚未收到供应商任务标识，不能自动恢复；请保持暂停并联系供应商核对",
    "production.approve.roughCutFirst": "请先完成粗剪审看，再单独批准导出",
    "dubbing.diskWriteFailed": "配音生成失败：音频落盘异常",
    "dubbing.noText": "配音生成失败：没有台词文本",
    "dubbing.noVoice": "配音生成失败：未选择音色",
    "dubbing.networkError": "配音生成失败（{{vendor}} 网络错误）：{{detail}}",
    "dubbing.httpError": "配音生成失败（{{vendor}} HTTP {{status}}）：{{detail}}",
    "dubbing.emptyAudio": "配音生成失败：供应商返回空音频",
    "transcribe.noAudio": "转写失败：未提供音频（请先连接或上传一个音频）",
    "transcribe.networkError": "转写失败（{{vendor}} 网络错误）：{{detail}}",
    "transcribe.httpError": "转写失败（{{vendor}} HTTP {{status}}）：{{detail}}",
    "transcribe.noText": "转写失败：供应商未返回文本",
    "transcribe.unreachable": "转写失败：音频地址无法访问",
    "common.noDetail": "(无详情)",
  },
  en: {
    "workspace.selectTitle": "Choose a Nomi project folder",
    "workspace.openButton": "Open folder",
    "workspace.invalidFolder": "No valid folder was selected",
    "workspace.protectedFolder": "“{{path}}” is your home folder or a protected system folder and cannot be used as a Nomi project folder. Choose or create an empty folder instead.",
    "workspace.initializeTitle": "Initialize this Nomi project folder?",
    "workspace.initializeDetail": "Nomi will create .nomi/ here and save generated images and videos in assets/ and exports/.\n\n{{path}}",
    "common.cancel": "Cancel",
    "common.initialize": "Initialize",
    "common.unknownError": "Unknown error",
    "dreamina.reusedLogin": "Dreamina reused the existing local sign-in. No new QR scan is needed; Nomi will refresh the current status.",
    "dreamina.loginStartFailed": "Could not start Dreamina sign-in: {{message}}",
    "dreamina.missingDeviceCode": "Missing device_code",
    "dreamina.loginSuccess": "Signed in",
    "dreamina.waiting": "Waiting for authorization…",
    "dreamina.loginFailed": "Sign-in failed",
    "dreamina.installed": "Dreamina CLI is installed",
    "dreamina.windowsInstall": "On Windows, install Dreamina CLI in WSL or manually with: curl -fsSL https://jimeng.jianying.com/cli | bash",
    "dreamina.installTimeout": "Installation timed out. Try again later or install it manually in a terminal.",
    "dreamina.installFailed": "Installation failed: {{message}}",
    "dreamina.installComplete": "Dreamina CLI installation completed.",
    "dreamina.installIncomplete": "Installation did not complete: {{message}}",
    "tasks.trackingLost": "Local task tracking was lost, possibly because too many tasks were running. The provider may still have completed it; try again later or check the provider dashboard.",
    "tasks.unknown": "Unknown task: it is not in the local pending-task cache. It may never have been accepted, or its ID may be incorrect.",
    "tasks.unrecognizedStatus": "The provider returned an unrecognized task status: “{{status}}”. It stayed that way for {{polls}} polls over {{seconds}}s, so Nomi is treating the task as failed. It may still be running on the provider side — check your provider dashboard.",
    "tasks.pollTimedOut": "Timed out waiting for the result (waited {{seconds}}s, last status: {{status}}). The task may still be running on the provider side — check your provider dashboard or fetch the result again later.",
    "tasks.noQueryOperation": "This model has no result-query operation and the create call returned nothing. Check its setup.",
    "tasks.completedWithoutOutput": "The provider reported completion but returned no usable output. Check this model's result endpoint.",
    "tasks.missingTaskId": "The provider did not return a task ID, so Nomi cannot safely query the result. Check this model's create endpoint.",
    "tasks.upstreamSaid": " (Upstream said: {{detail}})",
    "textTask.imagesUnreadable": "None of the {{count}} reference image(s) could be read, so the model cannot answer from the image. Check that the assets are still in the project.",
    "updater.devUnavailable": "Updates are unavailable in development mode. Check for updates in an installed build.",
    "agent.confirmTimeout": "Tool confirmation timed out and the action was skipped",
    "agent.sessionCancelled": "The session was cancelled",
    "experience.untitled": "Untitled experience",
    "browser.promptCategory.image": "Image prompts",
    "browser.promptCategory.video": "Video prompts",
    "export.missingWebmInput": "Export failed: missing WebM input data",
    "export.missingProjectId": "Export failed: missing project ID",
    "export.projectNotFound": "Export failed: project not found",
    "export.reveal.missingProjectId": "Could not open export location: missing project ID",
    "export.reveal.missingPath": "Could not open export location: missing export file path",
    "export.reveal.outsideExports": "Could not open export location: only files inside this project's exports folder can be opened",
    "export.reveal.fileMissing": "Could not open export location: the export file does not exist",
    "export.codecMissing": "Export failed: the MP4 encoder is missing. Reinstall Nomi — you do not need to install FFmpeg separately.",
    "export.inputMissing": "Export failed: the input video does not exist",
    "export.inputEmpty": "Export failed: the input video is empty",
    "export.detail": "Export failed: {{detail}}",
    "export.mp4NotProduced": "Export failed: no MP4 file was produced",
    "export.mp4Empty": "Export failed: the MP4 file is empty",
    "production.reconcile.noTaskId": "The provider task ID has not arrived yet, so automatic reconciliation is not possible",
    "production.export.mustBeRelative": "Export must return a path relative to the project directory",
    "production.export.escapesProject": "The export path cannot leave the project directory",
    "production.export.fileMissing": "The export file does not exist",
    "production.export.notAFile": "The export result is not a file",
    "production.resume.noTaskId": "The provider task ID has not arrived yet, so automatic resume is not possible. Keep it paused and check with the provider.",
    "production.approve.roughCutFirst": "Finish reviewing the rough cut first, then approve the export separately",
    "dubbing.diskWriteFailed": "Voiceover failed: could not write the audio to disk",
    "dubbing.noText": "Voiceover failed: no dialogue text",
    "dubbing.noVoice": "Voiceover failed: no voice selected",
    "dubbing.networkError": "Voiceover failed ({{vendor}} network error): {{detail}}",
    "dubbing.httpError": "Voiceover failed ({{vendor}} HTTP {{status}}): {{detail}}",
    "dubbing.emptyAudio": "Voiceover failed: the provider returned empty audio",
    "transcribe.noAudio": "Transcription failed: no audio provided (connect or upload an audio clip first)",
    "transcribe.networkError": "Transcription failed ({{vendor}} network error): {{detail}}",
    "transcribe.httpError": "Transcription failed ({{vendor}} HTTP {{status}}): {{detail}}",
    "transcribe.noText": "Transcription failed: the provider returned no text",
    "transcribe.unreachable": "Transcription failed: the audio URL is unreachable",
    "common.noDetail": "(no details)",
  },
} as const;

type DesktopTranslationKey = keyof (typeof translations)["zh-CN"];

export function desktopT(key: DesktopTranslationKey, values: Record<string, string | number> = {}): string {
  let text: string = translations[getDesktopLocale()][key];
  for (const [name, value] of Object.entries(values)) {
    text = text.replace(new RegExp(`\\{\\{${name}\\}\\}`, 'g'), String(value));
  }
  return text;
}

// i18n 相关 IPC 一处收口（避免主进程巨壳继续膨胀，R9）：
//  · set-locale：渲染层切语言 → 同步桌面侧（原生菜单/对话框文案）。
//  · get-system-locale：首启无存储偏好时，渲染层同步探测 OS 语言（app.getLocale() 由 --lang/系统设定）。
export function registerI18nIpc(): void {
  ipcMain.on("nomi:i18n:set-locale", (_event, locale: unknown) => setDesktopLocale(locale));
  ipcMain.on("nomi:i18n:get-system-locale", (event) => {
    try {
      event.returnValue = { ok: true, value: app.getLocale() };
    } catch (error) {
      event.returnValue = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
