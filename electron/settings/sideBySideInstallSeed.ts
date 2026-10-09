// Preview / RC 与稳定版并存时的配置分家 + 首次启动的一次性拷贝（批次 E，2026-09-21）。
//
// 为什么要这一条（`rootcause-config-loss-on-reinstall.md` §4，「现成的定时炸弹」）：
// Preview 今天只分了 `appId`（`com.nomi.app.preview`）和 `productName`，而 Electron 的
// `app.getName()` 读的是 asar 内 package.json 的 `name`（= `nomi`），`build.productName` 不进 asar。
// 于是 Preview 和稳定版**共用同一个 `%APPDATA%\nomi`**：装一次 Preview 就足以把目录升到新版本号，
// 回到稳定版就直接进本次事故的状态（读得出来、改不了、界面空白）。
// `docs/release-process.md` 里写的「Preview 使用 …… Nomi Preview Projects」其实从来没有实现过。
//
// 分家靠 electron-builder 的 `extraMetadata.name`（它把 name 写进 asar 内的 package.json，
// 是这件事的框架自带做法，不需要在运行时 setName——运行时改名有 getPath 缓存/时机问题，
// capabilityCore/host.ts 的注释里记着那个坑）。
//
// 分家之后 Preview 是一个全新的空 userData。**首次启动拷贝一份**稳定版的配置过来：
// 拷贝可以，共用不行——用户要的是「试新版不用赌上配置」，不是「两份配置各配一遍」。
// 拷完两边就此各走各路，Preview 怎么升级都碰不到稳定版那一份。
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

import { logError, logInfo } from "../logging/logger";
import { getSettingsRoot } from "./settingsRoot";

/** 稳定版的 app name（= package.json 的 `name`），它的 userData 是 `<appData>/nomi`。 */
export const STABLE_APP_NAME = "nomi";

/**
 * 首次启动要从稳定版带过来的配置文件。
 *
 * 是一份**显式清单**而不是「拷贝所有 .json」：userData 下还住着遥测队列、缓存、上报重试队列这类
 * 与机器/会话绑定的东西，把它们一起搬过去只会制造重复上报和假状态。
 * 新增一个配置文件却忘了加进来，`sideBySideInstallSeed.test.ts` 会红（它扫的是代码里真实出现的文件名）。
 */
export const SEEDED_CONFIG_FILES = [
  "model-catalog.json",
  "vendor-preference.json",
  "generation-model-defaults.json",
  "model-box-preference.json",
  "canvas-menu-preference.json",
  "automation-policy.json",
  // 用户选的权限档（每步都问 / 安全自动 / 全自动）。是用户自己的一次决定，不是机器状态——
  // 不带过去就等于让他在 Preview 里重新选一次，而那一次很可能选不到他原来那一档。
  "agent-approval-policy.json",
  "system-prompts.json",
  "attention-sound.json",
  "asset-relay.json",
  "proxy-prefs.json",
  "screenshot-hotkey-prefs.json",
  "connector-prefs.json",
  "prompt-library-user.json",
  "vendor-base-overrides.json",
  "preferences.json",
  "download-prefs.json",
] as const;

/**
 * 刻意**不**带过去的，连同理由——免得下一个人把它们补进上面那张表。
 * `project-location.json`：指向稳定版自己的项目根，Preview 应当用自己那份默认位置；
 * `prompt-library-cache.json`：缓存，重建就有；
 * `antigravity-verification.json`：一次性验证凭证，与安装实例绑定；
 * `provider-adapters.json`：适配运行的历史与租约，本机执行状态，带过去只会是一堆别人的记录；
 * `telemetry-outbox.json`：本机待上报队列，带过去 = 重复上报；
 * `telemetry-settings.json`：遥测选择**不继承**——换一个安装就让用户自己再决定一次，默认关；
 * `update-reminder.json`：更新提醒的本机状态——上次运行的版本（用来生成「已更新」卡）、已 ✕ 的热修横幅、用户同意过的待装版本和**稳定版自己的安装包缓存路径**。带到 Preview / RC 会让它凭空出一张「已更新到 x」卡，或把稳定版的待装记录当成自己的（Preview 不接稳定版更新源，也没有那份缓存，只会反复显示「上次没装上」）；两份安装各记各的；
 * `project.json`：根本不在 settings 根下（它是项目目录里的工程文件），列在这里只为让扫描器闭嘴时有个交代。
 */
export const DELIBERATELY_NOT_SEEDED = [
  "project-location.json",
  "prompt-library-cache.json",
  "antigravity-verification.json",
  "provider-adapters.json",
  "telemetry-outbox.json",
  "telemetry-settings.json",
  "update-reminder.json",
  "project.json",
] as const;

export type SideBySideSeedResult = Readonly<{
  seeded: string[];
  skippedBecauseAlreadyPresent: boolean;
  source: string | null;
}>;

/**
 * 从稳定版 userData 拷一份配置过来，**只在自己这份是全新的时候**。
 *
 * 判据是「目录文件还不存在」——它是用户配置里最重的那一份，也是首次启动唯一确定不存在的东西。
 * 拷过一次之后目录就在了，之后每次启动都是 no-op；两边从此互不影响。
 * 每个文件单独 try：某一份拷不过来（权限/被锁）不该让整次启动失败，剩下的照拷。
 *
 * macOS 上 safeStorage 的钥匙串条目名随 app 名走，所以拷过来的密钥密文 Preview 解不开——
 * 这不是静默失败：`apiKeyDecryptStatus` 会把它报成 needs_resave，健康度与设置页都看得见。
 * Windows 的 DPAPI 绑当前用户账户、不绑 app，拷过去照常能解。
 */
export function seedFromStableInstall(options: {
  appName: string;
  settingsRoot: string;
  appDataRoot: string;
}): SideBySideSeedResult {
  const { appName, settingsRoot, appDataRoot } = options;
  if (appName === STABLE_APP_NAME) return { seeded: [], skippedBecauseAlreadyPresent: false, source: null };

  const source = path.join(appDataRoot, STABLE_APP_NAME);
  if (path.resolve(source) === path.resolve(settingsRoot)) {
    return { seeded: [], skippedBecauseAlreadyPresent: false, source: null };
  }
  if (fs.existsSync(path.join(settingsRoot, "model-catalog.json"))) {
    return { seeded: [], skippedBecauseAlreadyPresent: true, source };
  }
  if (!fs.existsSync(path.join(source, "model-catalog.json"))) {
    return { seeded: [], skippedBecauseAlreadyPresent: false, source };
  }

  fs.mkdirSync(settingsRoot, { recursive: true });
  const seeded: string[] = [];
  for (const name of SEEDED_CONFIG_FILES) {
    const from = path.join(source, name);
    if (!fs.existsSync(from)) continue;
    try {
      fs.copyFileSync(from, path.join(settingsRoot, name), fs.constants.COPYFILE_EXCL);
      seeded.push(name);
    } catch {
      // 拷不过来的那一份就让 Preview 用默认值，不阻断启动、也绝不回头去改源目录。
    }
  }
  return { seeded, skippedBecauseAlreadyPresent: false, source };
}

/**
 * 启动期调用点：把「问 Electron 要身份」和「失败怎么办」留在这一层，main.ts 只写一行。
 * 拷不成不阻断启动——Preview 用默认配置照样能跑，而稳定版那份**一个字节都没碰**。
 */
export function seedFromStableInstallAtBoot(): void {
  try {
    const result = seedFromStableInstall({
      appName: app.getName(),
      settingsRoot: getSettingsRoot(),
      appDataRoot: app.getPath("appData"),
    });
    if (result.seeded.length) logInfo("main", "side-by-side-seeded", { files: result.seeded.length, source: result.source });
  } catch (error) {
    logError("main", "side-by-side-seed-failed", error);
  }
}
