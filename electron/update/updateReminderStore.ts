// 更新提醒要跨重启记住的两件事：哪个热修横幅已 ✕、更新后第一次打开要出的那张卡。
// 状态正本在主进程（本文件）；渲染层只读快照、通过 IPC 请求 ✕，不各自存一份。
// 落盘走配置读写原语（读不出来就不盖、坏文件留底），文件在 settings 根下。
import path from "node:path";
import { readConfigFileOrDefault, writeConfigFileAtomic } from "../configFileStore";
import { isJsonRecord } from "../jsonUtils";
import { logWarn } from "../logging/logger";
import { getSettingsRoot } from "../settings/settingsRoot";
import { compareVersions, type UpdateReminderMemory, type UpdatedCardData, type VersionNotes } from "../shared/updateReminder";

const FILE_NAME = "update-reminder.json";
const MAX_DISMISSED = 20;

type Pending = Readonly<{ fromVersion: string; toVersion: string; notes: readonly VersionNotes[] }>;

type Persisted = {
  version: 1;
  lastRunVersion: string | null;
  dismissedBanners: string[];
  /** 用户同意更新（点了下载 / 去官网）那一刻记下的「从哪版到哪版 + 说明」，装好后第一次启动用来出卡。 */
  pending: Pending | null;
  updatedCard: UpdatedCardData | null;
};

const EMPTY: Persisted = { version: 1, lastRunVersion: null, dismissedBanners: [], pending: null, updatedCard: null };

function isPersisted(value: unknown): boolean {
  return isJsonRecord(value) && value.version === 1;
}

export type UpdateReminderStore = {
  memory(): UpdateReminderMemory;
  rememberPending(pending: Pending): void;
  dismissBanner(version: string): UpdateReminderMemory;
  dismissUpdatedCard(): UpdateReminderMemory;
};

/**
 * 启动时调用一次：当前版本比上次运行的新 → 生成「已更新」卡（说明取同意更新时记下的那份，
 * 没记（比如 Mac 用户自己在官网下的）就只有版本号）；然后把「上次运行版本」推到当前版本。
 */
export function openUpdateReminderStore(currentVersion: string, filePath: string = path.join(getSettingsRoot(), FILE_NAME)): UpdateReminderStore {
  const loaded = readConfigFileOrDefault<Persisted>(filePath, () => EMPTY, isPersisted);
  let data: Persisted = { ...EMPTY, ...loaded, dismissedBanners: [...(loaded.dismissedBanners ?? [])] };

  const save = (): void => {
    try {
      writeConfigFileAtomic(filePath, data);
    } catch (error) {
      // 读不出来的旧文件不覆盖（写门会拒绝）：本次运行只在内存里有效，下次启动照旧；留一条日志，不打扰用户。
      logWarn("update", "reminder-store-write-failed", undefined, error);
    }
  };

  if (data.lastRunVersion && compareVersions(currentVersion, data.lastRunVersion) > 0) {
    const from = data.lastRunVersion;
    const pending = data.pending && data.pending.toVersion === currentVersion ? data.pending : null;
    data = {
      ...data,
      updatedCard: {
        fromVersion: from,
        toVersion: currentVersion,
        notes: (pending?.notes ?? []).filter((entry) => compareVersions(entry.version, from) > 0 && compareVersions(entry.version, currentVersion) <= 0),
      },
      pending: null,
      lastRunVersion: currentVersion,
    };
    save();
  } else if (!data.lastRunVersion) {
    data = { ...data, lastRunVersion: currentVersion };
    save();
  }

  const memory = (): UpdateReminderMemory => ({ dismissedBanners: data.dismissedBanners, updatedCard: data.updatedCard });
  return {
    memory,
    rememberPending(pending) {
      data = { ...data, pending };
      save();
    },
    dismissBanner(version) {
      if (!data.dismissedBanners.includes(version)) data = { ...data, dismissedBanners: [...data.dismissedBanners, version].slice(-MAX_DISMISSED) };
      save();
      return memory();
    },
    dismissUpdatedCard() {
      data = { ...data, updatedCard: null };
      save();
      return memory();
    },
  };
}
