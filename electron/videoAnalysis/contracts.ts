import { z } from "zod";

export const VIDEO_ANALYSIS_SCHEMA_VERSION = 1 as const;

export type VideoAnalysisStage =
  | "queued"
  | "reading_media"
  | "analyzing_evidence"
  | "structuring"
  | "completed";

export type VideoAnalysisStatus =
  | "queued"
  | "submitting"
  | "running"
  | "completed"
  | "failed"
  | "engine_unreachable"
  | "engine_incompatible"
  | "submission_unknown"
  | "cancel_requested"
  | "cancelled"
  | "detached";

export type VideoAnalysisSource = {
  kind: "project_asset" | "analysis_copy";
  relativePath: string;
};

export type VideoAnalysisTask = {
  schemaVersion: typeof VIDEO_ANALYSIS_SCHEMA_VERSION;
  analysisId: string;
  projectId: string;
  source: VideoAnalysisSource;
  sourceNodeId: string | null;
  engineOrigin: string;
  externalInference: boolean;
  status: VideoAnalysisStatus;
  stage: VideoAnalysisStage;
  engineTaskId: string | null;
  sourceSha256: string | null;
  engineName: string | null;
  engineVersion: string | null;
  engineStage: number | null;
  engineStageTotal: number | null;
  stageText: string;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  lastEngineCheckAt: string | null;
  lastEngineUpdateAt: string | null;
  resultAvailable: boolean;
};

export type VideoAnalysisShot = {
  shotId: number;
  timeRange: string;
  visualDescription: string;
  spokenText: string;
  ocrText: string;
  cameraShot: string;
  cameraMove: string;
  psychologicalEffect: string;
  evidence: {
    visualMs: number[];
    spokenTextRef: string | null;
    ocrTextRef: string | null;
  } | null;
};

export type VideoAnalysisScene = {
  sceneIndex: number;
  marketingRole: string;
  title: string;
  timeRange: string;
  roleAnalysis: string;
  shots: VideoAnalysisShot[];
};

export type VideoAnalysisPattern = {
  technique: string;
  usage: string;
  formula: string;
};

export type VideoAnalysisResult = {
  summary: string;
  hookAnalysis: string;
  scenes: VideoAnalysisScene[];
  patterns: VideoAnalysisPattern[];
  metrics: Record<string, unknown>;
  source: "model" | "human_edited" | "deterministic_evidence" | "unknown";
};

export type VideoAnalysisRawEvidence = {
  shotId: number;
  visualMs: number[];
  spokenTextRef: string;
  spokenText: string;
  ocrTextRef: string;
  ocrText: string;
};

export type VideoAnalysisEvidence = {
  schemaVersion: typeof VIDEO_ANALYSIS_SCHEMA_VERSION;
  projectId: string;
  analysisId: string;
  engineTaskId: string;
  sourceRelativePath: string;
  sourceSha256: string;
  resultSha256: string;
  engine: string;
  engineVersion: string | null;
  rawEvidence: VideoAnalysisRawEvidence[];
  frames: Array<{ shotId: number; url: string; sha256: string }>;
};

export type VideoAnalysisEvidenceInput = Pick<
  VideoAnalysisEvidence,
  "engine" | "engineVersion" | "rawEvidence" | "frames"
>;

const analysisModeSchema = z.enum(["deterministic", "model"]);
const healthSchema = z.object({
  ok: z.literal(true),
  engine: z.string().trim().min(1).max(120),
  pipeline_ready: z.boolean(),
  missing_dependencies: z.array(z.string().max(200)).optional().default([]),
  analysis_modes: z.array(analysisModeSchema).max(2).optional().default([]),
  version: z.string().trim().min(1).max(120).optional().nullable(),
}).passthrough();

export type EcutHealth = {
  engine: string;
  version: string | null;
  pipelineReady: boolean;
  missingDependencies: string[];
  analysisModes: Array<"deterministic" | "model">;
};

function contractError(label: string, error: z.ZodError): Error {
  const detail = error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
  return new Error(`Invalid ${label} response: ${detail}`);
}

export function parseEcutHealthResponse(value: unknown): EcutHealth {
  const parsed = healthSchema.safeParse(value);
  if (!parsed.success) throw contractError("e-cut health", parsed.error);
  return {
    engine: parsed.data.engine,
    version: parsed.data.version ?? null,
    pipelineReady: parsed.data.pipeline_ready,
    missingDependencies: parsed.data.missing_dependencies,
    analysisModes: parsed.data.analysis_modes,
  };
}

export function supportsRequestedInference(health: EcutHealth, externalInference: boolean): boolean {
  if (!health.pipelineReady) return false;
  if (externalInference) {
    return health.analysisModes.length === 0 || health.analysisModes.includes("model");
  }
  return health.analysisModes.includes("deterministic");
}

const evidenceSchema = z.object({
  visual_ms: z.array(z.number().finite().nonnegative()).max(12).optional().default([]),
  spoken_text_ref: z.string().max(500).optional().nullable(),
  ocr_text_ref: z.string().max(500).optional().nullable(),
}).passthrough();

const shotSchema = z.object({
  shot_id: z.number().int().positive(),
  time_range: z.string().max(200).optional().default(""),
  visual_description: z.string().max(20_000).optional().default(""),
  spoken_text: z.string().max(20_000).optional().default(""),
  ocr_text: z.string().max(20_000).optional().default(""),
  camera_shot: z.string().max(500).optional().default(""),
  camera_move: z.string().max(500).optional().default(""),
  psychological_effect: z.string().max(5_000).optional().default(""),
  evidence: evidenceSchema.optional().nullable(),
}).passthrough();

const sceneSchema = z.object({
  scene_index: z.number().int().positive(),
  marketing_role: z.string().max(200).optional().default("GENERIC"),
  scene_title: z.string().max(2_000).optional().default(""),
  time_range: z.string().max(200).optional().default(""),
  role_analysis: z.string().max(20_000).optional().default(""),
  shots: z.array(shotSchema).max(500),
}).passthrough();

const patternSchema = z.object({
  technique: z.string().max(5_000).optional().default(""),
  usage: z.string().max(10_000).optional().default(""),
  formula: z.string().max(10_000).optional().default(""),
}).passthrough();

export const ECUT_TASK_ID_PATTERN = /^(?:task-[0-9a-f]{32}|\d{8}-\d{6}-\d{1,4})$/;

const canonicalShotSchema = z.object({
  shotId: z.number().int().positive(),
  timeRange: z.string().max(200),
  visualDescription: z.string().max(20_000),
  spokenText: z.string().max(20_000),
  ocrText: z.string().max(20_000),
  cameraShot: z.string().max(500),
  cameraMove: z.string().max(500),
  psychologicalEffect: z.string().max(5_000),
  evidence: z.object({
    visualMs: z.array(z.number().finite().nonnegative()).max(12),
    spokenTextRef: z.string().max(500).nullable(),
    ocrTextRef: z.string().max(500).nullable(),
  }).strict().nullable(),
}).strict();

const canonicalSceneSchema = z.object({
  sceneIndex: z.number().int().positive(),
  marketingRole: z.string().max(200),
  title: z.string().max(2_000),
  timeRange: z.string().max(200),
  roleAnalysis: z.string().max(20_000),
  shots: z.array(canonicalShotSchema).max(500),
}).strict();

const canonicalPatternSchema = z.object({
  technique: z.string().max(5_000),
  usage: z.string().max(10_000),
  formula: z.string().max(10_000),
}).strict();

const videoAnalysisResultSchema = z.object({
  summary: z.string().max(20_000),
  hookAnalysis: z.string().max(20_000),
  scenes: z.array(canonicalSceneSchema).max(200),
  patterns: z.array(canonicalPatternSchema).max(200),
  metrics: z.record(z.unknown()),
  source: z.enum(["model", "human_edited", "deterministic_evidence", "unknown"]),
}).strict();

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const rawEvidenceSchema = z.object({
  shotId: z.number().int().positive(),
  visualMs: z.array(z.number().finite().nonnegative()).max(12),
  spokenTextRef: z.string().trim().min(1).max(500),
  spokenText: z.string().max(20_000),
  ocrTextRef: z.string().trim().min(1).max(500),
  ocrText: z.string().max(20_000),
}).strict();
const videoAnalysisEvidenceSchema = z.object({
  schemaVersion: z.literal(VIDEO_ANALYSIS_SCHEMA_VERSION),
  projectId: z.string().trim().min(1).max(300),
  analysisId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/),
  engineTaskId: z.string().regex(ECUT_TASK_ID_PATTERN),
  sourceRelativePath: z.string().trim().min(1).max(2_000),
  sourceSha256: sha256Schema,
  resultSha256: sha256Schema,
  engine: z.string().trim().min(1).max(120),
  engineVersion: z.string().trim().min(1).max(120).nullable(),
  rawEvidence: z.array(rawEvidenceSchema).max(500),
  frames: z.array(z.object({
    shotId: z.number().int().positive(),
    url: z.string().trim().min(1).max(2_000).refine((value) => value.startsWith("nomi-local://")),
    sha256: sha256Schema,
  }).strict()).max(500),
}).strict();

const videoAnalysisTaskSchema = z.object({
  schemaVersion: z.literal(VIDEO_ANALYSIS_SCHEMA_VERSION),
  analysisId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/),
  projectId: z.string().trim().min(1).max(300),
  source: z.object({
    kind: z.enum(["project_asset", "analysis_copy"]),
    relativePath: z.string().trim().min(1).max(2_000),
  }).strict(),
  sourceNodeId: z.string().trim().min(1).max(200).nullable(),
  engineOrigin: z.string().trim().min(1).max(500),
  externalInference: z.boolean(),
  status: z.enum([
    "queued", "submitting", "running", "completed", "failed", "engine_unreachable",
    "engine_incompatible", "submission_unknown", "cancel_requested", "cancelled", "detached",
  ]),
  stage: z.enum(["queued", "reading_media", "analyzing_evidence", "structuring", "completed"]),
  engineTaskId: z.string().regex(ECUT_TASK_ID_PATTERN).nullable(),
  sourceSha256: sha256Schema.nullable(),
  engineName: z.string().trim().min(1).max(120).nullable(),
  engineVersion: z.string().trim().min(1).max(120).nullable(),
  engineStage: z.number().int().nonnegative().nullable(),
  engineStageTotal: z.number().int().positive().max(100).nullable(),
  stageText: z.string().max(1_000),
  errorCode: z.string().max(200).nullable(),
  errorMessage: z.string().max(2_000).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  lastEngineCheckAt: z.string().datetime().nullable(),
  lastEngineUpdateAt: z.string().datetime().nullable(),
  resultAvailable: z.boolean(),
}).strict();

export function parseVideoAnalysisTask(value: unknown): VideoAnalysisTask {
  const parsed = videoAnalysisTaskSchema.safeParse(value);
  if (!parsed.success) throw contractError("video analysis task", parsed.error);
  return parsed.data;
}

export function parseVideoAnalysisResult(value: unknown): VideoAnalysisResult {
  const parsed = videoAnalysisResultSchema.safeParse(value);
  if (!parsed.success) throw contractError("video analysis result", parsed.error);
  return parsed.data;
}

export function parseVideoAnalysisEvidence(value: unknown): VideoAnalysisEvidence {
  const parsed = videoAnalysisEvidenceSchema.safeParse(value);
  if (!parsed.success) throw contractError("video analysis evidence", parsed.error);
  return parsed.data;
}

const storyboardSchema = z.object({
  video_title_summary: z.string().max(20_000).optional().default(""),
  hook_strategy_analysis: z.string().max(20_000).optional().default(""),
  scenes: z.array(sceneSchema).max(200),
  patterns: z.array(patternSchema).max(200).optional().default([]),
}).passthrough();

const taskSchema = z.object({
  task_id: z.string().regex(ECUT_TASK_ID_PATTERN),
  done: z.boolean(),
  cancelled: z.boolean().optional().default(false),
  stage: z.number().int().nonnegative(),
  stage_total: z.number().int().positive().max(100),
  stage_text: z.string().max(1_000).optional().default(""),
  error: z.string().max(20_000).optional().nullable(),
  storyboard_source: z.enum(["model", "human_edited", "deterministic_evidence"]).optional(),
  storyboard: storyboardSchema.optional(),
  raw_evidence: z.array(z.object({
    shot_id: z.number().int().positive(),
    visual_ms: z.array(z.number().finite().nonnegative()).max(12).optional().default([]),
    spoken_text_ref: z.string().trim().min(1).max(500),
    spoken_text: z.string().max(20_000).optional().default(""),
    ocr_text_ref: z.string().trim().min(1).max(500),
    ocr_text: z.string().max(20_000).optional().default(""),
  }).strict()).max(500).optional().default([]),
  metrics: z.record(z.unknown()).optional().default({}),
}).passthrough().superRefine((value, context) => {
  if (value.done && !value.cancelled && !value.error && !value.storyboard) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["storyboard"], message: "successful completed task requires storyboard" });
  }
});

export type EcutTask = {
  taskId: string;
  done: boolean;
  cancelled: boolean;
  stage: number;
  stageTotal: number;
  stageText: string;
  error: string | null;
  storyboard: VideoAnalysisResult | null;
  rawEvidence: VideoAnalysisRawEvidence[];
};

function mapStoryboard(value: z.infer<typeof storyboardSchema>, source: VideoAnalysisResult["source"], metrics: Record<string, unknown>): VideoAnalysisResult {
  return {
    summary: value.video_title_summary,
    hookAnalysis: value.hook_strategy_analysis,
    scenes: value.scenes.map((scene) => ({
      sceneIndex: scene.scene_index,
      marketingRole: scene.marketing_role,
      title: scene.scene_title,
      timeRange: scene.time_range,
      roleAnalysis: scene.role_analysis,
      shots: scene.shots.map((shot) => ({
        shotId: shot.shot_id,
        timeRange: shot.time_range,
        visualDescription: shot.visual_description,
        spokenText: shot.spoken_text,
        ocrText: shot.ocr_text,
        cameraShot: shot.camera_shot,
        cameraMove: shot.camera_move,
        psychologicalEffect: shot.psychological_effect,
        evidence: shot.evidence ? {
          visualMs: shot.evidence.visual_ms,
          spokenTextRef: shot.evidence.spoken_text_ref ?? null,
          ocrTextRef: shot.evidence.ocr_text_ref ?? null,
        } : null,
      })),
    })),
    patterns: value.patterns.map((pattern) => ({
      technique: pattern.technique,
      usage: pattern.usage,
      formula: pattern.formula,
    })),
    metrics,
    source,
  };
}

export function parseEcutTaskResponse(value: unknown): EcutTask {
  const parsed = taskSchema.safeParse(value);
  if (!parsed.success) throw contractError("e-cut task", parsed.error);
  const source = parsed.data.storyboard_source ?? "unknown";
  return {
    taskId: parsed.data.task_id,
    done: parsed.data.done,
    cancelled: parsed.data.cancelled,
    stage: Math.min(parsed.data.stage, parsed.data.stage_total),
    stageTotal: parsed.data.stage_total,
    stageText: parsed.data.stage_text,
    error: parsed.data.error ?? null,
    storyboard: parsed.data.storyboard ? mapStoryboard(parsed.data.storyboard, source, parsed.data.metrics) : null,
    rawEvidence: parsed.data.raw_evidence.map((item) => ({
      shotId: item.shot_id,
      visualMs: item.visual_ms,
      spokenTextRef: item.spoken_text_ref,
      spokenText: item.spoken_text,
      ocrTextRef: item.ocr_text_ref,
      ocrText: item.ocr_text,
    })),
  };
}
