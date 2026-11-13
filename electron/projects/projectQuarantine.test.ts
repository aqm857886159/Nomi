import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../scripts/_test-temp.mjs";
import { quarantineSafeName, quarantineWriteResult, writeQuarantineItems } from "./projectQuarantine";

const dirs: string[] = [];
const project = () => { const dir = makeTempDir("nomi-quarantine-"); dirs.push(dir); return dir; };
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.chmodSync(path.join(dir, ".nomi", "quarantine"), 0o755); } catch { /* not created */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
const qdir = (dir: string) => path.join(dir, ".nomi", "quarantine");
const files = (dir: string) => (fs.existsSync(qdir(dir)) ? fs.readdirSync(qdir(dir)).sort() : []);
const body = (dir: string, name: string) => JSON.parse(fs.readFileSync(path.join(qdir(dir), name), "utf8"));
const NOW = new Date(Date.UTC(2026, 10, 13, 8, 5, 12));

describe("quarantine sidecar", () => {
  it("keeps the raw content under .nomi/quarantine, named <time>-<kind>-<name>-<hash>.json", () => {
    const dir = project();
    const raw = { id: "bad", title: "我的分镜：第一版/草稿", plan: { shots: [{ durationSec: null }] } };
    const out = writeQuarantineItems(dir, [{ container: "storyboardDesign", field: "plan.shots[0].durationSec", raw }], NOW);
    const [name] = files(dir);
    expect(name).toMatch(/^20261113-080512-storyboardDesign-我的分镜：第一版_草稿-[0-9a-f]{12}\.json$/);
    expect(out).toEqual({ files: [{ relativePath: `.nomi/quarantine/${name}`, fresh: true }] });
    expect(body(dir, name)).toEqual({ container: "storyboardDesign", field: "plan.shots[0].durationSec", raw });
  });

  it("dedupes by content hash: the same item on every autosave is one file and only the first write is fresh", () => {
    const dir = project();
    const item = { container: "storyboardDesign", field: "x", raw: { id: "bad" } };
    const results = Array.from({ length: 5 }, (_, i) => writeQuarantineItems(dir, [item], new Date(NOW.getTime() + i * 1000)).files[0].fresh);
    expect(results).toEqual([true, false, false, false, false]);
    expect(files(dir)).toHaveLength(1);
  });

  it("does not truncate: 25 items in one call are all written (a 20-item cap would lose 5)", () => {
    const dir = project();
    const items = Array.from({ length: 25 }, (_, i) => ({ container: "storyboardDesign", field: "status", raw: { id: `d${i}`, title: `分镜${i}`, marker: `BAD-${i}-END` } }));
    expect(writeQuarantineItems(dir, items, NOW).files).toHaveLength(25);
    const all = files(dir).map((name) => JSON.stringify(body(dir, name))).join("\n");
    for (let i = 0; i < 25; i += 1) expect(all).toContain(`BAD-${i}-END`);
  });

  it("does not skip a large item (no silent 2MB cap)", () => {
    const dir = project();
    writeQuarantineItems(dir, [{ container: "storyboardDesign", field: "f", raw: { id: "big", prompt: "x".repeat(3 * 1024 * 1024) } }], NOW);
    expect(files(dir)).toHaveLength(1);
  });

  it("replaces a half-written file with the same hash instead of treating it as already kept", () => {
    const dir = project();
    const item = { container: "storyboardDesign", field: "status", raw: { id: "d1", title: "T", prompt: "y".repeat(5000) } };
    const [first] = writeQuarantineItems(dir, [item], NOW).files;
    const file = path.join(dir, first.relativePath);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").slice(0, 1000)); // 以前非原子写被强杀留下的半截
    const [again] = writeQuarantineItems(dir, [item], NOW).files;
    expect(again).toEqual({ relativePath: first.relativePath, fresh: true });
    expect(body(dir, path.basename(file))).toEqual(item);
  });

  it("throws on a malformed item instead of skipping it silently", () => {
    const dir = project();
    expect(() => writeQuarantineItems(dir, [{ container: 1 }])).toThrow();
    expect(() => writeQuarantineItems(dir, "nope")).toThrow();
  });

  it("file names are safe and length-limited", () => {
    expect(quarantineSafeName('a<b>c:"d/e\\f|g?h*i\u0001j')).toBe("a_b_c_d_e_f_g_h_i_j");
    expect(Array.from(quarantineSafeName("长".repeat(200)))).toHaveLength(40);
    expect(quarantineSafeName("...")).toBe("item");
  });
});

describe("quarantine IPC envelope", () => {
  it("a write that cannot land returns a failure that names the item but carries no content", () => {
    const dir = project();
    fs.mkdirSync(qdir(dir), { recursive: true });
    fs.chmodSync(qdir(dir), 0o500); // 只读：和 Windows 杀毒占住目录（EPERM）走同一条路
    const SECRET = "私有标题-不许进包络";
    const result = quarantineWriteResult(dir, [{ container: "storyboardDesign", field: "plan.shots[3].durationSec", raw: { id: "d1", title: SECRET, prompt: SECRET } }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason?.kind).toBe("write-denied");
    expect(result.reason?.item).toEqual({ index: 0, container: "storyboardDesign", field: "plan.shots[3].durationSec" });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(dir);
  });

  it("an unknown project folder is not-found, not a silent { written: 0 }", () => {
    const result = quarantineWriteResult(null, [{ container: "c", field: "f", raw: 1 }]);
    expect(result).toMatchObject({ ok: false, reason: { kind: "not-found", item: null } });
  });
});
