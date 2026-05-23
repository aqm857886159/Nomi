import { describe, expect, it } from "vitest";
import {
  canvasNodeKindSchema,
  canvasToolNames,
  canvasTools,
  plannedEdgeSchema,
  plannedNodeSchema,
} from "./canvasTools";

const makeValidNode = (overrides: Partial<Record<string, unknown>> = {}) => ({
  clientId: "n1",
  kind: "image",
  title: "Shot 1",
  prompt: "A scenic mountain view",
  position: { x: 100, y: 200 },
  ...overrides,
});

describe("canvasTools schemas", () => {
  describe("canvasNodeKindSchema", () => {
    it("accepts the 9 supported kinds", () => {
      for (const kind of [
        "text",
        "character",
        "scene",
        "image",
        "keyframe",
        "video",
        "shot",
        "output",
        "panorama",
      ]) {
        expect(canvasNodeKindSchema.safeParse(kind).success).toBe(true);
      }
    });

    it("rejects unknown kinds", () => {
      expect(canvasNodeKindSchema.safeParse("audio").success).toBe(false);
      expect(canvasNodeKindSchema.safeParse("").success).toBe(false);
      expect(canvasNodeKindSchema.safeParse(42).success).toBe(false);
    });
  });

  describe("plannedNodeSchema", () => {
    it("accepts a well-formed node", () => {
      expect(plannedNodeSchema.safeParse(makeValidNode()).success).toBe(true);
    });

    it("requires a non-empty clientId", () => {
      expect(plannedNodeSchema.safeParse(makeValidNode({ clientId: "" })).success).toBe(false);
    });

    it("requires a non-empty title", () => {
      expect(plannedNodeSchema.safeParse(makeValidNode({ title: "" })).success).toBe(false);
    });

    it("requires numeric position", () => {
      const bad = makeValidNode({ position: { x: "100", y: 200 } as unknown });
      expect(plannedNodeSchema.safeParse(bad).success).toBe(false);
    });

    it("rejects unknown kind", () => {
      expect(plannedNodeSchema.safeParse(makeValidNode({ kind: "audio" })).success).toBe(false);
    });
  });

  describe("plannedEdgeSchema", () => {
    it("accepts a well-formed edge", () => {
      const ok = plannedEdgeSchema.safeParse({ sourceClientId: "n1", targetClientId: "n2" });
      expect(ok.success).toBe(true);
    });

    it("rejects empty source or target", () => {
      expect(plannedEdgeSchema.safeParse({ sourceClientId: "", targetClientId: "n2" }).success).toBe(false);
      expect(plannedEdgeSchema.safeParse({ sourceClientId: "n1", targetClientId: "" }).success).toBe(false);
    });
  });

  describe("canvasToolNames", () => {
    it("enumerates all 5 tools", () => {
      expect(canvasToolNames).toEqual([
        "read_canvas_state",
        "create_canvas_nodes",
        "connect_canvas_edges",
        "set_node_prompt",
        "delete_canvas_nodes",
      ]);
    });

    it("matches the keys of canvasTools", () => {
      expect(Object.keys(canvasTools).sort()).toEqual([...canvasToolNames].sort());
    });
  });

  describe("create_canvas_nodes parameters", () => {
    const schema = canvasTools.create_canvas_nodes.parameters;

    it("accepts 1-24 nodes", () => {
      const nodes = Array.from({ length: 6 }, (_, i) => makeValidNode({ clientId: `n${i}` }));
      expect(schema.safeParse({ summary: "ok", nodes }).success).toBe(true);
    });

    it("rejects an empty nodes array", () => {
      expect(schema.safeParse({ summary: "ok", nodes: [] }).success).toBe(false);
    });

    it("rejects more than 24 nodes", () => {
      const nodes = Array.from({ length: 25 }, (_, i) => makeValidNode({ clientId: `n${i}` }));
      expect(schema.safeParse({ summary: "ok", nodes }).success).toBe(false);
    });

    it("requires summary", () => {
      const nodes = [makeValidNode()];
      // zod object passthrough: missing summary fails because schema is z.object({summary: z.string(), ...})
      expect(schema.safeParse({ nodes }).success).toBe(false);
    });
  });

  describe("connect_canvas_edges parameters", () => {
    const schema = canvasTools.connect_canvas_edges.parameters;

    it("accepts 1-48 edges", () => {
      const edges = Array.from({ length: 10 }, (_, i) => ({ sourceClientId: `n${i}`, targetClientId: `n${i + 1}` }));
      expect(schema.safeParse({ edges }).success).toBe(true);
    });

    it("rejects an empty edges array", () => {
      expect(schema.safeParse({ edges: [] }).success).toBe(false);
    });

    it("rejects more than 48 edges", () => {
      const edges = Array.from({ length: 49 }, (_, i) => ({ sourceClientId: `s${i}`, targetClientId: `t${i}` }));
      expect(schema.safeParse({ edges }).success).toBe(false);
    });
  });

  describe("set_node_prompt parameters", () => {
    const schema = canvasTools.set_node_prompt.parameters;

    it("accepts a well-formed call", () => {
      expect(schema.safeParse({ nodeId: "node-1", prompt: "new prompt" }).success).toBe(true);
    });

    it("rejects empty nodeId or prompt", () => {
      expect(schema.safeParse({ nodeId: "", prompt: "x" }).success).toBe(false);
      expect(schema.safeParse({ nodeId: "n", prompt: "" }).success).toBe(false);
    });
  });

  describe("delete_canvas_nodes parameters", () => {
    const schema = canvasTools.delete_canvas_nodes.parameters;

    it("accepts 1-24 ids", () => {
      expect(schema.safeParse({ nodeIds: ["a"] }).success).toBe(true);
      expect(schema.safeParse({ nodeIds: Array.from({ length: 24 }, (_, i) => `n${i}`) }).success).toBe(true);
    });

    it("rejects empty array and overflow", () => {
      expect(schema.safeParse({ nodeIds: [] }).success).toBe(false);
      expect(schema.safeParse({ nodeIds: Array.from({ length: 25 }, (_, i) => `n${i}`) }).success).toBe(false);
    });

    it("rejects empty string ids", () => {
      expect(schema.safeParse({ nodeIds: ["good", ""] }).success).toBe(false);
    });
  });

  describe("read_canvas_state parameters", () => {
    it("accepts empty object", () => {
      expect(canvasTools.read_canvas_state.parameters.safeParse({}).success).toBe(true);
    });
  });
});
