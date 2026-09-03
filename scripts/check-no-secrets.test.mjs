// 安全门岗的凭证检测单测。
//
// 为什么存在：2026-08-25 复盘——一个真实可用的 kie.ai key 明文躺在公开仓库 3 个月没被拦住
// （docs/onboarding-trials/fixtures/SECURITY-AUDIT.md:5）。这份测试把「必须拦住」和
// 「不许误报」两头同时钉死，防止门岗再被悄悄降级成橡皮图章。
//
// 注意：本文件自己也会被门岗扫（凭证规则不受路径白名单管）。所以**不许**在源码里写
// 字面量凭证形状的串——所有测试用凭证都在运行时用 sha256 派生拼出来（见 fixtureHex）。

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCANNER = path.join(REPO, "scripts", "check-no-secrets.mjs");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-secret-gate-"));

afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

/** 确定性地造一个高熵 hex 串（不在源码里留字面量凭证）。 */
const fixtureHex = (seed, len) => createHash("sha256").update(seed).digest("hex").slice(0, len);

/** 跑真扫描器（子进程，测的是真 CLI 而不是重写一遍规则）。 */
function scan(...args) {
  try {
    // stdio 全 pipe：否则扫描器的拦截横幅会直接喷进测试日志（反例用例本来就期望它红）
    const stdout = execFileSync("node", [SCANNER, ...args], { encoding: "utf8", cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/** 把内容写进临时文件后扫它。relPath 只影响「路径长什么样」（白名单是按路径匹配的）。 */
function scanContent(relPath, content) {
  const abs = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return scan(abs);
}

describe("明文凭证检测 — 必须拦住", () => {
  it("真实泄露的原样形状：`Target: kie.ai (<32位hex>)`，一个上下文词都没有", () => {
    // 这是 2026-05-28 那次真泄露的行，逐字复刻（key 换成派生值）。
    // 它没有 key/token/secret 任何上下文词——所以不能用「附近有关键词」来收窄。
    const r = scanContent("audit.md", `Date: 2026-05-28\nTarget: kie.ai (\`${fixtureHex("kie", 32)}\`)\n`);
    expect(r.code).toBe(1);
    expect(r.out).toContain("32 位 hex");
  });

  it("【根因】路径命中白名单也照样拦——白名单不许赦免凭证", () => {
    // 当初漏掉的第二个原因：ALLOWLIST 的 /docs\/.*(security|安全).*\.md$/i 把整份
    // SECURITY-AUDIT.md 放行了，而 scan() 里 `if (isAllowed(f)) continue` 是整体跳过。
    // 现在路径白名单只赦免「路径黑名单 + 微信类内容规则」，凭证规则对所有文件生效。
    const leak = `Target: kie.ai (\`${fixtureHex("allowlisted", 32)}\`)\n`;
    for (const p of ["docs/security/feedback-data-safety.md", "docs/plan/2026-05-28-feedback-radar.md", "docs/安全说明.md"]) {
      const r = scanContent(p, leak);
      expect(r.code, `白名单路径 ${p} 必须仍拦住凭证`).toBe(1);
    }
  });

  it("门岗自己不许把 key 完整打进 CI 日志（只脱敏成头4…尾4）", () => {
    const key = fixtureHex("masking", 32);
    const r = scanContent("audit.md", `Target: kie.ai (\`${key}\`)\n`);
    expect(r.out).not.toContain(key);
    expect(r.out).toContain(key.slice(0, 4));
    expect(r.out).toContain(key.slice(-4));
  });

  it("供应商前缀凭证", () => {
    const cases = [
      ["Anthropic", `sk-ant-${fixtureHex("anthropic", 40)}`],
      ["OpenAI 兼容", `sk-${fixtureHex("openai", 40)}`],
      ["GitHub", `ghp_${fixtureHex("github", 36)}`],
      ["AWS", `AKIA${fixtureHex("aws", 16).toUpperCase()}`],
      ["Google", `AIza${fixtureHex("google", 35)}`],
      ["Replicate", `r8_${fixtureHex("replicate", 37)}`],
      ["HuggingFace", `hf_${fixtureHex("hf", 34)}`],
    ];
    for (const [who, key] of cases) {
      const r = scanContent("notes.md", `随手记一下：${key}\n`);
      expect(r.code, `${who} 的 key 没被拦住`).toBe(1);
    }
  });

  it("关键词赋值兜住 32 位以外的形状（40/64 位 hex、base64 token）", () => {
    for (const len of [40, 64]) {
      const r = scanContent("cfg.ts", `const apiKey = "${fixtureHex(`len${len}`, len)}";\n`);
      expect(r.code, `${len} 位 hex 的 apiKey 赋值没被拦住`).toBe(1);
    }
    const b64 = createHash("sha256").update("b64").digest("base64").replace(/=+$/, "");
    expect(scanContent("cfg.ts", `access_token: "${b64}"\n`).code).toBe(1);
  });
});

describe("不许误报 — 仓库里真实存在的合法 32 位 hex", () => {
  // 这 8 处是全仓实扫出来的合法命中。当初的诱惑是「给它们各加一条白名单」——那等于
  // 把门岗降级成橡皮图章，正是漏掉真泄露的同一个病。所以改用两条结构判据把它们分开：
  //   ① 粘连（前后紧邻 [A-Za-z0-9_-./]）= 更大标识符的一段，不是独立凭证
  //   ② 低熵 = magic bytes 这类结构化数据，不是随机凭证
  const legit = [
    ["ComfyUI 哈希文件名 <hex>_<hex>.png（粘连）", "* （如 `1e7c411e05e7cfe8d6fca2cca51cb0f3_395b49d269db4e08b18cc1ed73a24730.png`），"],
    ["sketchfab 模型 ID（URL 尾部，粘连）", "* source:\thttps://sketchfab.com/3d-models/ue-mannequin-retopology-5394d9f894374a2ab7c57a21929ce4c2"],
    ["无横线 UUID（URL 段，粘连）", '{"image":"https://cdn.example.com/2f7a7cf9f5bc774d063f1f74e8bff249.png"}'],
    ["MP4 magic bytes（低熵，H=2.476）", 'const MP4_BYTES = Buffer.from("00000018667479706d70343200000000", "hex");'],
  ];
  for (const [what, line] of legit) {
    it(`放行：${what}`, () => {
      expect(scanContent("sample.ts", `${line}\n`).code, `误报了：${what}`).toBe(0);
    });
  }

  it("放行：描述性测试假值（被分隔符切碎的英文散文，不是随机串）", () => {
    const prose = [
      'apiKey: "must-be-ignored-for-none-auth",',
      'apiKey: "main-process-secret-must-not-leak",',
      'apiKey: "renderer-must-not-update-a-saved-key",',
      "const secretKey = 'sk-existing-connection-e2e-secret'",
      "const secretKey = 'sk-save-first-walkthrough'",
    ];
    for (const line of prose) {
      expect(scanContent("x.test.ts", `${line}\n`).code, `误报了描述性假值：${line}`).toBe(0);
    }
  });

  it("放行：git SHA-1 / SHA-256（任何 git 仓库里都海量合法出现）", () => {
    const content = [
      "- 基线 commit：`0d375a9590aee716008a06a676dbdf59e7332452`",
      '"computedHash": "8df9b47092524833138b58682d03f2e153a242e550d1693657afdbee0cc9cdb0"',
    ].join("\n");
    expect(scanContent("audit.md", `${content}\n`).code).toBe(0);
  });

  it("放行：占位符 / 示例 key", () => {
    for (const v of ["your-api-key-here", "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxx", "<YOUR_API_KEY_HERE>", "REPLACE_WITH_YOUR_KEY_1234"]) {
      expect(scanContent("README.md", `apiKey: "${v}"\n`).code, `误报了占位符：${v}`).toBe(0);
    }
  });
});

describe("行级豁免标记", () => {
  const key = fixtureHex("inline", 32);

  it("带理由的标记（同行）能豁免", () => {
    expect(scanContent("t.mjs", `const k = "${key}"; // nomi-secret-scan:allow 公开测试向量，非凭证\n`).code).toBe(0);
  });

  it("带理由的标记（上一行是纯注释行）能豁免", () => {
    expect(scanContent("t.mjs", `// nomi-secret-scan:allow 公开测试向量，非凭证\nconst k = "${key}";\n`).code).toBe(0);
  });


  it("不写理由的裸标记**不**生效——豁免必须说清为什么", () => {
    expect(scanContent("t.mjs", `const k = "${key}"; // nomi-secret-scan:allow\n`).code).toBe(1);
  });

  // 这条钉住的是「赦免范围」——带凭证那行上的标记不许顺延到下一行，
  // 否则标一行就悄悄赦免两行，又变成范围失控的赦免（本门岗的病根就是范围过大的赦免）。
  it("标记只赦免那一行，同文件其余行照拦", () => {
    const other = fixtureHex("inline-other", 32);
    const content = `const a = "${key}"; // nomi-secret-scan:allow 公开测试向量，非凭证\nconst b = "${other}";\n`;
    const r = scanContent("t.mjs", content);
    expect(r.code).toBe(1);
    expect(r.out).toContain(other.slice(0, 4)); // 报的是第 2 行那个
    expect(r.out).not.toContain(key.slice(0, 4));
  });
});

describe("路径白名单对非凭证规则仍然有效（没被这次改动误伤）", () => {
  it("白名单路径里的微信占位示例仍放行", () => {
    const wechat = "wxid_" + "abcdefgh1234";
    expect(scanContent("docs/feedback/README.md", `示例：${wechat}\n`).code).toBe(0);
  });
  it("非白名单路径里的同一串仍拦住", () => {
    const wechat = "wxid_" + "abcdefgh1234";
    expect(scanContent("src/leak.ts", `const id = "${wechat}";\n`).code).toBe(1);
  });
});

// 2026-09-03 删掉了这里的「--all 全绿」用例。
//
// 它跑的是 `node scripts/check-no-secrets.mjs --all`——与 package.json 的 `check:secrets`
// **逐字节同一条命令**，而 `check:secrets` 已经在 gates:contracts 链里独立跑。也就是说
// 同一次全仓扫描在每次 gates 里跑两遍：一遍在 contracts lane，一遍在并行 unit lane。
// 后者还挤在 ~1120 个测试文件中间抢 CPU，实测空载 17.7s、并行 lane 上直接压穿 60s 超时。
//
// 按 P1（不留并行版）删的是**重复的那一份**，不是覆盖：全仓零误报这件事仍由
// `pnpm run check:secrets` 独立守着，而且它红了会直接把 gates 链断掉，比这里的断言更硬。
// 下面这条静态检查（1ms，不起子进程）留着——它验的是「ALLOWLIST 没被开后门」这件
// **源码层**的事，contracts lane 的扫描跑绿并不能证明它，两者不重复。
describe("全仓兜底", () => {
  it("ALLOWLIST 里没有为那 8 个合法 hex 文件开的口子", () => {
    const src = fs.readFileSync(SCANNER, "utf8");
    const allowlist = src.slice(src.indexOf("const ALLOWLIST"), src.indexOf("// ====="));
    for (const f of ["titleHeuristics", "ue-mannequin", "promptLibrarySeed", "release-notes", "comfyui", "bilibili", "onboarding-trials"]) {
      expect(allowlist, `ALLOWLIST 里不该为 ${f} 开口子——那是把门岗降级成橡皮图章`).not.toContain(f);
    }
  });
});
