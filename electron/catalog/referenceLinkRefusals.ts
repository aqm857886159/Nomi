// 「这条连接的模型拉不到我们给的临时链接」——一份小配置文件，记的是**事实**，不是设置（写法同 automationPolicySettings）。
//
// 为什么要记：发之前的试探只能说「我这边现在打得开」，说不了「模型那边拉得到」（防盗链、地区限制、
// 只认某些来源……本机打得开、模型照样拉不到，而且时好时坏）。所以当模型明说「拉不到」之后，这条连接
// 之后的参考素材一律走上传（本机文件换新链接），不再把临时链接直接发过去。
//
// 谁写：只有 Run 里「提交被拒 / 任务失败」那两处会走到（`productionGenerationSubmission` 的唯一记录点）。
// 谁读：`assetTransportRuntime.assetLocalizationOptions`（决定点的入参）和做片返工（要不要重新换链接）。
// 记在连接上（vendor.key），不记在模型或某张图上：兄弟连接（`kie--xxx`）、别的连接互不影响。
// 记录 30 天后失效：判据说错一次，不该让这条连接从此不再用链接；到期再给链接一次机会，模型还是拒绝就再记一次。
// 写失败只记日志，不抛——记账失败不能把「模型拒绝」这条失败本身遮掉；文件缺失或损坏一律当作没有记录。
import path from "node:path";

import { readConfigFileOrDefault, writeConfigFileAtomic } from "../configFileStore";
import { logWarn } from "../logging/logger";
import { getSettingsRoot } from "../settings/settingsRoot";

const REFERENCE_LINK_REFUSALS_FILE = "reference-link-refusals.json";

type RefusalStore = { version: 1; connections: Record<string, { refusedAt: string }> };

const EMPTY_STORE = (): RefusalStore => ({ version: 1, connections: {} });

const REFUSAL_VALID_MS = 30 * 24 * 60 * 60 * 1000;

/** 只认自己的键：`constructor` / `__proto__` 这类原型上的名字不算已记录的连接。 */
const hasOwn = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

/** 这条连接有记录，而且还没过期。时间读不出来、或者在未来（手改文件、时钟错），都当作没有记录。 */
function refusedWithinValidity(store: RefusalStore, key: string, now: Date): boolean {
  if (!hasOwn(store.connections, key)) return false;
  const age = now.getTime() - Date.parse(store.connections[key]?.refusedAt);
  return age >= 0 && age < REFUSAL_VALID_MS;
}

export function referenceLinkRefusalsPath(): string {
  return path.join(getSettingsRoot(), REFERENCE_LINK_REFUSALS_FILE);
}

function isStoreShape(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (value as { connections?: unknown }).connections !== null
    && typeof (value as { connections?: unknown }).connections === "object"
    && !Array.isArray((value as { connections?: unknown }).connections);
}

function readStore(): RefusalStore {
  const stored = readConfigFileOrDefault<unknown>(referenceLinkRefusalsPath(), EMPTY_STORE, isStoreShape) as RefusalStore;
  return { version: 1, connections: { ...stored.connections } };
}

export function isConnectionRefused(vendorKey: string | undefined, now: Date = new Date()): boolean {
  const key = String(vendorKey ?? "").trim();
  if (!key) return false;
  try {
    return refusedWithinValidity(readStore(), key, now);
  } catch (error) {
    logWarn("catalog", "reference-link-refusals-read-failed", {}, error);
    return false;
  }
}

/** 记下这条连接拒绝过。还在有效期内就不动文件；写不成只记日志。 */
export function noteConnectionRefused(vendorKey: string | undefined, now: Date = new Date()): void {
  const key = String(vendorKey ?? "").trim();
  if (!key) return;
  try {
    const store = readStore();
    if (refusedWithinValidity(store, key, now)) return;
    store.connections[key] = { refusedAt: now.toISOString() };
    writeConfigFileAtomic(referenceLinkRefusalsPath(), store);
  } catch (error) {
    logWarn("catalog", "reference-link-refusals-write-failed", { vendor: key }, error);
  }
}
