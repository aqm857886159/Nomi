import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fsyncDirectoryIfDurable, getDurabilityMode, setDurabilityMode } from "./durability";
import { writeJsonFileAtomic } from "./jsonFile";
import { createProductionRunRepository } from "./productionRun/productionRunRepository";

// 反向保证（P1：不留悄悄削弱生产的逃生口）。
//
// 整个套件默认跑在 'ephemeral'（`tests/setup/durability.ts` 关掉了 fsync，这是 productionRun
// flake 的根因修复）。代价是：**没有任何别的测试还会碰真 fsync**，所以万一哪天生产的落盘屏障
// 被删掉/改坏，全绿也照样看不出来。这个文件就是那道反向闸——它自己翻回 'durable'，
// 断言真实写盘路径确实调了 fsync。
//
// 详见 docs/plan/2026-08-25-production-run-test-flake-fsync.md。

describe("durability barrier", () => {
  const previous = getDurabilityMode();
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-durability-"));
    setDurabilityMode("durable");
  });

  afterEach(() => {
    setDurabilityMode(previous);
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("'durable' 模式下 writeJsonFileAtomic 真的 fsync（掉电不撕裂 project.json 的地基）", () => {
    const spy = vi.spyOn(fs, "fsyncSync");
    writeJsonFileAtomic(path.join(root, "project.json"), { hello: "world" });
    expect(spy).toHaveBeenCalled();
    // 内容照常落地（屏障不改变可观察行为）。
    expect(JSON.parse(fs.readFileSync(path.join(root, "project.json"), "utf8"))).toEqual({ hello: "world" });
  });

  it("'durable' 模式下 production run 的事件追加真的 fsync（事件日志不撕裂 = run 能重放）", () => {
    const repository = createProductionRunRepository({ projectDirResolver: () => root });
    const spy = vi.spyOn(fs, "fsyncSync");
    repository.create({
      runId: "run-durability-1",
      projectId: "project-1",
      playbook: { name: "brand.promo", version: "1.0.0" },
      origin: { host: "codex" },
      brief: { goal: "durability", durationSeconds: 30 },
    });
    expect(spy).toHaveBeenCalled();
  });

  it("'ephemeral' 模式下不 fsync —— 但写入的字节完全一样（关屏障不改变被测行为）", () => {
    const durablePath = path.join(root, "durable.json");
    writeJsonFileAtomic(durablePath, { a: 1, b: [2, 3] });

    setDurabilityMode("ephemeral");
    const spy = vi.spyOn(fs, "fsyncSync");
    const ephemeralPath = path.join(root, "ephemeral.json");
    writeJsonFileAtomic(ephemeralPath, { a: 1, b: [2, 3] });

    expect(spy).not.toHaveBeenCalled();
    expect(fs.readFileSync(ephemeralPath, "utf8")).toBe(fs.readFileSync(durablePath, "utf8"));
  });

  // 注：这条钉的是**模式翻转**（谁有权关屏障）。屏障的另一半——**调用点**
  // （不许绕过 fsyncIfDurable 直接 fs.fsyncSync）由 `pnpm run check:heavy-path` 的
  // `unguarded-fsync` 规则把着，不在这里重复实现（P1：一个不变量一个执行处）。
  it("只有测试 harness 能翻成 ephemeral——生产代码里不许出现（防 flake 修复被当成万能开关滥用）", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx|mts|mjs)$/.test(entry.name) || /\.test\.[a-z]+$/.test(entry.name)) continue;
        if (full.endsWith(path.join("tests", "setup", "durability.ts"))) continue; // 唯一合法处
        if (/setDurabilityMode\(\s*["']ephemeral["']\s*\)/.test(fs.readFileSync(full, "utf8"))) {
          offenders.push(path.relative(process.cwd(), full));
        }
      }
    };
    for (const dir of ["electron", "src", "scripts", "tests"]) {
      const abs = path.join(process.cwd(), dir);
      if (fs.existsSync(abs)) walk(abs);
    }
    expect(offenders).toEqual([]);
  });
});

// 目录屏障（fsyncDirectoryIfDurable）：全仓唯一的「开目录 fd 只为 fsync 它」实现。
// 2026-09-03 根因：Windows 上 openSync 目录能成功、fsyncSync 才抛 EPERM，两处各抄一份的实现没兜这一步，
// 新建 / 打开任何项目都在主进程炸成 project_agent_unavailable。这里钉住三条：durable 真 fsync、
// 不支持目录 fsync 的平台码静默放过、ephemeral 连 open 都不做。
describe("fsyncDirectoryIfDurable", () => {
  const previous = getDurabilityMode();
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-durability-dir-"));
  });

  afterEach(() => {
    setDurabilityMode(previous);
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("'durable' 模式下打开目录并 fsync 它", () => {
    setDurabilityMode("durable");
    const open = vi.spyOn(fs, "openSync");
    const sync = vi.spyOn(fs, "fsyncSync").mockImplementation(() => undefined);
    fsyncDirectoryIfDurable(root);
    expect(open).toHaveBeenCalledWith(root, "r");
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("平台不支持目录 fsync（EPERM / EINVAL / ENOTSUP）→ 静默放过，其它错误照抛", () => {
    setDurabilityMode("durable");
    const unsupported = Object.assign(new Error("EPERM: operation not permitted, fsync"), { code: "EPERM" });
    vi.spyOn(fs, "fsyncSync").mockImplementation(() => {
      throw unsupported;
    });
    expect(() => fsyncDirectoryIfDurable(root)).not.toThrow();
    const io = Object.assign(new Error("EIO: i/o error, fsync"), { code: "EIO" });
    vi.spyOn(fs, "fsyncSync").mockImplementation(() => {
      throw io;
    });
    expect(() => fsyncDirectoryIfDurable(root)).toThrow(io);
  });

  it("'ephemeral' 模式下连目录 fd 都不开", () => {
    setDurabilityMode("ephemeral");
    const open = vi.spyOn(fs, "openSync");
    const sync = vi.spyOn(fs, "fsyncSync");
    fsyncDirectoryIfDurable(root);
    expect(open).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });
});

// 类级回归（docs/fixes/2026-09-03-windows-directory-fsync-barrier）：「开一个只读目录 fd 然后 fsync 它」这个形态
// 全仓只许出现在 durability.ts。再抄一份就是第九个平台差异分叉点。
describe("directory barrier has a single implementation", () => {
  it("no module outside electron/durability.ts pairs a read-only openSync with an fsync", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(ts|mts)$/.test(entry.name) || /\.test\.[a-z]+$/.test(entry.name)) continue;
        if (full.endsWith(path.join("electron", "durability.ts"))) continue;
        const source = fs.readFileSync(full, "utf8");
        if (/openSync\([^)]*(?:"r"|O_RDONLY)[^)]*\)[\s\S]{0,300}?fsync(?:IfDurable|Sync)\(/.test(source)) {
          offenders.push(path.relative(process.cwd(), full));
        }
      }
    };
    walk(path.join(process.cwd(), "electron"));
    expect(offenders).toEqual([]);
  });
});
