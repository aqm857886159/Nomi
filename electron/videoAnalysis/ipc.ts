import path from "node:path";

import { ipcMain } from "electron";

import { parseLocalAssetUrl } from "../protocol/localProtocol";
import { projectDirById } from "../projects/repository";
import { readVideoAnalysisEngineConfig } from "../settings/videoAnalysisSettings";
import { activeTaskProjectFallback } from "../tasks/activeProjectFallback";
import type { VideoAnalysisSource } from "./contracts";
import { createEcutClient } from "./ecutClient";
import { createVideoAnalysisRepository, type VideoAnalysisRepository } from "./repository";
import { createVideoAnalysisService, type VideoAnalysisService } from "./service";

export type VideoAnalysisHealthProjection = {
  configured: boolean;
  reachable: boolean;
  engine: string | null;
  version: string | null;
  error: string | null;
};

type IpcDeps = {
  service: VideoAnalysisService;
  repository: VideoAnalysisRepository;
  resolveAssetSource: (projectId: string, assetUrl: string) => VideoAnalysisSource;
  probeHealth: () => Promise<VideoAnalysisHealthProjection>;
  resolveActiveProjectId: () => string;
};

function inputRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid video analysis request");
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string, max = 2_000): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > max) throw new Error(`${label} is required`);
  return text;
}

export function resolveVideoAnalysisAssetSource(projectId: string, assetUrl: string): VideoAnalysisSource {
  const url = new URL(assetUrl);
  if (url.search || url.hash) throw new Error("Video analysis asset URL cannot contain query or fragment");
  const parsed = parseLocalAssetUrl(assetUrl);
  if (!parsed || parsed.projectId !== projectId) throw new Error("Video analysis requires an asset from the current project");
  const projectDir = projectDirById(projectId);
  if (!projectDir) throw new Error("Video analysis project not found");
  const relativePath = path.relative(projectDir, parsed.filePath).replace(/\\/g, "/");
  if (!relativePath.startsWith("assets/") || relativePath.includes("../")) {
    throw new Error("Video analysis requires a project asset");
  }
  return { kind: "project_asset", relativePath };
}

function defaultDeps(): IpcDeps {
  const repository = createVideoAnalysisRepository();
  const service = createVideoAnalysisService({
    repository,
    resolveEngineConfig: () => {
      const settings = readVideoAnalysisEngineConfig();
      return {
        origin: settings.engineOrigin,
        token: settings.token,
        externalInference: settings.externalInference,
        engineSourceRetention: settings.engineSourceRetention,
      };
    },
    createClient: (config) => createEcutClient(config),
  });
  return {
    repository,
    service,
    resolveAssetSource: resolveVideoAnalysisAssetSource,
    resolveActiveProjectId: activeTaskProjectFallback,
    probeHealth: async () => {
      const settings = readVideoAnalysisEngineConfig();
      if (!settings.token) {
        return { configured: false, reachable: false, engine: null, version: null, error: "token_required" };
      }
      try {
        const health = await createEcutClient({ origin: settings.engineOrigin, token: settings.token }).health();
        return {
          configured: true,
          reachable: health.pipelineReady,
          engine: health.engine,
          version: health.version,
          error: health.pipelineReady ? null : `missing_dependencies:${health.missingDependencies.join(",")}`,
        };
      } catch (error) {
        return {
          configured: true,
          reachable: false,
          engine: null,
          version: null,
          error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        };
      }
    },
  };
}

export function registerVideoAnalysisIpc(deps: IpcDeps = defaultDeps()): void {
  const resumedProjects = new Set<string>();
  const requireActiveProject = (projectId: string): void => {
    if (deps.resolveActiveProjectId() !== projectId) {
      throw new Error("Video analysis is limited to the active project");
    }
  };

  ipcMain.handle("nomi:video-analysis:start", async (_event, payload: unknown) => {
    const input = inputRecord(payload);
    const projectId = requiredString(input.projectId, "projectId", 300);
    requireActiveProject(projectId);
    const assetUrl = requiredString(input.assetUrl, "assetUrl");
    const sourceNodeId = input.sourceNodeId === undefined ? null : requiredString(input.sourceNodeId, "sourceNodeId", 200);
    const source = deps.resolveAssetSource(projectId, assetUrl);
    return deps.service.start({ projectId, source, sourceNodeId });
  });
  ipcMain.handle("nomi:video-analysis:list", async (_event, payload: unknown) => {
    const projectId = requiredString(inputRecord(payload).projectId, "projectId", 300);
    requireActiveProject(projectId);
    if (!resumedProjects.has(projectId)) {
      deps.service.resumeProject(projectId);
      resumedProjects.add(projectId);
    }
    return deps.repository.list(projectId);
  });
  ipcMain.handle("nomi:video-analysis:read", async (_event, payload: unknown) => {
    const input = inputRecord(payload);
    const projectId = requiredString(input.projectId, "projectId", 300);
    requireActiveProject(projectId);
    const analysisId = requiredString(input.analysisId, "analysisId", 160);
    return {
      task: deps.repository.read(projectId, analysisId),
      result: deps.repository.readResult(projectId, analysisId),
      evidence: deps.repository.readEvidence(projectId, analysisId),
    };
  });
  ipcMain.handle("nomi:video-analysis:cancel", async (_event, payload: unknown) => {
    const input = inputRecord(payload);
    const projectId = requiredString(input.projectId, "projectId", 300);
    requireActiveProject(projectId);
    return deps.service.cancel(
      projectId,
      requiredString(input.analysisId, "analysisId", 160),
    );
  });
  ipcMain.handle("nomi:video-analysis:cleanup", async (_event, payload: unknown) => {
    const projectId = requiredString(inputRecord(payload).projectId, "projectId", 300);
    requireActiveProject(projectId);
    return deps.service.cleanup(projectId);
  });
  ipcMain.handle("nomi:video-analysis:health", async () => deps.probeHealth());
}
