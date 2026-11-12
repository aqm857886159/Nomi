import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../scripts/_test-temp.mjs";
import { writeQuarantineItems } from "./projectQuarantine";

const dirs: string[] = [];
const project = () => { const dir = makeTempDir("nomi-quarantine-"); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const files = (dir: string) => fs.readdirSync(path.join(dir, ".nomi", "quarantine"));

describe("quarantine sidecar", () => {
  it("keeps the raw content of each isolated item under the project's .nomi/quarantine", () => {
    const dir = project();
    const raw = { id: "bad", title: "原样内容", plan: { shots: [{ durationSec: null }] } };
    expect(writeQuarantineItems(dir, [{ container: "storyboardDesign", field: "plan.shots[0].durationSec", raw }])).toEqual({ written: 1 });
    const [name] = files(dir);
    expect(name).toMatch(/^storyboardDesign-[0-9a-f]{16}\.json$/);
    expect(JSON.parse(fs.readFileSync(path.join(dir, ".nomi", "quarantine", name), "utf8"))).toEqual({ container: "storyboardDesign", field: "plan.shots[0].durationSec", raw });
  });

  it("is idempotent: the same item every autosave writes one file, not one per save", () => {
    const dir = project();
    const item = { container: "storyboardDesign", field: "x", raw: { id: "bad" } };
    for (let i = 0; i < 5; i += 1) writeQuarantineItems(dir, [item]);
    expect(files(dir)).toHaveLength(1);
  });

  it("ignores malformed calls and oversize items without throwing", () => {
    const dir = project();
    expect(writeQuarantineItems(dir, "nope")).toEqual({ written: 0 });
    expect(writeQuarantineItems(dir, [null, { container: 1 }, { container: "c", field: "f", raw: "x".repeat(3 * 1024 * 1024) }])).toEqual({ written: 0 });
    expect(fs.existsSync(path.join(dir, ".nomi", "quarantine"))).toBe(false);
  });
});
