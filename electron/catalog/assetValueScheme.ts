// 出站素材值的**形态判定**单一真相源。request.extras 里的一个字符串，发给供应商前只有三种命运：
//   ① reachable   —— http(s) 公网 URL：所有 vendor 都够得着，原样发。
//   ② localizable —— 只有 app 自己读得到的本地素材，**必须先物化/上传换公网 URL**：
//                    `nomi-local://`（项目内文件，读盘）与 `data:`（内联字节，就地解码）。
//   ③ unreachable —— `blob:` / `file:`：只在本机某个进程/页面里有意义，任何 vendor 都拉不到，
//                    发出去必错 → **付费守卫前**就抛人话，别让用户花钱换一个必然的失败。
//
// 为什么 data: 必须归到 ②（2026-08-26 真实付费实测）：此前只认 `nomi-local://`，data: URI 一路直穿到
// vendor body，于是**同一张参考图在不同 vendor 上一个成一个挂**——火山方舟 Ark 收 data:（HTTP 200），
// kie.ai 三个模型（nano-banana-2 的 image_input / seedream 的 image_urls / flux-2 的 input_urls）
// 全部 HTTP 500 "File type not supported"。L3 参考护栏也拦不住：参考「确实在 body 里」。
// UI 主路径先把上传的图落成项目素材所以碰不到；headless/MCP 和落盘失败退回 base64 的兜底路径会碰到。
//
// 为什么单独成模块：assetLocalization 管「怎么上传」，本模块只做纯字符串/字节运算（可裸测），
// 顺带让 assetLocalization 不撑破 800 行（R9）。
//
// ⚠️ 本模块被 renderer 间接 import（catalogTaskActions → assetLocalization.collectLocalAssetUrls），
// 故**不许 import 任何 node: 内置模块**；Buffer 只在函数体内用（renderer 只走 classify，不解码）。

import { contentTypeFromMagicBytes, extensionFromContentType } from "../assets/mediaTypes";

export const NOMI_LOCAL_PREFIX = "nomi-local://";

/** 素材值形态。null（见 classifyAssetValue）= 这根本不是一个需要处理的素材值。 */
export type AssetValueScheme = "nomi-local" | "inline-data" | "unreachable";

/** 内联 data: URI 只当**媒体**素材看：媒体 mime、octet-stream、或没声明 mime（靠嗅探）。
 *  `data:text/...` / `data:application/json` 这类是普通参数值，原样放行（别把一段 JSON 传去图床）。 */
function isMediaMime(mime: string): boolean {
  if (!mime) return true; // data:;base64,… → 无声明，交给字节嗅探
  return /^(image|video|audio|model)\//.test(mime) || mime === "application/octet-stream";
}

/** data: URI 的 header（"data:" 与 "," 之间）→ { mime, base64 }；不是合法 data: URI 返回 null。 */
function parseDataUrlHeader(value: string): { mime: string; base64: boolean; payloadStart: number } | null {
  if (!/^data:/i.test(value)) return null;
  const commaIndex = value.indexOf(",");
  if (commaIndex < 0) return null;
  const header = value.slice("data:".length, commaIndex);
  const parts = header.split(";");
  const mime = (parts[0] || "").trim().toLowerCase();
  const base64 = parts.slice(1).some((part) => part.trim().toLowerCase() === "base64");
  return { mime, base64, payloadStart: commaIndex + 1 };
}

/**
 * 一个值是不是「发送前需要处理的素材」，是哪一类。不是素材值（普通字符串/公网 URL/数字…）→ null。
 *
 * unreachable 判定**只认 blob:/file: 两个明确 scheme 且整串无空白**：extras 里混着自由文本
 * （提示词片段、备注），拿「像路径」去猜会把正常文案判成坏素材，整条生成误杀。裸文件系统路径
 * （`/Users/…`、`C:\…`）因此**不判**——它与普通参数值（如 uploadPath "images/nomi"）没法安全区分；
 * 它进 body 一样发不出去，但那属于调用方给错了值，我们不去猜。
 */
export function classifyAssetValue(value: unknown): AssetValueScheme | null {
  if (typeof value !== "string" || !value) return null;
  if (value.startsWith(NOMI_LOCAL_PREFIX)) return "nomi-local";
  if (/^data:/i.test(value)) {
    const header = parseDataUrlHeader(value);
    return header && isMediaMime(header.mime) ? "inline-data" : null;
  }
  if (/^(blob|file):/i.test(value) && !/\s/.test(value)) return "unreachable";
  return null;
}

/** 素材值需要本地化（物化/上传）才发得出去。 */
export function isLocalizableAssetValue(value: unknown): value is string {
  const scheme = classifyAssetValue(value);
  return scheme === "nomi-local" || scheme === "inline-data";
}

/** 内容派生的短标签，给内联素材当文件名后缀用（同一份字节永远同名，两份不同字节几乎不同名）。
 *  只吃头尾各 8KB + 总长度：整段 FNV 对几十 MB 的视频要空转几千万次，而这里只为「别重名」。 */
function contentTag(bytes: Uint8Array): string {
  const SAMPLE = 8 * 1024;
  let hash = 0x811c9dc5;
  const mix = (byte: number) => {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  for (let i = 0; i < Math.min(SAMPLE, bytes.length); i += 1) mix(bytes[i]);
  for (let i = Math.max(0, bytes.length - SAMPLE); i < bytes.length; i += 1) mix(bytes[i]);
  mix(bytes.length & 0xff);
  mix((bytes.length >>> 8) & 0xff);
  mix((bytes.length >>> 16) & 0xff);
  return hash.toString(36);
}

/**
 * data: URI → 字节 + contentType + 文件名（`nomi-local://` 的 readNomiLocalAsset 在内联侧的对应物）。
 * 不是 data: URI / 载荷坏掉 / 空载荷 → null（调用方按「素材读不出来」抛人话）。
 *
 * contentType **字节优先**：与 resolveContentType 同口径——mime 是生产者随手声明的，字节是事实
 * （见 mediaTypes.contentTypeFromMagicBytes 的注释：认错类型会把视频送进图片通道被 413 顶回来）。
 * 认不出则退回声明的 mime，再退 octet-stream（上游据此 fail-closed，不瞎猜是图还是视频）。
 *
 * 文件名带内容标签：同一次请求里两张不同的内联图不能重名——kie 这类「uploadPath + fileName」的
 * 托管端点重名有覆盖风险，覆盖了就是两个参考塌成同一张图，而且**看起来一切正常**。
 */
export function parseInlineDataAsset(value: string): { bytes: Buffer; contentType: string; fileName: string } | null {
  const header = parseDataUrlHeader(value);
  if (!header || !isMediaMime(header.mime)) return null;
  const payload = value.slice(header.payloadStart);
  if (!payload) return null;
  let bytes: Buffer;
  try {
    if (header.base64) {
      // Buffer.from(…, "base64") 会**静默忽略**非法字符：不先校验，一段坏载荷会变成一堆垃圾字节
      // 被当成合法素材传上去。宁可在这里判死。
      if (!/^[A-Za-z0-9+/\-_=\s]+$/.test(payload)) return null;
      bytes = Buffer.from(payload, "base64");
    } else {
      bytes = Buffer.from(decodeURIComponent(payload), "utf8");
    }
  } catch {
    return null;
  }
  if (bytes.length === 0) return null;
  const contentType = contentTypeFromMagicBytes(bytes) ?? (header.mime || "application/octet-stream");
  const extension = extensionFromContentType(contentType) || "bin";
  return { bytes, contentType, fileName: `inline-${contentTag(bytes)}.${extension}` };
}

/** 素材值的人话短标识：data: URI 动辄几 MB，原样拼进错误消息会给用户糊一屏 base64。 */
export function describeAssetValue(value: string): string {
  const header = parseDataUrlHeader(value);
  if (!header) return value;
  const size = Math.max(1, Math.round(value.length / 1024));
  return `${value.slice(0, header.payloadStart)}…（${size}KB 内联素材）`;
}

/** blob:/file: 进了出站请求 —— 付费前拦下并告诉用户怎么办（这类值任何 vendor 都拉不到）。 */
export function unreachableAssetValueError(value: string): Error {
  const scheme = value.slice(0, value.indexOf(":") + 1).toLowerCase();
  return new Error(
    `参考素材「${describeAssetValue(value).slice(0, 120)}」发不出去：${scheme} 地址只在本机有效，服务商拉不到它。` +
      `请先把这份素材导入项目（拖进画布 / 素材库导入 / MCP 用 nomi_import_asset），再作为参考连上。`,
  );
}
