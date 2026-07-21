export type DesktopLocale = "zh-CN" | "en";

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
    "updater.devUnavailable": "开发模式下不可用，请在安装版中检查更新",
    "agent.confirmTimeout": "工具确认超时（长时间无响应，已自动跳过）",
    "agent.sessionCancelled": "会话已取消",
    "browser.promptCategory.image": "图片提示词",
    "browser.promptCategory.video": "视频提示词",
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
    "updater.devUnavailable": "Updates are unavailable in development mode. Check for updates in an installed build.",
    "agent.confirmTimeout": "Tool confirmation timed out and the action was skipped",
    "agent.sessionCancelled": "The session was cancelled",
    "browser.promptCategory.image": "Image prompts",
    "browser.promptCategory.video": "Video prompts",
  },
} as const;

type DesktopTranslationKey = keyof (typeof translations)["zh-CN"];

let currentLocale: DesktopLocale = "zh-CN";

export function setDesktopLocale(value: unknown): void {
  currentLocale = value === "en" || (typeof value === "string" && value.toLowerCase().startsWith("en")) ? "en" : "zh-CN";
}

export function desktopT(key: DesktopTranslationKey, values: Record<string, string | number> = {}): string {
  let text: string = translations[currentLocale][key];
  for (const [name, value] of Object.entries(values)) {
    text = text.replaceAll(`{{${name}}}`, String(value));
  }
  return text;
}
