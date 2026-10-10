/**
 * `check:walkthrough-tool-args` —— 走查里手写的模型面调用，键必须在那个动词今天发布的 schema 里。
 *
 * 判据本体与它守的不变量写在 `scripts/walkthrough-tool-args-lib.mjs`，这里只负责接线：
 * 从 `MODEL_FACING_TOOL_SPECS` 派生出**模型此刻真正读到的** JSON Schema，喂进判据。
 *
 * 用法：pnpm run check:walkthrough-tool-args
 */
import fs from "node:fs";
import path from "node:path";
import { MODEL_FACING_TOOL_SPECS } from "../electron/shared/agentCapabilities/modelFacingToolRegistry";
import { toPublishedJsonSchema } from "../electron/shared/agentCapabilities/modelVisibleJsonSchema";
import { collectWalkthroughToolArgViolations } from "./walkthrough-tool-args-lib.mjs";

import { repoRoot } from "./lib/repoPaths.mjs";
const walkthroughRoot = path.join(repoRoot, "tests", "ux");

function collectFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(mjs|mts|ts)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

const schemasByVerb = Object.fromEntries(
  MODEL_FACING_TOOL_SPECS.map((spec) => [spec.name, toPublishedJsonSchema(spec.schema)]),
);

const files = collectFiles(walkthroughRoot).map((full) => ({
  path: path.relative(repoRoot, full),
  text: fs.readFileSync(full, "utf8"),
}));

const result = collectWalkthroughToolArgViolations(files, schemasByVerb);

// 空转守卫（2026-09-18 的教训：一道扫不到东西的门岗，绿得和真绿一模一样）。
if (result.sites === 0 || result.checked === 0) {
  console.error(
    `❌ 判据空转：扫了 ${files.length} 个走查文件，认出 ${result.sites} 处动词调用、比对 ${result.checked} 个键。` +
    `\n   多半是动词名对不上或字面量形状变了，不是真的没有手写调用。`,
  );
  process.exit(1);
}

if (result.violations.length > 0) {
  console.error(`❌ 走查手写的模型面调用有 ${result.violations.length} 个键不在动词的 schema 里：\n`);
  for (const violation of result.violations) {
    console.error(`   ${violation.filePath}:${violation.line}  ${violation.verb} → ${violation.key}`);
  }
  console.error(
    `\n   这个字面量没有类型，编译器看不见它；宿主按新名读会读到 undefined，那一步静默什么也不做。` +
    `\n   → 查这个动词今天的字段名：pnpm exec tsx scripts/check-model-schema.ts 的 published schema，` +
    `\n     或直接读 electron/shared/agentCapabilities/verbDeclarations.ts。`,
  );
  process.exit(1);
}

const skippedNote = result.skipped.length > 0
  ? `；${result.skipped.length} 处查不了（变量/展开/计算键），如实记账不算绿`
  : "";
console.log(
  `✅ 走查模型面调用：${result.sites} 处调用、${result.checked} 个键全部在 schema 里` +
  `（${Object.keys(schemasByVerb).length} 个动词的发布 schema）${skippedNote}。`,
);
