// 守卫：单测和隔离窗口都不许落到创作者真实的能力目录（主目录下 .nomi/capability-core：令牌、实例登记、批准收据密钥）。
//
// 拦得住：① 全局启动配置（tests/setup/tempWorkspace.ts）不再把 NOMI_CAPABILITY_DIR 指到本轮临时目录；
//        ② 起窗共用助手（tests/ux/_launchApp.mjs）又改回继承外层 shell 的值；
// 另有一道只提醒、不红的事后检查（tempWorkspace.ts teardown）：整套跑完默认能力目录修改时间变了就打印一句提醒。
//        它会被创作者的 Nomi 开关、别的线并行测试误触发，所以不做成硬红。
// 拦不住：手写 spawn / 硬编码 home 路径且清掉环境变量的代码、vitest 之外直接起的 node 进程——
//        这类至多靠上面的提醒事后发现，不能事前阻止。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { capabilityCoreDir } from "../electron/capabilityCore/security";

const repoRoot = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

describe("能力目录不落到真实主目录", () => {
  it("单测运行期间 capabilityCoreDir() 指向本轮临时目录", () => {
    const dir = capabilityCoreDir();
    expect(dir).not.toBe(path.join(os.homedir(), ".nomi", "capability-core"));
    expect(dir).toContain("nomi-vitest-run-");
  });

  it("全局启动配置明确设了 NOMI_CAPABILITY_DIR", () => {
    expect(read("tests/setup/tempWorkspace.ts")).toMatch(/env\[CAPABILITY_DIR_KEY\]\s*=/);
  });

  it("起窗助手的能力目录表达式不读外层 process.env", () => {
    const source = read("tests/ux/_launchApp.mjs");
    const start = source.indexOf("const capabilityDir =");
    expect(start).toBeGreaterThan(-1);
    const expr = source.slice(start, source.indexOf("\n\n", start));
    expect(expr).not.toMatch(/process\.env/);
    expect(expr).toMatch(/isolate \? path\.join\(tempRoot, 'capability'\)/);
  });
});
