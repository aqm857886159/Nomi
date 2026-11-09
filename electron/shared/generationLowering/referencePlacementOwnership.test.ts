/**
 * 结构守卫：参考放置只有一个主人（`lowerGenerationIntent.ts`），删掉的旧拼法不许回来，意图里没地方夹带落点。
 *
 * S3（2026-11-08）之前同一件事有三份拼法（画布渲染层按槽写键、headless 按键名猜族、Run 按合同角色词查表再镜像别名），
 * 三份各自演化，同一张图同一个模式两条路发出去不一样。现在三个入口只把手上的东西说成意图，放置只在降级函数里。
 * 11-09 又收掉函数里的第二套表示（Run 旧值在意图里自带候选键、读键、选法，原值形状照搬）：槽和旧落点规则都编译成
 * 绑定，意图只剩「值 + 第几个绑定」。
 * 这里守两件事：
 *  1. 删掉的那几份拼法、那套旧值表示的名字不许回来（换个文件再抄一份也算）；
 *  2. 意图的形状就是「绑定 + 值」：选哪个键、什么形状、已有值怎么办只能写在绑定里，意图里没地方再带一份。
 *
 * 「新入口自己挑键、绕过主人发出去」不再靠扫生产代码里的写法（以前的静态写键扫描 + 例外登记表，2026-11-09 删：它把
 * 同名的界面状态、metadata 都当成写口，又拦不住换个变量名、跨模块 helper 的写法——方向检查
 * `docs/engineering/direction-checks/2026-11-09-reference-assembly-boundary.md`）。现在由结构挡：
 *  · 解析产物不透明、请求体由装配主人封存，裸 Record / 快照 / 克隆在参考装配入口和发送入口带原因拒
 *    （`referenceAssemblyBoundary.test.ts`）；
 *  · 谁能拿到解析器、并入口、封存体发送口、原始出网和模板内部，由 `eslint.config.mjs` 的模块边界名单管
 *    （`referenceAssemblyBoundary.lint.test.ts`）；
 *  · 三个真实入口共用同一份绑定，由 `referenceBinding.contract.test.ts` 的变异守（改一种目标策略或编码，用到它的入口一起红）。
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

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
  // 11-09：Run 旧值的第二套表示（意图自带候选键、读键、选法）。
  ["Preserved", "ReferenceIntent"],
  ["preserved", "References"],
  ["retainExisting", "GroupAt"],
  ["joins", "Combine"],
  ["reference_slot", "_unknown"],
].map((parts) => parts.join(""));
/** 以前那张别名表的名字单独成词才算（接入套件里 `NEUTRAL_…` 开头的线缆名表是另一回事）。 */
const RETIRED_EXACT_WORDS = [["PARAMETER", "_ALIASES"].join("")];

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

/** 两个意图类型的成员名（`Readonly<{…}>` 或 `{…}` 都认）。 */
function intentShape(source: string): Record<string, string[]> {
  const file = ts.createSourceFile("lowerGenerationIntent.ts", source, ts.ScriptTarget.Latest, true);
  const shape: Record<string, string[]> = {};
  const literalOf = (node: ts.TypeNode): ts.TypeLiteralNode | null => {
    if (ts.isTypeLiteralNode(node)) return node;
    if (ts.isTypeReferenceNode(node) && node.typeArguments?.length === 1) return literalOf(node.typeArguments[0]!);
    return null;
  };
  file.forEachChild((node) => {
    if (!ts.isTypeAliasDeclaration(node) || !["IntentReference", "GenerationIntent"].includes(node.name.text)) return;
    const literal = literalOf(node.type);
    Object.assign(shape, { [node.name.text]: literal ? literal.members.map((member) => member.name?.getText(file) ?? "?") : ["?"] });
  });
  return shape;
}

describe("参考放置只有一个主人（lowerGenerationIntent.ts）", () => {
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

  it("意图只有「绑定 + 值」：IntentReference 只有 binding / value，GenerationIntent 只有 references", () => {
    expect(intentShape(fs.readFileSync(path.join(repoRoot, LOWERING_DIR, "lowerGenerationIntent.ts"), "utf8"))).toEqual({
      IntentReference: ["binding", "value"],
      GenerationIntent: ["references"],
    });
  });

  it("意图形状守卫认得出夹带（反例：意图里再带候选键）", () => {
    const planted = 'export type IntentReference = Readonly<{ binding: number; value: string; keys: string[] }>;\nexport type GenerationIntent = { references: IntentReference[]; extra?: unknown };';
    expect(intentShape(planted)).toEqual({ IntentReference: ["binding", "value", "keys"], GenerationIntent: ["references", "extra"] });
  });

  it("守卫自己认得出旧拼法（反例：一行 Run 路别名镜像）", () => {
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
  });
});
