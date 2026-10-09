/**
 * 应用内更新提醒的界面文案（zh-CN / en，D-update 样张，2026-10-08）。
 *
 * 写作纪律：
 * ① 只说真会发生的事。旧文案「完成后再更新 / will wait until it finishes」承诺了没有任何代码在做的等待；
 *    这里改成说清「现在重启会中断」+「退出时会自动装好」。
 * ② 「项目和素材都在你电脑上」与 Mac 三步是仅有的两处说明文字：一个是用户点更新前唯一担心的事，
 *    一个是未签名 Mac 换版的真实步骤。其余一律不加解释句。
 * ③ 不写钱：更新本身不花钱也不该提钱（check:i18n-no-cost-claims）。
 * 「稍后 / 重试 / 关闭 / 知道了」复用 common.* 与 runtime.design.gotIt，不另起一份。
 */
export const zhUpdateReminder = {
  badge: {
    available: '新版本 {{version}}',
    downloading: '更新下载中 {{percent}}%',
    ready: '重启以更新',
    failed: '更新没下完 · 重试',
    installFailed: '上次没装上 · 点一下重试',
  },
  dialog: {
    availableTitle: '新版本 {{version}}',
    readyTitle: '{{version}} 已下载好',
    downloadingTitle: '正在下载 {{version}}',
    failedTitle: '更新没下完',
    installFailedTitle: '更新没装上',
    failedOffline: '没连上网络。连上后点重试。',
    failedInterrupted: '连接中断了。点重试再下一次。',
    failedOther: '出了点意外，没下完。点重试再来一次。',
    failedInstall: '安装程序没能启动。点重试再装一次。',
    progress: '已下载 {{percent}}%，下载在后台进行，可以继续做片',
    macTitle: '去官网换上 {{version}}',
    size: '安装包 {{size}}',
    localData: '项目和素材都在你电脑上，更新只换 Nomi 本身',
    moreGroups_one: '还有 {{count}} 组改动',
    moreGroups_other: '还有 {{count}} 组改动',
    fullNotes: '完整说明',
    download: '下载更新',
    goDownload: '去下载新版',
    restart: '重启以更新',
    installOnQuit: '退出 Nomi 时会自动装好。',
    running_one: '还有 {{count}} 个任务在跑，现在重启会中断它。退出 Nomi 时会自动装好。',
    running_other: '还有 {{count}} 个任务在跑，现在重启会中断它们。退出 Nomi 时会自动装好。',
    reopenDownload: '重新打开下载页',
    macSteps: {
      open: '下载完成后，打开 .dmg 文件',
      replace: '把 Nomi 拖到「应用程序」，选择替换',
      relaunch: '重新打开 Nomi，项目都在',
    },
  },
  hotfix: {
    label: '{{version}} 修复',
    view: '看看',
  },
  updated: {
    title: '已更新到 {{version}}',
    titleRange: '从 {{from}} 更新到 {{to}}',
  },
  about: {
    view: '查看',
  },
}

export const enUpdateReminder: typeof zhUpdateReminder = {
  badge: {
    available: 'Update {{version}}',
    downloading: 'Downloading update {{percent}}%',
    ready: 'Restart to update',
    failed: 'Update incomplete · Retry',
    installFailed: 'Last install failed · Click to retry',
  },
  dialog: {
    availableTitle: 'Nomi {{version}} is available',
    readyTitle: '{{version}} is downloaded',
    downloadingTitle: 'Downloading {{version}}',
    failedTitle: 'The update did not finish downloading',
    installFailedTitle: 'The update could not be installed',
    failedOffline: 'Nomi could not reach the network. Retry once you are back online.',
    failedInterrupted: 'The connection was interrupted. Retry to download again.',
    failedOther: 'Something unexpected stopped the download. Retry to start it again.',
    failedInstall: 'The installer could not start. Retry to install again.',
    progress: '{{percent}}% downloaded. It continues in the background, so keep working',
    macTitle: 'Get {{version}} from the website',
    size: 'Installer {{size}}',
    localData: 'Your projects and media stay on your computer. Updating only replaces Nomi itself',
    moreGroups_one: '{{count}} more section',
    moreGroups_other: '{{count}} more sections',
    fullNotes: 'Full release notes',
    download: 'Download update',
    goDownload: 'Download new version',
    restart: 'Restart to update',
    installOnQuit: 'It installs automatically when you quit Nomi.',
    running_one: '{{count}} task is still running. Restarting now would interrupt it. The update installs automatically when you quit Nomi.',
    running_other: '{{count}} tasks are still running. Restarting now would interrupt them. The update installs automatically when you quit Nomi.',
    reopenDownload: 'Open download page again',
    macSteps: {
      open: 'When the download finishes, open the .dmg file',
      replace: 'Drag Nomi into Applications and choose Replace',
      relaunch: 'Open Nomi again. Your projects are all there',
    },
  },
  hotfix: {
    label: '{{version}} fix',
    view: 'View',
  },
  updated: {
    title: 'Updated to {{version}}',
    titleRange: 'Updated from {{from}} to {{to}}',
  },
  about: {
    view: 'View',
  },
}
