// 铁律 ⑩ 模型半：样本集的形状、花钱开关、以及评分管线在零额度夹具上能跑通（不调任何真模型）。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { cases, requiresSpendOptIn, TOKEN_ESTIMATE } from "./datasets/intent-draft.mjs";
import { draftShotFields, gradeIntent } from "./lib/intentGrading.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type IntentCase = (typeof cases)[number];

describe("intent-draft 样本集", () => {
  it("至少 24 条，中英各半，id 唯一，train / test 两边都有两种语言", () => {
    expect(cases.length).toBeGreaterThanOrEqual(24);
    const zh = cases.filter((c: IntentCase) => c.lang === "zh").length;
    expect(zh * 2).toBe(cases.length);
    expect(new Set(cases.map((c: IntentCase) => c.id)).size).toBe(cases.length);
    for (const split of ["train", "test"]) {
      const langs = new Set(cases.filter((c: IntentCase) => c.split === split).map((c: IntentCase) => c.lang));
      expect([...langs].sort(), `${split} 两种语言都要有`).toEqual(["en", "zh"]);
    }
  });

  it("每条都写了期望的草稿字段，且覆盖比例 / 时长 / 张数 / 模型点名 / 参考 / 先别生成 / 越界诚实", () => {
    const covered = new Set<string>();
    for (const c of cases as IntentCase[]) {
      const fields = Object.keys(c.expect.draft);
      expect(fields.length, `${c.id} 没写期望字段`).toBeGreaterThan(0);
      for (const field of fields) covered.add(field);
    }
    for (const field of ["aspectRatio", "durationSec", "count", "modelMatch", "references", "noGenerate", "honesty"]) {
      expect(covered.has(field), `没有一条用例考 ${field}`).toBe(true);
    }
  });

  it("默认不跑真模型：不带 --spend-ok 时 eval:run 直接拒绝，并说清这一批大概花多少 token", () => {
    expect(requiresSpendOptIn).toBe(true);
    expect(TOKEN_ESTIMATE.perCaseTypical).toBeGreaterThan(0);
    const run = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "eval-run.mjs"), "intent-draft"], { cwd: repoRoot, encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/--spend-ok/);
    expect(run.stderr).toMatch(/万 token/);
  });
});

describe("意图评分器（确定性）", () => {
  it("顶层 taskKind 折进每一镜；比例读 aspectRatio / aspect_ratio / ratio / 比例语义的 size", () => {
    const args = { taskKind: "text_to_video", shots: [{ parameters: { size: "16:9" } }, { aspectRatio: "9:16" }, { parameters: { ratio: "1:1" }, taskKind: "text_to_image" }] };
    expect(args.shots.map((shot) => draftShotFields(args, shot))).toEqual([
      { kind: "video", durationSec: undefined, aspectRatio: "16:9", model: undefined, references: 0 },
      { kind: "video", durationSec: undefined, aspectRatio: "9:16", model: undefined, references: 0 },
      { kind: "image", durationSec: undefined, aspectRatio: "1:1", model: undefined, references: 0 },
    ]);
  });

  it("像素档 size（2048x2048）不算比例；宿主拒收的那次草稿不算数", () => {
    const events = [
      { type: "agent.tool.proposed", payload: { toolCallId: "a", toolName: "draft_shots", args: { shots: [{ parameters: { size: "16:9" } }] } } },
      { type: "agent.tool.completed", payload: { toolCallId: "a", toolName: "draft_shots", ok: false } },
      { type: "agent.tool.proposed", payload: { toolCallId: "b", toolName: "draft_shots", args: { shots: [{ parameters: { size: "2048x2048" } }] } } },
      { type: "agent.tool.completed", payload: { toolCallId: "b", toolName: "draft_shots", ok: true } },
    ];
    const graded = gradeIntent({ expect: { draft: { aspectRatio: "16:9" } } }, { events });
    expect(graded.checks).toEqual([expect.objectContaining({ name: "intent.aspectRatio", pass: false })]);
    expect(graded.draftCount).toBe(1);
  });
});

describe("评分管线（零额度夹具 → eval:score）", () => {
  it("夹具跑通 scores.json 的意图指标：首次通过率、各字段命中率、越界诚实率、train / test 分开", () => {
    const source = path.join(repoRoot, "evals", "fixtures", "intent-draft-run");
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-intent-fixture-"));
    try {
      fs.cpSync(source, runDir, { recursive: true });
      const score = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "eval-score.mjs"), runDir], { cwd: repoRoot, encoding: "utf8" });
      // 夹具里故意有两条不过（时长写错、说了先别生成却调了 generate），所以评分段退出码是 1。
      expect(score.status, score.stderr).toBe(1);
      const scores = JSON.parse(fs.readFileSync(path.join(runDir, "scores.json"), "utf8"));
      expect(scores.summary.intent.all).toMatchObject({ trials: 5, firstPassRate: 0.6, meanDraftsPerTrial: 1, honestyRate: 1 });
      expect(scores.summary.intent.train).toMatchObject({ trials: 4, firstPassRate: 0.5 });
      expect(scores.summary.intent.test).toMatchObject({ trials: 1, firstPassRate: 1 });
      expect(scores.summary.intent.all.fieldHitRate).toMatchObject({ durationSec: 0, noGenerate: 0.8, aspectRatio: 1, count: 1 });
      expect(fs.readFileSync(path.join(runDir, "report.md"), "utf8")).toContain("意图指标");
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });
});
