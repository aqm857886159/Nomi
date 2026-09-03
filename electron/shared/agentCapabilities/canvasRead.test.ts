import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GENERATION_NODE_STATUSES } from "../canvas/generationNodeStatus";
import {
  CANVAS_READ_CAPABILITY,
  canvasReadResultSchema,
  canvasReadSemanticInputSchema,
  projectCanvasRead,
} from "./canvasRead";

const FORBIDDEN_RESULT_KEYS = [
  "raw",
  "url",
  "thumbnailUrl",
  "meta",
  "provider",
  "providerTaskId",
  "taskId",
  "provenance",
  "runs",
] as const;

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...collectKeys(child)]);
}

function deepFreeze(value: unknown): unknown {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalResultFixture() {
  return {
    nodes: [
      {
        id: "node-a",
        kind: "image",
        title: "A",
        prompt: "",
        status: "success",
        position: { x: 0, y: 0 },
        locked: false,
        hasResult: true,
        currentResultId: "result-a",
        resultIds: ["result-a", "result-b"],
      },
      {
        id: "node-b",
        kind: "video",
        title: "B",
        prompt: "",
        status: "idle",
        position: { x: 10, y: 20 },
        locked: false,
        hasResult: false,
        resultIds: [] as string[],
      },
    ],
    edges: [{ id: "edge-a", source: "node-a", target: "node-b", mode: "reference" }],
    groups: [{ id: "group-a", name: "A", nodeIds: ["node-a", "node-b"], collapsed: false }],
    selectedNodeIds: ["node-b"],
  };
}

type CanonicalResultFixture = ReturnType<typeof canonicalResultFixture>;
type CanonicalInvariantCase = readonly [
  name: string,
  mutate: (fixture: CanonicalResultFixture) => void,
  issuePath: readonly (string | number)[],
];

const CANONICAL_INVARIANT_CASES: readonly CanonicalInvariantCase[] = [
  ["a whitespace-only node ID", (fixture) => (fixture.nodes[0]!.id = "   "), ["nodes", 0, "id"]],
  ["a whitespace-only node kind", (fixture) => (fixture.nodes[0]!.kind = "   "), ["nodes", 0, "kind"]],
  ["duplicate node IDs", (fixture) => (fixture.nodes[1]!.id = "node-a"), ["nodes", 1, "id"]],
  ["duplicate edge IDs", (fixture) => fixture.edges.push({ ...fixture.edges[0]! }), ["edges", 1, "id"]],
  [
    "duplicate group IDs",
    (fixture) => fixture.groups.push({ ...fixture.groups[0]!, nodeIds: ["node-a"] }),
    ["groups", 1, "id"],
  ],
  ["a dangling edge source", (fixture) => (fixture.edges[0]!.source = "ghost"), ["edges", 0, "source"]],
  ["a dangling edge target", (fixture) => (fixture.edges[0]!.target = "ghost"), ["edges", 0, "target"]],
  ["a dangling group reference", (fixture) => fixture.groups[0]!.nodeIds.push("ghost"), ["groups", 0, "nodeIds", 2]],
  ["a dangling selected-node reference", (fixture) => fixture.selectedNodeIds.push("ghost"), ["selectedNodeIds", 1]],
  ["duplicate group node IDs", (fixture) => fixture.groups[0]!.nodeIds.push("node-a"), ["groups", 0, "nodeIds", 2]],
  ["duplicate selected-node IDs", (fixture) => fixture.selectedNodeIds.push("node-b"), ["selectedNodeIds", 1]],
  ["duplicate result IDs", (fixture) => fixture.nodes[0]!.resultIds.push("result-a"), ["nodes", 0, "resultIds", 2]],
];

const INVALID_SEQUENCE_CASES = [
  ["negative integer", -1],
  ["negative fraction", -1.5],
  ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
] as const;

describe("canvas.read canonical contract", () => {
  it("owns the exact canonical identity, aliases, policy, port, and honest exposure", () => {
    expect(CANVAS_READ_CAPABILITY).toEqual({
      id: "canvas.read",
      version: 1,
      aliases: {
        pi: "read_canvas_state",
        mcp: "nomi_canvas_read",
      },
      inputSchema: canvasReadSemanticInputSchema,
      outputSchema: canvasReadResultSchema,
      effect: "read",
      execution: {
        port: "canvas",
        availability: "main_or_renderer",
      },
      exposure: "mcp_safe",
      requiredScope: "canvas:read",
      targetKind: "project",
      approval: "none",
      projections: {
        pi: {
          description: "Read the current generation canvas (nodes + edges).",
        },
        mcp: {
          description: "Read the project canvas as compact nodes and edges.",
        },
      },
    });
  });

  it("accepts only the empty semantic input object", () => {
    expect(canvasReadSemanticInputSchema.parse({})).toEqual({});

    for (const rejected of [{ projectId: "project-a" }, { leaseHandle: "lease-a" }, { extra: true }, null, []]) {
      expect(canvasReadSemanticInputSchema.safeParse(rejected).success).toBe(false);
    }
  });

  it("keeps the canonical result schema strict at every object boundary", () => {
    const projected = projectCanvasRead({
      nodes: [{ id: "node-a", kind: "image", position: { x: 1, y: 2 } }],
      edges: [],
      groups: [],
      selectedNodeIds: [],
    });

    expect(canvasReadResultSchema.safeParse(projected).success).toBe(true);
    expect(canvasReadResultSchema.safeParse({ ...projected, projectId: "project-a" }).success).toBe(false);
    expect(
      canvasReadResultSchema.safeParse({
        ...projected,
        nodes: [{ ...projected.nodes[0], raw: { secret: true } }],
      }).success,
    ).toBe(false);
    expect(
      canvasReadResultSchema.safeParse({
        ...projected,
        nodes: [{ ...projected.nodes[0], position: { ...projected.nodes[0]?.position, z: 3 } }],
      }).success,
    ).toBe(false);
    expect(
      canvasReadResultSchema.safeParse({
        ...projected,
        edges: [{ id: "edge-a", source: "node-a", target: "node-a", mode: "reference", leak: true }],
      }).success,
    ).toBe(false);
    expect(
      canvasReadResultSchema.safeParse({
        ...projected,
        groups: [{ id: "group-a", name: "", nodeIds: ["node-a"], collapsed: false, leak: true }],
      }).success,
    ).toBe(false);
    expect(
      canvasReadResultSchema.safeParse({
        ...projected,
        nodes: [{ ...projected.nodes[0], currentResultId: "https://cdn.example/result.png" }],
      }).success,
    ).toBe(false);
    expect(
      canvasReadResultSchema.safeParse({
        ...projected,
        nodes: [{ ...projected.nodes[0], resultIds: ["opaque-result", "file:///tmp/result.png"] }],
      }).success,
    ).toBe(false);
  });

  it("rejects every URI-scheme result identity", () => {
    const projected = projectCanvasRead({
      nodes: [{ id: "node-a", kind: "image" }],
    });

    for (const id of ["blob:https://example.com/result", "ftp://example.com/result", "s3://bucket/result"]) {
      expect(
        canvasReadResultSchema.safeParse({
          ...projected,
          nodes: [{ ...projected.nodes[0], currentResultId: id }],
        }).success,
      ).toBe(false);
    }
  });

  it.each(CANONICAL_INVARIANT_CASES)("rejects %s at its canonical path", (_name, mutate, issuePath) => {
    const fixture = canonicalResultFixture();
    mutate(fixture);

    const parsed = canvasReadResultSchema.safeParse(fixture);

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((issue) => issue.path)).toContainEqual([...issuePath]);
  });

  it.each(INVALID_SEQUENCE_CASES)("rejects %s sequence numbers in the result schema", (_name, value) => {
    const fixture = canonicalResultFixture();
    const withShotIndex = {
      ...fixture,
      nodes: [{ ...fixture.nodes[0]!, shotIndex: value }, fixture.nodes[1]!],
    };
    const withOrder = {
      ...fixture,
      edges: [{ ...fixture.edges[0]!, order: value }],
    };

    const shotIndexResult = canvasReadResultSchema.safeParse(withShotIndex);
    const orderResult = canvasReadResultSchema.safeParse(withOrder);

    expect(shotIndexResult.success).toBe(false);
    if (!shotIndexResult.success) {
      expect(shotIndexResult.error.issues.map((issue) => issue.path)).toContainEqual(["nodes", 0, "shotIndex"]);
    }
    expect(orderResult.success).toBe(false);
    if (!orderResult.success) {
      expect(orderResult.error.issues.map((issue) => issue.path)).toContainEqual(["edges", 0, "order"]);
    }
  });
});

describe("projectCanvasRead", () => {
  it("accepts every status owned by the neutral shared canvas contract", () => {
    for (const status of GENERATION_NODE_STATUSES) {
      const [node] = projectCanvasRead({ nodes: [{ id: `node-${status}`, kind: "image", status }] }).nodes;
      expect(node?.status).toBe(status);
    }

    const [invalid] = projectCanvasRead({
      nodes: [{ id: "node-invalid", kind: "image", status: "not-a-generation-status" }],
    }).nodes;
    expect(invalid?.status).toBe("idle");
  });

  it("projects only decision fields while preserving URL text in user-authored title and prompt", () => {
    const projected = projectCanvasRead({
      nodes: [
        {
          id: " node-a ",
          kind: " image ",
          title: "Reference: https://example.com/title",
          prompt: "Keep file://example and https://example.com/prompt as text",
          status: "success",
          position: { x: 12, y: 34, z: 56 },
          locked: true,
          shotIndex: 2,
          result: {
            id: " result-current ",
            url: "https://cdn.example/current.png",
            raw: { providerTaskId: "secret-current" },
            provider: "secret-provider",
          },
          history: [
            { id: "result-current", thumbnailUrl: "https://cdn.example/thumb.png" },
            { id: "result-old", taskId: "secret-old", provenance: { provider: "secret" } },
            { id: "https://cdn.example/not-an-opaque-id" },
            { id: "data:image/png;base64,AAAA" },
            { url: "https://cdn.example/fallback.png", text: "text-fallback" },
          ],
          meta: { secret: true },
          runs: [{ taskId: "secret-run" }],
          providerTaskId: "secret-node-task",
        },
        {
          id: "node-b",
          kind: "video",
          title: "B",
          prompt: "",
          position: { x: -4, y: 9 },
          result: { id: "nomi-local://asset/not-opaque", raw: "secret" },
        },
      ],
      edges: [
        {
          id: " edge-a ",
          source: " node-a ",
          target: "node-b",
          mode: "first_frame",
          order: 3,
          meta: { secret: true },
        },
      ],
      groups: [
        {
          id: " group-a ",
          name: "Sequence A",
          nodeIds: ["node-b", "node-a"],
          collapsed: true,
          provider: "secret",
        },
      ],
      selectedNodeIds: ["node-b"],
      raw: { secret: true },
      provider: "secret-root",
    });

    expect(projected).toEqual({
      nodes: [
        {
          id: "node-a",
          kind: "image",
          title: "Reference: https://example.com/title",
          prompt: "Keep file://example and https://example.com/prompt as text",
          status: "success",
          position: { x: 12, y: 34 },
          locked: true,
          shotIndex: 2,
          hasResult: true,
          currentResultId: "result-current",
          resultIds: ["result-current", "result-old"],
        },
        {
          id: "node-b",
          kind: "video",
          title: "B",
          prompt: "",
          status: "idle",
          position: { x: -4, y: 9 },
          locked: false,
          hasResult: true,
        },
      ],
      edges: [{ id: "edge-a", source: "node-a", target: "node-b", mode: "first_frame", order: 3 }],
      groups: [{ id: "group-a", name: "Sequence A", nodeIds: ["node-b", "node-a"], collapsed: true }],
      selectedNodeIds: ["node-b"],
    });

    expect(Object.keys(projected.nodes[0] ?? {}).sort()).toEqual([
      "currentResultId",
      "hasResult",
      "id",
      "kind",
      "locked",
      "position",
      "prompt",
      "resultIds",
      "shotIndex",
      "status",
      "title",
    ]);
    const keys = collectKeys(projected);
    for (const forbidden of FORBIDDEN_RESULT_KEYS) expect(keys).not.toContain(forbidden);
  });

  it("never treats URL or text fallbacks as a result identity", () => {
    const [node] = projectCanvasRead({
      nodes: [
        {
          id: "node-a",
          kind: "image",
          result: {
            url: "https://cdn.example/fallback.png",
            thumbnailUrl: "file:///tmp/thumb.png",
            text: "fallback text",
          },
          history: [
            { id: "file:///tmp/result.png" },
            { id: "http://example.com/result.png" },
            { id: "HTTPS://example.com/result.png" },
            { id: "NOMI-LOCAL://asset/result.png" },
            { id: "DATA:image/png;base64,AAAA" },
            { id: "blob:https://example.com/result" },
            { id: "ftp://example.com/result" },
            { id: "s3://bucket/result" },
            { id: "  " },
          ],
        },
      ],
    }).nodes;

    expect(node).toMatchObject({ id: "node-a", hasResult: true });
    expect(node).not.toHaveProperty("currentResultId");
    expect(node).not.toHaveProperty("resultIds");
  });

  it("normalizes malformed fields independently instead of hiding the valid canvas", () => {
    const projected = projectCanvasRead({
      nodes: [
        null,
        { id: "", kind: "image" },
        { id: "missing-kind", kind: "" },
        {
          id: " valid-a ",
          kind: " image ",
          title: 42,
          prompt: null,
          status: { invalid: true },
          position: { x: Number.NaN, y: "bad" },
          locked: "yes",
          shotIndex: Number.POSITIVE_INFINITY,
          result: "broken-result",
          history: [{ id: "old-a" }, null, { id: 42 }],
        },
        {
          id: "valid-b",
          kind: "text",
          status: "not-a-status",
          position: { x: 4, y: Number.NaN },
          result: { id: " current-b " },
        },
        { id: "valid-a", kind: "video", title: "duplicate must not win" },
      ],
      edges: [
        { id: " edge-a ", source: " valid-a ", target: "valid-b", mode: undefined, order: Number.NaN },
        { id: "edge-a", source: "valid-b", target: "valid-a", mode: "last_frame", order: 2 },
        { id: "edge-missing-target", source: "valid-a", target: "ghost" },
        { id: "", source: "valid-a", target: "valid-b" },
      ],
      groups: [
        { id: " group-a ", name: 7, nodeIds: ["valid-b", " valid-a ", "valid-b", "ghost"], collapsed: "yes" },
        { id: "group-a", name: "duplicate must not win", nodeIds: ["valid-a"] },
        { id: "group-b", name: "B", nodeIds: "broken", collapsed: false },
        { id: "", name: "invalid", nodeIds: ["valid-a"] },
      ],
      selectedNodeIds: ["valid-b", " valid-a ", "valid-b", "ghost", 42],
    });

    expect(projected).toEqual({
      nodes: [
        {
          id: "valid-a",
          kind: "image",
          title: "",
          prompt: "",
          status: "idle",
          position: { x: 0, y: 0 },
          locked: false,
          hasResult: false,
          resultIds: ["old-a"],
        },
        {
          id: "valid-b",
          kind: "text",
          title: "",
          prompt: "",
          status: "idle",
          position: { x: 4, y: 0 },
          locked: false,
          hasResult: true,
          currentResultId: "current-b",
          resultIds: ["current-b"],
        },
      ],
      edges: [{ id: "edge-a", source: "valid-a", target: "valid-b", mode: "reference" }],
      groups: [
        { id: "group-a", name: "", nodeIds: ["valid-b", "valid-a"], collapsed: false },
        { id: "group-b", name: "B", nodeIds: [], collapsed: false },
      ],
      selectedNodeIds: ["valid-b", "valid-a"],
    });
  });

  it.each(INVALID_SEQUENCE_CASES)("omits %s sequence numbers", (_name, value) => {
    const projected = projectCanvasRead({
      nodes: [
        { id: "node-a", kind: "image", shotIndex: value },
        { id: "node-b", kind: "video" },
      ],
      edges: [{ id: "edge-a", source: "node-a", target: "node-b", order: value }],
    });

    expect(projected.nodes[0]).not.toHaveProperty("shotIndex");
    expect(projected.edges[0]).not.toHaveProperty("order");
  });

  it("preserves zero-valued sequence numbers", () => {
    const projected = projectCanvasRead({
      nodes: [
        { id: "node-a", kind: "image", shotIndex: 0 },
        { id: "node-b", kind: "video" },
      ],
      edges: [{ id: "edge-a", source: "node-a", target: "node-b", order: 0 }],
    });

    expect(projected.nodes[0]?.shotIndex).toBe(0);
    expect(projected.edges[0]?.order).toBe(0);
  });

  it("returns a deterministic empty result for a malformed root", () => {
    const empty = { nodes: [], edges: [], groups: [], selectedNodeIds: [] };

    expect(projectCanvasRead(null)).toEqual(empty);
    expect(projectCanvasRead("not-a-canvas")).toEqual(empty);
    expect(projectCanvasRead({ nodes: "bad", edges: 42, groups: {}, selectedNodeIds: null })).toEqual(empty);
  });

  it("is deterministic, does not mutate its source, and has no ambient current-project access", () => {
    const source = {
      nodes: [
        {
          id: "node-a",
          kind: "image",
          title: "A",
          position: { x: 1, y: 2 },
          result: { id: "result-a", raw: { secret: true } },
        },
      ],
      edges: [],
      groups: [],
      selectedNodeIds: ["node-a"],
    };
    const serialized = JSON.stringify(source);
    deepFreeze(source);

    const first = projectCanvasRead(source);
    const second = projectCanvasRead(source);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(JSON.stringify(source)).toBe(serialized);

    const implementation = readFileSync(new URL("./canvasRead.ts", import.meta.url), "utf8");
    expect(implementation).not.toMatch(/\b(?:globalThis|currentProject|getState|gateway)\b/);
  });
});
