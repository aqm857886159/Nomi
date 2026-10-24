// 出站参考媒体链接（服务商请求里的参考图 / 视频 / 音频链接）的唯一写法：平台 WHATWG URL 解析后序列化。
//
// 收口在参数层：taskTemplateParams 产出模板参数时调 serializeReferenceParams，模板只是搬值——发出去的字段叫什么
// （image_urls / first_frame / content[].image_url.url / input.video_list …）都不影响。不经 taskTemplateParams 的
// 只有自定义调用的试跑参数（customCallIpc 在交给脚本之前同一个函数过一次）；门表见
// docs/fixes/2026-10-25-outbound-ref-url.root-cause.json。
// 「哪些参数是参考」只认共享键表 GENERIC_REFERENCE_KEYS（由档案声明推导），驼峰 / 下划线写法都认；这里不另写键表。
// 表里的键带进来的参考值被上游推导抄到表外的键上，按值认作同一条参考（见 serializeReferenceParams）。
// 拿携带的参考去和参数 / 请求体 / 回包里的值比的地方，两边都过 comparableReferenceUrl（同一个序列化）。
import { desktopT } from "../desktopStrings";
import { GENERIC_REFERENCE_KEYS } from "../shared/modelArchetypes/referenceKeys";

/** 键名写法归一：first_frame_url ≡ firstFrameUrl ≡ FIRST-FRAME-URL。 */
function keySpelling(key: string): string {
  return key.replace(/[_-]/g, "").toLowerCase();
}
const REFERENCE_KEY_SPELLINGS: ReadonlySet<string> = new Set([...GENERIC_REFERENCE_KEYS].map(keySpelling));

/** 带 authority 的绝对地址（scheme://）。data: / blob: 不是这个形状；nomi-local:// 是 Nomi 自己的本地传输，另有规则。 */
const ABSOLUTE_URL = /^[a-z][a-z\d+.-]*:\/\//i;
const NOMI_LOCAL_URL = /^nomi-local:/i;

/** 要换写法的外部地址（去掉首尾空白）；ComfyUI 输入目录文件名、data:、nomi-local://、空串都不是 → null。 */
function externalUrl(value: string): string | null {
  const candidate = value.trim();
  return ABSOLUTE_URL.test(candidate) && !NOMI_LOCAL_URL.test(candidate) ? candidate : null;
}

/** 一条参考地址的出站写法。不是外部地址的原样返回；解析不了的在发出去之前失败（不让服务商收到半个地址）。 */
export function serializeReferenceUrl(value: string, field = "reference"): string {
  const candidate = externalUrl(value);
  if (!candidate) return value;
  try {
    return new URL(candidate).href;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(desktopT("outbound.referenceUrlInvalid", { field, detail })), { cause: error });
  }
}

/** 比较用：两边按同一个序列化比；解析不了的原样，「发不发得出去」的判定不由它改。 */
export function comparableReferenceUrl(value: string): string {
  const candidate = externalUrl(value);
  if (!candidate) return value;
  try {
    return new URL(candidate).href;
  } catch {
    return value;
  }
}

/** 只走普通对象 / 数组（JSON 形状）；Buffer、FormData 之类原样，不拆。 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function mapStrings(value: unknown, field: string, map: (text: string, field: string) => string): unknown {
  if (typeof value === "string") return map(value, field);
  if (Array.isArray(value)) return value.map((item, index) => mapStrings(item, `${field}[${index}]`, map));
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, mapStrings(child, `${field}.${key}`, map)]));
}

const isReferenceKey = (key: string): boolean => REFERENCE_KEY_SPELLINGS.has(keySpelling(key));

/** 参考键下（在哪一层都认）装着的外部地址。 */
function referenceUrlsIn(value: unknown, underReferenceKey: boolean, into: Set<string>): Set<string> {
  if (typeof value === "string") {
    const url = underReferenceKey ? externalUrl(value) : null;
    if (url) into.add(url);
  } else if (Array.isArray(value)) value.forEach((item) => referenceUrlsIn(item, underReferenceKey, into));
  else if (isPlainRecord(value)) {
    for (const [key, child] of Object.entries(value)) referenceUrlsIn(child, underReferenceKey || isReferenceKey(key), into);
  }
  return into;
}

/**
 * 参数层收口：挂在参考键下的值（在哪一层都认，含 archetypeInput 这种嵌套参数袋），字符串 / 数组 / 对象形
 * （[{url, role}]、火山 content 项）里的外部地址一律换成序列化后的写法。同一条参考被上游推导抄到了表外的键
 * （参考键形态投影 projectReferencesOntoBodyKeys 按请求体读的键落位，键名不一定在表里），按值认出来、同样换写法。
 * 别的值原样。返回新对象，不改入参。
 */
export function serializeReferenceParams<T>(value: T): T {
  const carried = referenceUrlsIn(value, false, new Set());
  const walk = (node: unknown, field: string, underReferenceKey: boolean): unknown => {
    if (typeof node === "string") {
      return underReferenceKey || carried.has(node.trim()) ? serializeReferenceUrl(node, field || "reference") : node;
    }
    if (Array.isArray(node)) return node.map((item, index) => walk(item, `${field}[${index}]`, underReferenceKey));
    if (!isPlainRecord(node)) return node;
    return Object.fromEntries(Object.entries(node).map(([key, child]) =>
      [key, walk(child, field ? `${field}.${key}` : key, underReferenceKey || isReferenceKey(key))]));
  };
  return walk(value, "", false) as T;
}

/** 比较用的整值版本：值里每个外部地址都换成 comparableReferenceUrl（不看键，解析不了的原样）。 */
export function comparableReferenceValues<T>(value: T): T {
  return mapStrings(value, "", (text) => comparableReferenceUrl(text)) as T;
}
