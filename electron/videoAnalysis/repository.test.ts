import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createVideoAnalysisRepository } from "./repository";

const tempRoots: string[] = [];

function tempProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-video-analysis-repository-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("video analysis repository", () => {
  it("stores task, result, and evidence under the project without absolute paths", () => {
    const projectRoot = tempProject();
    const repository = createVideoAnalysisRepository({
      projectDirResolver: (projectId) => projectId === "project-a" ? projectRoot : null,
      now: () => "2026-08-08T08:00:00.000Z",
      randomId: () => "analysis-fixed",
    });

    const task = repository.create({
      projectId: "project-a",
      source: { kind: "project_asset", relativePath: "assets/reference.mp4" },
      engineOrigin: "http://127.0.0.1:8931",
      externalInference: true,
    });
    repository.update("project-a", task.analysisId, (current) => ({ ...current, status: "submitting" }));
    repository.update("project-a", task.analysisId, (current) => ({
      ...current,
      status: "running",
      engineTaskId: "20260808-160102-1234",
      sourceSha256: "a".repeat(64),
    }));
    repository.complete("project-a", task.analysisId, {
      summary: "Reference structure",
      hookAnalysis: "Evidence first",
      scenes: [],
      patterns: [],
      metrics: { shotCount: 38 },
      source: "model",
    }, {
      engine: "eccut-local",
      engineVersion: null,
      rawEvidence: [],
      frames: [],
    });

    const analysisDir = path.join(projectRoot, ".nomi", "analysis", "video", task.analysisId);
    const taskText = fs.readFileSync(path.join(analysisDir, "task.json"), "utf8");
    const resultText = fs.readFileSync(path.join(analysisDir, "result.json"), "utf8");
    const evidenceText = fs.readFileSync(path.join(analysisDir, "evidence.json"), "utf8");
    const all = `${taskText}\n${resultText}\n${evidenceText}`;

    expect(all).not.toContain(projectRoot);
    expect(all).not.toContain("/private/");
    expect(JSON.parse(taskText).task.source.relativePath).toBe("assets/reference.mp4");
    expect(JSON.parse(evidenceText).resultSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(evidenceText).resultSha256).not.toBe("b".repeat(64));
    expect(repository.readResult("project-a", task.analysisId)?.metrics).toEqual({ shotCount: 38 });
    expect(repository.list("project-a")[0]?.status).toBe("completed");
  });

  it("rejects corrupt task envelopes, tampered results, and illegal terminal transitions", () => {
    const projectRoot = tempProject();
    const repository = createVideoAnalysisRepository({
      projectDirResolver: () => projectRoot,
      randomId: () => "analysis-integrity",
    });
    const task = repository.create({
      projectId: "project-a",
      source: { kind: "project_asset", relativePath: "assets/reference.mp4" },
      engineOrigin: "http://127.0.0.1:8931",
      externalInference: true,
    });
    repository.update("project-a", task.analysisId, (current) => ({ ...current, status: "submitting" }));
    repository.update("project-a", task.analysisId, (current) => ({
      ...current,
      status: "running",
      engineTaskId: "20260808-160102-1234",
      sourceSha256: "a".repeat(64),
    }));
    repository.complete("project-a", task.analysisId, {
      summary: "Verified",
      hookAnalysis: "Evidence",
      scenes: [],
      patterns: [],
      metrics: {},
      source: "model",
    }, {
      engine: "eccut-local",
      engineVersion: "v2",
      rawEvidence: [],
      frames: [],
    });
    const files = repository.paths("project-a", task.analysisId);

    expect(() => repository.update("project-a", task.analysisId, (current) => ({ ...current, status: "running" })))
      .toThrow(/transition|completed/i);

    fs.writeFileSync(files.result, JSON.stringify({ summary: "forged", scenes: [] }), "utf8");
    expect(repository.readResult("project-a", task.analysisId)).toBeNull();

    const envelope = JSON.parse(fs.readFileSync(files.task, "utf8"));
    envelope.task.engineOrigin = "http://example.com:8931";
    fs.writeFileSync(files.task, JSON.stringify(envelope), "utf8");
    expect(repository.read("project-a", task.analysisId)).toBeNull();
  });

  it("rejects traversal and unknown projects", () => {
    const projectRoot = tempProject();
    const repository = createVideoAnalysisRepository({
      projectDirResolver: (projectId) => projectId === "project-a" ? projectRoot : null,
    });

    expect(() => repository.create({
      projectId: "project-a",
      source: { kind: "project_asset", relativePath: "../outside.mp4" },
      engineOrigin: "http://127.0.0.1:8931",
      externalInference: false,
    })).toThrow(/source|relative|path/i);
    expect(() => repository.list("missing")).toThrow(/project/i);
  });

  it("resolves only real project files and rejects symbolic-link escapes", () => {
    const projectRoot = tempProject();
    const outsideRoot = tempProject();
    fs.mkdirSync(path.join(projectRoot, "assets"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "assets", "inside.mp4"), "video");
    fs.writeFileSync(path.join(outsideRoot, "outside.mp4"), "outside");
    fs.symlinkSync(path.join(outsideRoot, "outside.mp4"), path.join(projectRoot, "assets", "linked.mp4"));
    const repository = createVideoAnalysisRepository({ projectDirResolver: () => projectRoot });

    expect(repository.resolveSourcePath("project-a", { kind: "project_asset", relativePath: "assets/inside.mp4" }))
      .toBe(path.join(projectRoot, "assets", "inside.mp4"));
    expect(() => repository.resolveSourcePath("project-a", { kind: "project_asset", relativePath: "assets/linked.mp4" }))
      .toThrow(/symbolic|boundary/i);
    expect(() => repository.resolveSourcePath("project-a", { kind: "project_asset", relativePath: "assets/missing.mp4" }))
      .toThrow();
  });

  it("quarantines a task left in submitting instead of making it eligible for resubmission", () => {
    const projectRoot = tempProject();
    const repository = createVideoAnalysisRepository({
      projectDirResolver: () => projectRoot,
      randomId: () => "analysis-restart",
    });
    const created = repository.create({
      projectId: "project-a",
      source: { kind: "project_asset", relativePath: "assets/reference.mp4" },
      engineOrigin: "http://127.0.0.1:8931",
      externalInference: true,
    });
    repository.update("project-a", created.analysisId, (current) => ({ ...current, status: "submitting" }));

    const recovered = repository.recoverAfterRestart("project-a");

    expect(recovered[0]?.status).toBe("submission_unknown");
    expect(recovered[0]?.errorCode).toBe("submission_unknown");
  });

  it("rejects a valid result/evidence pair swapped from another analysis", () => {
    const projectRoot = tempProject();
    let id = 0;
    const repository = createVideoAnalysisRepository({
      projectDirResolver: () => projectRoot,
      randomId: () => `bound-${++id}`,
    });
    const complete = (sourceSha256: string) => {
      const task = repository.create({
        projectId: "project-a",
        source: { kind: "project_asset", relativePath: "assets/reference.mp4" },
        engineOrigin: "http://127.0.0.1:8931",
        externalInference: false,
      });
      repository.update("project-a", task.analysisId, (current) => ({ ...current, status: "submitting", sourceSha256 }));
      repository.update("project-a", task.analysisId, (current) => ({
        ...current,
        status: "running",
        engineTaskId: `20260808-160102-123${id}`,
      }));
      repository.complete("project-a", task.analysisId, {
        summary: `result-${id}`, hookAnalysis: "", scenes: [], patterns: [], metrics: {}, source: "model",
      }, { engine: "eccut-local", engineVersion: "v2", rawEvidence: [], frames: [] });
      return task;
    };
    const first = complete("a".repeat(64));
    const second = complete("b".repeat(64));
    const firstPaths = repository.paths("project-a", first.analysisId);
    const secondPaths = repository.paths("project-a", second.analysisId);
    fs.copyFileSync(secondPaths.result, firstPaths.result);
    fs.copyFileSync(secondPaths.evidence, firstPaths.evidence);

    expect(repository.readResult("project-a", first.analysisId)).toBeNull();
    expect(repository.readEvidence("project-a", first.analysisId)).toBeNull();
  });
});
