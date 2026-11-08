/**
 * 结构守卫：参考放进请求体的哪个键，只有 `lowerGenerationIntent.ts` 能写。
 *
 * S3（2026-11-08）之前同一件事有三份拼法（画布渲染层按槽写键、headless 按键名猜族、Run 按合同角色词查表再镜像别名），
 * 三份各自演化，同一张图同一个模式两条路发出去不一样。现在三个入口只把手上的东西说成意图，放置只在降级函数里。
 * 这里守两件事：
 *  1. 删掉的那几份拼法的名字不许回来（换个文件再抄一份也算）；
 *  2. 生产代码里，唯一主人以外不许静态写参考键；同目录也不许按变量键赋值，防止再藏一份拼法。
 *     键表是 shared 的通用参考键全集（`GENERIC_REFERENCE_KEYS`，由声明推导，加档案、加槽自动进表）。
 *     例外逐个登记理由：标准输入键（调用方 → 降级函数的中间形状）、键名同名但不是请求参数的、
 *     以及还没收进来的渲染后供应商改形（点名在册，不许再加）。
 *
 * 目录外变量键写入无法在这里判定其领域；三个真实入口另由 loweringConsumers.test.ts 守住消费结果。
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { GENERIC_REFERENCE_KEYS } from "../modelArchetypes/referenceKeys";

const repoRoot = path.resolve(__dirname, "../../..");
const LOWERING_DIR = path.join("electron", "shared", "generationLowering");

/**
 * 删掉的旧拼法（S3）。名字回来 = 有人又在别处放参考了。名字拆开拼，免得这份守卫自己成了全仓搜索里的一条命中
 * （验收按名字全仓 grep 要零条）。
 */
const RETIRED_ASSEMBLY_NAMES = [
  ["project", "ReferencesOntoBodyKeys"],
  ["project", "ReferenceUrls"],
  ["PROJECTION", "_KEYS"],
  ["APIMART_REFERENCE_PARAM", "ETER_ALIASES"],
  ["REFERENCE_PARAM", "ETER_ALIASES"],
  ["mirrorApimart", "ReferenceParameterAliases"],
  ["lower", "CombinedReferences"],
  ["combineRoleFor", "ContractReference"],
  ["refKey", "WantsArray"],
  ["OBJECT_SHAPE", "_REF_KEY"],
  ["ARRAY_SHAPE", "_REF_KEY"],
].map((parts) => parts.join(""));
/** 以前那张别名表的名字单独成词才算（接入套件里 `NEUTRAL_…` 开头的线缆名表是另一回事）。 */
const RETIRED_EXACT_WORDS = [["PARAMETER", "_ALIASES"].join("")];

/**
 * 允许静态写参考键的地方（文件 → 键 → 理由）。只有三类能进：
 *  · 标准输入：调用方 → 降级函数的中间形状（意图），不是放置决定；
 *  · 不是请求参数：键名碰巧和参考键同名的界面状态、节点 meta、上限表、工作流绑定配置；
 *  · 渲染后的供应商改形（`registerRequestTransform`）：供应商专用请求体在模板渲染之后再改形——同类、本次没收进
 *    降级函数（要把改形写进档案槽的 inputKey，再逐字节核这些供应商的请求体），在这里点名，不许再加新的。
 * 新增一行要说清是哪一类、为什么不能交给降级函数。
 */
const STANDARD_INPUT = "标准输入键（意图），不是放置决定";
const NOT_REQUEST_PARAMS = "不是请求参数，键名同名而已";
const VENDOR_TRANSFORM = "渲染后的供应商改形（registerRequestTransform）：同类、本次未收进降级函数";
const STANDARD_INPUT_WRITERS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "electron/catalog/archetypeInput.ts": {
    first_frame_url: `${STANDARD_INPUT}：referenceInputParams 把调用方的 firstFrameUrl… 归一成标准 snake 键，headless 降级从这里读携带的参考`,
    last_frame_url: STANDARD_INPUT,
    reference_image_urls: STANDARD_INPUT,
    reference_video_urls: STANDARD_INPUT,
    source_video_url: `${STANDARD_INPUT}（单源视频）`,
    reference_audio_urls: STANDARD_INPUT,
    reference_images: `${STANDARD_INPUT}（聚合兜底）`,
  },
  "src/ui/onboarding/customCallTestFixture.ts": {
    first_frame_url: `${STANDARD_INPUT}：自定义调用脚本试跑给用户脚本的输入，不经 mapping body`,
    last_frame_url: STANDARD_INPUT,
    reference_image_urls: STANDARD_INPUT,
    reference_images: STANDARD_INPUT,
    reference_audio_urls: STANDARD_INPUT,
    reference_video_urls: STANDARD_INPUT,
    source_video_url: STANDARD_INPUT,
  },
  "src/workbench/generationCanvas/runner/relayFrameResolver.ts": {
    firstFrameUrl: `${STANDARD_INPUT}：视频接力把上一段的尾帧当这一段的首帧，写的是画布参考列表`,
  },
  "electron/browser/core/browserViewBridges.ts": { image: `${NOT_REQUEST_PARAMS}：内置浏览器的截图状态` },
  "electron/catalog/comfyuiWorkflowBindingNormalize.ts": { images: `${NOT_REQUEST_PARAMS}：ComfyUI 工作流的图片输入绑定` },
  "electron/integrationCertification/integrationWorkflowBinding.ts": { images: `${NOT_REQUEST_PARAMS}：工作流媒体绑定的校验结果` },
  "src/workbench/generationCanvas/model/referenceImageUrlsToEdges.ts": { referenceImageUrls: `${NOT_REQUEST_PARAMS}：节点 meta 里的上传列表` },
  "src/workbench/generationCanvas/nodes/controls/generationModePresentation.ts": {
    images: `${NOT_REQUEST_PARAMS}：模式的张数上限表`,
    videos: NOT_REQUEST_PARAMS,
    audios: NOT_REQUEST_PARAMS,
  },
  "src/workbench/generationCanvas/nodes/director/model/storeOutputActions.ts": { videos: `${NOT_REQUEST_PARAMS}：导演台的产物列表` },
  "electron/catalog/falOfficial.ts": { end_image_url: `${VENDOR_TRANSFORM}：fal Kling V3 把 image_urls 改成 start_image_url / end_image_url` },
  "electron/catalog/runwayImage.ts": { referenceImages: `${VENDOR_TRANSFORM}：Runway 图片把参考改成 [{uri}]` },
  "electron/catalog/agnesVideoContract.ts": { videos: `${VENDOR_TRANSFORM}：Agnes Video 2.5 把参考视频改成 [{url, start_seconds…}]` },
};

function productionSources(): string[] {
  const out: string[] = [];
  for (const top of ["electron", "src"]) {
    const root = path.join(repoRoot, top);
    for (const entry of fs.readdirSync(root, { recursive: true }) as string[]) {
      const rel = path.join(top, entry);
      if (!/\.(ts|tsx)$/.test(rel) || /\.(test|spec)\.(ts|tsx)$/.test(rel) || /(^|\/)(__tests__|__fixtures__|fixtures)\//.test(rel)) continue;
      if (rel.includes(`${path.sep}node_modules${path.sep}`) || rel.endsWith(".d.ts")) continue;
      out.push(rel);
    }
  }
  return out.sort();
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 去掉注释（行注释与块注释），只看代码。字符串里的 `//`（URL）按行内引号粗判保留。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => {
      const index = line.search(/(^|[^:"'`])\/\//);
      return index < 0 ? line : line.slice(0, index + 1);
    })
    .join("\n");
}

function retiredNameHits(files: ReadonlyArray<{ rel: string; source: string }>): string[] {
  const words = [
    ...RETIRED_ASSEMBLY_NAMES.map((name) => new RegExp(`\\b${escape(name)}\\b`)),
    ...RETIRED_EXACT_WORDS.map((name) => new RegExp(`(^|[^A-Za-z0-9_])${escape(name)}($|[^A-Za-z0-9_])`)),
  ];
  const hits: string[] = [];
  for (const { rel, source } of files) {
    source.split("\n").forEach((line, index) => {
      if (words.some((word) => word.test(line))) hits.push(`${rel}:${index + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

function staticReferenceKeyWrites(files: ReadonlyArray<{ rel: string; source: string }>): string[] {
  const keys = [...GENERIC_REFERENCE_KEYS].filter((key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key));
  const alternation = keys.map(escape).join("|");
  // x.key = … / x.key ??= … / x["key"] = … （不含 == / ===）
  const write = new RegExp(`(?:\\.(${alternation})\\b|\\[\\s*["'\`](${alternation})["'\`]\\s*\\])\\s*(?:\\?\\?=|=(?!=))`, "g");
  const hits: string[] = [];
  for (const { rel, source } of files) {
    if (rel === path.join(LOWERING_DIR, "lowerGenerationIntent.ts")) continue;
    const allowed = STANDARD_INPUT_WRITERS[rel.split(path.sep).join("/")] ?? {};
    stripComments(source).split("\n").forEach((line, index) => {
      for (const match of line.matchAll(write)) {
        const key = match[1] ?? match[2]!;
        if (!allowed[key]) hits.push(`${rel}:${index + 1}: ${key} ← ${line.trim()}`);
      }
    });
    if (rel.startsWith(LOWERING_DIR + path.sep)) {
      const file = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isBinaryExpression(node) && ts.isElementAccessExpression(node.left)
          && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
          && !ts.isStringLiteralLike(node.left.argumentExpression)) {
          const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
          hits.push(`${rel}:${line}: 变量键写入 ← ${node.getText(file)}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
  }
  return hits;
}

describe("参考放置只有一个主人（lowerGenerationIntent.ts）", () => {
  const files = productionSources().map((rel) => ({ rel, source: fs.readFileSync(path.join(repoRoot, rel), "utf8") }));

  it("删掉的旧拼法不许回来（electron / src 生产与测试代码都查，注释里也不许）", () => {
    const withTests: Array<{ rel: string; source: string }> = [];
    for (const top of ["electron", "src"]) {
      for (const entry of fs.readdirSync(path.join(repoRoot, top), { recursive: true }) as string[]) {
        const rel = path.join(top, entry);
        if (!/\.(ts|tsx)$/.test(rel) || rel.endsWith("referencePlacementOwnership.test.ts")) continue;
        withTests.push({ rel, source: fs.readFileSync(path.join(repoRoot, rel), "utf8") });
      }
    }
    expect(retiredNameHits(withTests)).toEqual([]);
  });

  it("唯一主人以外不静态写参考键，同目录也不许变量键赋值（标准输入键的造型逐个登记理由）", () => {
    expect(staticReferenceKeyWrites(files)).toEqual([]);
  });

  it("登记表里每一行都还有对应的写法（写法删了，登记也要删）", () => {
    const stale: string[] = [];
    for (const [rel, keys] of Object.entries(STANDARD_INPUT_WRITERS)) {
      const source = files.find((file) => file.rel.split(path.sep).join("/") === rel)?.source;
      for (const key of Object.keys(keys)) {
        if (!source || !new RegExp(`\\.${escape(key)}\\s*=(?!=)`).test(stripComments(source))) stale.push(`${rel}: ${key}`);
      }
    }
    expect(stale).toEqual([]);
  });

  it("守卫自己认得出旧拼法（反例：一行 Run 路别名镜像、一行按族写键）", () => {
    const planted = [{
      rel: path.join("electron", "capabilityCore", "planted.ts"),
      source: [
        `const ${RETIRED_ASSEMBLY_NAMES[2]} = { imageUrls: "image_urls" };`,
        "export function place(parameters: Record<string, unknown>, urls: string[]) {",
        "  parameters.image_urls = urls;",
        "  parameters[\"first_frame_image\"] = urls[0];",
        "}",
      ].join("\n"),
    }];
    expect(retiredNameHits(planted)).toHaveLength(1);
    expect(staticReferenceKeyWrites(planted)).toHaveLength(2);
  });

  it("同目录也不许另开写口：静态键和变量键都拒绝，唯一主人不误报", () => {
    const source = 'out.image_urls = urls;\nout[key] = value;\nout[key] ??= value;';
    expect(staticReferenceKeyWrites([{ rel: path.join(LOWERING_DIR, "anotherWriter.ts"), source }])).toHaveLength(3);
    expect(staticReferenceKeyWrites([{ rel: path.join(LOWERING_DIR, "lowerGenerationIntent.ts"), source }])).toEqual([]);
    expect(staticReferenceKeyWrites([{ rel: path.join(LOWERING_DIR, "declaration.ts"), source: 'const keys = ["image_urls"];\nconst value = out[key];' }])).toEqual([]);
  });
});
