import type { z } from "zod";

export declare const CANVAS_PLAN_TAG_NAME: "tapcanvas_canvas_plan";

export declare const canvasPlanNodeSchema: z.ZodObject<{
	clientId: z.ZodString;
	kind: z.ZodString;
	label: z.ZodString;
	nodeType: z.ZodOptional<z.ZodString>;
	position: z.ZodOptional<z.ZodObject<{
		x: z.ZodNumber;
		y: z.ZodNumber;
	}>>;
	groupId: z.ZodOptional<z.ZodString>;
	groupLabel: z.ZodOptional<z.ZodString>;
	config: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}>;

export declare const canvasPlanEdgeSchema: z.ZodObject<{
	sourceClientId: z.ZodString;
	targetClientId: z.ZodString;
	sourceHandle: z.ZodOptional<z.ZodString>;
	targetHandle: z.ZodOptional<z.ZodString>;
}>;

export declare const canvasPlanSchema: z.ZodObject<{
	action: z.ZodLiteral<"create_canvas_workflow">;
	summary: z.ZodOptional<z.ZodString>;
	reason: z.ZodOptional<z.ZodString>;
	nodes: z.ZodArray<typeof canvasPlanNodeSchema, "atleastone">;
	edges: z.ZodOptional<z.ZodArray<typeof canvasPlanEdgeSchema>>;
}>;

export type ChatCanvasPlan = z.infer<typeof canvasPlanSchema>;

export declare const CANVAS_PLAN_PROTOCOL_FORMAT_HINT: string;
export declare const CANVAS_PLAN_VISUAL_PROMPT_REQUIRED_HINT: string;
export declare const CANVAS_PLAN_STORYBOARD_EDITOR_REQUIRED_HINT: string;
export declare const CANVAS_PLAN_VIDEO_PROMPT_REQUIRED_HINT: string;
export declare const CANVAS_PLAN_VIDEO_GOVERNANCE_HINT: string;
export declare const CANVAS_PLAN_NOVEL_TRACEABILITY_REQUIRED_HINT: string;
