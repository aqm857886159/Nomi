// 结构测试：模型的完整名字只在 `modelHandle.ts` 一处生成、一处查表。
//
// 为什么要它：完整名字以前就有过「两处各拼一份」的苗头（索引印 id、列表印 id + vendor，两边对不上，
// 真模型评测 11-15 那轮 24 次拒收有 13 次是 id 抄对了、家配错了）。任何别的生产文件自己写
// `${modelId}@${vendor}`、或者拿 `@` 去切这串名字，都会让「名字长什么样」重新有两个家——这里当场拦。
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const OWNER = path.join("electron", "shared", "agentCapabilities", "modelHandle.ts");
const SCAN = ["electron", "src"];
const SOURCE = /\.(ts|tsx|mts)$/;
const TEST = /\.(test|e2e|spec)\.|\/__tests__\//;

// `${…modelId|modelKey…}@${…vendor|providerId|vendorKey|modelVendor…}`：模型身份两件拼成一串。
const CONCAT = /\$\{[^}]*\b(?:modelId|modelKey)\b[^}]*\}@\$\{[^}]*\b(?:vendor|providerId|vendorKey|modelVendor)\b[^}]*\}/;
// 拿 `@` 去切 / 找完整名字（只看同一行里提到 model 的）。
const PARSE = /\b(?:model\w*|handle\w*)\b[^\n]*\.(?:split|lastIndexOf|indexOf)\(\s*["']@["']\s*\)/i;

function productionFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) productionFiles(full, out);
    else if (SOURCE.test(name) && !TEST.test(full)) out.push(full);
  }
  return out;
}

function handleViolations(files: readonly string[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const relative = path.relative(ROOT, file);
    if (relative === OWNER) continue;
    readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      if (CONCAT.test(line) || PARSE.test(line)) hits.push(`${relative}:${index + 1}  ${line.trim()}`);
    });
  }
  return hits;
}

describe("模型完整名字只有一个家", () => {
  const files = SCAN.flatMap((dir) => productionFiles(path.join(ROOT, dir)));

  it("扫到的生产文件够多（不然这条断言是空的）", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((file) => file.endsWith(OWNER))).toBe(true);
  });

  it("modelHandle.ts 之外没有生产代码自己拼或切完整名字", () => {
    expect(handleViolations(files), "改用 modelHandleOf / resolveModelHandle").toEqual([]);
  });

  it("阳性对照：尺子认得出两种违规写法", () => {
    expect(CONCAT.test("const name = `${row.modelId}@${row.vendor}`")).toBe(true);
    expect(CONCAT.test("label: `${model.modelKey}@${model.vendorKey}`")).toBe(true);
    expect(PARSE.test("const [id, vendor] = modelName.split('@')")).toBe(true);
    expect(CONCAT.test("occurrence: `${run.id}@${run.updatedAt}`")).toBe(false);
  });
});
