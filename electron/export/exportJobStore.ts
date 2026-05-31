import fs from "node:fs";
import path from "node:path";

import { serializeManifest } from "./exportManifest";
import { createExportTempDir } from "./exportPaths";
import type { ExportJobSnapshot } from "./exportJobManager";

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function appendLog(jobDir: string, line: string): void {
  fs.appendFileSync(path.join(jobDir, "export.log"), `${new Date().toISOString()} ${line}\n`, "utf8");
}

export class ExportJobStore {
  create(snapshot: ExportJobSnapshot): ExportJobSnapshot {
    const jobDir = createExportTempDir(snapshot.projectDir, snapshot.id);
    const stored = { ...snapshot, jobDir };
    writeJson(path.join(jobDir, "manifest.json"), JSON.parse(serializeManifest(stored.manifest)));
    writeJson(path.join(jobDir, "job.json"), stored);
    fs.closeSync(fs.openSync(path.join(jobDir, "export.log"), "a"));
    appendLog(jobDir, `created job ${stored.id} with status ${stored.status}`);
    return stored;
  }

  save(snapshot: ExportJobSnapshot): ExportJobSnapshot {
    fs.mkdirSync(snapshot.jobDir, { recursive: true });
    writeJson(path.join(snapshot.jobDir, "job.json"), snapshot);
    appendLog(snapshot.jobDir, `saved job ${snapshot.id} with status ${snapshot.status}`);

    if (snapshot.result !== undefined) {
      writeJson(path.join(snapshot.jobDir, "result.json"), snapshot.result);
    }
    if (snapshot.error !== undefined) {
      writeJson(path.join(snapshot.jobDir, "error.json"), snapshot.error);
    }

    return snapshot;
  }

  appendLog(snapshot: ExportJobSnapshot, message: string): void {
    fs.mkdirSync(snapshot.jobDir, { recursive: true });
    fs.closeSync(fs.openSync(path.join(snapshot.jobDir, "export.log"), "a"));
    appendLog(snapshot.jobDir, message);
  }

  loadJob(projectDir: string, jobId: string): ExportJobSnapshot | null {
    const jobDir = createExportTempDir(projectDir, jobId);
    const jobPath = path.join(jobDir, "job.json");
    if (!fs.existsSync(jobPath)) {
      return null;
    }
    return readJson<ExportJobSnapshot>(jobPath);
  }

  loadRecentJobs(projectDir: string): ExportJobSnapshot[] {
    const jobsDir = path.join(path.resolve(projectDir), ".nomi", "jobs");
    if (!fs.existsSync(jobsDir)) {
      return [];
    }

    return fs
      .readdirSync(jobsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(jobsDir, entry.name, "job.json"))
      .filter((jobPath) => fs.existsSync(jobPath))
      .map((jobPath) => readJson<ExportJobSnapshot>(jobPath))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
