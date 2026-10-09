// 应用内更新提醒的共享合同：主进程（electron/update/*）和渲染层（src/ui/app-shell/*）读同一份。
// 纯类型 + 纯函数，不碰 Electron / DOM / 文件。设计卡 docs/plan/2026-10-08-update-reminder.md。

export type UpdatePlatform = "darwin" | "win32" | "linux";
export type UpdateLocale = "zh" | "en";

export type DigestGroup = Readonly<{
  /** 分组名（中文段的 `##`、英文段的 `###`）；英文段第一个 `###` 之前的列表归入无名组。 */
  heading: string | null;
  /** 每条列表项的加粗短语，已剥 PR 号与句末标点。 */
  items: readonly string[];
}>;

export type LocaleDigest = Readonly<{
  /** 标题句：中文取 H1「—」后面那句，英文取「What changed」段的第一段。 */
  title: string | null;
  groups: readonly DigestGroup[];
  /** 超出显示上限没列出的分组数。 */
  hiddenGroups: number;
}>;

/** 一个版本的发版说明摘要：两种语言都带上，界面按当前语言挑，换语言不用回主进程。 */
export type VersionNotes = Readonly<{
  version: string;
  zh: LocaleDigest;
  en: LocaleDigest;
  /** 说明里声明了「适用平台」时才有；null = 所有平台。 */
  platforms: readonly UpdatePlatform[] | null;
}>;

export type UpdaterPhase = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "downloaded" | "error";
export type UpdaterErrorStage = "check" | "download" | "install";
/** 失败的人话分类：没连上网 / 连接中途断了 / 其他。界面按它挑话术，不把技术原文当正文。 */
export type UpdaterErrorReason = "offline" | "interrupted" | "other";

/** 主进程广播的更新事件（渲染层只读）。 */
export type UpdateEvent =
  | { type: "checking" }
  | { type: "up-to-date" }
  | { type: "available"; version: string; notes: readonly VersionNotes[]; sizeBytes: number | null; releaseUrl: string | null }
  | { type: "progress"; percent: number }
  | { type: "downloaded"; version: string }
  | { type: "error"; message: string; stage: UpdaterErrorStage; reason: UpdaterErrorReason };

export type UpdaterState = Readonly<{
  phase: UpdaterPhase;
  latestVersion: string | null;
  /** 当前版本之后每一版的摘要，从新到旧。 */
  notes: readonly VersionNotes[];
  sizeBytes: number | null;
  releaseUrl: string | null;
  percent: number;
  errorMessage: string;
  errorStage: UpdaterErrorStage | null;
  errorReason: UpdaterErrorReason | null;
}>;

export const UPDATER_INITIAL_STATE: UpdaterState = {
  phase: "idle",
  latestVersion: null,
  notes: [],
  sizeBytes: null,
  releaseUrl: null,
  percent: 0,
  errorMessage: "",
  errorStage: null,
  errorReason: null,
};

/** 更新状态的唯一 reducer：主进程用它记真相，渲染层用它跟随事件。 */
export function reduceUpdaterState(state: UpdaterState, event: UpdateEvent): UpdaterState {
  switch (event.type) {
    case "checking":
      return { ...UPDATER_INITIAL_STATE, phase: "checking" };
    case "up-to-date":
      return { ...UPDATER_INITIAL_STATE, phase: "up-to-date" };
    case "available":
      return {
        ...UPDATER_INITIAL_STATE,
        phase: "available",
        latestVersion: event.version,
        notes: event.notes,
        sizeBytes: event.sizeBytes,
        releaseUrl: event.releaseUrl,
      };
    case "progress":
      return { ...state, phase: "downloading", percent: event.percent };
    case "downloaded":
      return { ...state, phase: "downloaded", percent: 100, latestVersion: event.version || state.latestVersion };
    case "error":
      return { ...state, phase: "error", errorMessage: event.message, errorStage: event.stage, errorReason: event.reason };
    default:
      return state;
  }
}

/** 持久化在 settings 根下 update-reminder.json 里的、需要跨重启记住的那一点。 */
export type UpdatedCardData = Readonly<{ fromVersion: string; toVersion: string; notes: readonly VersionNotes[] }>;

export type UpdateReminderMemory = Readonly<{
  /** 已 ✕ 掉的热修横幅版本。 */
  dismissedBanners: readonly string[];
  /** 更新后第一次打开要出的卡（✕ 后清空）。 */
  updatedCard: UpdatedCardData | null;
}>;

export type UpdateSnapshot = Readonly<{ state: UpdaterState; memory: UpdateReminderMemory }>;

/** 某个版本在 GitHub Release 上的完整说明页（弹窗 / 卡片里的「完整说明」）。 */
export function buildReleaseNotesUrl(version: string): string {
  return `https://github.com/aqm857886159/Nomi/releases/tag/v${version}`;
}

/** 胶囊上的版本号：0.24.0 → 0.24，0.23.1 原样。 */
export function shortVersion(version: string): string {
  return version.replace(/^(\d+\.\d+)\.0$/, "$1");
}

/** 第三位变 = 热修版（0.23.1）；第三位是 0 = 攒批版（0.24.0）。 */
export function isHotfixVersion(version: string): boolean {
  const patch = /^\d+\.\d+\.(\d+)/.exec(version)?.[1];
  return patch !== undefined && patch !== "0";
}

export function notesAppliesTo(notes: VersionNotes | undefined, platform: string): boolean {
  if (!notes?.platforms) return true;
  return notes.platforms.includes(platform as UpdatePlatform);
}

export type HotfixBannerData = Readonly<{ version: string; headline: string }>;

/**
 * 项目库顶部的一次性热修横幅：只有「有新版 + 是热修版 + 适用本平台 + 没 ✕ 过」才出；
 * 文字是发版说明里「修好了什么」那句标题（没有标题就不出，不拿版本号凑数）。
 */
export function deriveHotfixBanner(
  state: UpdaterState,
  memory: UpdateReminderMemory,
  platform: string,
  locale: UpdateLocale,
): HotfixBannerData | null {
  if (state.phase !== "available" || !state.latestVersion) return null;
  const version = state.latestVersion;
  if (!isHotfixVersion(version)) return null;
  if (memory.dismissedBanners.includes(version)) return null;
  const latest = state.notes.find((entry) => entry.version === version);
  if (!notesAppliesTo(latest, platform)) return null;
  const headline = latest?.[locale].title;
  return headline ? { version, headline } : null;
}

export type UpdatedCardView = Readonly<{
  fromVersion: string | null;
  toVersion: string;
  headline: string | null;
  items: readonly string[];
}>;

const CARD_MAX_ITEMS = 3;

/** 更新后卡片：跳了几版就合成一张——标题取最新一版，条目从新到旧摊平取前 3 条。 */
export function deriveUpdatedCard(card: UpdatedCardData | null, locale: UpdateLocale): UpdatedCardView | null {
  if (!card) return null;
  const digests = [...card.notes].sort((a, b) => compareVersions(b.version, a.version)).map((entry) => entry[locale]);
  const skipped = compareVersions(card.toVersion, card.fromVersion) > 0 && minorOrMajorGap(card.fromVersion, card.toVersion);
  return {
    fromVersion: skipped ? card.fromVersion : null,
    toVersion: card.toVersion,
    headline: digests.find((digest) => digest.title)?.title ?? null,
    items: digests.flatMap((digest) => digest.groups.flatMap((group) => group.items)).slice(0, CARD_MAX_ITEMS),
  };
}

/** 「从 A 更新到 B」只在真的跳了版时写：中间还有别的已发布版本，或者跨了次版本。 */
function minorOrMajorGap(from: string, to: string): boolean {
  const a = parseVersion(from);
  const b = parseVersion(to);
  return a[0] !== b[0] || a[1] !== b[1] || b[2] - a[2] > 1;
}

function parseVersion(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i += 1) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

const DIALOG_MAX_GROUPS = 4;

/**
 * 弹窗里的「为什么更新」：只取当前语言；跳了几版就把各版的分组从新到旧接起来（最多 4 组），
 * 标题取最新一版的标题句。没有可用的摘要时 groups 为空——界面只显示版本号和「完整说明」链接。
 */
export function dialogDigest(notes: readonly VersionNotes[], locale: UpdateLocale): LocaleDigest {
  const newestFirst = [...notes].sort((a, b) => compareVersions(b.version, a.version)).map((entry) => entry[locale]);
  const groups = newestFirst.flatMap((digest) => digest.groups);
  return {
    title: newestFirst.find((digest) => digest.title)?.title ?? null,
    groups: groups.slice(0, DIALOG_MAX_GROUPS),
    hiddenGroups: Math.max(0, groups.length - DIALOG_MAX_GROUPS) + newestFirst.reduce((sum, digest) => sum + digest.hiddenGroups, 0),
  };
}
