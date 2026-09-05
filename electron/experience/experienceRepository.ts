import fs from "node:fs";
import path from "node:path";
import { appendEvents, readEvents } from "../events/eventLogRepository";
import { getWorkspaceRepositoryDeps } from "../runtimePaths";
import { resolveWorkspaceProjectDir } from "../workspace/workspaceRepository";
import { extractExperienceCandidates, normalizeTrajectory } from "./experienceExtractor";
import { buildExperienceCandidate, recordExperienceReuse } from "./experiencePolicy";
import { experienceCandidateSchema, type ExperienceCandidate, type ExperienceReuse, type ExperienceTrajectory } from "./experienceTypes";

type Projection = { version: 1; candidates: ExperienceCandidate[] };

let projectDirResolver: (projectId: string) => string | null = (projectId) =>
  resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps());

export function setExperienceProjectDirResolverForTests(resolver: (projectId: string) => string | null): void {
  projectDirResolver = resolver;
}

function projectionPath(projectId: string): string | null {
  const root = projectDirResolver(projectId);
  return root ? path.join(root, ".nomi", "experience", "index.json") : null;
}

function candidateFromPayload(payload: Record<string, unknown>): ExperienceCandidate | null {
  const candidate = experienceCandidateSchema.safeParse(payload.candidate);
  return candidate.success ? candidate.data : null;
}

function replay(projectId: string): Projection {
  const byId = new Map<string, ExperienceCandidate>();
  for (const event of readEvents(projectId)) {
    if (event.type === "experience.candidate.created" || event.type === "experience.candidate.updated" || event.type === "experience.reuse.recorded") {
      const candidate = candidateFromPayload(event.payload);
      if (candidate) byId.set(candidate.candidateId, candidate);
    }
  }
  return { version: 1, candidates: [...byId.values()] };
}

function loadProjection(projectId: string): Projection {
  const file = projectionPath(projectId);
  if (file && fs.existsSync(file)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<Projection>;
      if (raw.version === 1 && Array.isArray(raw.candidates)) {
        const candidates = raw.candidates.map((candidate) => experienceCandidateSchema.parse(candidate));
        return { version: 1, candidates };
      }
    } catch {
      // A projection is disposable; the EventLog below is the source of truth.
    }
  }
  const rebuilt = replay(projectId);
  saveProjection(projectId, rebuilt);
  return rebuilt;
}

function saveProjection(projectId: string, projection: Projection): void {
  const file = projectionPath(projectId);
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(projection, null, 2), "utf8");
}

function appendProjectionEvent(projectId: string, type: string, candidate: ExperienceCandidate, extra: Record<string, unknown> = {}): void {
  appendEvents(projectId, [{
    id: `evt_experience_${candidate.candidateId.slice(-12)}_${Date.now().toString(36)}`,
    source: "system",
    type,
    payload: { candidate, ...extra },
  }]);
}

export type ExperienceRepository = {
  complete(input: unknown): Promise<ExperienceCandidate[]>;
  list(projectId: string): ExperienceCandidate[];
  recordReuse(projectId: string, candidateId: string, reuse: ExperienceReuse): Promise<ExperienceCandidate | null>;
};

export function createExperienceRepository(): ExperienceRepository {
  return {
    async complete(input: unknown): Promise<ExperienceCandidate[]> {
      const trajectory: ExperienceTrajectory = normalizeTrajectory(input);
      const drafts = await extractExperienceCandidates(trajectory);
      if (drafts.length === 0) return [];
      const projection = loadProjection(trajectory.projectId);
      const candidates: ExperienceCandidate[] = [];
      for (const draft of drafts) {
        const candidate = buildExperienceCandidate(draft, {
          projectId: trajectory.projectId,
          trajectoryId: trajectory.trajectoryId,
          now: trajectory.completedAt,
        });
        const existing = projection.candidates.find((item) => item.contentHash === candidate.contentHash);
        if (existing) {
          candidates.push(existing);
          continue;
        }
        projection.candidates.push(candidate);
        appendProjectionEvent(trajectory.projectId, "experience.candidate.created", candidate);
        candidates.push(candidate);
      }
      saveProjection(trajectory.projectId, projection);
      return candidates;
    },
    list(projectId: string): ExperienceCandidate[] {
      return loadProjection(projectId).candidates;
    },
    async recordReuse(projectId: string, candidateId: string, reuse: ExperienceReuse): Promise<ExperienceCandidate | null> {
      const projection = loadProjection(projectId);
      const index = projection.candidates.findIndex((candidate) => candidate.candidateId === candidateId);
      if (index < 0) return null;
      const current = projection.candidates[index];
      const next = recordExperienceReuse(current, reuse);
      if (next === current || JSON.stringify(next) === JSON.stringify(current)) return current;
      projection.candidates[index] = next;
      appendProjectionEvent(projectId, "experience.reuse.recorded", next, { reuse });
      saveProjection(projectId, projection);
      return next;
    },
  };
}

let repository: ExperienceRepository | null = null;

export function getExperienceRepository(): ExperienceRepository {
  return repository ??= createExperienceRepository();
}

export function resetExperienceRepositoryForTests(): void {
  repository = null;
}
