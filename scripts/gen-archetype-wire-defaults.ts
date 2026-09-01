// 把档案(src/config/modelArchetypes)的参数默认值抽成纯数据，桥接给 electron。
// 为什么要它：electron/tsconfig rootDir 隔离，runtime 不能直接 import src/config 的档案；
// 但 headless/MCP 生成不经 UI → request.params 为空 → 缺必填参(model 变体 / duration / 比例…) vendor 拒。
// 本脚本(跑在 electron 编译外、可 import src/config)抽 {archetypeId: {taskKind: {param: defaultValue}}}，
// 写成 electron/catalog/archetypeWireDefaults.generated.ts；runtime 按 (archetypeId, taskKind) 兜底填，既有值优先。
// 单一真相源仍是档案：改档案默认 → `pnpm gen:archetype-defaults` 重生成；check:archetype-defaults 门防漂移。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL_ARCHETYPES } from "../src/config/modelArchetypes/index.ts";
import type { ModelArchetype } from "../src/config/modelArchetypes/types.ts";

type WireDefaults = Record<string, Record<string, Record<string, Record<string, unknown>>>>;
type ModeManifest = Record<string, {
  defaultModeId: string;
  modes: Record<string, string>;
}>;
// { archetypeId: { taskKind: true } } —— 该模式的 `size` 控件是「比例语义」（选项集里有 \d+:\d+ 档）。
type SizeRatioSemantic = Record<string, Record<string, boolean>>;

// 一个 size 控件的选项集里出现任意 "16:9" 这样的比例档 → 判定 size 键是比例语义（而非像素语义）。
const RATIO_OPTION_RE = /^\d+\s*:\s*\d+$/;

// 结构：{ archetypeId: { taskKind: { "*"|vendorKey: { param: default } } } }。
// 同一档案同一 taskKind 在不同 vendor 下参数枚举不同（vendorParams，B 分层，如 apimart Kling duration=number
// vs kie=string "5"）→ 必须按 vendor 分桶，否则会把 kie 的字符串默认喂给 apimart 触发「string≠int」。
// runtime 取 perKind[vendorKey] ?? perKind["*"]。
//
// ⚠️ 同一 taskKind 多模式的「主模式」收口（2026-09-01 修 minimax-h3 text_to_video 被 ref 模式盖住的 bug）：
// 一个档案可以有多个模式共享同一 transportTaskKind（minimax-h3 的 t2v/i2v/ref 都是 text_to_video 档案级默认；
// seedance 系的 first/firstlast/omni 都落 image_to_video）。消费侧（taskParams.applyHeadlessParamDefaults）
// 只按 (archetypeId, taskKind, vendorKey) 取兜底、**拿不到 modeId**（headless 缺参路正是「没选具体模式」那条），
// 所以这里必须为每个 (archetypeId, taskKind) **确定性地选一个主模式**写默认——而不是旧的「遍历顺序里最后一个模式胜」
// （那让 ref 的 adaptive + reference-to-video 覆盖了 t2v 的真实默认 16:9 + text-to-video，把 adaptive 当纯文生
// 默认发给 MiniMax /v2/video_generation → 400「t2va 必须显式 ratio 且不能 adaptive」）。
// 主模式判据（诚实、稳定、与运行时语义一致）：
//   ① 档案 defaultModeId 若落在这个 taskKind → 用它（它就是这条 taskKind 的规范/首选模式：
//      minimax-h3/happyhorse 的 t2v、runway-audio 的 sfx、suno 的 music）。
//   ② 否则（默认模式在别的 taskKind，如各 i2v 族档案默认是 t2v 文生）→ 用该 taskKind **首个声明**的模式
//      （档案作者把最基础的变体排前：i2v/first/keyframe 在 ref/omni 之前），保序、确定。
// 形状不变（仍 {taskKind:{vendorKey:{...}}}），消费侧零改动（P1：不加并行读方、不迁键形）。
//
// 纯函数（吃传入档案数组）：核心收口逻辑与全局目录解耦，回归测试可注入合成的「多模式同 taskKind」假档案
// 断言各模式默认互不污染（见 gen-archetype-wire-defaults.test.ts），不依赖真实目录。
export function buildWireDefaultsFor(archetypes: readonly ModelArchetype[]): WireDefaults {
  const out: WireDefaults = {};
  for (const arch of archetypes) {
    const defaultVariant =
      arch.variants && arch.defaultVariantId ? arch.variants.find((v) => v.id === arch.defaultVariantId) : undefined;
    // taskKind → 该 taskKind 下选中的主模式（见上「主模式判据」）。同 taskKind 后续模式不再覆盖它。
    const primaryModeByTaskKind = new Map<string, (typeof arch.modes)[number]>();
    for (const mode of arch.modes) {
      const taskKind = mode.transportTaskKind ?? arch.transportTaskKind;
      if (!taskKind) continue;
      const current = primaryModeByTaskKind.get(taskKind);
      if (!current) {
        primaryModeByTaskKind.set(taskKind, mode); // 首个声明的模式 = 默认候选（判据②）。
        continue;
      }
      // 判据①覆盖判据②：defaultModeId 模式一旦出现，抢占主模式（哪怕它不是首个声明的）。
      if (mode.id === arch.defaultModeId) primaryModeByTaskKind.set(taskKind, mode);
    }
    for (const [taskKind, mode] of primaryModeByTaskKind) {
      // body 的 model 字段：mode.modelEnum 优先，否则档案默认变体的 modelKey（headless 不选变体=默认变体）。
      const model = mode.modelEnum ?? defaultVariant?.modelKey;
      // 通用 params 落 "*"；每个有 vendorParams 覆盖的 vendor 落各自桶（覆盖=整组替换，与 resolveArchetypeForModel 一致）。
      const paramSets: Record<string, typeof mode.params> = { "*": mode.params ?? [], ...(mode.vendorParams ?? {}) };
      for (const [vendorKey, params] of Object.entries(paramSets)) {
        const d: Record<string, unknown> = {};
        // 模式级固定 body 常量（如 Veo/Omni 的 generation_type）——headless 也必发，各 vendor 桶都带。
        for (const [k, v] of Object.entries(mode.fixedParams ?? {})) d[k] = v;
        // 用户可调参的默认值（duration=number 保类型，避 vendor「string≠int」）。
        for (const p of params ?? []) {
          if (typeof p.defaultValue !== "undefined") d[p.key] = p.defaultValue;
        }
        if (model) d.model = model;
        if (Object.keys(d).length === 0) continue;
        out[arch.id] = out[arch.id] ?? {};
        out[arch.id][taskKind] = out[arch.id][taskKind] ?? {};
        (out[arch.id][taskKind] as Record<string, Record<string, unknown>>)[vendorKey] = d;
      }
    }
  }
  return out;
}

/** 生产入口：吃全局目录。逻辑收口在纯函数 buildWireDefaultsFor（可注入合成档案回归测试）。 */
export function buildArchetypeWireDefaults(): WireDefaults {
  return buildWireDefaultsFor(MODEL_ARCHETYPES);
}

/**
 * 每个模式（taskKind）的 `size` 键到底是**比例语义**还是**像素语义**——从控件选项集 DERIVE，而不是从
 * 默认值的字面形状猜。
 *
 * 为什么必须从这里 derive：headless size 别名闸（taskParams.sizeDefaultIsRatioSemantic）此前只按「默认值
 * 长得像不像 \d+:\d+」判——但 seedance-2.5-apimart 的 size 默认是 "adaptive"（比例族里的自动档，不匹配那个
 * 正则），而它的 size 控件选项集正是 ["adaptive","16:9","9:16",...]，且 t2v body 只读 `size`。于是调用方
 * aspect_ratio="16:9" 铺进的 size 被误判成「像素语义」而剥掉，默认 "adaptive" 胜出，画幅被吞。选项集里只要
 * 出现一个真比例档（16:9…），这个 size 键就是比例语义——用它填调用方比例是对的。此判据在生成期（能 import
 * src/config 档案、看得见控件 options）算好，桥过去给 electron 的闸读；闸对没登记的档案回退旧的值形状正则。
 *
 * 结构 { archetypeId: { taskKind: true } }：只登记「是比例语义」的（true），像素语义/无 size 控件的不落键
 * （闸里 `?? 回退` 即可），生成文件更小。同一 taskKind 跨 vendorParams 多套 params 时，任一套的 size 控件
 * 是比例语义即记 true（调用方比例对该模式适用）。
 */
export function buildArchetypeSizeRatioSemantic(): SizeRatioSemantic {
  const out: SizeRatioSemantic = {};
  for (const arch of MODEL_ARCHETYPES) {
    for (const mode of arch.modes) {
      const taskKind = mode.transportTaskKind ?? arch.transportTaskKind;
      if (!taskKind) continue;
      // 通用 params 与每个 vendorParams 覆盖里的 size 控件都算；任一套判为比例语义就登记。
      const paramSets: Array<typeof mode.params> = [mode.params ?? [], ...Object.values(mode.vendorParams ?? {})];
      const ratioSemantic = paramSets.some((params) =>
        (params ?? []).some(
          (p) => p.key === "size" && (p.options ?? []).some((o) => RATIO_OPTION_RE.test(String(o.value).trim())),
        ),
      );
      if (!ratioSemantic) continue;
      out[arch.id] = out[arch.id] ?? {};
      out[arch.id][taskKind] = true;
    }
  }
  return out;
}

/**
 * 档案身份表：{ archetypeId: identifierPatterns[] }。
 * 为什么也要桥过去：主进程要能从 modelKey 认出档案（中转接入时决定「这个模型有没有可复用的
 * 原生报文」、启动自愈时同理），而档案住 src/config、electron 直接 import 不到。匹配规则与
 * resolveArchetypeForModel 同源（整串相等 或 去掉 vendor 前缀后的末段相等），实现在
 * electron/catalog/archetypeIdentity.ts。
 */
export function buildArchetypeIdentifierPatterns(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const arch of MODEL_ARCHETYPES) {
    const patterns = [...(arch.identifierPatterns ?? [])];
    // 变体 modelKey 也是这个档案的身份（用户接入的可能是 fast/mini 那一支）。
    for (const v of arch.variants ?? []) if (v.modelKey) patterns.push(v.modelKey);
    const unique = [...new Set(patterns.map((p) => String(p).trim()).filter(Boolean))];
    if (unique.length) out[arch.id] = unique;
  }
  return out;
}

/**
 * 主进程脚本派发只需要确认「这个 modeId 是否属于该档案、走哪个 taskKind」。
 * 这里从完整档案生成最窄清单，避免 Electron 反向 import renderer 源码，也不在主进程
 * 复制 slots/params 等能力语义。用户自定义能力契约是运行时数据，另由主进程读取其显式投影。
 */
export function buildArchetypeModeManifest(): ModeManifest {
  const out: ModeManifest = {};
  for (const arch of MODEL_ARCHETYPES) {
    out[arch.id] = {
      defaultModeId: arch.defaultModeId,
      modes: Object.fromEntries(
        arch.modes.map((mode) => [mode.id, mode.transportTaskKind ?? arch.transportTaskKind]),
      ),
    };
  }
  return out;
}

const BANNER = "// @generated by scripts/gen-archetype-wire-defaults.ts — 请勿手改（改档案后跑 pnpm gen:archetype-defaults）。\n";

/** 档案 id → kind（拆分生成文件用）。 */
function archetypeKindById(): Record<string, string> {
  return Object.fromEntries(MODEL_ARCHETYPES.map((arch) => [arch.id, arch.kind]));
}

const KIND_SLUG: Record<string, string> = {
  image: "image",
  video: "video",
  audio: "audio",
  model3d: "model3d",
};

/**
 * 默认值表**按档案 kind 分片**生成，再由 barrel 合并。
 *
 * 为什么不写成一个文件：它随档案数单调增长，2026-08-26 接火山 Seedream 5.0 pro + Seedance 2.5 时
 * 顶破了 800 行巨壳门岗（R12）。把它塞进白名单等于给一个**每加一个模型就再涨一截**的文件开永久口子，
 * 门岗会一次次被同一件事顶红。按 kind 分片后每片各自增长，且分组语义与代码其它处一致。
 * （同样理由，身份表早已单独成文件——见 renderIdentifiersFile。）
 */
export function renderWireDefaultShards(defaults: WireDefaults): Array<{ file: string; content: string }> {
  const kindById = archetypeKindById();
  const byKind: Record<string, WireDefaults> = {};
  for (const [archetypeId, value] of Object.entries(defaults)) {
    const slug = KIND_SLUG[kindById[archetypeId]] ?? "other";
    byKind[slug] = byKind[slug] ?? {};
    byKind[slug][archetypeId] = value;
  }
  return Object.keys(KIND_SLUG)
    .concat("other")
    .filter((slug) => byKind[slug])
    .map((slug) => ({
      file: `archetypeWireDefaults.${slug}.generated.ts`,
      content:
        `${BANNER}// 档案参数默认值桥接（${slug} 分片）。合并出口在 archetypeWireDefaults.generated.ts。\n` +
        `export const ARCHETYPE_WIRE_DEFAULTS_${slug.toUpperCase()}: Record<string, Record<string, Record<string, Record<string, unknown>>>> = ${JSON.stringify(byKind[slug], null, 2)};\n`,
    }));
}

/** 合并出口（消费方 import 路径不变）。 */
export function renderGeneratedFile(defaults: WireDefaults, sizeRatioSemantic: SizeRatioSemantic): string {
  const shards = renderWireDefaultShards(defaults).map((s) => s.file.replace(/\.ts$/, ""));
  const names = shards.map((f) => `ARCHETYPE_WIRE_DEFAULTS_${f.split(".")[1].toUpperCase()}`);
  return (
    `${BANNER}// 档案参数默认值桥接：headless/MCP 生成缺参时 runtime 按 (archetypeId, taskKind) 兜底填，既有值优先。\n` +
    `// 表体按 kind 分片（各 *.generated.ts），此处合并 —— 分片是为了不让单文件随档案数顶破 800 行巨壳门岗。\n` +
    shards.map((file, i) => `import { ${names[i]} } from "./${file}";\n`).join("") +
    `\nexport const ARCHETYPE_WIRE_DEFAULTS: Record<string, Record<string, Record<string, Record<string, unknown>>>> = {\n` +
    names.map((n) => `  ...${n},\n`).join("") +
    `};\n` +
    `\n// size 键比例语义桥接（从档案 size 控件选项集 derive）：headless size 别名闸据此判「调用方比例能否落到 size」，\n` +
    `// 不再只按默认值字面形状猜（修 seedance-2.5-apimart t2v 的 size 默认 "adaptive" 被误判像素语义、吞掉调用方比例）。\n` +
    `export const ARCHETYPE_SIZE_RATIO_SEMANTIC: Record<string, Record<string, boolean>> = ${JSON.stringify(sizeRatioSemantic, null, 2)};\n`
  );
}

/** 身份表单独一个文件：与默认值是两件事（一个给 headless 兜底、一个给主进程认档案），
 *  合在一起还会把生成文件顶过 800 行的巨壳门岗。 */
export function renderIdentifiersFile(identifiers: Record<string, string[]>): string {
  return (
    `${BANNER}// 档案身份桥接：主进程从 modelKey 认出档案（中转接入选原生报文用）；匹配实现在 archetypeIdentity.ts。\n` +
    `export const ARCHETYPE_IDENTIFIER_PATTERNS: Record<string, string[]> = ${JSON.stringify(identifiers, null, 2)};\n`
  );
}

export function renderModesFile(manifest: ModeManifest): string {
  return (
    `${BANNER}// 档案模式桥接：主进程只据此校验 modeId/taskKind；完整输入能力仍以 renderer 档案为真相源。\n` +
    `export const ARCHETYPE_MODE_MANIFEST: Record<string, { defaultModeId: string; modes: Record<string, string> }> = ${JSON.stringify(manifest, null, 2)};\n`
  );
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
export const normalizeGeneratedText = (value: string): string => value.replaceAll("\r\n", "\n");

if (isMain) {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../electron/catalog");
  const wireDefaults = buildArchetypeWireDefaults();
  const outputs: Array<{ file: string; content: string }> = [
    ...renderWireDefaultShards(wireDefaults),
    { file: "archetypeWireDefaults.generated.ts", content: renderGeneratedFile(wireDefaults, buildArchetypeSizeRatioSemantic()) },
    { file: "archetypeIdentifiers.generated.ts", content: renderIdentifiersFile(buildArchetypeIdentifierPatterns()) },
    { file: "archetypeModes.generated.ts", content: renderModesFile(buildArchetypeModeManifest()) },
  ];
  if (process.argv.includes("--check")) {
    for (const { file, content } of outputs) {
      const target = path.join(dir, file);
      const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
      if (normalizeGeneratedText(existing) !== normalizeGeneratedText(content)) {
        console.error(`✗ ${file} 与档案不同步——跑 \`pnpm gen:archetype-defaults\` 重生成后提交。`);
        process.exit(1);
      }
    }
    console.log("✓ 档案默认参数桥接已同步。");
  } else {
    for (const { file, content } of outputs) fs.writeFileSync(path.join(dir, file), content);
    console.log(`wrote ${outputs.map((o) => o.file).join(", ")} (${Object.keys(buildArchetypeWireDefaults()).length} archetypes)`);
  }
}
