import { app } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

type ProjectRecord = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  revision?: number;
  savedAt?: number;
  thumbnail?: string;
  thumbnailUrls?: string[];
  version: number;
  payload?: unknown;
};

type BillingModelKind = "text" | "image" | "video";
type ProfileKind =
  | "chat"
  | "prompt_refine"
  | "text_to_image"
  | "image_to_prompt"
  | "image_to_video"
  | "text_to_video"
  | "image_edit";

type Vendor = {
  key: string;
  name: string;
  enabled: boolean;
  hasApiKey?: boolean;
  baseUrlHint?: string | null;
  authType?: "none" | "bearer" | "x-api-key" | "query";
  authHeader?: string | null;
  authQueryParam?: string | null;
  meta?: unknown;
  createdAt: string;
  updatedAt: string;
};

type Model = {
  modelKey: string;
  vendorKey: string;
  modelAlias?: string | null;
  labelZh: string;
  kind: BillingModelKind;
  enabled: boolean;
  meta?: unknown;
  pricing?: {
    cost: number;
    enabled: boolean;
    createdAt?: string;
    updatedAt?: string;
    specCosts: Array<{ specKey: string; cost: number; enabled: boolean; createdAt?: string; updatedAt?: string }>;
  };
  createdAt: string;
  updatedAt: string;
};

type Mapping = {
  id: string;
  vendorKey: string;
  taskKind: ProfileKind;
  name: string;
  enabled: boolean;
  requestMapping?: unknown;
  responseMapping?: unknown;
  createdAt: string;
  updatedAt: string;
};

type ApiKeyRecord = {
  vendorKey: string;
  apiKey: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type CatalogState = {
  version: 1;
  vendors: Vendor[];
  models: Model[];
  mappings: Mapping[];
  apiKeysByVendor: Record<string, ApiKeyRecord>;
};

type TaskRequest = {
  kind: ProfileKind;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  extras?: Record<string, unknown>;
};

type TaskResult = {
  id: string;
  kind: ProfileKind;
  status: "queued" | "running" | "succeeded" | "failed";
  assets: Array<{
    type: "image" | "video";
    url: string;
    thumbnailUrl?: string | null;
    assetId?: string | null;
    assetRefId?: string | null;
    assetName?: string | null;
  }>;
  raw: unknown;
};

const PROJECT_FILE = "project.json";
const PROJECT_ROOT_ENV = "NOMI_PROJECTS_DIR";
const CATALOG_FILE = "model-catalog.json";
const SKILLS_ROOT_ENV = "NOMI_SKILLS_DIR";
const taskCache = new Map<string, CachedTask>();

type CachedTask = {
  vendor: string;
  request: TaskRequest;
  raw: unknown;
  mapping?: Mapping | null;
  model?: Model;
  apiKey?: string;
  providerMeta?: JsonRecord;
  projectId?: string;
  nodeId?: string;
  wantedKind?: BillingModelKind;
};

type LocalAssetRecord = {
  id: string;
  name: string;
  userId: "local";
  projectId: string;
  createdAt: string;
  updatedAt: string;
  data: {
    url: string;
    relativePath: string;
    absolutePath: string;
    contentType: string;
    size: number;
    kind: string;
  };
};

type SkillRecord = {
  name: string;
  directoryName: string;
  filePath: string;
  body: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function getProjectsRoot(): string {
  const configured = String(process.env[PROJECT_ROOT_ENV] || "").trim();
  return configured || path.join(app.getPath("documents"), "Nomi Projects");
}

function getSettingsRoot(): string {
  return app.getPath("userData");
}

function getSkillsRoots(): string[] {
  const candidates = [
    String(process.env[SKILLS_ROOT_ENV] || "").trim(),
    path.join(process.cwd(), "skills"),
    path.join(app.getAppPath(), "skills"),
    path.join(__dirname, "../skills"),
    path.join(process.resourcesPath || "", "skills"),
  ].filter(Boolean);
  return Array.from(new Set(candidates.map((item) => path.resolve(item))));
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function readText(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function parseSkillName(markdown: string, directoryName: string): string {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  const frontmatter = match?.[1] || "";
  const nameMatch = frontmatter.match(/^name:\s*["']?(.+?)["']?\s*$/m);
  return String(nameMatch?.[1] || directoryName).trim();
}

function normalizeSkillLookupKey(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[._\s/]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .toLowerCase();
}

function readSkillRecords(): SkillRecord[] {
  const records: SkillRecord[] = [];
  for (const root of getSkillsRoots()) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const filePath = path.join(root, entry.name, "SKILL.md");
      if (!fs.existsSync(filePath)) continue;
      const body = readText(filePath).trim();
      if (!body) continue;
      records.push({
        name: parseSkillName(body, entry.name),
        directoryName: entry.name,
        filePath,
        body,
      });
    }
  }
  return records;
}

function readNestedRecord(input: unknown, pathParts: string[]): unknown {
  let current = input;
  for (const part of pathParts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as JsonRecord)[part];
  }
  return current;
}

function readRequestedSkill(payload: JsonRecord): { key: string; name: string } {
  const chatContext = payload.chatContext;
  const skill = readNestedRecord(chatContext, ["skill"]);
  return {
    key: trim(readNestedRecord(skill, ["key"])),
    name: trim(readNestedRecord(skill, ["name"])),
  };
}

function findSkillRecord(skillKey: string, skillName: string): SkillRecord | null {
  const records = readSkillRecords();
  if (!records.length) return null;
  const normalizedKey = normalizeSkillLookupKey(skillKey);
  const normalizedName = normalizeSkillLookupKey(skillName);

  const exact = records.find((skill) => skill.name === skillKey);
  if (exact) return exact;

  const prefix = records
    .filter((skill) => skillKey.startsWith(`${skill.name}.`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (prefix) return prefix;

  return records.find((skill) => (
    normalizeSkillLookupKey(skill.name) === normalizedKey
    || normalizeSkillLookupKey(skill.directoryName) === normalizedKey
    || (normalizedName && normalizeSkillLookupKey(skill.name) === normalizedName)
    || (normalizedName && normalizeSkillLookupKey(skill.directoryName) === normalizedName)
  )) || null;
}

function buildSkillSystemPrompt(payload: JsonRecord): string {
  const requested = readRequestedSkill(payload);
  if (!requested.key && !requested.name) return "";
  const skill = findSkillRecord(requested.key, requested.name);
  if (!skill) {
    return [
      "Nomi 桌面 Agent skill 提示：",
      `请求的 skill 未在本地 skills 目录找到：${requested.key || requested.name}`,
      "继续按用户请求和当前上下文完成任务；不要声称已经加载不存在的 skill。",
    ].join("\n");
  }
  return [
    "Nomi 桌面 Agent 已加载本地 skill。以下内容是本次回复必须参考的领域方法论和输出约束。",
    "注意：本桌面运行时只把 skill 作为本地知识注入；skill 中提到的外部 CLI、HTTP 或文件工具不会自动执行，除非当前对话/界面明确提供了对应能力。",
    `skillKey: ${requested.key || skill.name}`,
    `skillName: ${requested.name || skill.name}`,
    `skillFile: ${path.relative(process.cwd(), skill.filePath)}`,
    "",
    skill.body,
  ].join("\n");
}

function writeJson(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function sanitizeName(value: unknown, fallback = "Untitled"): string {
  const text = String(value || "").trim() || fallback;
  return text
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 90)
    .trim() || fallback;
}

function uniqueDir(parent: string, preferredName: string): string {
  const base = sanitizeName(preferredName);
  let candidate = path.join(parent, base);
  if (!fs.existsSync(candidate)) return candidate;
  for (let index = 2; index < 1000; index += 1) {
    candidate = path.join(parent, `${base} ${index}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(parent, `${base} ${crypto.randomUUID().slice(0, 8)}`);
}

function normalizeProjectRecord(input: unknown): ProjectRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Project record must be an object");
  }
  const raw = input as JsonRecord;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `project-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const time = Date.now();
  return {
    ...(raw as ProjectRecord),
    id,
    name: sanitizeName(raw.name, "Untitled Project"),
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : time,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : time,
    revision: typeof raw.revision === "number" ? raw.revision : 0,
    savedAt: typeof raw.savedAt === "number" ? raw.savedAt : time,
    version: typeof raw.version === "number" ? raw.version : 1,
  };
}

function projectDirById(projectId: string): string | null {
  const root = getProjectsRoot();
  ensureDir(root);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const projectFile = path.join(root, entry.name, PROJECT_FILE);
    if (!fs.existsSync(projectFile)) continue;
    const record = readJson<ProjectRecord | null>(projectFile, null);
    if (record?.id === projectId) return path.join(root, entry.name);
  }
  return null;
}

function ensureProjectFolders(projectDir: string): void {
  ensureDir(projectDir);
  ensureDir(path.join(projectDir, "assets"));
  ensureDir(path.join(projectDir, "exports"));
  ensureDir(path.join(projectDir, "cache"));
}

function toSummary(record: ProjectRecord): Omit<ProjectRecord, "payload"> {
  const { payload: _payload, ...summary } = record;
  return summary;
}

export function listProjects(): Array<Omit<ProjectRecord, "payload">> {
  const root = getProjectsRoot();
  ensureDir(root);
  const projects: Array<Omit<ProjectRecord, "payload">> = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const record = readJson<ProjectRecord | null>(path.join(root, entry.name, PROJECT_FILE), null);
    if (record?.id) projects.push(toSummary(normalizeProjectRecord(record)));
  }
  return projects.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createProject(input: unknown): ProjectRecord {
  const root = getProjectsRoot();
  ensureDir(root);
  const record = normalizeProjectRecord(input);
  const projectDir = uniqueDir(root, record.name);
  ensureProjectFolders(projectDir);
  writeJson(path.join(projectDir, PROJECT_FILE), record);
  return record;
}

export function readProject(projectId: string): ProjectRecord | null {
  const projectDir = projectDirById(String(projectId || "").trim());
  if (!projectDir) return null;
  return normalizeProjectRecord(readJson<ProjectRecord>(path.join(projectDir, PROJECT_FILE), {} as ProjectRecord));
}

export function saveProject(projectId: string, input: unknown): ProjectRecord {
  const id = String(projectId || "").trim();
  const record = normalizeProjectRecord({ ...(input as JsonRecord), id });
  const projectDir = projectDirById(id) || uniqueDir(getProjectsRoot(), record.name);
  ensureProjectFolders(projectDir);
  writeJson(path.join(projectDir, PROJECT_FILE), record);
  return record;
}

export function deleteProject(projectId: string): { id: string; deleted: boolean } {
  const id = String(projectId || "").trim();
  if (!id) throw new Error("projectId is required");
  const projectDir = projectDirById(id);
  if (!projectDir) return { id, deleted: false };
  const root = path.resolve(getProjectsRoot());
  const resolvedProjectDir = path.resolve(projectDir);
  const rootWithSep = `${root}${path.sep}`;
  if (resolvedProjectDir === root || !resolvedProjectDir.startsWith(rootWithSep)) {
    throw new Error("Refusing to delete a path outside the projects root");
  }
  fs.rmSync(resolvedProjectDir, { recursive: true, force: true });
  return { id, deleted: true };
}

export function resolveProjectRelativePath(projectId: string, relativePath: string): string {
  const projectDir = projectDirById(String(projectId || "").trim());
  if (!projectDir) throw new Error("Project not found");
  const resolved = path.resolve(projectDir, String(relativePath || ""));
  const rootWithSep = `${path.resolve(projectDir)}${path.sep}`;
  if (resolved !== path.resolve(projectDir) && !resolved.startsWith(rootWithSep)) {
    throw new Error("Path escapes project root");
  }
  return resolved;
}

function catalogPath(): string {
  return path.join(getSettingsRoot(), CATALOG_FILE);
}

function defaultCatalog(): CatalogState {
  const t = nowIso();
  return {
    version: 1,
    vendors: [
      {
        key: "chatfire",
        name: "ChatFire OpenAI Compatible",
        enabled: true,
        hasApiKey: false,
        baseUrlHint: "https://api.chatfire.site",
        authType: "bearer",
        authHeader: null,
        authQueryParam: null,
        createdAt: t,
        updatedAt: t,
      },
    ],
    models: [
      {
        modelKey: "gpt-image-1",
        vendorKey: "chatfire",
        modelAlias: "gpt-image-1",
        labelZh: "GPT Image",
        kind: "image",
        enabled: true,
        createdAt: t,
        updatedAt: t,
      },
      {
        modelKey: "sora",
        vendorKey: "chatfire",
        modelAlias: "sora",
        labelZh: "Sora Video",
        kind: "video",
        enabled: true,
        createdAt: t,
        updatedAt: t,
      },
      {
        modelKey: "gpt-4o-mini",
        vendorKey: "chatfire",
        modelAlias: "gpt-4o-mini",
        labelZh: "GPT-4o mini",
        kind: "text",
        enabled: true,
        createdAt: t,
        updatedAt: t,
      },
    ],
    mappings: [],
    apiKeysByVendor: {},
  };
}

function readCatalog(): CatalogState {
  const parsed = readJson<CatalogState | null>(catalogPath(), null);
  if (!parsed || parsed.version !== 1) {
    const initial = defaultCatalog();
    writeCatalog(initial);
    return initial;
  }
  const apiKeysByVendor = parsed.apiKeysByVendor || {};
  return {
    ...parsed,
    vendors: parsed.vendors.map((vendor) => ({
      ...vendor,
      hasApiKey: Boolean(apiKeysByVendor[vendor.key]?.apiKey && apiKeysByVendor[vendor.key]?.enabled !== false),
    })),
    apiKeysByVendor,
  };
}

function writeCatalog(state: CatalogState): CatalogState {
  writeJson(catalogPath(), state);
  return state;
}

function normalizeEnabled(value: unknown, fallback = true): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function filterByParams<T extends { vendorKey?: string; kind?: BillingModelKind; enabled?: boolean; taskKind?: ProfileKind }>(
  items: T[],
  params: unknown,
): T[] {
  if (!params || typeof params !== "object") return items;
  const raw = params as JsonRecord;
  return items.filter((item) => {
    if (typeof raw.vendorKey === "string" && item.vendorKey !== raw.vendorKey) return false;
    if (typeof raw.kind === "string" && item.kind !== raw.kind) return false;
    if (typeof raw.taskKind === "string" && item.taskKind !== raw.taskKind) return false;
    if (typeof raw.enabled === "boolean" && item.enabled !== raw.enabled) return false;
    return true;
  });
}

export function listModelCatalogVendors(): Vendor[] {
  return readCatalog().vendors;
}

export function listModelCatalogModels(params?: unknown): Model[] {
  return filterByParams(readCatalog().models, params);
}

export function listModelCatalogMappings(params?: unknown): Mapping[] {
  return filterByParams(readCatalog().mappings, params);
}

export function getModelCatalogHealth(): unknown {
  const state = readCatalog();
  const enabledVendors = state.vendors.filter((vendor) => vendor.enabled);
  const enabledModels = state.models.filter((model) => model.enabled);
  const enabledApiKeys = Object.values(state.apiKeysByVendor).filter((key) => key.enabled && key.apiKey).length;
  const executableModels = enabledModels.filter((model) => {
    const vendor = state.vendors.find((item) => item.key === model.vendorKey);
    const apiKey = state.apiKeysByVendor[model.vendorKey];
    return Boolean(vendor?.enabled && (vendor.authType === "none" || (apiKey?.enabled && apiKey.apiKey)));
  });
  const byKind = (["text", "image", "video"] as BillingModelKind[]).map((kind) => ({
    kind,
    enabledModels: enabledModels.filter((model) => model.kind === kind).length,
    executableModels: executableModels.filter((model) => model.kind === kind).length,
  }));
  const issues = [];
  if (state.vendors.length === 0 || state.models.length === 0) {
    issues.push({ code: "catalog_empty", severity: "error", message: "Local model catalog is empty" });
  }
  for (const model of enabledModels) {
    const vendor = state.vendors.find((item) => item.key === model.vendorKey);
    const apiKey = state.apiKeysByVendor[model.vendorKey];
    if (!vendor?.enabled) {
      issues.push({ code: "vendor_disabled", severity: "error", message: `Vendor disabled: ${model.vendorKey}`, vendorKey: model.vendorKey, modelKey: model.modelKey, kind: model.kind });
    } else if (vendor.authType !== "none" && !apiKey?.apiKey) {
      issues.push({ code: "vendor_api_key_missing", severity: "error", message: `API key missing: ${model.vendorKey}`, vendorKey: model.vendorKey, modelKey: model.modelKey, kind: model.kind });
    }
  }
  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    counts: {
      vendors: state.vendors.length,
      enabledVendors: enabledVendors.length,
      models: state.models.length,
      enabledModels: enabledModels.length,
      mappings: state.mappings.length,
      enabledMappings: state.mappings.filter((mapping) => mapping.enabled).length,
      enabledApiKeys,
    },
    byKind,
    issues,
  };
}

export function upsertModelCatalogVendor(payload: unknown): Vendor {
  const state = readCatalog();
  const raw = payload as JsonRecord;
  const key = sanitizeName(raw.key, "").toLowerCase().replace(/\s+/g, "-");
  if (!key) throw new Error("vendor key is required");
  const existing = state.vendors.find((vendor) => vendor.key === key);
  const t = nowIso();
  const vendor: Vendor = {
    key,
    name: String(raw.name || existing?.name || key).trim(),
    enabled: normalizeEnabled(raw.enabled, existing?.enabled ?? true),
    hasApiKey: existing?.hasApiKey ?? false,
    baseUrlHint: typeof raw.baseUrlHint === "string" ? raw.baseUrlHint.trim() || null : existing?.baseUrlHint ?? null,
    authType: (raw.authType as Vendor["authType"]) || existing?.authType || "bearer",
    authHeader: typeof raw.authHeader === "string" ? raw.authHeader.trim() || null : existing?.authHeader ?? null,
    authQueryParam: typeof raw.authQueryParam === "string" ? raw.authQueryParam.trim() || null : existing?.authQueryParam ?? null,
    meta: raw.meta ?? existing?.meta,
    createdAt: existing?.createdAt || t,
    updatedAt: t,
  };
  state.vendors = [vendor, ...state.vendors.filter((item) => item.key !== key)];
  writeCatalog(state);
  return { ...vendor, hasApiKey: Boolean(state.apiKeysByVendor[key]?.apiKey) };
}

export function deleteModelCatalogVendor(key: string): void {
  const state = readCatalog();
  state.vendors = state.vendors.filter((vendor) => vendor.key !== key);
  state.models = state.models.filter((model) => model.vendorKey !== key);
  state.mappings = state.mappings.filter((mapping) => mapping.vendorKey !== key);
  delete state.apiKeysByVendor[key];
  writeCatalog(state);
}

export function upsertModelCatalogVendorApiKey(vendorKey: string, payload: unknown): unknown {
  const state = readCatalog();
  const key = String(vendorKey || "").trim();
  const apiKey = String((payload as JsonRecord)?.apiKey || "").trim();
  if (!key) throw new Error("vendor key is required");
  if (!apiKey) throw new Error("api key is required");
  const t = nowIso();
  const existing = state.apiKeysByVendor[key];
  state.apiKeysByVendor[key] = {
    vendorKey: key,
    apiKey,
    enabled: normalizeEnabled((payload as JsonRecord)?.enabled, true),
    createdAt: existing?.createdAt || t,
    updatedAt: t,
  };
  writeCatalog(state);
  return { vendorKey: key, hasApiKey: true, enabled: state.apiKeysByVendor[key].enabled, createdAt: state.apiKeysByVendor[key].createdAt, updatedAt: t };
}

export function clearModelCatalogVendorApiKey(vendorKey: string): unknown {
  const state = readCatalog();
  const key = String(vendorKey || "").trim();
  const t = nowIso();
  delete state.apiKeysByVendor[key];
  writeCatalog(state);
  return { vendorKey: key, hasApiKey: false, enabled: false, createdAt: t, updatedAt: t };
}

export function upsertModelCatalogModel(payload: unknown): Model {
  const state = readCatalog();
  const raw = payload as JsonRecord;
  const modelKey = String(raw.modelKey || "").trim();
  const vendorKey = String(raw.vendorKey || "").trim();
  if (!modelKey || !vendorKey) throw new Error("modelKey and vendorKey are required");
  const existing = state.models.find((model) => model.vendorKey === vendorKey && model.modelKey === modelKey);
  const t = nowIso();
  const model: Model = {
    modelKey,
    vendorKey,
    modelAlias: typeof raw.modelAlias === "string" ? raw.modelAlias.trim() || null : existing?.modelAlias ?? null,
    labelZh: String(raw.labelZh || existing?.labelZh || modelKey).trim(),
    kind: (raw.kind as BillingModelKind) || existing?.kind || "text",
    enabled: normalizeEnabled(raw.enabled, existing?.enabled ?? true),
    meta: raw.meta ?? existing?.meta,
    pricing: raw.pricing as Model["pricing"] || existing?.pricing,
    createdAt: existing?.createdAt || t,
    updatedAt: t,
  };
  state.models = [model, ...state.models.filter((item) => !(item.vendorKey === vendorKey && item.modelKey === modelKey))];
  writeCatalog(state);
  return model;
}

export function deleteModelCatalogModel(vendorKey: string, modelKey: string): void {
  const state = readCatalog();
  state.models = state.models.filter((model) => !(model.vendorKey === vendorKey && model.modelKey === modelKey));
  writeCatalog(state);
}

export function upsertModelCatalogMapping(payload: unknown): Mapping {
  const state = readCatalog();
  const raw = payload as JsonRecord;
  const id = String(raw.id || "").trim() || `mapping-${crypto.randomUUID()}`;
  const existing = state.mappings.find((mapping) => mapping.id === id);
  const t = nowIso();
  const vendorKey = String(raw.vendorKey || existing?.vendorKey || "").trim();
  const taskKind = (raw.taskKind as ProfileKind) || existing?.taskKind || "chat";
  if (!vendorKey) throw new Error("vendorKey is required");
  const mapping: Mapping = {
    id,
    vendorKey,
    taskKind,
    name: String(raw.name || existing?.name || taskKind).trim(),
    enabled: normalizeEnabled(raw.enabled, existing?.enabled ?? true),
    requestMapping: raw.requestMapping ?? raw.requestProfile ?? existing?.requestMapping,
    responseMapping: raw.responseMapping ?? raw.requestProfile ?? existing?.responseMapping,
    createdAt: existing?.createdAt || t,
    updatedAt: t,
  };
  state.mappings = [mapping, ...state.mappings.filter((item) => item.id !== id)];
  writeCatalog(state);
  return mapping;
}

export function deleteModelCatalogMapping(id: string): void {
  const state = readCatalog();
  state.mappings = state.mappings.filter((mapping) => mapping.id !== id);
  writeCatalog(state);
}

export function exportModelCatalogPackage(params?: unknown): unknown {
  const state = readCatalog();
  const includeApiKeys = Boolean((params as JsonRecord | undefined)?.includeApiKeys);
  return {
    version: "desktop-local-v1",
    exportedAt: nowIso(),
    vendors: state.vendors.map((vendor) => ({
      vendor,
      ...(includeApiKeys && state.apiKeysByVendor[vendor.key]?.apiKey
        ? { apiKey: { apiKey: state.apiKeysByVendor[vendor.key].apiKey, enabled: state.apiKeysByVendor[vendor.key].enabled } }
        : {}),
      models: state.models.filter((model) => model.vendorKey === vendor.key),
      mappings: state.mappings.filter((mapping) => mapping.vendorKey === vendor.key),
    })),
  };
}

export function importModelCatalogPackage(payload: unknown): unknown {
  const state = readCatalog();
  const raw = payload as { vendors?: Array<{ vendor?: unknown; apiKey?: unknown; models?: unknown[]; mappings?: unknown[] }> };
  let vendors = 0;
  let models = 0;
  let mappings = 0;
  const errors: string[] = [];
  for (const bundle of raw.vendors || []) {
    try {
      const vendor = upsertModelCatalogVendor(bundle.vendor);
      vendors += 1;
      const apiKey = bundle.apiKey as JsonRecord | undefined;
      if (apiKey?.apiKey) upsertModelCatalogVendorApiKey(vendor.key, apiKey);
      for (const model of bundle.models || []) {
        upsertModelCatalogModel({ ...(model as JsonRecord), vendorKey: (model as JsonRecord).vendorKey || vendor.key });
        models += 1;
      }
      for (const mapping of bundle.mappings || []) {
        upsertModelCatalogMapping({ ...(mapping as JsonRecord), vendorKey: (mapping as JsonRecord).vendorKey || vendor.key });
        mappings += 1;
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  writeCatalog(readCatalog() || state);
  return { imported: { vendors, models, mappings }, errors };
}

export async function fetchModelCatalogDocs(payload: unknown): Promise<unknown> {
  const targetUrl = String((payload as JsonRecord)?.url || "").trim();
  if (!/^https?:\/\//i.test(targetUrl)) throw new Error("http/https url is required");
  const response = await fetch(targetUrl);
  const contentType = response.headers.get("content-type") || "";
  const html = await response.text();
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || null;
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const max = 120000;
  return {
    url: targetUrl,
    finalUrl: response.url,
    status: response.status,
    contentType,
    title,
    text: text.slice(0, max),
    truncated: text.length > max,
    diagnostics: [],
  };
}

export async function testModelCatalogMapping(id: string, payload: unknown): Promise<unknown> {
  const mapping = readCatalog().mappings.find((item) => item.id === id);
  const raw = payload as JsonRecord | undefined;
  if (!mapping) {
    return {
      mappingId: id,
      vendorKey: "",
      taskKind: "chat",
      stage: raw?.stage || "create",
      executed: false,
      ok: false,
      diagnostics: ["Mapping not found."],
      request: null,
    };
  }
  const profile = requestProfileFromMapping(mapping);
  if (!profile) {
    return {
      mappingId: id,
      vendorKey: mapping.vendorKey,
      taskKind: mapping.taskKind,
      stage: raw?.stage || "create",
      executed: false,
      ok: false,
      diagnostics: ["Only requestProfile.version=v2 can be tested in the desktop runtime."],
      request: null,
    };
  }
  const stage = raw?.stage === "result" || raw?.stage === "query" ? "query" : "create";
  const operation = profileOperation(profile, stage);
  if (!operation) {
    return {
      mappingId: id,
      vendorKey: mapping.vendorKey,
      taskKind: mapping.taskKind,
      stage,
      executed: false,
      ok: false,
      diagnostics: [`No ${stage}.default operation in requestProfile.`],
      request: null,
    };
  }
  const wantedKind = billingKindForTaskKind(mapping.taskKind);
  const { vendor, model, apiKey } = findExecutableModelForTask(mapping.vendorKey, trim(raw?.modelKey), wantedKind);
  const request: TaskRequest = {
    kind: mapping.taskKind,
    prompt: firstString(raw?.prompt, "Nomi mapping smoke test"),
    extras: {
      ...(isJsonRecord(raw?.extras) ? raw?.extras : {}),
      modelKey: model.modelKey,
      modelAlias: model.modelAlias || model.modelKey,
    },
  };
  const providerMeta = {
    query_id: firstString(raw?.taskId),
    task_id: firstString(raw?.taskId),
  };
  const preview = buildProfileHttpRequest({ vendor, model, apiKey, request, operation, providerMeta }).preview;
  const upstreamResponse = raw && Object.prototype.hasOwnProperty.call(raw, "upstreamResponse") ? raw.upstreamResponse : undefined;
  if (typeof upstreamResponse !== "undefined") {
    const normalized = await buildProfileTaskResult({
      response: upstreamResponse,
      profile,
      operation,
      request,
      taskIdFallback: firstString(raw?.taskId, `test-${Date.now()}`),
      wantedKind,
    });
    return {
      mappingId: id,
      vendorKey: mapping.vendorKey,
      taskKind: mapping.taskKind,
      stage,
      executed: false,
      ok: normalized.result.status !== "failed",
      diagnostics: ["Mapped the provided upstream response without sending a request."],
      request: preview,
      response: normalized.result,
    };
  }
  if (!raw?.execute) {
    return {
      mappingId: id,
      vendorKey: mapping.vendorKey,
      taskKind: mapping.taskKind,
      stage,
      executed: false,
      ok: true,
      diagnostics: ["Rendered local desktop requestProfile without sending a request."],
      request: preview,
    };
  }
  const executed = await executeProfileOperation({ vendor, model, apiKey, request, operation, providerMeta });
  const normalized = await buildProfileTaskResult({
    response: executed.response,
    profile,
    operation,
    request,
    taskIdFallback: firstString(raw?.taskId, `test-${Date.now()}`),
    wantedKind,
  });
  return {
    mappingId: id,
    vendorKey: mapping.vendorKey,
    taskKind: mapping.taskKind,
    stage,
    executed: true,
    ok: normalized.result.status !== "failed",
    diagnostics: ["Executed requestProfile through the desktop runtime."],
    request: executed.request,
    response: normalized.result,
  };
}

function extensionFromMime(contentType: string, fallback = "bin"): string {
  const type = contentType.split(";")[0]?.trim().toLowerCase();
  if (type === "image/png") return "png";
  if (type === "image/jpeg") return "jpg";
  if (type === "image/webp") return "webp";
  if (type === "image/gif") return "gif";
  if (type === "video/mp4") return "mp4";
  if (type === "video/webm") return "webm";
  if (type === "application/json") return "json";
  return fallback;
}

function extensionFromUrl(url: string): string {
  try {
    const ext = path.extname(new URL(url).pathname).replace(/^\./, "").toLowerCase();
    return ext.slice(0, 8) || "bin";
  } catch {
    return "bin";
  }
}

function localAssetUrl(projectId: string, relativePath: string): string {
  return `nomi-local://asset/${encodeURIComponent(projectId)}/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function contentTypeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".json") return "application/json";
  if (ext === ".txt" || ext === ".md") return "text/plain";
  return "application/octet-stream";
}

function assetKindFromContentType(contentType: string): string {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType === "application/json" || contentType.startsWith("text/")) return "document";
  return "file";
}

function stableAssetId(projectId: string, relativePath: string): string {
  const digest = crypto.createHash("sha1").update(`${projectId}:${relativePath}`).digest("hex").slice(0, 20);
  return `asset-${digest}`;
}

function collectFilesRecursively(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFilesRecursively(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

function uniqueAssetPath(projectId: string, fileName: string): { absolutePath: string; relativePath: string } {
  const projectDir = projectDirById(projectId);
  if (!projectDir) throw new Error("Project not found");
  const today = new Date().toISOString().slice(0, 10);
  const assetDir = path.join(projectDir, "assets", today);
  ensureDir(assetDir);
  const parsed = path.parse(sanitizeName(fileName, "asset.bin"));
  const base = parsed.name || "asset";
  const ext = parsed.ext || ".bin";
  let absolutePath = path.join(assetDir, `${base}${ext}`);
  for (let index = 2; fs.existsSync(absolutePath); index += 1) {
    absolutePath = path.join(assetDir, `${base}-${index}${ext}`);
  }
  return {
    absolutePath,
    relativePath: path.relative(projectDir, absolutePath).replace(/\\/g, "/"),
  };
}

function writeAsset(projectId: string, bytes: Buffer, fileName: string, contentType: string, meta: JsonRecord): unknown {
  const { absolutePath, relativePath } = uniqueAssetPath(projectId, fileName);
  fs.writeFileSync(absolutePath, bytes);
  const url = localAssetUrl(projectId, relativePath);
  const t = nowIso();
  return {
    id: `asset-${crypto.randomUUID()}`,
    name: sanitizeName(fileName, "asset"),
    userId: "local",
    projectId,
    createdAt: t,
    updatedAt: t,
    data: {
      ...meta,
      url,
      relativePath,
      absolutePath,
      contentType,
      size: bytes.byteLength,
    },
  };
}

function parseDataUrl(dataUrl: string): { bytes: Buffer; contentType: string } {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match) throw new Error("Invalid data URL");
  const contentType = match[1] || "application/octet-stream";
  const encoded = match[3] || "";
  const bytes = match[2] ? Buffer.from(encoded, "base64") : Buffer.from(decodeURIComponent(encoded));
  return { bytes, contentType };
}

export async function importRemoteAsset(payload: unknown): Promise<unknown> {
  const raw = payload as JsonRecord;
  const projectId = String(raw.projectId || "").trim();
  const url = String(raw.url || "").trim();
  if (!projectId) throw new Error("projectId is required");
  if (!url) throw new Error("url is required");
  if (url.startsWith("nomi-local://")) {
    return { id: `asset-${crypto.randomUUID()}`, name: String(raw.fileName || "local asset"), userId: "local", projectId, createdAt: nowIso(), updatedAt: nowIso(), data: { url, kind: raw.kind || "local" } };
  }
  if (url.startsWith("data:")) {
    const parsed = parseDataUrl(url);
    const ext = extensionFromMime(parsed.contentType, "bin");
    return writeAsset(projectId, parsed.bytes, String(raw.fileName || `asset-${Date.now()}.${ext}`), parsed.contentType, { kind: raw.kind || "generated", originalUrl: null });
  }
  if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s), data, and nomi-local assets are supported");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Asset download failed: ${response.status}`);
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const bytes = Buffer.from(await response.arrayBuffer());
  const ext = extensionFromMime(contentType, extensionFromUrl(url));
  const fileName = String(raw.fileName || path.basename(new URL(url).pathname) || `asset-${Date.now()}.${ext}`);
  return writeAsset(projectId, bytes, fileName.includes(".") ? fileName : `${fileName}.${ext}`, contentType, {
    kind: raw.kind || "generated",
    originalUrl: url,
    ownerNodeId: raw.ownerNodeId || null,
  });
}

function bytesFromPayload(value: unknown): Buffer {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Buffer.from(value);
  throw new Error("bytes must be an ArrayBuffer");
}

export async function importLocalFile(payload: unknown): Promise<unknown> {
  const raw = payload as JsonRecord;
  const projectId = String(raw.projectId || "").trim();
  if (!projectId) throw new Error("projectId is required");
  const bytes = bytesFromPayload(raw.bytes);
  const contentType = String(raw.contentType || "application/octet-stream");
  const ext = extensionFromMime(contentType, "bin");
  const fileName = String(raw.fileName || `asset-${Date.now()}.${ext}`);
  return writeAsset(projectId, bytes, fileName, contentType, {
    kind: raw.kind || "upload",
    originalName: raw.fileName || null,
  });
}

export function listProjectAssets(payload: unknown): { items: LocalAssetRecord[]; cursor: string | null } {
  const raw = payload as JsonRecord | undefined;
  const projectId = String(raw?.projectId || "").trim();
  if (!projectId) throw new Error("projectId is required");
  const projectDir = projectDirById(projectId);
  if (!projectDir) return { items: [], cursor: null };
  const assetsDir = path.join(projectDir, "assets");
  const requestedLimit = typeof raw?.limit === "number" && Number.isFinite(raw.limit) ? Math.floor(raw.limit) : 200;
  const limit = Math.max(1, Math.min(500, requestedLimit));
  const offset = Math.max(0, Number.parseInt(String(raw?.cursor || "0"), 10) || 0);
  const kindFilter = typeof raw?.kind === "string" && raw.kind.trim() ? raw.kind.trim() : "";
  const records = collectFilesRecursively(assetsDir).flatMap((absolutePath): LocalAssetRecord[] => {
    try {
      const stat = fs.statSync(absolutePath);
      const relativePath = path.relative(projectDir, absolutePath).replace(/\\/g, "/");
      const contentType = contentTypeFromPath(absolutePath);
      const kind = assetKindFromContentType(contentType);
      if (kindFilter && kind !== kindFilter) return [];
      const createdAt = new Date(stat.birthtimeMs || stat.mtimeMs).toISOString();
      const updatedAt = new Date(stat.mtimeMs).toISOString();
      return [{
        id: stableAssetId(projectId, relativePath),
        name: path.basename(absolutePath),
        userId: "local",
        projectId,
        createdAt,
        updatedAt,
        data: {
          url: localAssetUrl(projectId, relativePath),
          relativePath,
          absolutePath,
          contentType,
          size: stat.size,
          kind,
        },
      }];
    } catch {
      return [];
    }
  }).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const items = records.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return {
    items,
    cursor: nextOffset < records.length ? String(nextOffset) : null,
  };
}

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function findExecutableModel(vendorKey: string, modelKey: string, kind?: BillingModelKind): { vendor: Vendor; model: Model; apiKey: string } {
  const state = readCatalog();
  const vendor = state.vendors.find((item) => item.key === vendorKey && item.enabled);
  if (!vendor) throw new Error(`Vendor is not enabled: ${vendorKey}`);
  const model = state.models.find((item) => item.vendorKey === vendorKey && item.enabled && (!kind || item.kind === kind) && (item.modelKey === modelKey || item.modelAlias === modelKey));
  if (!model) throw new Error(`Model is not enabled: ${modelKey}`);
  const apiKey = state.apiKeysByVendor[vendorKey]?.apiKey || "";
  if (vendor.authType !== "none" && !apiKey) throw new Error(`API key missing: ${vendorKey}`);
  return { vendor, model, apiKey };
}

function findExecutableModelForTask(vendorKey: string, modelKey: string, kind: BillingModelKind): { vendor: Vendor; model: Model; apiKey: string } {
  if (modelKey) return findExecutableModel(vendorKey, modelKey, kind);
  const state = readCatalog();
  const model = state.models.find((item) => item.vendorKey === vendorKey && item.enabled && item.kind === kind);
  if (!model) throw new Error(`No enabled ${kind} model for vendor: ${vendorKey}`);
  return findExecutableModel(vendorKey, model.modelKey, kind);
}

function authHeaders(vendor: Vendor, apiKey: string): Record<string, string> {
  if (!apiKey || vendor.authType === "none") return {};
  if (vendor.authType === "x-api-key") return { [vendor.authHeader || "X-API-Key"]: apiKey };
  if (vendor.authType === "query") return {};
  return { Authorization: `Bearer ${apiKey}` };
}

function authQueryParams(vendor: Vendor, apiKey: string): Record<string, string> {
  if (!apiKey || vendor.authType !== "query") return {};
  return { [vendor.authQueryParam || "api_key"]: apiKey };
}

function endpoint(vendor: Vendor, suffix: string): string {
  const base = String(vendor.baseUrlHint || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error(`Base URL missing: ${vendor.key}`);
  return `${base}${suffix}`;
}

function appendQueryParams(url: string, params: Record<string, unknown>): string {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (!key || value == null) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item == null || item === "") continue;
      parsed.searchParams.append(key, String(item));
    }
  }
  return parsed.toString();
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = trim(value);
    if (text) return text;
  }
  return "";
}

function billingKindForTaskKind(kind: ProfileKind): BillingModelKind {
  if (kind === "text_to_video" || kind === "image_to_video") return "video";
  if (kind === "chat" || kind === "prompt_refine" || kind === "image_to_prompt") return "text";
  return "image";
}

function extractAssetUrl(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const record = raw as JsonRecord;
  const candidates = [
    record.url,
    record.video_url,
    record.image_url,
    record.output,
    (record.data as JsonRecord[] | undefined)?.[0]?.url,
    (record.data as JsonRecord[] | undefined)?.[0]?.b64_json ? `data:image/png;base64,${(record.data as JsonRecord[])[0].b64_json}` : "",
    (record.images as JsonRecord[] | undefined)?.[0]?.url,
    (record.videos as JsonRecord[] | undefined)?.[0]?.url,
    (record.result as JsonRecord | undefined)?.url,
    (record.result as JsonRecord | undefined)?.video_url,
    (record.result as JsonRecord | undefined)?.image_url,
  ];
  return firstString(...candidates);
}

function extractTaskId(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const record = raw as JsonRecord;
  return firstString(record.id, record.taskId, record.task_id, (record.data as JsonRecord | undefined)?.id);
}

async function postJson(url: string, apiKey: string, vendor: Vendor, body: unknown): Promise<unknown> {
  const response = await fetch(appendQueryParams(url, authQueryParams(vendor, apiKey)), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(vendor, apiKey),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(firstString((json as JsonRecord | null)?.message, (json as JsonRecord | null)?.error, `Provider request failed: ${response.status}`));
  return json;
}

async function localizeTaskAsset(projectId: string, assetUrl: string, type: "image" | "video", nodeId?: string): Promise<TaskResult["assets"][number]> {
  const imported = await importRemoteAsset({
    projectId,
    url: assetUrl,
    kind: "generated",
    ownerNodeId: nodeId || null,
    fileName: `${type}-${Date.now()}.${type === "image" ? "png" : "mp4"}`,
  }) as { id?: string; name?: string; data?: { url?: string } };
  return {
    type,
    url: String(imported.data?.url || assetUrl),
    thumbnailUrl: type === "image" ? String(imported.data?.url || assetUrl) : null,
    assetId: imported.id || null,
    assetName: imported.name || null,
  };
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function findTaskMapping(vendorKey: string, taskKind: ProfileKind): Mapping | null {
  const state = readCatalog();
  return state.mappings.find((mapping) => mapping.enabled && mapping.vendorKey === vendorKey && mapping.taskKind === taskKind) || null;
}

function requestProfileFromMapping(mapping: Mapping | null | undefined): JsonRecord | null {
  if (!mapping) return null;
  for (const candidate of [mapping.requestMapping, mapping.responseMapping]) {
    if (isJsonRecord(candidate) && candidate.version === "v2" && candidate.enabled !== false) return candidate;
  }
  return null;
}

function profileOperation(profile: JsonRecord, stage: "create" | "query"): JsonRecord | null {
  const group = profile[stage];
  if (!isJsonRecord(group)) return null;
  const operation = isJsonRecord(group.default) ? group.default : group;
  return isJsonRecord(operation) ? operation : null;
}

function firstReferenceImage(request: TaskRequest): string {
  const extras = request.extras || {};
  const referenceImages = Array.isArray(extras.referenceImages) ? extras.referenceImages : [];
  return firstString(
    extras.image_url,
    extras.imageUrl,
    extras.firstFrameUrl,
    extras.lastFrameUrl,
    referenceImages[0],
  );
}

function taskTemplateParams(request: TaskRequest): JsonRecord {
  const extras = request.extras || {};
  const size = request.width && request.height ? `${request.width}x${request.height}` : firstString(extras.size, extras.aspectRatio);
  const duration = firstString(extras.duration, extras.durationSeconds, extras.videoDuration);
  return {
    ...extras,
    size,
    n: extras.n ?? 1,
    width: request.width,
    height: request.height,
    seed: request.seed,
    steps: request.steps,
    cfgScale: request.cfgScale,
    cfg_scale: request.cfgScale,
    negative_prompt: request.negativePrompt,
    duration,
    image_url: firstReferenceImage(request),
    first_frame_url: firstString(extras.firstFrameUrl),
    last_frame_url: firstString(extras.lastFrameUrl),
    reference_images: Array.isArray(extras.referenceImages) ? extras.referenceImages : [],
    max_tokens: extras.maxTokens ?? extras.max_tokens,
  };
}

function templateContext(request: TaskRequest, model: Model, apiKey: string, providerMeta: JsonRecord = {}): JsonRecord {
  const params = taskTemplateParams(request);
  return {
    request: {
      ...request,
      params,
    },
    model: {
      ...model,
      model_key: model.modelAlias || model.modelKey,
      model_alias: model.modelAlias || model.modelKey,
    },
    account: {
      account_key: apiKey,
      api_key: apiKey,
    },
    providerMeta,
  };
}

function readTemplatePath(context: JsonRecord, expression: string): unknown {
  const normalized = expression.trim();
  if (!normalized) return undefined;
  const parts = normalized.split(".").map((part) => part.trim()).filter(Boolean);
  let current: unknown = context;
  for (const part of parts) {
    if (!isJsonRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function renderTemplateString(input: string, context: JsonRecord): unknown {
  const exact = input.match(/^\{\{\s*([^}]+)\s*\}\}$/);
  if (exact) return readTemplatePath(context, exact[1]);
  return input.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, expression: string) => {
    const value = readTemplatePath(context, expression);
    if (value == null) return "";
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

function renderTemplateValue(value: unknown, context: JsonRecord): unknown {
  if (typeof value === "string") return renderTemplateString(value, context);
  if (Array.isArray(value)) {
    return value.map((item) => renderTemplateValue(item, context)).filter((item) => typeof item !== "undefined");
  }
  if (isJsonRecord(value)) {
    const out: JsonRecord = {};
    for (const [key, child] of Object.entries(value)) {
      const rendered = renderTemplateValue(child, context);
      if (typeof rendered !== "undefined") out[key] = rendered;
    }
    return out;
  }
  return value;
}

function renderedRecord(value: unknown): Record<string, unknown> {
  return isJsonRecord(value) ? value : {};
}

function stringifyHeaders(headers: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!key || value == null || value === "") continue;
    out[key] = String(value);
  }
  return out;
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = /authorization|api[-_]?key/i.test(key) ? "[redacted]" : value;
  }
  return out;
}

async function requestJson(
  vendor: Vendor,
  apiKey: string,
  method: string,
  url: string,
  headers: Record<string, string>,
  query: Record<string, unknown>,
  body: unknown,
): Promise<unknown> {
  const finalUrl = appendQueryParams(url, { ...authQueryParams(vendor, apiKey), ...query });
  const upperMethod = method.toUpperCase();
  const hasBody = upperMethod !== "GET" && upperMethod !== "HEAD" && body != null;
  const response = await fetch(finalUrl, {
    method: upperMethod,
    headers,
    ...(hasBody ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!response.ok) {
    const record = isJsonRecord(json) ? json : {};
    throw new Error(firstString(record.message, record.error, readNestedRecord(record, ["error", "message"]), `Provider request failed: ${response.status}`));
  }
  return json;
}

function operationUrl(vendor: Vendor, operationPath: string): string {
  if (/^https?:\/\//i.test(operationPath)) return operationPath;
  return endpoint(vendor, operationPath.startsWith("/") ? operationPath : `/${operationPath}`);
}

function buildProfileHttpRequest(input: {
  vendor: Vendor;
  model: Model;
  apiKey: string;
  request: TaskRequest;
  operation: JsonRecord;
  providerMeta?: JsonRecord;
}): { method: string; url: string; headers: Record<string, string>; query: Record<string, unknown>; body: unknown; preview: unknown } {
  const context = templateContext(input.request, input.model, input.apiKey, input.providerMeta || {});
  const method = firstString(input.operation.method) || "POST";
  const renderedPath = renderTemplateValue(input.operation.path || "/v1/tasks", context);
  const url = operationUrl(input.vendor, String(renderedPath || "/v1/tasks"));
  const renderedHeaders = stringifyHeaders(renderedRecord(renderTemplateValue(input.operation.headers, context)));
  const headers = {
    ...authHeaders(input.vendor, input.apiKey),
    ...renderedHeaders,
  };
  const upperMethod = method.toUpperCase();
  const renderedBody = renderTemplateValue(input.operation.body, context);
  if (upperMethod !== "GET" && upperMethod !== "HEAD" && renderedBody != null && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
    headers["Content-Type"] = "application/json";
  }
  const query = renderedRecord(renderTemplateValue(input.operation.query, context));
  return {
    method: upperMethod,
    url,
    headers,
    query,
    body: renderedBody,
    preview: {
      method: upperMethod,
      url: appendQueryParams(url, query),
      headers: redactHeaders(headers),
      body: renderedBody,
    },
  };
}

async function executeProfileOperation(input: {
  vendor: Vendor;
  model: Model;
  apiKey: string;
  request: TaskRequest;
  operation: JsonRecord;
  providerMeta?: JsonRecord;
}): Promise<{ response: unknown; request: unknown }> {
  const built = buildProfileHttpRequest(input);
  const response = await requestJson(input.vendor, input.apiKey, built.method, built.url, built.headers, built.query, built.body);
  return {
    response,
    request: built.preview,
  };
}

function pathValues(input: unknown, expression: string): unknown[] {
  const parts = expression.split(".").map((part) => part.trim()).filter(Boolean);
  let current: unknown[] = [input];
  for (const part of parts) {
    const wildcard = part.endsWith("[*]");
    const key = wildcard ? part.slice(0, -3) : part;
    const next: unknown[] = [];
    for (const item of current) {
      let value: unknown;
      if (/^\d+$/.test(key) && Array.isArray(item)) {
        value = item[Number(key)];
      } else if (key && isJsonRecord(item)) {
        value = item[key];
      } else {
        value = item;
      }
      if (wildcard) {
        if (Array.isArray(value)) next.push(...value);
      } else if (typeof value !== "undefined") {
        next.push(value);
      }
    }
    current = next;
  }
  return current;
}

function mappingCandidates(mapping: JsonRecord | null, key: string): string[] {
  const raw = mapping?.[key];
  if (Array.isArray(raw)) return raw.map((item) => String(item || "").trim()).filter(Boolean);
  const direct = firstString(raw);
  return direct ? [direct] : [];
}

function valuesFromMapping(response: unknown, mapping: JsonRecord | null, key: string): unknown[] {
  return mappingCandidates(mapping, key).flatMap((candidate) => pathValues(response, candidate));
}

function firstMappedString(response: unknown, mapping: JsonRecord | null, key: string): string {
  return firstString(...valuesFromMapping(response, mapping, key));
}

function collectAssetUrls(value: unknown): string[] {
  if (typeof value === "string") {
    const text = value.trim();
    return /^(https?:\/\/|data:|nomi-local:\/\/)/i.test(text) ? [text] : [];
  }
  if (Array.isArray(value)) return value.flatMap(collectAssetUrls);
  if (isJsonRecord(value)) {
    return [
      value.url,
      value.video_url,
      value.image_url,
      value.output_url,
      value.thumbnailUrl,
    ].flatMap(collectAssetUrls);
  }
  return [];
}

function taskStatusFromResponse(response: unknown, responseMapping: JsonRecord | null, profile: JsonRecord, assetUrls: string[]): TaskResult["status"] {
  const mappedStatus = firstMappedString(response, responseMapping, "status");
  const fallbackStatus = firstString(
    mappedStatus,
    isJsonRecord(response) ? response.status : "",
    isJsonRecord(response) ? readNestedRecord(response, ["data", "status"]) : "",
    isJsonRecord(response) ? readNestedRecord(response, ["choices", "0", "finish_reason"]) : "",
  ).toLowerCase();
  const statusMapping = isJsonRecord(profile.status_mapping) ? profile.status_mapping : {};
  for (const status of ["queued", "running", "succeeded", "failed"] as const) {
    const values = Array.isArray(statusMapping[status]) ? statusMapping[status] as unknown[] : [];
    if (values.map((item) => String(item).toLowerCase()).includes(fallbackStatus)) return status;
  }
  if (["queued", "pending"].includes(fallbackStatus)) return "queued";
  if (["running", "processing", "in_progress"].includes(fallbackStatus)) return "running";
  if (["succeeded", "success", "completed", "complete", "done", "stop", "length"].includes(fallbackStatus)) return "succeeded";
  if (["failed", "error", "timeout", "expired", "canceled", "cancelled"].includes(fallbackStatus)) return "failed";
  if (assetUrls.length > 0) return "succeeded";
  if (isJsonRecord(response) && (response.error || readNestedRecord(response, ["data", "error"]))) return "failed";
  return "queued";
}

function providerMetaFromResponse(response: unknown, mapping: JsonRecord | null): JsonRecord {
  const meta: JsonRecord = {};
  if (mapping) {
    for (const key of Object.keys(mapping)) {
      const value = firstMappedString(response, mapping, key);
      if (value) meta[key] = value;
    }
  }
  const taskId = firstString(meta.query_id, meta.task_id, extractTaskId(response));
  if (taskId) {
    meta.query_id = meta.query_id || taskId;
    meta.task_id = meta.task_id || taskId;
  }
  return meta;
}

async function buildProfileTaskResult(input: {
  response: unknown;
  profile: JsonRecord;
  operation: JsonRecord;
  request: TaskRequest;
  taskIdFallback: string;
  wantedKind: BillingModelKind;
  projectId?: string;
  nodeId?: string;
}): Promise<{ result: TaskResult; providerMeta: JsonRecord }> {
  const responseMapping = isJsonRecord(input.operation.response_mapping) ? input.operation.response_mapping : null;
  const providerMetaMapping = isJsonRecord(input.operation.provider_meta_mapping) ? input.operation.provider_meta_mapping : null;
  const providerMeta = providerMetaFromResponse(input.response, providerMetaMapping);
  const taskId = firstString(
    firstMappedString(input.response, responseMapping, "task_id"),
    providerMeta.task_id,
    providerMeta.query_id,
    extractTaskId(input.response),
    input.taskIdFallback,
  );
  const mappedAssetValues = [
    ...valuesFromMapping(input.response, responseMapping, "assets"),
    ...valuesFromMapping(input.response, responseMapping, "image_url"),
    ...valuesFromMapping(input.response, responseMapping, "video_url"),
  ];
  const assetUrls = Array.from(new Set([
    ...mappedAssetValues.flatMap(collectAssetUrls),
    ...collectAssetUrls(extractAssetUrl(input.response)),
  ]));
  const status = taskStatusFromResponse(input.response, responseMapping, input.profile, assetUrls);
  const type: "image" | "video" = input.wantedKind === "video" ? "video" : "image";
  const assets = input.projectId
    ? await Promise.all(assetUrls.map((url) => localizeTaskAsset(input.projectId || "", url, type, input.nodeId)))
    : assetUrls.map((url) => ({ type, url, thumbnailUrl: type === "image" ? url : null }));
  return {
    providerMeta,
    result: {
      id: taskId,
      kind: input.request.kind,
      status,
      assets,
      raw: input.response,
    },
  };
}

export async function runTask(payload: unknown): Promise<TaskResult> {
  const raw = payload as { vendor?: string; request?: TaskRequest };
  const vendorKey = trim(raw.vendor);
  const request = raw.request;
  if (!vendorKey || !request) throw new Error("vendor and request are required");
  const kind = request.kind;
  const wantedKind = billingKindForTaskKind(kind);
  const modelKey = firstString(request.extras?.modelKey, request.extras?.modelAlias);
  const { vendor, model, apiKey } = findExecutableModel(vendorKey, modelKey, wantedKind);
  const projectId = trim(request.extras?.projectId);
  const nodeId = trim(request.extras?.nodeId);
  const taskId = `task-${crypto.randomUUID()}`;
  const mapping = findTaskMapping(vendorKey, kind);
  const profile = requestProfileFromMapping(mapping);
  const createOperation = profile ? profileOperation(profile, "create") : null;

  if (profile && createOperation) {
    const executed = await executeProfileOperation({ vendor, model, apiKey, request, operation: createOperation });
    const normalized = await buildProfileTaskResult({
      response: executed.response,
      profile,
      operation: createOperation,
      request,
      taskIdFallback: taskId,
      wantedKind,
      projectId,
      nodeId,
    });
    if (!["succeeded", "failed"].includes(normalized.result.status)) {
      taskCache.set(normalized.result.id, {
        vendor: vendorKey,
        request,
        raw: executed.response,
        mapping,
        model,
        apiKey,
        providerMeta: normalized.providerMeta,
        projectId,
        nodeId,
        wantedKind,
      });
    }
    return normalized.result;
  }

  if (wantedKind === "text") {
    const imageUrl = kind === "image_to_prompt" ? firstReferenceImage(request) : "";
    const userContent: unknown = imageUrl
      ? [
          { type: "text", text: request.prompt },
          { type: "image_url", image_url: { url: imageUrl } },
        ]
      : request.prompt;
    const maxTokensValue = Number(request.extras?.maxTokens ?? request.extras?.max_tokens);
    const temperatureValue = Number(request.extras?.temperature);
    const response = await postJson(endpoint(vendor, "/v1/chat/completions"), apiKey, vendor, {
      model: model.modelAlias || model.modelKey,
      messages: [{ role: "user", content: userContent }],
      temperature: Number.isFinite(temperatureValue) ? temperatureValue : 0.7,
      ...(Number.isFinite(maxTokensValue) && maxTokensValue > 0 ? { max_tokens: maxTokensValue } : {}),
    });
    return { id: taskId, kind, status: "succeeded", assets: [], raw: response };
  }

  const suffix = wantedKind === "video" ? "/v1/videos/generations" : "/v1/images/generations";
  const providerResponse = await postJson(endpoint(vendor, suffix), apiKey, vendor, {
    model: model.modelAlias || model.modelKey,
    prompt: request.prompt,
    size: request.width && request.height ? `${request.width}x${request.height}` : undefined,
    seed: request.seed,
    n: 1,
    response_format: "url",
    extras: request.extras,
  });
  const assetUrl = extractAssetUrl(providerResponse);
  const upstreamTaskId = extractTaskId(providerResponse) || taskId;
  if (!assetUrl) {
    taskCache.set(upstreamTaskId, { vendor: vendorKey, request, raw: providerResponse, model, apiKey, projectId, nodeId, wantedKind });
    return { id: upstreamTaskId, kind, status: "queued", assets: [], raw: providerResponse };
  }
  const type: "image" | "video" = wantedKind === "video" ? "video" : "image";
  const asset: TaskResult["assets"][number] = projectId
    ? await localizeTaskAsset(projectId, assetUrl, type, nodeId)
    : { type, url: assetUrl, thumbnailUrl: type === "image" ? assetUrl : null };
  return { id: upstreamTaskId, kind, status: "succeeded", assets: [asset], raw: providerResponse };
}

export async function fetchTaskResult(payload: unknown): Promise<{ vendor: string; result: TaskResult }> {
  const raw = payload as JsonRecord;
  const taskId = trim(raw.taskId);
  const cached = taskCache.get(taskId);
  if (!cached) {
    return {
      vendor: trim(raw.vendor),
      result: {
        id: taskId,
        kind: (raw.taskKind as ProfileKind) || "text_to_image",
        status: "failed",
        assets: [],
        raw: { message: "Local task is not in the pending cache." },
      },
    };
  }
  const profile = requestProfileFromMapping(cached.mapping);
  const queryOperation = profile ? profileOperation(profile, "query") : null;
  if (profile && queryOperation && cached.model && cached.apiKey) {
    const { vendor, model, apiKey } = findExecutableModel(
      cached.vendor,
      cached.model.modelKey,
      cached.wantedKind,
    );
    const executed = await executeProfileOperation({
      vendor,
      model,
      apiKey: cached.apiKey || apiKey,
      request: cached.request,
      operation: queryOperation,
      providerMeta: {
        ...(cached.providerMeta || {}),
        query_id: cached.providerMeta?.query_id || taskId,
        task_id: cached.providerMeta?.task_id || taskId,
      },
    });
    const normalized = await buildProfileTaskResult({
      response: executed.response,
      profile,
      operation: queryOperation,
      request: cached.request,
      taskIdFallback: taskId,
      wantedKind: cached.wantedKind || model.kind,
      projectId: cached.projectId,
      nodeId: cached.nodeId,
    });
    if (normalized.result.status === "succeeded" || normalized.result.status === "failed") {
      taskCache.delete(taskId);
    } else {
      taskCache.set(taskId, {
        ...cached,
        raw: executed.response,
        providerMeta: {
          ...(cached.providerMeta || {}),
          ...normalized.providerMeta,
        },
      });
    }
    return { vendor: cached.vendor, result: normalized.result };
  }

  const assetUrl = extractAssetUrl(cached.raw);
  if (assetUrl) {
    const type: "image" | "video" = cached.wantedKind === "video" ? "video" : "image";
    const asset = cached.projectId
      ? await localizeTaskAsset(cached.projectId, assetUrl, type, cached.nodeId)
      : { type, url: assetUrl, thumbnailUrl: type === "image" ? assetUrl : null };
    taskCache.delete(taskId);
    return {
      vendor: cached.vendor,
      result: { id: taskId, kind: cached.request.kind, status: "succeeded", assets: [asset], raw: cached.raw },
    };
  }

  return {
    vendor: cached.vendor,
    result: {
      id: taskId,
      kind: cached.request.kind,
      status: "queued",
      assets: [],
      raw: cached.raw,
    },
  };
}

function chooseTextModel(): { vendor: Vendor; model: Model; apiKey: string } {
  const state = readCatalog();
  for (const model of state.models.filter((item) => item.kind === "text" && item.enabled)) {
    const vendor = state.vendors.find((item) => item.key === model.vendorKey && item.enabled);
    const apiKey = state.apiKeysByVendor[model.vendorKey]?.apiKey || "";
    if (vendor && (vendor.authType === "none" || apiKey)) return { vendor, model, apiKey };
  }
  throw new Error("No local text model is configured. Open model settings and add an API key.");
}

export async function runAgentChat(payload: unknown): Promise<unknown> {
  const raw = payload as JsonRecord;
  const { vendor, model, apiKey } = chooseTextModel();
  const systemPrompt = trim(raw.systemPrompt);
  const skillSystemPrompt = buildSkillSystemPrompt(raw);
  const messages = [
    ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
    ...(skillSystemPrompt ? [{ role: "system", content: skillSystemPrompt }] : []),
    { role: "user", content: trim(raw.prompt) || trim(raw.displayPrompt) },
  ];
  const response = await postJson(endpoint(vendor, "/v1/chat/completions"), apiKey, vendor, {
    model: model.modelAlias || model.modelKey,
    messages,
    temperature: typeof raw.temperature === "number" ? raw.temperature : 0.7,
  });
  const text = firstString(
    ((response as JsonRecord).choices as JsonRecord[] | undefined)?.[0]?.message && (((response as JsonRecord).choices as JsonRecord[])[0].message as JsonRecord).content,
    ((response as JsonRecord).choices as JsonRecord[] | undefined)?.[0]?.text,
    (response as JsonRecord).text,
  );
  return {
    id: `agent-${crypto.randomUUID()}`,
    text,
    raw: response,
    toolCalls: [],
    artifacts: [],
  };
}
