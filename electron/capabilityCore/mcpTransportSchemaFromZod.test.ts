import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CANVAS_WRITE_OPERATIONS, canvasWriteSemanticInputSchema } from "../shared/agentCapabilities/canvasWrite";
import { findUnsupportedSchemaFeatures } from "./mcpArgValidation";
import { MCP_CAPABILITY_RESOLVER } from "./mcpCapabilityProjection";
import { transportSchemaFromZod } from "./mcpTransportSchemaFromZod";

describe("transportSchemaFromZod", () => {
  it("flattens a discriminated union into a property superset with an intersected required list", () => {
    const union = z.discriminatedUnion("operation", [
      z.object({ operation: z.literal("a"), only_a: z.string().min(2) }).strict(),
      z.object({ operation: z.literal("b"), only_b: z.number().int().min(3), shared: z.string() }).strict(),
    ]);
    const schema = transportSchemaFromZod(union, { label: "test" });
    expect(schema.properties).toHaveProperty("only_a");
    expect(schema.properties).toHaveProperty("only_b");
    expect((schema.properties as Record<string, { enum?: unknown[] }>).operation.enum).toEqual(["a", "b"]);
    // 分支各自的必填不能变成超集的必填，否则任何一个分支都构造不出来。
    expect(schema.required).toEqual(["operation"]);
  });

  it("keeps a nested union addressable instead of widening it into an untyped blob", () => {
    const schema = transportSchemaFromZod(
      z.object({
        select: z.union([
          z.object({ kind: z.literal("all") }).strict(),
          z.object({ kind: z.literal("indexes"), indexes: z.array(z.number().int()).min(1) }).strict(),
        ]),
      }),
      { label: "test" },
    );
    const select = (schema.properties as Record<string, Record<string, unknown>>).select;
    expect(select.type).toBe("object");
    expect(select.required).toEqual(["kind"]);
    expect((select.properties as Record<string, { enum?: unknown[] }>).kind.enum).toEqual(["all", "indexes"]);
  });

  it("stays inside the runtime validator's keyword subset", () => {
    const schema = transportSchemaFromZod(canvasWriteSemanticInputSchema, { label: "canvas.write" });
    expect(findUnsupportedSchemaFeatures(schema)).toEqual([]);
  });
});

describe("the published canvas.write transport schema is derived, not hand-written", () => {
  const tool = MCP_CAPABILITY_RESOLVER.resolve("nomi_canvas_edit");
  const properties = (tool?.inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>;

  it("publishes every operation the validator accepts", () => {
    expect((properties.operation as { enum?: unknown[] }).enum).toEqual([...CANVAS_WRITE_OPERATIONS]);
  });

  it("publishes the fields that used to be unreachable behind additionalProperties:false", () => {
    // 探针实测：这五个字段此前一个都不在传输 schema 的 properties 里，于是
    // propose_storyboard_plan / create_camera_move / create_staging_reference 结构性不可达。
    for (const field of ["title", "anchors", "shots", "shotClientId", "characters", "customBlocking", "move"]) {
      expect(properties, `${field} must be visible to the host`).toHaveProperty(field);
    }
  });

  it("carries the Zod prompt-writing guidance all the way to tools/list", () => {
    const nodePrompt = ((properties.nodes?.items as Record<string, unknown>)?.properties as Record<string, { description?: string }>)?.prompt;
    expect(nodePrompt?.description).toMatch(/STRUCTURED skeleton/);
    const edgeMode = ((properties.edges?.items as Record<string, unknown>)?.properties as Record<string, { description?: string }>)?.mode;
    expect(edgeMode?.description).toMatch(/character_ref/);
  });
});
