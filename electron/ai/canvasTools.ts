import { tool } from "ai";
import { z } from "zod";

/**
 * Zod schemas for the generation canvas tools the LLM is allowed to call.
 *
 * The schemas mirror the existing `GenerationCanvasNode` shape (see
 * `src/workbench/generationCanvas/model/...`). They intentionally use a
 * `clientId` (LLM-supplied) instead of the real node id so the model can
 * reference nodes it just proposed before the user has confirmed creation.
 *
 * The Vercel AI SDK `tool({ ... })` helper only requires `description` +
 * `parameters` for the LLM-side schema. We deliberately omit `execute` here:
 * actual mutation happens in the renderer once the user confirms, so the main
 * process emits the tool-call to the UI and feeds the user's decision back to
 * the model as the tool result.
 */

export const canvasNodeKindSchema = z.enum([
  "text",
  "character",
  "scene",
  "image",
  "keyframe",
  "video",
  "shot",
  "output",
  "panorama",
]);

export const plannedNodeSchema = z.object({
  clientId: z.string().min(1),
  kind: canvasNodeKindSchema,
  title: z.string().min(1),
  prompt: z.string(),
  // 可省略：批量布局由渲染层 derive 成紧凑网格（applyCanvasToolCall.gridPosition），
  // 不再信任 LLM 手写的像素坐标（硬编码单行会溢出视口）。
  position: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .optional(),
  // bug①：agent 为节点建议模型 + 模式 + 标量参数（比例/清晰度…），用户在计划卡可改可确认。
  // modelKey/modeId 必须取自系统提示词给出的「可用模型清单」；params 是宽松键值（schema 不按
  // 单个模型严格——一次 batch 可含多模型），合法性在写入时按档案逐字段校验（单字段，跨字段留二期）。
  modelKey: z.string().optional(),
  modeId: z.string().optional(),
  params: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const plannedEdgeSchema = z.object({
  sourceClientId: z.string().min(1),
  targetClientId: z.string().min(1),
});

export const canvasToolNames = [
  "read_canvas_state",
  "create_canvas_nodes",
  "connect_canvas_edges",
  "set_node_prompt",
  "delete_canvas_nodes",
] as const;
export type CanvasToolName = (typeof canvasToolNames)[number];

export const canvasTools = {
  read_canvas_state: tool({
    description:
      "Read the current generation canvas: returns all nodes (id, kind, title, prompt, position) and all edges (source, target). Use this first when you need to know what is already on the canvas before planning new work.",
    parameters: z.object({}),
  }),
  create_canvas_nodes: tool({
    description:
      "Propose a batch of new canvas nodes for the user to confirm. Nodes are NOT auto-executed; they appear on the canvas as idle/draft and the user manually clicks generate. Use `clientId` to reference these nodes from edges in the same plan.",
    parameters: z.object({
      summary: z
        .string()
        .describe("One-sentence summary of the plan, shown to the user before confirmation."),
      nodes: z.array(plannedNodeSchema).min(1).max(24),
    }),
  }),
  connect_canvas_edges: tool({
    description:
      "Connect two nodes with a reference edge (source feeds context into target). Use the clientId values you supplied in a prior create_canvas_nodes call, or real node ids returned from read_canvas_state.",
    parameters: z.object({
      edges: z.array(plannedEdgeSchema).min(1).max(48),
    }),
  }),
  set_node_prompt: tool({
    description:
      "Rewrite the prompt of a single existing node. Use this in refine/polish flows. Do not use to create new nodes.",
    parameters: z.object({
      nodeId: z.string().min(1),
      prompt: z.string().min(1),
    }),
  }),
  delete_canvas_nodes: tool({
    description:
      "Delete one or more existing canvas nodes by id. Always destructive — the user must confirm.",
    parameters: z.object({
      nodeIds: z.array(z.string().min(1)).min(1).max(24),
    }),
  }),
} as const;

export type CanvasTools = typeof canvasTools;

export type PlannedNode = z.infer<typeof plannedNodeSchema>;
export type PlannedEdge = z.infer<typeof plannedEdgeSchema>;
