// 异步任务「这次成没成、结果在哪」的**唯一读法**（#1213 收口）。
//
// 两台引擎都调它：引擎 A（画布 / 单镜 Run 走的 runtime.buildProfileTaskResult）、引擎 B（制作 Run / Agent
// 走的目录执行器 queryTask / materialize）。以前各读各的：A 用 response_mapping + 一份 12 条路径的兜底并集，
// B 完全不看 mapping、只认 data.result.{images,videos,audios}。同一份上游响应，两边取出的东西不一样。
//
// 读法的合同：
//   1. **先按通道声明的合同**（mapping.response_mapping 的 assets / image_url / video_url / audio_url / model_url）。
//   2. 合同读不到 → **通用规则**：在响应里按「结果字段名」找地址（result_url / video_url / url / output / fileUrl …，
//      含 content.* / data.* / output.* / results[*] / videos[*] 等嵌套，以及被当字符串二次嵌套的 JSON），
//      只收 http(s) / data: / nomi-local: 地址，**按期望的媒体类型核扩展名**，**排除本次请求回显的参考地址**，
//      并排除缩略图 / 封面 / 尾帧 / 参考这类字段；类型证据先于字段名排名，只取排名最高的那一处（同一张列表里的兄弟一起），并说出用的是哪条规则。合同读到的地址同样排除回显的参考地址。
//   3. 状态由共享词表判（resolveTaskStatus → shared/taskStatus），产物作硬证据参与判定。
// 下载那一步还会按 content-type / 字节再核一次（assets/generatedMediaDecode），这里只做便宜的第一道。
import type { JsonRecord } from "../jsonUtils";
import { isJsonRecord } from "../jsonUtils";
import { collectAssetUrls, firstMappedString, maybeParseJsonString, resolveTaskStatus, valuesFromMapping, type TaskStatus } from "./responseParsing";
import { classifyUpstreamTaskStatus } from "../shared/taskStatus";
import { firstString } from "../jsonUtils";
import { extractAssetUrl } from "./assetUrlExtract";
import { logInfo } from "../logging/logger";

export type ExpectedMediaKind = "image" | "video" | "audio" | "model3d";

/** 用了哪条规则取到地址：`contract` = 通道声明的位置；`generic:<路径>` = 通用规则在那个位置找到；`none` = 没取到。 */
export type ResultReadRule = "contract" | `generic:${string}` | "none";

export type TaskResponseReading = {
  status: TaskStatus;
  /** 上游给了、但谁都认不得的原始动词（空 = 认得或没给）。 */
  unrecognizedStatus: string;
  assetUrls: string[];
  rule: ResultReadRule;
};

/** 任务种类 → 期望的产物媒体类型（文本等没有媒体产物的种类 → null，不按类型过滤）。 */
export function expectedMediaKind(kind: string | null | undefined): ExpectedMediaKind | null {
  return kind === "image" || kind === "video" || kind === "audio" || kind === "model3d" ? kind : null;
}

const CONTRACT_ASSET_KEYS = ["assets", "image_url", "video_url", "audio_url", "model_url"] as const;

const EXTENSIONS: Record<ExpectedMediaKind, readonly string[]> = {
  video: ["mp4", "mov", "webm", "m4v", "mkv", "avi", "m3u8"],
  image: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "heic"],
  audio: ["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus"],
  model3d: ["glb", "gltf", "obj", "fbx", "usdz", "stl", "ply"],
};
const ALL_KNOWN_EXTENSIONS = new Set(Object.values(EXTENSIONS).flat());

/** 「这是结果」的字段名，按可信度排（越靠前越像结果）。 */
const RESULT_KEY_RANK = [
  "result_url", "resulturl", "resulturls", "video_url", "videourl", "image_url", "imageurl", "audio_url", "audiourl",
  "model_url", "file_url", "fileurl", "output_url", "outputurl", "download_url", "downloadurl", "url", "uri", "output", "outputs",
  "result", "results", "fail_reason",
] as const;
/** 明显不是本次产物的字段：缩略图 / 封面 / 尾帧 / 头像 / 参考 / 输入 / 回调。 */
const EXCLUDED_KEY = /thumb|poster|cover|preview|avatar|icon|logo|last_frame|first_frame|frame_url|reference|ref_|input|prompt|callback|webhook|mask|source|origin/i;
const MAX_DEPTH = 7;

function isAssetUrl(value: string): boolean {
  return /^(https?:\/\/|data:|nomi-local:\/\/)/i.test(value.trim());
}

/** 地址的媒体类型证据：data: 看 mime；http 看路径扩展名；看不出 → null（不拒，交给下载那一步核）。 */
export function mediaKindOf(url: string): ExpectedMediaKind | null {
  const text = url.trim();
  const dataMime = /^data:([a-z]+)\//i.exec(text)?.[1]?.toLowerCase();
  if (dataMime) return dataMime === "image" || dataMime === "video" || dataMime === "audio" ? dataMime : dataMime === "model" ? "model3d" : null;
  const pathname = (() => {
    try {
      return new URL(text).pathname;
    } catch {
      return "";
    }
  })();
  const ext = /\.([a-z0-9]{2,5})$/i.exec(pathname)?.[1]?.toLowerCase();
  if (!ext || !ALL_KNOWN_EXTENSIONS.has(ext)) return null;
  return (Object.keys(EXTENSIONS) as ExpectedMediaKind[]).find((kind) => EXTENSIONS[kind].includes(ext)) ?? null;
}

type Candidate = { url: string; path: string; rank: number; typed: boolean };

function keyRank(key: string): number {
  const normalized = key.toLowerCase().replace(/\[\*\]$/, "");
  const index = (RESULT_KEY_RANK as readonly string[]).indexOf(normalized);
  return index >= 0 ? index : RESULT_KEY_RANK.length;
}

/** 深度扫响应里的地址，记下路径与它所在字段的可信度。数组里的字符串归属最近的字段名。 */
function scanCandidates(value: unknown, path: string, key: string, depth: number, out: Candidate[], excluded: boolean): void {
  if (depth > MAX_DEPTH) return;
  const node = maybeParseJsonString(value);
  if (typeof node === "string") {
    if (!excluded && isAssetUrl(node)) out.push({ url: node.trim(), path, rank: keyRank(key), typed: false });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => scanCandidates(item, `${path}.${index}`, key, depth + 1, out, excluded));
    return;
  }
  if (!isJsonRecord(node)) return;
  for (const [childKey, child] of Object.entries(node)) {
    // 子对象自己没有结果字段名时（如 videos[0] = {url}），沿用父字段的名字定可信度。
    const effectiveKey = keyRank(childKey) < RESULT_KEY_RANK.length ? childKey : key;
    scanCandidates(child, path ? `${path}.${childKey}` : childKey, effectiveKey, depth + 1, out, excluded || EXCLUDED_KEY.test(childKey));
  }
}

/**
 * 地址自身的媒体类型和这笔任务要的类型合不合得上。看不出类型 / 不知道要什么 → 合得上（交给下载那一步按字节核）。
 * 唯一的容器特例：要音频时接受视频容器扩展名（.mp4 / .webm 装音频）——这是「合同不按扩展名筛」想保住的那一类，
 * 其余对不上一律不要：要视频却给 .png，就是 V-1213 复现的「花钱生成视频、落盘一张图」。
 */
function kindCompatible(kind: ExpectedMediaKind | null, wantedKind: ExpectedMediaKind | null): boolean {
  if (!kind || !wantedKind || kind === wantedKind) return true;
  return wantedKind === "audio" && kind === "video";
}

/**
 * 一个地址能不能当本次产物：不是本次请求回显的参考地址、媒体类型和期望合得上。
 * **合同与通用规则共用这一道筛**（两台引擎都经它）：合同只决定「去哪儿找」，不豁免这两条。
 */
function admissible(url: string, wantedKind: ExpectedMediaKind | null, echoUrls: ReadonlySet<string>): boolean {
  if (echoUrls.has(url.trim())) return false;
  return kindCompatible(mediaKindOf(url), wantedKind);
}

/**
 * 类型证据分：期望类型对上的（扩展名 / data: mime 就是要的那种）最高；没期望时，看得出是媒体的高于看不出的。
 * 这一分**先于**字段名排名——「明确是视频的结果」压过「顶层一个看不出是什么的辅助地址」（V-1213 反例：
 * 顶层 poster / 无扩展名 url 抢走了 data.result.videos 里的真 mp4，花钱生成视频拿到一张图）。
 */
function typeScore(url: string, wantedKind: ExpectedMediaKind | null): number {
  const kind = mediaKindOf(url);
  if (wantedKind) return kind === wantedKind ? 2 : 1;
  return kind ? 2 : 1;
}

/**
 * 通用规则：合同读不到时，在响应里找最像本次产物的地址。
 * 期望类型对不上的不要；回显的参考地址不要；排除字段下的不要。排序：类型证据 → 字段名可信度 → 出现顺序。
 */
export function findResultUrlByGenericRule(
  response: unknown,
  wantedKind: ExpectedMediaKind | null,
  echoUrls: ReadonlySet<string> = new Set(),
): { urls: string[]; path: string } | null {
  const found: Candidate[] = [];
  scanCandidates(response, "", "", 0, found, false);
  const usable = found
    .filter((candidate) => candidate.rank < RESULT_KEY_RANK.length && admissible(candidate.url, wantedKind, echoUrls))
    .map((candidate, order) => ({ ...candidate, score: typeScore(candidate.url, wantedKind), order }));
  if (usable.length) {
    usable.sort((a, b) => b.score - a.score || a.rank - b.rank || a.order - b.order);
    // 同一张列表里的兄弟（videos.0.url / videos.1.url）是同一批产物，一起取；别处的地址不搭车。
    const listPattern = (path: string) => path.replace(/\.\d+(?=\.|$)/g, ".*");
    const best = usable[0];
    const pattern = listPattern(best.path);
    const urls = Array.from(new Set(usable
      .filter((candidate) => candidate.score === best.score && candidate.rank === best.rank && listPattern(candidate.path) === pattern)
      .map((candidate) => candidate.url)));
    return { urls, path: pattern };
  }
  // 深扫看不见的已知形状（只做**解码**）：同步接口的 b64_json（转 data: 地址）、chat/completions 里内联的图
  // （markdown / 多模态数组）。它排在深扫之后、过同一道筛，不能再绕过排序抢先返回。
  const known = extractAssetUrl(response).trim();
  if (known && admissible(known, wantedKind, echoUrls)) return { urls: [known], path: "known-shape" };
  return null;
}

/** 本次请求里出现过的地址（参考图 / 首帧 / 参考视频……）：上游常把它们原样回显，绝不能当产物。 */
export function requestEchoUrls(extras: unknown): Set<string> {
  const urls = new Set<string>();
  const walk = (value: unknown, depth: number) => {
    if (depth > MAX_DEPTH) return;
    if (typeof value === "string") {
      if (isAssetUrl(value)) urls.add(value.trim());
      return;
    }
    if (Array.isArray(value)) return value.forEach((item) => walk(item, depth + 1));
    if (isJsonRecord(value)) for (const child of Object.values(value)) walk(child, depth + 1);
  };
  walk(extras, 0);
  return urls;
}

/** 读一份异步任务响应：状态 + 结果地址 + 用了哪条规则。两台引擎的唯一读法。 */
export function readTaskResponse(input: {
  response: unknown;
  responseMapping: JsonRecord | null;
  statusMapping: Record<string, string[]> | undefined;
  wantedKind: ExpectedMediaKind | null;
  echoUrls?: ReadonlySet<string>;
  /** 有就在走了通用规则时记一条日志（哪家、哪个模型、哪条路径），排查与补合同用。 */
  trace?: { vendor?: string; model?: string };
}): TaskResponseReading {
  const echoUrls = input.echoUrls ?? new Set<string>();
  // 合同读到的地址过同一道筛（V-1213 复验）：回显的参考地址不要、和期望类型对不上的不要（音频装视频容器除外）。
  // 下载那一步只核「字节是不是它自称的那种媒体」，不知道这笔任务要什么——类型在这里就得核。
  const contractUrls = Array.from(new Set(
    CONTRACT_ASSET_KEYS.flatMap((key) => valuesFromMapping(input.response, input.responseMapping, key)).flatMap(collectAssetUrls),
  )).filter((url) => admissible(url, input.wantedKind, echoUrls));
  if (contractUrls.length > 0) {
    const resolved = resolveTaskStatus(input.response, input.responseMapping, input.statusMapping, contractUrls);
    return { ...resolved, assetUrls: contractUrls, rule: "contract" };
  }
  const generic = findResultUrlByGenericRule(input.response, input.wantedKind, echoUrls);
  const assetUrls = generic ? generic.urls : [];
  const resolved = resolveTaskStatus(input.response, input.responseMapping, input.statusMapping, assetUrls);
  // 通用规则找到的地址只在上游说成功（或动词认不出、靠这份产物作证据）时才算数：
  // 「进行中」的响应里出现的地址多半是占位 / 预览，不能拿去落盘。
  if (generic && resolved.status === "succeeded") {
    if (input.trace) logInfo("tasks", "result-read-generic-rule", { vendor: input.trace.vendor || "?", model: input.trace.model || "?", rule: `generic:${generic.path}` });
    return { ...resolved, assetUrls, rule: `generic:${generic.path}` };
  }
  return { ...resolved, assetUrls: [], rule: "none" };
}

/**
 * 引擎 B（制作 Run）账本要记的状态词：上游原话在共享词表里认得、或谁都认不得 → 记原话（账本记真话）；
 * 只有通道自己的 statusMapping 认得的方言词（共享词表里没有）才交归一后的判词——否则下游那张唯一词表会把它当「认不出」。
 */
export function readProviderStatusWord(response: unknown, responseMapping: JsonRecord | null, statusMapping: Record<string, string[]> | undefined): string {
  const record = isJsonRecord(response) ? response : {};
  const raw = firstString(firstMappedString(response, responseMapping, "status"), isJsonRecord(record.data) ? record.data.status : "", record.status);
  const resolved = readTaskResponse({ response, responseMapping, statusMapping, wantedKind: null });
  const keepRaw = Boolean(raw) && (classifyUpstreamTaskStatus(raw) !== "unknown" || Boolean(resolved.unrecognizedStatus));
  return keepRaw ? raw : resolved.status;
}
