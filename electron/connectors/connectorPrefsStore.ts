// Connector-scoped preferences store —— 数据 connector 的非凭据用户偏好（如 TikHub 生效线路）。
//
// 为什么单开一份、不塞进 model-catalog.json：catalog 是「生成 vendor/model」的账本（会进模型列表、
// 有额度语义、走 safeStorage 凭据层）；connector 的「线路偏好」是一条纯本地 view 设置，既不是凭据、
// 也不是生成任务（P4 概念隔离）。这里只存**非敏感**偏好——TikHub 的 key 仍走 catalog 的 safeStorage，
// 绝不落这里。落在 settings root 下的独立 JSON，读写走既有原子写工具（P1：不另起持久化管线）。
import path from "node:path";
import { getSettingsRoot } from "../settings/settingsRoot";
import { readJson } from "../runtimePaths";
import { writeJsonFileAtomic } from "../jsonFile";
import { isJsonRecord, trim, type JsonRecord } from "../jsonUtils";

const CONNECTOR_PREFS_FILE = "connector-prefs.json";

/** connector 偏好文件形状（按 connectorId 分区；每个 connector 只读自己那格）。 */
type ConnectorPrefsFile = {
  version: 1;
  byConnector: Record<string, JsonRecord>;
};

function prefsPath(): string {
  return path.join(getSettingsRoot(), CONNECTOR_PREFS_FILE);
}

function readPrefsFile(): ConnectorPrefsFile {
  const raw = readJson<unknown>(prefsPath(), null);
  if (!isJsonRecord(raw) || !isJsonRecord(raw.byConnector)) {
    return { version: 1, byConnector: {} };
  }
  const byConnector: Record<string, JsonRecord> = {};
  for (const [k, v] of Object.entries(raw.byConnector)) {
    if (isJsonRecord(v)) byConnector[k] = v;
  }
  return { version: 1, byConnector };
}

/** 读某个 connector 的偏好分区（缺则空对象）。 */
export function readConnectorPrefs(connectorId: string): JsonRecord {
  const id = trim(connectorId);
  if (!id) return {};
  return readPrefsFile().byConnector[id] ?? {};
}

/**
 * 合并式写入某个 connector 的偏好（读-改-写一次落盘；只覆盖传入的键，其它 connector 分区不动）。
 * value 里的 undefined 键表示删除该键。
 */
export function writeConnectorPrefs(connectorId: string, patch: JsonRecord): void {
  const id = trim(connectorId);
  if (!id) return;
  const file = readPrefsFile();
  const existing = file.byConnector[id] ?? {};
  const next: JsonRecord = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  file.byConnector[id] = next;
  writeJsonFileAtomic(prefsPath(), file);
}
