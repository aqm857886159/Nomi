// 本地 ComfyUI /object_info 能力索引（节点类清单 + combo 枚举值）。两处消费：
//   ① 导入 workflow 时对账「缺自定义节点 / 引用了本机没有的模型文件」（comfyuiWorkflowImportStore.reconcile）；
//   ② 内置文生图 ckpt_name 留空时 derive 本机第一个 checkpoint（comfyuiLocal 的 "comfyui-prompt" 请求变换）。
// 与 comfyuiProbe 同一直连纪律：全局 fetch（undici 不认系统代理 → 直连本机/局域网，不被 Clash 绕开）。
// 形状实查 ComfyUI server.py：/object_info 返回 { <class_type>: { input: { required/optional: { <key>: [spec, opts?] } } } }。
// combo 输入的 spec 有两种活的形状（2026-09-11 真机 ComfyUI 0.35.0 实测，本机 ~/ComfyUI 含真实自定义节点，
// 1188 个类里 533 个字段是新格式）：
//   ① 老节点（函数式 INPUT_TYPES）：spec[0] 本身就是字符串数组，如 [["a.safetensors","b.safetensors"], {opts}]。
//   ② 新一代节点（comfy_api.latest._io.py 的 IO.Combo.Input，序列化见该文件 add_to_dict_v1）：
//      spec = ["COMBO", { options?: string[]|number[], multiselect?, remote?: {route,...}, control_after_generate?, ... }]。
//      options 字段缺失 = 纯 remote 动态下拉（如内置 LoadImageOutput.image 的 remote:{route:"/internal/files/output"}），
//      本地没有可核对的列表，按「已知但无本地列表」跳过（不是「已装 0 个」，见下方 classifyComboSpec 注释）。
// owner 2026-09-11 追问「会不会还有新格式，之后还要搞？」——真正「没见过」的第三种外壳（既不是①也不是②，
// 也不是已知且故意排除在外的 DynamicCombo）不再默默跳过：收进 ComfyObjectInfoIndex.unknownComboShapes，
// 供 UI 一键「反馈给 Nomi」（见 electron/comfyuiProbe.ts、src/ui/onboarding/ComfyuiWorkflowImportPanel.tsx）。
// /object_info/{class} 只返回该类同构子集。
import { comfyuiEndpoint, normalizeComfyuiBaseUrl } from "./comfyui/endpointResolver";
import { appFetch } from "./appFetch";

/** 一处真机遇到的「没见过的 combo 外壳」——喂进「反馈给 Nomi」诊断的原始素材（node class / input key / 原始 spec）。 */
export type ComfyUnknownComboSpec = {
  classType: string;
  inputKey: string;
  /** 原始 spec，未裁剪——诊断 UI 把它原样贴进 GitHub issue 正文，供排查真实新格式用。 */
  spec: unknown;
};

export type ComfyObjectInfoIndex = {
  /** 本机已装的全部节点 class_type。 */
  classNames: Set<string>;
  /** class_type → (inputKey → combo 可选值)。老/新两种 spec 格式都收（文件名/采样器这类枚举）；remote 动态下拉不收。 */
  enumsByClass: Map<string, Map<string, string[]>>;
  /**
   * 真正「没见过的」combo 外壳（既不是老格式数组、也不是已知的 COMBO/DynamicCombo 两个家族）。
   * 不是每次「取不到枚举」都进这里——remote-only combo、DynamicCombo 这类是**已知但本地无列表**，
   * 静默即可（见 classifyComboSpec 注释）；只有真正陌生的外壳才进，供「反馈给 Nomi」一键报告用
   * （2026-09-11 owner 拍板：「会不会还有新格式」→ 下次真遇到时能自己喊出来，不再要真机踩一次才发现）。
   * 上限 50 条，防某个装了大量自定义节点的机器把这份诊断也撑爆。
   */
  unknownComboShapes: ComfyUnknownComboSpec[];
};

const MAX_UNKNOWN_COMBO_SHAPES = 50;

function isRec(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 单个 combo 选项列表上限（防某些索引型自定义节点带百万级列表撑爆内存）。超限当「无枚举」跳过（不算未知格式，只是太大）。 */
const MAX_ENUM_OPTIONS = 20_000;

/**
 * 已知、但**故意**不展开成扁平枚举的 combo 家族 io_type。真机实测（2026-09-11，本机 ~/ComfyUI 0.35.0，
 * 含真实自定义节点）：`COMFY_DYNAMICCOMBO_V3`（如 ResizeImageMaskNode.resize_type）的 `options` 是一份
 * 「选哪个模式就展开哪组子输入」的嵌套子 schema（元素是 `{key, inputs:{...}}` 对象），根本不是选项值
 * 列表——这是另一个概念（动态表单），不是「我们不认识的 COMBO 变体」，纳入 unknownComboShapes 会造成
 * 假警报。留在这张白名单里的都必须像这样逐个核实过语义，不能因为名字带 combo 就默认加入。
 */
const KNOWN_NON_ENUM_COMBO_FAMILY = new Set(["COMFY_DYNAMICCOMBO_V3"]);

function toEnumString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  // 真机实测两处真实节点混了数字进字符串枚举——内置 CreateVideo.bit_depth 的 options 是
  // ["auto", 8, 10]，第三方 KJNodes ImageResizeKJ.crop 的老格式数组是 ["disabled","center",0]。
  // 早先「必须纯字符串数组」的严格性会把这两个真实、正在用的字段判成「未知」，比该报的还宽——
  // 数字转字符串收进来（下游 enumsByClass 契约本就是 string[]），不算新外壳，只是元素类型更宽容。
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

type ComboClassification =
  | { kind: "options"; options: string[] }
  /** 不是 combo 语义（普通类型名如 INT/STRING/IMAGE），或已知且故意不展开的 combo 家族（如 DynamicCombo）。 */
  | { kind: "not-combo" }
  /** 已知是 combo 外壳，但本地没有可核对的列表（remote-only 动态下拉，或选项数超限）。 */
  | { kind: "known-empty" }
  /** 没见过的外壳——可能是 ComfyUI 又引入了新格式，值得「反馈给 Nomi」。 */
  | { kind: "unknown-shape" };

/**
 * 给一个输入 spec 分类。返回值三分（详见 ComboClassification 各分支注释）——「不认识」和
 * 「认识但没有本地列表」必须分开，混淆会重演 R21 那次「空数组当不是枚举」的沉默失灵，也会让
 * 「反馈给 Nomi」诊断在正常的 remote-only/DynamicCombo 字段上瞎报警。
 */
function classifyComboSpec(spec: unknown): ComboClassification {
  if (!Array.isArray(spec) || spec.length === 0) return { kind: "not-combo" };
  const head: unknown = spec[0];

  // 老格式：spec[0] 本身就是枚举值数组，如 [["a.safetensors","b.safetensors"], {opts}]。
  if (Array.isArray(head)) {
    if (head.length > MAX_ENUM_OPTIONS) return { kind: "known-empty" };
    const options: string[] = [];
    for (const raw of head) {
      const s = toEnumString(raw);
      if (s === undefined) return { kind: "unknown-shape" }; // 数组里混进既非字符串也非数字的元素（对象/布尔/…）
      options.push(s);
    }
    return { kind: "options", options };
  }

  // 正常类型 spec 的第一个元素必须是字符串（类型名，或 combo 家族的 io_type 字面量）；
  // 两者都不是 → 从没见过的外壳形态（不是 combo 语义之外的东西，是彻底陌生的东西）。
  if (typeof head !== "string") return { kind: "unknown-shape" };

  // 新一代节点格式：spec = ["COMBO", { options?, remote?, multiselect?, ... }]（_io.py Combo.Input.as_dict）。
  // multiselect/MultiCombo 的 options 形状与单选完全一致，这里先当普通枚举收（TODO：多选值语义——
  // reconcile 侧按 typeof value === "string" 过滤，多选实际值是数组，天然不会被误判，暂不需要专门分支）。
  if (head === "COMBO") {
    const cfg = spec[1];
    if (!isRec(cfg)) return { kind: "unknown-shape" }; // _io.py 的 as_dict 恒产出一个 config 对象；缺失=没见过的变体
    const options: unknown = cfg.options;
    if (options === undefined) return { kind: "known-empty" }; // 纯 remote 动态下拉：已知，非「已装 0 个」
    if (!Array.isArray(options)) return { kind: "unknown-shape" }; // options 存在但不是数组——未来 ComfyUI 可能改成这样
    if (options.length > MAX_ENUM_OPTIONS) return { kind: "known-empty" };
    const collected: string[] = [];
    for (const raw of options) {
      const s = toEnumString(raw);
      if (s === undefined) return { kind: "unknown-shape" };
      collected.push(s);
    }
    return { kind: "options", options: collected };
  }

  if (KNOWN_NON_ENUM_COMBO_FAMILY.has(head)) return { kind: "not-combo" };
  // 名字里带 combo 但既不是 "COMBO" 也不在白名单里——很可能是 ComfyUI 又引入了新的 combo 家族。
  if (/combo/i.test(head)) return { kind: "unknown-shape" };
  return { kind: "not-combo" }; // 普通类型名（INT/STRING/IMAGE/…），不是 combo 语义
}

/** 纯解析（可单测）：/object_info 全量或 /object_info/{class} 子集 → 能力索引。任何异形都跳过、不抛。 */
export function parseObjectInfoIndex(json: unknown): ComfyObjectInfoIndex {
  const classNames = new Set<string>();
  const enumsByClass = new Map<string, Map<string, string[]>>();
  const unknownComboShapes: ComfyUnknownComboSpec[] = [];
  if (!isRec(json)) return { classNames, enumsByClass, unknownComboShapes };
  for (const [classType, def] of Object.entries(json)) {
    if (!isRec(def)) continue;
    classNames.add(classType);
    const input = isRec(def.input) ? def.input : {};
    const enums = new Map<string, string[]>();
    for (const group of [input.required, input.optional]) {
      if (!isRec(group)) continue;
      for (const [inputKey, spec] of Object.entries(group)) {
        const result = classifyComboSpec(spec);
        if (result.kind === "options") {
          enums.set(inputKey, result.options);
        } else if (result.kind === "unknown-shape" && unknownComboShapes.length < MAX_UNKNOWN_COMBO_SHAPES) {
          unknownComboShapes.push({ classType, inputKey, spec });
        }
      }
    }
    if (enums.size > 0) enumsByClass.set(classType, enums);
  }
  return { classNames, enumsByClass, unknownComboShapes };
}

function normalizeBase(baseUrl: string): string {
  return normalizeComfyuiBaseUrl(baseUrl);
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown | null> {
  try {
    const res = await appFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // 连不上/超时/非 JSON —— 调用方按「无法核对」处理（不阻断导入/提交）。
  }
}

// 60s TTL 缓存（按 URL）：一次导入面板里的多次分析 / 一批提交共享，不反复拉几 MB 的全量 object_info。
const cache = new Map<string, { at: number; value: ComfyObjectInfoIndex }>();
/** 同一个 ComfyUI origin 的并发读取共享一条网络请求，避免设置页批量加载时击穿缓存。 */
const inFlight = new Map<string, Promise<ComfyObjectInfoIndex | null>>();
const CACHE_TTL_MS = 60_000;

function cached(url: string): ComfyObjectInfoIndex | null {
  const hit = cache.get(url);
  return hit && Date.now() - hit.at < CACHE_TTL_MS ? hit.value : null;
}

export function _resetComfyObjectInfoCacheForTest(): void {
  cache.clear();
  inFlight.clear();
}

/**
 * 按 baseUrl 爆缓存。用户动作驱动的对账（导入分析 / 预置模板「重新检测」）必须拿新鲜事实——
 * 用户刚把模型放进目录、点重检还看到 60s 前的「缺」是假话（走查实锤过）。提交路径的 checkpoints
 * 缓存不受影响（那边 60s 内多次提交共享一份没问题）。
 */
export function bustComfyObjectInfoCache(baseUrl: string): void {
  const prefix = normalizeBase(baseUrl);
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** 全量能力索引（导入对账用）。null = 服务器不可达/异常（调用方跳过核对，别当「没装任何节点」）。 */
export async function fetchComfyuiObjectInfoIndex(baseUrl: string): Promise<ComfyObjectInfoIndex | null> {
  const url = comfyuiEndpoint(baseUrl, "objectInfo");
  const hit = cached(url);
  if (hit) return hit;
  const pending = inFlight.get(url);
  if (pending) return pending;
  const request = (async (): Promise<ComfyObjectInfoIndex | null> => {
    const json = await fetchJson(url, 15_000); // 全量含全部自定义节点，可到几 MB —— 给足时间
    if (json === null) return null;
    const index = parseObjectInfoIndex(json);
    // 空 classNames = 形状不认识（真 ComfyUI 至少有内置节点），按不可核对处理，别误报「全缺」。
    if (index.classNames.size === 0) return null;
    cache.set(url, { at: Date.now(), value: index });
    return index;
  })();
  inFlight.set(url, request);
  try {
    return await request;
  } finally {
    if (inFlight.get(url) === request) inFlight.delete(url);
  }
}

/** 本机已装 checkpoint 文件名（内置文生图 ckpt_name 留空时 derive 用）。null = 不可达。 */
export async function fetchComfyuiCheckpoints(baseUrl: string): Promise<string[] | null> {
  const url = comfyuiEndpoint(baseUrl, "objectInfo", "CheckpointLoaderSimple");
  const hit = cached(url);
  if (hit) return hit.enumsByClass.get("CheckpointLoaderSimple")?.get("ckpt_name") ?? [];
  const pending = inFlight.get(url);
  if (pending) {
    const index = await pending;
    return index?.enumsByClass.get("CheckpointLoaderSimple")?.get("ckpt_name") ?? (index ? [] : null);
  }
  const request = (async (): Promise<ComfyObjectInfoIndex | null> => {
    const json = await fetchJson(url, 5_000);
    if (json === null) return null;
    const index = parseObjectInfoIndex(json);
    if (index.classNames.size === 0) return null;
    cache.set(url, { at: Date.now(), value: index });
    return index;
  })();
  inFlight.set(url, request);
  try {
    const index = await request;
    return index?.enumsByClass.get("CheckpointLoaderSimple")?.get("ckpt_name") ?? (index ? [] : null);
  } finally {
    if (inFlight.get(url) === request) inFlight.delete(url);
  }
}
