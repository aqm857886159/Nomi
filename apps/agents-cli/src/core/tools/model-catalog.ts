import type { ToolHandler } from "./registry.js";

function readStr(env: unknown, key: string): string {
  if (!env || typeof env !== "object") return "";
  const v = (env as Record<string, unknown>)[key];
  return typeof v === "string" ? v.trim() : "";
}

function getBaseUrl(ctx: { meta?: Record<string, unknown> }): string {
  return readStr(ctx.meta, "apiBaseUrl") || readStr(process.env, "TAPCANVAS_API_BASE_URL") || "http://localhost:8788";
}

function getAuthHeader(ctx: { meta?: Record<string, unknown> }): string {
  const token = readStr(ctx.meta, "authToken") || readStr(process.env, "TAPCANVAS_API_KEY") || "";
  return token ? `Bearer ${token}` : "";
}

async function catalogFetch(
  ctx: { meta?: Record<string, unknown> },
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const url = `${getBaseUrl(ctx)}${path}`;
  const auth = getAuthHeader(ctx);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) headers["Authorization"] = auth;
  const res = await fetch(url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text, status: res.status }; }
}

export const modelCatalogFetchDocsTool: ToolHandler = {
  definition: {
    name: "model_catalog_fetch_docs",
    description: "抓取供应商 API 文档页面内容，用于分析 API 结构、endpoint、请求/响应格式。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "文档页面 URL" },
      },
      required: ["url"],
    },
  },
  async execute(args, ctx, toolCallId) {
    try {
      const result = await catalogFetch(ctx, "POST", "/model-catalog/docs/fetch", { url: args.url });
      return { toolCallId, content: JSON.stringify(result) };
    } catch (e) {
      return { toolCallId, content: `Error: ${(e as Error).message}` };
    }
  },
};

export const modelCatalogImportTool: ToolHandler = {
  definition: {
    name: "model_catalog_import",
    description: "把供应商、模型、调用映射写入 Nomi model catalog。package 必须符合 ModelCatalogImportPackageDto 格式（version, vendors[]）。",
    parameters: {
      type: "object",
      properties: {
        package: {
          type: "object",
          description: "ModelCatalogImportPackageDto JSON 对象",
        },
      },
      required: ["package"],
    },
  },
  async execute(args, ctx, toolCallId) {
    try {
      const result = await catalogFetch(ctx, "POST", "/model-catalog/import", args.package);
      return { toolCallId, content: JSON.stringify(result) };
    } catch (e) {
      return { toolCallId, content: `Error: ${(e as Error).message}` };
    }
  },
};

export const modelCatalogHealthTool: ToolHandler = {
  definition: {
    name: "model_catalog_health",
    description: "查看当前 model catalog 状态：已配置的 vendor、model、mapping 数量及健康问题。",
    parameters: { type: "object", properties: {} },
  },
  async execute(_args, ctx, toolCallId) {
    try {
      const result = await catalogFetch(ctx, "GET", "/model-catalog/health");
      return { toolCallId, content: JSON.stringify(result) };
    } catch (e) {
      return { toolCallId, content: `Error: ${(e as Error).message}` };
    }
  },
};

export const modelCatalogTestMappingTool: ToolHandler = {
  definition: {
    name: "model_catalog_test_mapping",
    description: "测试 model catalog mapping 的连通性。先用 model_catalog_list_mappings 获取 mappingId。",
    parameters: {
      type: "object",
      properties: {
        mappingId: { type: "string" },
        modelKey: { type: "string" },
        prompt: { type: "string", description: "测试用提示词，默认 'connection test'" },
        stage: { type: "string", enum: ["create", "result"], description: "默认 create" },
        execute: { type: "boolean", description: "true=真实调用供应商 API，false=只验证结构" },
      },
      required: ["mappingId", "modelKey"],
    },
  },
  async execute(args, ctx, toolCallId) {
    try {
      const body = {
        modelKey: args.modelKey,
        prompt: args.prompt || "connection test",
        stage: args.stage || "create",
        execute: args.execute === true,
      };
      const result = await catalogFetch(ctx, "POST", `/model-catalog/mappings/${args.mappingId}/test`, body);
      return { toolCallId, content: JSON.stringify(result) };
    } catch (e) {
      return { toolCallId, content: `Error: ${(e as Error).message}` };
    }
  },
};

export const modelCatalogListMappingsTool: ToolHandler = {
  definition: {
    name: "model_catalog_list_mappings",
    description: "列出 model catalog 中的 mappings，可按 vendorKey 过滤。用于获取 mappingId 以便测试。",
    parameters: {
      type: "object",
      properties: {
        vendorKey: { type: "string", description: "可选，按供应商过滤" },
      },
    },
  },
  async execute(args, ctx, toolCallId) {
    try {
      const qs = args.vendorKey ? `?vendorKey=${args.vendorKey}` : "";
      const result = await catalogFetch(ctx, "GET", `/model-catalog/mappings${qs}`);
      return { toolCallId, content: JSON.stringify(result) };
    } catch (e) {
      return { toolCallId, content: `Error: ${(e as Error).message}` };
    }
  },
};
