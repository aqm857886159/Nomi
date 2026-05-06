import type { ToolHandler } from "./registry.js";

function readStr(env: unknown, key: string): string {
  if (!env || typeof env !== "object") return "";
  const v = (env as Record<string, unknown>)[key];
  return typeof v === "string" ? v.trim() : "";
}

async function workspaceFetch(
  ctx: { meta?: Record<string, unknown> },
  tool: string,
  args: unknown,
): Promise<unknown> {
  const base = readStr(ctx.meta, "apiBaseUrl") || readStr(process.env, "TAPCANVAS_API_BASE_URL") || "http://localhost:8788";
  const token = readStr(ctx.meta, "authToken") || readStr(process.env, "TAPCANVAS_API_KEY") || "";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${base}/workbench/tools/${tool}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text, status: res.status }; }
}

function makeTool(name: string, description: string, properties: Record<string, unknown>, required: string[]): ToolHandler {
  return {
    definition: {
      name,
      description,
      parameters: { type: "object", properties, required },
    },
    async execute(args, ctx, toolCallId) {
      try {
        const result = await workspaceFetch(ctx, name, args);
        return { toolCallId, content: JSON.stringify(result) };
      } catch (e) {
        return { toolCallId, content: `Error: ${(e as Error).message}` };
      }
    },
  };
}

export const workspaceReadTool = makeTool(
  "workspace_read",
  "读取当前项目信息。需要 projectId。",
  { projectId: { type: "string" } },
  ["projectId"],
);

export const workspaceListProjectsTool = makeTool(
  "workspace_list_projects",
  "列出用户的所有项目。",
  {},
  [],
);

export const canvasReadTool = makeTool(
  "canvas_read",
  "读取画布（Flow）中的所有节点和连线。需要 projectId 和 flowId。",
  { projectId: { type: "string" }, flowId: { type: "string" } },
  ["projectId", "flowId"],
);

export const canvasCreateNodesTool = makeTool(
  "canvas_create_nodes",
  "在画布中批量创建节点。需要 projectId、flowId 和 nodes 数组。",
  {
    projectId: { type: "string" },
    flowId: { type: "string" },
    nodes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: { type: "string" },
          prompt: { type: "string" },
          position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } } },
          label: { type: "string" },
        },
        required: ["kind"],
      },
    },
  },
  ["projectId", "flowId", "nodes"],
);

export const canvasUpdateNodeTool = makeTool(
  "canvas_update_node",
  "更新画布中指定节点的数据。需要 projectId、flowId、nodeId 和 data。",
  {
    projectId: { type: "string" },
    flowId: { type: "string" },
    nodeId: { type: "string" },
    data: { type: "object" },
  },
  ["projectId", "flowId", "nodeId", "data"],
);

export const canvasConnectNodesTool = makeTool(
  "canvas_connect_nodes",
  "在画布中批量添加连线（edges）。需要 projectId、flowId 和 edges 数组。",
  {
    projectId: { type: "string" },
    flowId: { type: "string" },
    edges: {
      type: "array",
      items: {
        type: "object",
        properties: { source: { type: "string" }, target: { type: "string" } },
        required: ["source", "target"],
      },
    },
  },
  ["projectId", "flowId", "edges"],
);

export const canvasDeleteNodeTool = makeTool(
  "canvas_delete_node",
  "删除画布中的指定节点。需要 projectId、flowId 和 nodeId。",
  { projectId: { type: "string" }, flowId: { type: "string" }, nodeId: { type: "string" } },
  ["projectId", "flowId", "nodeId"],
);

export const canvasRunNodeTool = makeTool(
  "canvas_run_node",
  "触发画布节点生成（图片或视频）。需要 projectId、flowId、nodeId、kind 和 prompt。",
  {
    projectId: { type: "string" },
    flowId: { type: "string" },
    nodeId: { type: "string" },
    kind: { type: "string", enum: ["image", "video"] },
    prompt: { type: "string" },
    referenceImageUrl: { type: "string" },
  },
  ["projectId", "flowId", "nodeId", "kind", "prompt"],
);

export const timelineReadTool = makeTool(
  "timeline_read",
  "读取项目时间轴中的所有片段。需要 projectId。",
  { projectId: { type: "string" } },
  ["projectId"],
);

export const timelineAddClipTool = makeTool(
  "timeline_add_clip",
  "向时间轴添加一个片段（图片或视频）。需要 projectId 和 clip 对象。",
  {
    projectId: { type: "string" },
    clip: {
      type: "object",
      properties: {
        id: { type: "string" },
        type: { type: "string", enum: ["image", "video"] },
        url: { type: "string" },
        label: { type: "string" },
        startFrame: { type: "number" },
        frameCount: { type: "number" },
      },
      required: ["type", "url", "startFrame", "frameCount"],
    },
  },
  ["projectId", "clip"],
);

export const timelineRemoveClipTool = makeTool(
  "timeline_remove_clip",
  "从时间轴移除指定片段。需要 projectId 和 clipId。",
  { projectId: { type: "string" }, clipId: { type: "string" } },
  ["projectId", "clipId"],
);

export const timelineUpdateClipTool = makeTool(
  "timeline_update_clip",
  "更新时间轴中指定片段的属性。需要 projectId、clipId 和 updates。",
  { projectId: { type: "string" }, clipId: { type: "string" }, updates: { type: "object" } },
  ["projectId", "clipId", "updates"],
);

export const creationReadTool = makeTool(
  "creation_read",
  "读取项目章节内容。需要 projectId，可选 chapterId。",
  { projectId: { type: "string" }, chapterId: { type: "string" } },
  ["projectId"],
);

export const creationAppendTextTool = makeTool(
  "creation_append_text",
  "向指定章节追加文本内容。需要 projectId、chapterId 和 text。",
  { projectId: { type: "string" }, chapterId: { type: "string" }, text: { type: "string" } },
  ["projectId", "chapterId", "text"],
);

export const assetListTool = makeTool(
  "asset_list",
  "列出项目中的资产文件。需要 projectId，可选 limit。",
  { projectId: { type: "string" }, limit: { type: "number" } },
  ["projectId"],
);
