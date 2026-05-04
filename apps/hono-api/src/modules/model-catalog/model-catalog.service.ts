import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { isAdminRequest } from "../auth/admin-request";
import {
	BillingModelKindSchema,
	ModelCatalogIntegrationChannelKindSchema,
	ModelCatalogImageOptionsSchema,
	ModelCatalogHealthSchema,
	ModelCatalogImportResultSchema,
	ModelCatalogMappingTestResultSchema,
	ModelCatalogMappingSchema,
	ModelCatalogModelSchema,
	ModelCatalogVideoOptionsSchema,
	ModelCatalogVendorAuthTypeSchema,
	ModelCatalogVendorSchema,
	type ModelCatalogImportPackage,
	type ModelCatalogImportResult,
	type ModelCatalogHealth,
	type ModelCatalogHealthIssue,
	type ModelCatalogMappingTestResult,
	type ModelCatalogMappingDto,
	type ModelCatalogModelDto,
	type TestModelCatalogMappingInput,
	type ModelCatalogVendorDto,
} from "./model-catalog.schemas";
import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import { TaskKindSchema, type TaskRequestDto } from "../task/task.schemas";
import {
	buildMappedUpstreamRequest,
	parseMappedTaskResultFromPayload,
	type MappingStage,
} from "../task/task.mappings";
import {
	deleteCatalogMappingRow,
	deleteCatalogModelRow,
	deleteCatalogVendorApiKeyRow,
	deleteCatalogVendorCascade,
	getCatalogMappingById,
	getCatalogModelByVendorAndKey,
	listCatalogModelsByModelKey,
	getCatalogModelByVendorKindAndAlias,
	getCatalogVendorApiKeyByVendorKey,
	getCatalogVendorByKey,
	listCatalogMappings,
	listCatalogModels,
	listCatalogVendorApiKeys,
	listCatalogVendors,
	upsertCatalogVendorApiKeyRow,
	upsertCatalogMappingRow,
	upsertCatalogModelRow,
	upsertCatalogVendorRow,
	type ModelCatalogMappingRow,
	type ModelCatalogModelRow,
	type ModelCatalogVendorApiKeyRow,
	type ModelCatalogVendorRow,
} from "./model-catalog.repo";

type UnknownRecord = Record<string, unknown>;

function requireAdmin(c: AppContext): void {
	if (!isAdminRequest(c)) {
		throw new AppError("Forbidden", { status: 403, code: "forbidden" });
	}
}

function safeJsonParse(value: string | null): unknown | undefined {
	if (!value) return undefined;
	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
}

async function safeReadResponsePayload(response: Response): Promise<unknown> {
	const text = await response.text().catch(() => "");
	const trimmed = text.trim();
	if (!trimmed) return null;
	const contentType = response.headers.get("content-type") || "";
	if (
		contentType.toLowerCase().includes("application/json") ||
		trimmed.startsWith("{") ||
		trimmed.startsWith("[")
	) {
		try {
			return JSON.parse(trimmed) as unknown;
		} catch {
			return trimmed;
		}
	}
	return trimmed;
}

function normalizeKey(value: string): string {
	return String(value || "").trim().toLowerCase();
}

function normalizeOptionalString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequestProfileV2Like(value: unknown): value is UnknownRecord {
	if (!isRecord(value)) return false;
	if (String(value.version || "").trim() !== "v2") return false;
	return isRecord(value.create) || isRecord(value.query) || isRecord(value.result);
}

export function normalizeModelCatalogVendorMeta(meta: unknown): unknown {
	if (typeof meta === "undefined") return undefined;
	if (!isRecord(meta)) return meta;

	const integrationDraft = meta.integrationDraft;
	if (typeof integrationDraft === "undefined") return meta;
	if (!isRecord(integrationDraft)) {
		throw new AppError("invalid vendor meta", {
			status: 400,
			code: "invalid_vendor_meta",
			details: {
				reason: "meta.integrationDraft must be an object",
			},
		});
	}

	const channelKind = integrationDraft.channelKind;
	if (typeof channelKind !== "undefined") {
		const parsed = ModelCatalogIntegrationChannelKindSchema.safeParse(channelKind);
		if (!parsed.success) {
			throw new AppError("invalid vendor meta", {
				status: 400,
				code: "invalid_vendor_meta",
				details: {
					reason: "meta.integrationDraft.channelKind is invalid",
					channelKind,
				},
			});
		}
	}

	return meta;
}

function validateModelCatalogModelMeta(
	meta: unknown,
	input: { modelKey: string },
): unknown {
	if (typeof meta === "undefined") return undefined;
	if (!isRecord(meta)) return meta;

	const normalizedMeta: UnknownRecord = { ...meta };

	const videoOptionsValue = (() => {
		if ("videoOptions" in meta) return meta.videoOptions;
		return undefined;
	})();
	if (typeof videoOptionsValue !== "undefined") {
		if (!isRecord(videoOptionsValue)) {
			throw new AppError("invalid model meta", {
				status: 400,
				code: "invalid_model_meta",
				details: {
					modelKey: input.modelKey,
					reason: "meta.videoOptions must be an object",
				},
			});
		}

		const parsed = ModelCatalogVideoOptionsSchema.safeParse(videoOptionsValue);
		if (!parsed.success) {
			throw new AppError("invalid model meta", {
				status: 400,
				code: "invalid_model_meta",
				details: {
					modelKey: input.modelKey,
					reason: parsed.error.flatten(),
				},
			});
		}

		normalizedMeta.videoOptions = parsed.data;
	}

	const imageOptionsValue = (() => {
		if ("imageOptions" in meta) return meta.imageOptions;
		return undefined;
	})();
	if (typeof imageOptionsValue !== "undefined") {
		if (!isRecord(imageOptionsValue)) {
			throw new AppError("invalid model meta", {
				status: 400,
				code: "invalid_model_meta",
				details: {
					modelKey: input.modelKey,
					reason: "meta.imageOptions must be an object",
				},
			});
		}

		const parsed = ModelCatalogImageOptionsSchema.safeParse(imageOptionsValue);
		if (!parsed.success) {
			throw new AppError("invalid model meta", {
				status: 400,
				code: "invalid_model_meta",
				details: {
					modelKey: input.modelKey,
					reason: parsed.error.flatten(),
				},
			});
		}

		normalizedMeta.imageOptions = parsed.data;
	}

	if ("useCases" in meta) {
		const useCasesRaw = meta.useCases;
		if (!Array.isArray(useCasesRaw)) {
			throw new AppError("invalid model meta", {
				status: 400,
				code: "invalid_model_meta",
				details: {
					modelKey: input.modelKey,
					reason: "meta.useCases must be an array of strings",
				},
			});
		}
		const useCases = useCasesRaw
			.map((value) => (typeof value === "string" ? value.trim() : ""))
			.filter(Boolean);
		normalizedMeta.useCases = useCases;
	}

	return normalizedMeta;
}

function mapVendor(row: any): ModelCatalogVendorDto {
	const authTypeRaw = typeof row?.auth_type === "string" ? row.auth_type : null;
	const authType = (() => {
		const parsed = ModelCatalogVendorAuthTypeSchema.safeParse(authTypeRaw);
		return parsed.success ? parsed.data : "bearer";
	})();

	return ModelCatalogVendorSchema.parse({
		key: row.key,
		name: row.name,
		enabled: Number(row.enabled ?? 1) !== 0,
		hasApiKey:
			typeof row.hasApiKey === "boolean"
				? row.hasApiKey
				: typeof row.has_api_key === "number"
					? row.has_api_key !== 0
					: undefined,
		baseUrlHint: row.base_url_hint ?? null,
		authType,
		authHeader: row.auth_header ?? null,
		authQueryParam: row.auth_query_param ?? null,
		meta: safeJsonParse(row.meta ?? null),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

function mapModel(row: any): ModelCatalogModelDto {
	const modelKey = String(row.model_key || "").trim();
	const kind = String(row.kind || "").trim();

	return ModelCatalogModelSchema.parse({
		modelKey,
		vendorKey: row.vendor_key,
		modelAlias: normalizeOptionalString(row.model_alias ?? null),
		labelZh: row.label_zh,
		kind,
		enabled: Number(row.enabled ?? 1) !== 0,
		meta: safeJsonParse(row.meta ?? null),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

function mapMapping(row: any): ModelCatalogMappingDto {
	return ModelCatalogMappingSchema.parse({
		id: row.id,
		vendorKey: row.vendor_key,
		taskKind: row.task_kind,
		name: row.name,
		enabled: Number(row.enabled ?? 1) !== 0,
		requestMapping: safeJsonParse(row.request_mapping ?? null),
		responseMapping: safeJsonParse(row.response_mapping ?? null),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

const TASK_KIND_BY_MODEL_KIND = {
	text: new Set(["chat", "prompt_refine"]),
	image: new Set(["text_to_image", "image_edit"]),
	video: new Set(["text_to_video", "image_to_video"]),
} as const;

type HealthKind = keyof typeof TASK_KIND_BY_MODEL_KIND;

function healthIssue(input: ModelCatalogHealthIssue): ModelCatalogHealthIssue {
	return input;
}

export function buildModelCatalogHealthFromRows(input: {
	vendors: readonly ModelCatalogVendorRow[];
	models: readonly ModelCatalogModelRow[];
	mappings: readonly ModelCatalogMappingRow[];
	apiKeys: readonly ModelCatalogVendorApiKeyRow[];
}): ModelCatalogHealth {
	const { vendors, models, mappings, apiKeys } = input;
	const enabledVendorKeys = new Set(
		vendors
			.filter((vendor) => Number(vendor.enabled ?? 1) !== 0)
			.map((vendor) => String(vendor.key || "").trim().toLowerCase())
			.filter(Boolean),
	);
	const enabledApiKeyVendorKeys = new Set(
		apiKeys
			.filter((apiKey) => Number(apiKey.enabled ?? 1) !== 0 && String(apiKey.api_key || "").trim())
			.map((apiKey) => String(apiKey.vendor_key || "").trim().toLowerCase())
			.filter(Boolean),
	);
	const enabledMappingsByVendor = new Map<string, Set<string>>();
	for (const mapping of mappings) {
		if (Number(mapping.enabled ?? 1) === 0) continue;
		const vendorKey = String(mapping.vendor_key || "").trim().toLowerCase();
		const taskKind = String(mapping.task_kind || "").trim();
		if (!vendorKey || !taskKind) continue;
		const existing = enabledMappingsByVendor.get(vendorKey) || new Set<string>();
		existing.add(taskKind);
		enabledMappingsByVendor.set(vendorKey, existing);
	}
	const issues: ModelCatalogHealthIssue[] = [];
	if (vendors.length === 0 && models.length === 0 && mappings.length === 0) {
		issues.push(healthIssue({
			code: "catalog_empty",
			severity: "error",
			message: "模型目录为空：尚未导入任何厂商、模型或执行映射。",
		}));
	}
	const byKind = (Object.keys(TASK_KIND_BY_MODEL_KIND) as HealthKind[]).map((kind) => {
		const enabledModels = models.filter((model) =>
			String(model.kind || "").trim() === kind &&
			Number(model.enabled ?? 1) !== 0 &&
			enabledVendorKeys.has(String(model.vendor_key || "").trim().toLowerCase()),
		);
		let executableModels = 0;
		for (const model of enabledModels) {
			const vendorKey = String(model.vendor_key || "").trim().toLowerCase();
			const vendorMappings = enabledMappingsByVendor.get(vendorKey) || new Set<string>();
			const requiredTaskKinds = TASK_KIND_BY_MODEL_KIND[kind];
			const hasMapping = Array.from(requiredTaskKinds).some((taskKind) => vendorMappings.has(taskKind));
			if (!enabledApiKeyVendorKeys.has(vendorKey)) {
				issues.push(healthIssue({
					code: "vendor_api_key_missing",
					severity: "warning",
					message: `厂商 ${vendorKey} 缺少启用的 API Key。`,
					vendorKey,
				}));
			}
			if (!hasMapping) {
				issues.push(healthIssue({
					code: "model_mapping_missing",
					severity: "error",
					message: `模型 ${model.model_key} 缺少 ${kind} 可执行映射。`,
					vendorKey,
					modelKey: model.model_key,
					kind,
				}));
				continue;
			}
			executableModels += 1;
		}
		return {
			kind,
			enabledModels: enabledModels.length,
			executableModels,
		};
	});
	for (const model of models) {
		const vendorKey = String(model.vendor_key || "").trim().toLowerCase();
		if (Number(model.enabled ?? 1) !== 0 && vendorKey && !enabledVendorKeys.has(vendorKey)) {
			issues.push(healthIssue({
				code: "vendor_disabled",
				severity: "error",
				message: `模型 ${model.model_key} 所属厂商 ${vendorKey} 未启用。`,
				vendorKey,
				modelKey: model.model_key,
			}));
		}
	}
	const dedupedIssues = Array.from(
		new Map(issues.map((issue) => [
			`${issue.code}:${issue.vendorKey || ""}:${issue.modelKey || ""}:${issue.kind || ""}`,
			issue,
		])).values(),
	);
	return ModelCatalogHealthSchema.parse({
		ok: dedupedIssues.every((issue) => issue.severity !== "error"),
		counts: {
			vendors: vendors.length,
			enabledVendors: vendors.filter((vendor) => Number(vendor.enabled ?? 1) !== 0).length,
			models: models.length,
			enabledModels: models.filter((model) => Number(model.enabled ?? 1) !== 0).length,
			mappings: mappings.length,
			enabledMappings: mappings.filter((mapping) => Number(mapping.enabled ?? 1) !== 0).length,
			enabledApiKeys: enabledApiKeyVendorKeys.size,
		},
		byKind,
		issues: dedupedIssues,
	});
}

export async function getModelCatalogHealth(c: AppContext): Promise<ModelCatalogHealth> {
	const [vendors, models, mappings, apiKeys] = await Promise.all([
		listCatalogVendors(c.env.DB),
		listCatalogModels(c.env.DB),
		listCatalogMappings(c.env.DB),
		listCatalogVendorApiKeys(c.env.DB),
	]);
	return buildModelCatalogHealthFromRows({ vendors, models, mappings, apiKeys });
}

export async function listModelCatalogVendors(
	c: AppContext,
): Promise<ModelCatalogVendorDto[]> {
	const rows = await listCatalogVendors(c.env.DB);
	let keyRows: Array<{ vendor_key: string; enabled: number }> = [];
	try {
		keyRows = await listCatalogVendorApiKeys(c.env.DB);
	} catch {
		keyRows = [];
	}
	const enabledKeySet = new Set(
		(keyRows || [])
			.filter((r: any) => (r?.enabled ?? 1) !== 0 && typeof r?.vendor_key === "string")
			.map((r: any) => String(r.vendor_key).trim().toLowerCase())
			.filter(Boolean),
	);
	return rows.map((r) =>
		mapVendor({
			...r,
			hasApiKey: enabledKeySet.has(String(r.key || "").trim().toLowerCase()),
		}),
	);
}

export async function upsertModelCatalogVendor(
	c: AppContext,
	input: {
		key: string;
		name: string;
		enabled?: boolean;
		baseUrlHint?: string | null;
		authType?: string;
		authHeader?: string | null;
		authQueryParam?: string | null;
		meta?: unknown;
	},
): Promise<ModelCatalogVendorDto> {
	requireAdmin(c);
	const nowIso = new Date().toISOString();
	const key = normalizeKey(input.key);
	const name = String(input.name || "").trim();
	const enabled = typeof input.enabled === "boolean" ? input.enabled : true;
	const meta = normalizeModelCatalogVendorMeta(input.meta);

	const authType = (() => {
		const parsed = ModelCatalogVendorAuthTypeSchema.safeParse(input.authType);
		return parsed.success ? parsed.data : "bearer";
	})();

	const row = await upsertCatalogVendorRow(
		c.env.DB,
		{
			key,
			name,
			enabled,
			baseUrlHint: normalizeOptionalString(input.baseUrlHint ?? null),
			authType,
			authHeader: normalizeOptionalString(input.authHeader ?? null),
			authQueryParam: normalizeOptionalString(input.authQueryParam ?? null),
			meta:
				typeof meta === "undefined"
					? null
					: JSON.stringify(meta),
		},
		nowIso,
	);
	return mapVendor(row);
}

export async function deleteModelCatalogVendor(
	c: AppContext,
	key: string,
): Promise<void> {
	requireAdmin(c);
	const k = normalizeKey(key);
	if (!k) return;
	try {
		await deleteCatalogVendorCascade(c.env.DB, k);
	} catch (err: any) {
		throw new AppError("delete vendor failed", {
			status: 500,
			code: "delete_failed",
			details: { message: err?.message ?? String(err) },
		});
	}
}

export async function listModelCatalogModels(
	c: AppContext,
	filter?: { vendorKey?: string; kind?: string; enabled?: boolean },
): Promise<ModelCatalogModelDto[]> {
	const rows = await listCatalogModels(c.env.DB, {
		vendorKey: filter?.vendorKey ? normalizeKey(filter.vendorKey) : undefined,
		kind: filter?.kind ? String(filter.kind).trim() : undefined,
		enabled: filter?.enabled,
	});
	return rows.map((row) => mapModel(row));
}

export async function upsertModelCatalogModel(
	c: AppContext,
	input: {
		modelKey: string;
		vendorKey: string;
		modelAlias?: string | null;
		labelZh: string;
		kind: string;
		enabled?: boolean;
		meta?: unknown;
		pricing?: unknown;
	},
): Promise<ModelCatalogModelDto> {
	requireAdmin(c);
	const nowIso = new Date().toISOString();
	const modelKey = String(input.modelKey || "").trim();
	const vendorKey = normalizeKey(input.vendorKey);
	const modelAlias = normalizeOptionalString(input.modelAlias ?? null) || modelKey;
	const labelZh = String(input.labelZh || "").trim();
	const kind = String(input.kind || "").trim();
	const enabled = typeof input.enabled === "boolean" ? input.enabled : true;
	const meta = validateModelCatalogModelMeta(input.meta, { modelKey });

	const vendor = await getCatalogVendorByKey(c.env.DB, vendorKey);
	if (!vendor) {
		throw new AppError("vendor not found", {
			status: 400,
			code: "vendor_not_found",
			details: { vendorKey },
		});
	}

	const existing = await getCatalogModelByVendorKindAndAlias(c.env.DB, {
		vendorKey,
		kind,
		modelAlias,
	});
	const existingKey =
		typeof (existing as any)?.model_key === "string"
			? (existing as any).model_key.trim()
			: "";
	if (existing && existingKey && existingKey !== modelKey) {
		throw new AppError("modelAlias already exists for this vendor/kind", {
			status: 400,
			code: "model_alias_conflict",
			details: { vendorKey, kind, modelAlias, modelKey, existingModelKey: existingKey },
		});
	}

	const row = await upsertCatalogModelRow(
		c.env.DB,
		{
			modelKey,
			vendorKey,
			modelAlias,
			labelZh,
			kind,
			enabled,
			meta:
				typeof meta === "undefined"
					? null
					: JSON.stringify(meta),
		},
		nowIso,
	);

	return mapModel(row);
}

export async function deleteModelCatalogModel(
	c: AppContext,
	input: { modelKey: string; vendorKey?: string | null },
): Promise<void> {
	requireAdmin(c);
	const mk = String(input.modelKey || "").trim();
	if (!mk) return;
	const vendorKey = typeof input.vendorKey === "string" ? normalizeKey(input.vendorKey) : "";
	if (vendorKey) {
		await deleteCatalogModelRow(c.env.DB, { vendorKey, modelKey: mk });
		return;
	}

	const candidates = await listCatalogModelsByModelKey(c.env.DB, mk);
	if (!candidates.length) return;
	if (candidates.length > 1) {
		throw new AppError("vendorKey is required for non-unique modelKey", {
			status: 400,
			code: "vendor_required",
			details: {
				modelKey: mk,
				vendors: candidates
					.map((c: any) =>
						typeof c?.vendor_key === "string" ? c.vendor_key.trim() : "",
					)
					.filter(Boolean),
			},
		});
	}
	const onlyVendorKey =
		typeof candidates[0]?.vendor_key === "string"
			? candidates[0].vendor_key.trim()
			: "";
	if (!onlyVendorKey) return;
	await deleteCatalogModelRow(c.env.DB, { vendorKey: onlyVendorKey, modelKey: mk });
}

export async function listModelCatalogMappings(
	c: AppContext,
	filter?: { vendorKey?: string; taskKind?: string; enabled?: boolean },
): Promise<ModelCatalogMappingDto[]> {
	const rows = await listCatalogMappings(c.env.DB, {
		vendorKey: filter?.vendorKey ? normalizeKey(filter.vendorKey) : undefined,
		taskKind: filter?.taskKind ? String(filter.taskKind).trim() : undefined,
		enabled: filter?.enabled,
	});
	return rows.map(mapMapping);
}

export async function exportModelCatalogPackage(
	c: AppContext,
	options?: { includeApiKeys?: boolean },
): Promise<ModelCatalogImportPackage> {
	requireAdmin(c);
	const nowIso = new Date().toISOString();
	const includeApiKeys = options?.includeApiKeys === true;

	const [vendorRows, modelRows, mappingRows, apiKeyRows] =
		await Promise.all([
			listCatalogVendors(c.env.DB),
			listCatalogModels(c.env.DB),
			listCatalogMappings(c.env.DB),
			includeApiKeys ? listCatalogVendorApiKeys(c.env.DB) : Promise.resolve([]),
		]);
	if (!vendorRows.length) {
		throw new AppError("No vendors to export", {
			status: 400,
			code: "empty_export",
		});
	}

	const modelsByVendor = (modelRows || []).reduce<Record<string, any[]>>(
		(acc, row) => {
			const vendorKey = normalizeKey(row.vendor_key);
			if (!vendorKey) return acc;
			(acc[vendorKey] ||= []).push(row);
			return acc;
		},
		{},
	);

	const mappingsByVendor = (mappingRows || []).reduce<Record<string, any[]>>(
		(acc, row) => {
			const vendorKey = normalizeKey(row.vendor_key);
			if (!vendorKey) return acc;
			(acc[vendorKey] ||= []).push(row);
			return acc;
		},
		{},
	);

	const apiKeyByVendor = (apiKeyRows || []).reduce<
		Record<string, { apiKey: string; enabled: boolean }>
	>((acc, row: any) => {
		const vendorKey = normalizeKey(row.vendor_key);
		if (!vendorKey) return acc;
		const apiKey = typeof row.api_key === "string" ? row.api_key.trim() : "";
		if (!apiKey) return acc;
		acc[vendorKey] = {
			apiKey,
			enabled: Number(row.enabled ?? 1) !== 0,
		};
		return acc;
	}, {});

	const vendors = vendorRows.map((row) => {
		const vendorKey = normalizeKey(row.key);
		const authTypeRaw = typeof row.auth_type === "string" ? row.auth_type : null;
		const authType = (() => {
			const parsed = ModelCatalogVendorAuthTypeSchema.safeParse(authTypeRaw);
			return parsed.success ? parsed.data : "bearer";
		})();

		const keyBundle = includeApiKeys ? apiKeyByVendor[vendorKey] : undefined;
		const bundleModels = (modelsByVendor[vendorKey] || []).flatMap((m) => {
			const parsedKind = BillingModelKindSchema.safeParse(String(m.kind || "").trim());
			if (!parsedKind.success) return [];
			return [{
				modelKey: String(m.model_key || "").trim(),
				vendorKey,
				modelAlias: normalizeOptionalString((m as any).model_alias ?? null),
				labelZh: String(m.label_zh || "").trim(),
				kind: parsedKind.data,
				enabled: Number(m.enabled ?? 1) !== 0,
				meta: safeJsonParse(m.meta ?? null),
			}];
		});

		const bundleMappings = (mappingsByVendor[vendorKey] || []).flatMap((mp) => {
			const parsedTaskKind = TaskKindSchema.safeParse(String(mp.task_kind || "").trim());
			if (!parsedTaskKind.success) return [];
			const requestMapping = safeJsonParse(mp.request_mapping ?? null);
			const responseMapping = safeJsonParse(mp.response_mapping ?? null);
			const requestProfile =
				isRequestProfileV2Like(requestMapping) &&
				isRequestProfileV2Like(responseMapping)
					? requestMapping
					: isRequestProfileV2Like(requestMapping)
						? requestMapping
						: null;
			return [{
				taskKind: parsedTaskKind.data,
				name: String(mp.name || "").trim(),
				enabled: Number(mp.enabled ?? 1) !== 0,
				...(requestProfile ? { requestProfile } : {}),
				...(requestProfile ? {} : { requestMapping }),
				...(requestProfile ? {} : { responseMapping }),
			}];
		});

		return {
			vendor: {
				key: vendorKey,
				name: String(row.name || "").trim(),
				enabled: Number(row.enabled ?? 1) !== 0,
				baseUrlHint: row.base_url_hint ?? null,
				authType,
				authHeader: row.auth_header ?? null,
				authQueryParam: row.auth_query_param ?? null,
				meta: safeJsonParse(row.meta ?? null),
			},
			...(keyBundle ? { apiKey: { ...keyBundle } } : {}),
			models: bundleModels,
			mappings: bundleMappings,
		};
	});

	return {
		version: "v2",
		exportedAt: nowIso,
		vendors,
	};
}

export async function upsertModelCatalogMapping(
	c: AppContext,
	input: {
		id?: string;
		vendorKey: string;
		taskKind: string;
		name: string;
		enabled?: boolean;
		requestMapping?: unknown;
		responseMapping?: unknown;
	},
): Promise<ModelCatalogMappingDto> {
	requireAdmin(c);
	const nowIso = new Date().toISOString();
	const vendorKey = normalizeKey(input.vendorKey);
	const taskKind = String(input.taskKind || "").trim();
	const name = String(input.name || "").trim();
	const enabled = typeof input.enabled === "boolean" ? input.enabled : true;

	const vendor = await getCatalogVendorByKey(c.env.DB, vendorKey);
	if (!vendor) {
		throw new AppError("vendor not found", {
			status: 400,
			code: "vendor_not_found",
			details: { vendorKey },
		});
	}

	const row = await upsertCatalogMappingRow(
		c.env.DB,
		{
			id: input.id,
			vendorKey,
			taskKind,
			name,
			enabled,
			requestMapping:
				typeof input.requestMapping === "undefined"
					? null
					: JSON.stringify(input.requestMapping),
			responseMapping:
				typeof input.responseMapping === "undefined"
					? null
					: JSON.stringify(input.responseMapping),
		},
		nowIso,
	);
	return mapMapping(row);
}

export async function deleteModelCatalogMapping(
	c: AppContext,
	id: string,
): Promise<void> {
	requireAdmin(c);
	const rowId = String(id || "").trim();
	if (!rowId) return;
	await deleteCatalogMappingRow(c.env.DB, rowId);
}

export async function testModelCatalogMapping(
	c: AppContext,
	mappingId: string,
	input: TestModelCatalogMappingInput,
): Promise<ModelCatalogMappingTestResult> {
	requireAdmin(c);
	const id = String(mappingId || "").trim();
	if (!id) {
		throw new AppError("mappingId is required", {
			status: 400,
			code: "invalid_request",
		});
	}

	const row = await getCatalogMappingById(c.env.DB, id);
	if (!row) {
		throw new AppError("mapping not found", {
			status: 404,
			code: "mapping_not_found",
			details: { mappingId: id },
		});
	}
	const vendorKey = normalizeKey(row.vendor_key);
	const vendor = await getCatalogVendorByKey(c.env.DB, vendorKey);
	if (!vendor) {
		throw new AppError("vendor not found", {
			status: 400,
			code: "vendor_not_found",
			details: { vendorKey },
		});
	}
	const model = await getCatalogModelByVendorAndKey(c.env.DB, {
		vendorKey,
		modelKey: input.modelKey,
	});
	if (!model) {
		throw new AppError("model not found for mapping vendor", {
			status: 400,
			code: "model_not_found",
			details: { vendorKey, modelKey: input.modelKey },
		});
	}

	const baseUrl = normalizeOptionalString(vendor.base_url_hint);
	if (!baseUrl) {
		throw new AppError("vendor.baseUrlHint is required before testing mapping", {
			status: 400,
			code: "vendor_base_url_missing",
			details: { vendorKey },
		});
	}

	const requestMapping = safeJsonParse(row.request_mapping ?? null);
	const responseMapping = safeJsonParse(row.response_mapping ?? null);
	if (!isRequestProfileV2Like(requestMapping)) {
		throw new AppError("mapping requestProfile v2 is required before testing", {
			status: 400,
			code: "mapping_request_profile_missing",
			details: { mappingId: id },
		});
	}

	const keyRow = await getCatalogVendorApiKeyByVendorKey(c.env.DB, vendorKey);
	const apiKey = typeof keyRow?.api_key === "string" ? keyRow.api_key.trim() : "";
	if (input.execute && !apiKey && vendor.auth_type !== "none") {
		throw new AppError("vendor api key is required for execute test", {
			status: 400,
			code: "vendor_api_key_missing",
			details: { vendorKey },
		});
	}

	const stage: MappingStage = input.stage === "result" ? "result" : "create";
	const extras =
		input.extras && typeof input.extras === "object" && !Array.isArray(input.extras)
			? input.extras
			: {};
	const req: TaskRequestDto = {
		kind: row.task_kind as TaskRequestDto["kind"],
		prompt: input.prompt,
		extras: {
			...extras,
			modelKey: input.modelKey,
		},
	};
	const diagnostics: string[] = [];
	if (!row.enabled) diagnostics.push("mapping 当前未启用；本次仅用于验证契约。");
	if (isRecord(requestMapping) && isRecord(requestMapping.draftSource)) {
		const requiresAdapterReview = requestMapping.draftSource.requiresAdapterReview;
		if (requiresAdapterReview === true) {
			diagnostics.push("requestProfile 标记 requiresAdapterReview=true，执行前需要人工复核。");
		}
	}

	const upstream = await buildMappedUpstreamRequest({
		c,
		baseUrl,
		apiKey: apiKey || "__TEST_API_KEY__",
		auth: {
			authType: ModelCatalogVendorAuthTypeSchema.parse(vendor.auth_type || "bearer"),
			authHeader: normalizeOptionalString(vendor.auth_header ?? null),
			authQueryParam: normalizeOptionalString(vendor.auth_query_param ?? null),
		},
		stage,
		requestMapping,
		req,
		taskId: input.taskId || null,
		dryRun: !input.execute,
	});

	let responsePayload: unknown = typeof input.upstreamResponse === "undefined"
		? undefined
		: input.upstreamResponse;
	if (input.execute) {
		const response = await fetchWithHttpDebugLog(
			c,
			upstream.url,
			upstream.init,
			{ tag: "model-catalog:mapping-test" },
		);
		responsePayload = await safeReadResponsePayload(response);
		if (!response.ok) {
			diagnostics.push(`上游 HTTP 状态码 ${response.status}`);
		}
	}

	const parsedResult =
		typeof responsePayload === "undefined"
			? undefined
			: parseMappedTaskResultFromPayload({
				vendorKey,
				model: input.modelKey,
				stage,
				reqKind: req.kind,
				payload: responsePayload,
				responseMapping: responseMapping ?? requestMapping,
				fallbackTaskId: input.taskId || null,
				selectedStageMapping: upstream.selectedStageMapping,
			});

	return ModelCatalogMappingTestResultSchema.parse({
		mappingId: id,
		vendorKey,
		taskKind: row.task_kind,
		stage,
		executed: input.execute === true,
		ok: diagnostics.length === 0,
		diagnostics,
		request: upstream.requestLog,
		...(typeof responsePayload === "undefined" ? {} : { response: responsePayload }),
		...(typeof parsedResult === "undefined" ? {} : { parsedResult }),
	});
}

export async function importModelCatalogPackage(
	c: AppContext,
	pkg: ModelCatalogImportPackage,
): Promise<ModelCatalogImportResult> {
	requireAdmin(c);
	const nowIso = new Date().toISOString();

	const result: ModelCatalogImportResult = {
		imported: { vendors: 0, models: 0, mappings: 0 },
		errors: [],
	};

	for (const bundle of pkg.vendors) {
		try {
			const vendorKey = normalizeKey(bundle.vendor.key);
			const vendorMeta = normalizeModelCatalogVendorMeta(bundle.vendor.meta);
			const vendorRow = await upsertCatalogVendorRow(
				c.env.DB,
				{
					key: vendorKey,
					name: bundle.vendor.name.trim(),
					enabled:
						typeof bundle.vendor.enabled === "boolean"
							? bundle.vendor.enabled
							: true,
					baseUrlHint: normalizeOptionalString(bundle.vendor.baseUrlHint ?? null),
					authType:
						typeof bundle.vendor.authType === "string" &&
						ModelCatalogVendorAuthTypeSchema.safeParse(bundle.vendor.authType)
							.success
							? bundle.vendor.authType
							: "bearer",
					authHeader: normalizeOptionalString(bundle.vendor.authHeader ?? null),
					authQueryParam: normalizeOptionalString(bundle.vendor.authQueryParam ?? null),
					meta:
						typeof vendorMeta === "undefined"
							? null
							: JSON.stringify(vendorMeta),
				},
				nowIso,
			);
			if (vendorRow) result.imported.vendors += 1;

			if (bundle.apiKey?.apiKey) {
				try {
					await upsertCatalogVendorApiKeyRow(
						c.env.DB,
						{
							vendorKey,
							apiKey: String(bundle.apiKey.apiKey || "").trim(),
							enabled:
								typeof bundle.apiKey.enabled === "boolean"
									? bundle.apiKey.enabled
									: true,
						},
						nowIso,
					);
				} catch (err: any) {
					result.errors.push(
						`Failed to import vendor api key "${vendorKey}": ${err?.message ?? String(err)}`,
					);
				}
			}

			for (const m of bundle.models || []) {
				try {
					const modelVendorKey = normalizeKey(
						(typeof (m as any)?.vendorKey === "string" &&
							(m as any).vendorKey) ||
							vendorKey,
					);
					const modelKey = String(m.modelKey || "").trim();
					const modelAlias =
						normalizeOptionalString((m as any).modelAlias ?? null) || modelKey;
					const meta = validateModelCatalogModelMeta(m.meta, { modelKey });
					await upsertCatalogModelRow(
						c.env.DB,
						{
							modelKey,
							vendorKey: modelVendorKey,
							modelAlias,
							labelZh: String(m.labelZh || "").trim(),
							kind: String(m.kind || "").trim(),
							enabled: typeof m.enabled === "boolean" ? m.enabled : true,
							meta: typeof meta === "undefined" ? null : JSON.stringify(meta),
						},
						nowIso,
					);
					result.imported.models += 1;
				} catch (err: any) {
					result.errors.push(
						`Failed to import model "${m.modelKey}": ${err?.message ?? String(err)}`,
					);
				}
			}

			for (const mapping of bundle.mappings || []) {
				try {
					const requestProfile =
						typeof mapping.requestProfile === "undefined"
							? undefined
							: mapping.requestProfile;
					const requestMapping =
						typeof requestProfile === "undefined"
							? mapping.requestMapping
							: requestProfile;
					const responseMapping =
						typeof requestProfile === "undefined"
							? mapping.responseMapping
							: requestProfile;
					await upsertCatalogMappingRow(
						c.env.DB,
						{
							vendorKey,
							taskKind: String(mapping.taskKind || "").trim(),
							name: String(mapping.name || "").trim(),
							enabled:
								typeof mapping.enabled === "boolean" ? mapping.enabled : true,
							requestMapping:
								typeof requestMapping === "undefined"
									? null
									: JSON.stringify(requestMapping),
							responseMapping:
								typeof responseMapping === "undefined"
									? null
									: JSON.stringify(responseMapping),
						},
						nowIso,
					);
					result.imported.mappings += 1;
				} catch (err: any) {
					result.errors.push(
						`Failed to import mapping "${vendorKey}:${mapping.taskKind}:${mapping.name}": ${err?.message ?? String(err)}`,
					);
				}
			}
		} catch (err: any) {
			result.errors.push(
				`Failed to import vendor "${bundle.vendor.key}": ${err?.message ?? String(err)}`,
			);
		}
	}

	return ModelCatalogImportResultSchema.parse(result);
}

export async function upsertModelCatalogVendorApiKey(
	c: AppContext,
	input: { vendorKey: string; apiKey: string; enabled?: boolean },
) {
	requireAdmin(c);
	const nowIso = new Date().toISOString();
	const vendorKey = normalizeKey(input.vendorKey);
	const apiKey = String(input.apiKey || "").trim();
	if (!vendorKey) {
		throw new AppError("vendorKey is required", {
			status: 400,
			code: "invalid_request",
		});
	}
	if (!apiKey) {
		throw new AppError("apiKey is required", {
			status: 400,
			code: "invalid_request",
		});
	}
	const vendor = await getCatalogVendorByKey(c.env.DB, vendorKey);
	if (!vendor) {
		throw new AppError("vendor not found", {
			status: 404,
			code: "vendor_not_found",
		});
	}
	const row = await upsertCatalogVendorApiKeyRow(
		c.env.DB,
		{
			vendorKey,
			apiKey,
			enabled: typeof input.enabled === "boolean" ? input.enabled : true,
		},
		nowIso,
	);
	return {
		vendorKey,
		hasApiKey: true,
		enabled: Number(row.enabled ?? 1) !== 0,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export async function clearModelCatalogVendorApiKey(
	c: AppContext,
	vendorKey: string,
) {
	requireAdmin(c);
	const key = normalizeKey(vendorKey);
	if (!key) return { vendorKey: key, hasApiKey: false };
	try {
		const existing = await getCatalogVendorApiKeyByVendorKey(c.env.DB, key);
		if (!existing) {
			return { vendorKey: key, hasApiKey: false };
		}
		await deleteCatalogVendorApiKeyRow(c.env.DB, key);
		return { vendorKey: key, hasApiKey: false };
	} catch {
		return { vendorKey: key, hasApiKey: false };
	}
}
