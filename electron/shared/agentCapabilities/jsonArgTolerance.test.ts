// 「模型把数组写成了 JSON 字符串」这一类，从**契约到发布出去的 JSON Schema** 都要收得下。
//
// 复现的是 2026-09-06 打包版那次：用户让 Agent 从原稿重拆 10 镜，
// `create_canvas_nodes` 连着被拒 6 次，模型自己都说对了病因却改不回来。
//
// 这份测试有两道，缺一不可：
//   ① 契约收得下（zod 层）——证明解出来的东西照样过同一个 item schema；
//   ② **发布出去的 schema 也收得下**（pi 的 TypeBox 层）——它跑在 zod 之前，
//      它挡下来的调用永远走不到 ①。带阳性对照：同一张 schema 换成裸数组就必须挡下来。
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ignoreOverride, zodToJsonSchema } from "zod-to-json-schema";
import { Compile } from "typebox/compile";
import type { TSchema } from "typebox";
import { canvasWriteSemanticInputSchema } from "./canvasWrite";
import { JSON_TEXT_BRANCH_MARKER, jsonTolerantArray } from "./jsonArgTolerance";
import { transportSchemaFromZod } from "../../capabilityCore/mcpTransportSchemaFromZod";

const node = (clientId: string) => ({
  clientId,
  kind: "image" as const,
  title: `镜 ${clientId}`,
  prompt: "天台 · 黄昏 · 少年侧身",
});

const tenShots = Array.from({ length: 10 }, (_, index) => node(`s${index + 1}`));

describe("契约层：数组与「数组的 JSON 文本」是同一个入参", () => {
  it("结构化数组照常通过", () => {
    const parsed = canvasWriteSemanticInputSchema.parse({
      operation: "create_canvas_nodes",
      summary: "从原稿重拆 10 镜",
      nodes: tenShots,
    });
    expect(parsed.operation).toBe("create_canvas_nodes");
    if (parsed.operation !== "create_canvas_nodes") return;
    expect(parsed.nodes).toHaveLength(10);
  });

  it("被二次序列化的同一份入参解开后等价——这就是用户那 6 次失败的形状", () => {
    const parsed = canvasWriteSemanticInputSchema.parse({
      operation: "create_canvas_nodes",
      summary: "从原稿重拆 10 镜",
      nodes: JSON.stringify(tenShots),
      edges: JSON.stringify([{ sourceClientId: "s1", targetClientId: "s2", mode: "first_frame" }]),
    });
    if (parsed.operation !== "create_canvas_nodes") throw new Error("分支不对");
    expect(parsed.nodes).toHaveLength(10);
    expect(parsed.nodes[0]!.clientId).toBe("s1");
    expect(parsed.edges).toHaveLength(1);
  });

  it("整类覆盖：anchors / shots / nodeIds / indexes 同样收得下", () => {
    const plan = canvasWriteSemanticInputSchema.parse({
      operation: "propose_storyboard_plan",
      title: "重拆 10 镜",
      anchors: "[]",
      shots: JSON.stringify([{ index: 1 }, { index: 2 }]),
    });
    if (plan.operation !== "propose_storyboard_plan") throw new Error("分支不对");
    expect(plan.shots).toHaveLength(2);

    const arrange = canvasWriteSemanticInputSchema.parse({
      operation: "arrange_storyboard_to_timeline",
      nodeIds: '["node-1","node-2"]',
    });
    if (arrange.operation !== "arrange_storyboard_to_timeline") throw new Error("分支不对");
    expect(arrange.nodeIds).toEqual(["node-1", "node-2"]);

    const patch = canvasWriteSemanticInputSchema.parse({
      operation: "patch_shots",
      select: { kind: "indexes", indexes: "[1,3]" },
      patch: { durationSec: 4 },
    });
    if (patch.operation !== "patch_shots" || patch.select.kind !== "indexes") throw new Error("分支不对");
    expect(patch.select.indexes).toEqual([1, 3]);
  });

  it("仍然 fail-closed：解不出、或解出来不是这个形状，一样拒", () => {
    expect(() =>
      canvasWriteSemanticInputSchema.parse({
        operation: "create_canvas_nodes",
        summary: "坏的",
        nodes: "[{不是 JSON",
      }),
    ).toThrow();
    expect(() =>
      canvasWriteSemanticInputSchema.parse({
        operation: "create_canvas_nodes",
        summary: "少字段",
        nodes: JSON.stringify([{ clientId: "s1" }]),
      }),
    ).toThrow();
  });
});

/** `tools.mts` 发布 JSON Schema 用的那套选项，逐字照抄。 */
function publish(schema: z.ZodTypeAny): TSchema {
  return zodToJsonSchema(schema, {
    $refStrategy: "none",
    effectStrategy: "input",
    removeAdditionalStrategy: "strict",
    override: (definition) =>
      "typeName" in definition
      && definition.typeName === z.ZodFirstPartyTypeKind.ZodEffects
      && "effect" in definition
      && (definition.effect as { type: string }).type === "preprocess"
        ? {}
        : ignoreOverride,
  }) as TSchema;
}

describe("发布层：pi 的 TypeBox 跑在 zod 之前，它也必须收得下", () => {
  const schema = z.object({ nodes: jsonTolerantArray(z.array(z.object({ clientId: z.string() }).strict()), "数组") }).strict();

  it("两种写法都过——这就是「容错真的在生效」", () => {
    const check = Compile(publish(schema));
    expect(check.Check({ nodes: [{ clientId: "s1" }] })).toBe(true);
    expect(check.Check({ nodes: '[{"clientId":"s1"}]' })).toBe(true);
  });

  it("阳性对照：同一张 schema 换成裸数组，字符串在 zod 之前就被挡掉——这正是修之前的样子", () => {
    const bare = z.object({ nodes: z.array(z.object({ clientId: z.string() }).strict()) }).strict();
    const check = Compile(publish(bare));
    expect(check.Check({ nodes: [{ clientId: "s1" }] })).toBe(true);
    expect(check.Check({ nodes: '[{"clientId":"s1"}]' })).toBe(false);
  });

  it("数组的完整形状仍然发布给模型看，而且排在字符串那支前面——容错不是把字段降级成 any", () => {
    const published = publish(schema) as unknown as {
      properties: { nodes: { anyOf: Array<{ type?: string; items?: unknown; description?: string }> } };
    };
    const [structured, text] = published.properties.nodes.anyOf;
    expect(structured?.type).toBe("array");
    expect(structured?.items).toBeTruthy();
    expect(structured?.description).toBe("数组");
    expect(text?.type).toBe("string");
  });

  it("「别把数组写成字符串」这句话就挂在字符串那一支上——模型读得到，MCP 载荷 0 字节", () => {
    const published = publish(schema) as unknown as {
      properties: { nodes: { anyOf: Array<{ description?: string }> } };
    };
    const text = published.properties.nodes.anyOf[1];
    expect(text?.description).toContain(JSON_TEXT_BRANCH_MARKER);
    expect(text?.description).toContain("not a string containing it");
  });
});

describe("MCP 传输层：只广播结构化那一支", () => {
  it("扁平化后 nodes 仍是 array，不是没有 type 的四不像", () => {
    const transport = transportSchemaFromZod(canvasWriteSemanticInputSchema, {
      label: "test",
    }) as unknown as { properties: Record<string, { type?: string; items?: unknown; description?: string }> };
    expect(transport.properties.nodes?.type).toBe("array");
    expect(transport.properties.nodes?.items).toBeTruthy();
    // 字符串那支的措辞一个字都不该出现在对外广播里——那个校验器不实现 anyOf，
    // 广播它只会造出一份「像在校验其实没有」的 schema。
    expect(JSON.stringify(transport)).not.toContain(JSON_TEXT_BRANCH_MARKER);
  });

  it("不广播 ≠ 不容错：执行边界仍然收得下二次序列化的写法", () => {
    const parsed = canvasWriteSemanticInputSchema.parse({
      operation: "arrange_storyboard_to_timeline",
      nodeIds: '["node-1"]',
    });
    if (parsed.operation !== "arrange_storyboard_to_timeline") throw new Error("分支不对");
    expect(parsed.nodeIds).toEqual(["node-1"]);
  });
});
