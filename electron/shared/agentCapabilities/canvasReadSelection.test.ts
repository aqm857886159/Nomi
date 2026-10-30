import { describe, expect, it } from "vitest";

import { projectCanvasRead, type CanvasReadResult } from "./canvasRead";
import { MAX_CANVAS_PROMPT_CHARACTERS, formatCanvasForAgent, projectCanvasForAgent } from "./canvasReadCompact";

const nodeId = (index: number): string =>
  `gen-v2-image-${(1_760_000_000_000 + index * 7919).toString(36)}-${(index * 46_656 + 1_679_616).toString(36).slice(0, 4)}`;

function canvasOf(selectedCount: number, options: { extraNodes?: number; prompt?: (index: number) => string } = {}): CanvasReadResult {
  const total = selectedCount + (options.extraNodes ?? 0);
  const nodes = Array.from({ length: total }, (_, index) => ({
    id: nodeId(index), kind: index % 2 ? "video" : "image", title: `镜头 ${index + 1}`,
    prompt: options.prompt?.(index) ?? "", position: { x: index * 10, y: 0 },
  }));
  return projectCanvasRead({ nodes, edges: [], groups: [], selectedNodeIds: nodes.slice(0, selectedCount).map((node) => node.id) });
}

const selectedIdsOf = (result: CanvasReadResult): readonly string[] => result.selectedNodeIds;
const nodeLinesOf = (text: string): string[] => text.split("\n").filter((line) => line.startsWith("- "));
const selectedNodeLinesOf = (text: string): string[] => nodeLinesOf(text).filter((line) => line.includes("| 选中"));
const selectionLineOf = (text: string): string => text.split("\n").find((line) => line.startsWith("当前选中"))!;
const idsOf = (lines: readonly string[]): string[] => lines.map((line) => line.slice(2).split(" | ")[0]!);

describe("look_at_canvas 的选区：选中状态跟着节点行", () => {
  it("44 个节点选中 40 个：40 行带选中，选中排前面，账写总数", () => {
    const result = canvasOf(40, { extraNodes: 4 });
    const projection = projectCanvasForAgent(result);
    const selectedLines = selectedNodeLinesOf(projection.text);

    expect(selectedLines).toHaveLength(40);
    expect(idsOf(selectedLines)).toEqual(selectedIdsOf(result));
    expect(nodeLinesOf(projection.text).slice(0, 40)).toEqual(selectedLines);
    expect(projection.selection).toEqual({ total: 40, listed: 40, omitted: 0 });
    expect(selectionLineOf(projection.text)).toBe("当前选中 40 个（节点行里标了「选中」）");
  });

  it("超出全局文本预算的选区：行内账与文本里的 M 对得上", () => {
    const selectedCount = MAX_CANVAS_PROMPT_CHARACTERS;
    const result = canvasOf(selectedCount, { prompt: () => "x".repeat(100) });
    const projection = projectCanvasForAgent(result);
    const marked = selectedNodeLinesOf(projection.text).length;

    expect(projection.selection.total).toBe(selectedCount);
    expect(projection.selection.listed).toBe(marked);
    expect(marked).toBeLessThan(selectedCount);
    expect(selectionLineOf(projection.text)).toBe(`当前选中 ${selectedCount} 个，只列出了其中 ${marked} 个；没列出的不要猜，请让用户缩小选区`);
    expect(projection.text).not.toContain("look_at_canvas");
  });

  it("没有选中：照旧明确写无", () => {
    const projection = projectCanvasForAgent(canvasOf(0, { extraNodes: 3 }));
    expect(selectionLineOf(projection.text)).toBe("当前选中: 无");
    expect(projection.selection).toEqual({ total: 0, listed: 0, omitted: 0 });
    expect(selectedNodeLinesOf(projection.text)).toEqual([]);
  });

  it.each([0, 1, 32, 33, 40, 120])("选区账对得上：%i 个", (count) => {
    const projection = projectCanvasForAgent(canvasOf(count, { extraNodes: count === 0 ? 3 : 0, prompt: count >= 120 ? () => "x".repeat(100) : undefined }));
    const marked = selectedNodeLinesOf(projection.text).length;
    expect(projection.selection.total).toBe(count);
    expect(marked).toBe(projection.selection.listed);
    expect(projection.selection.listed + projection.selection.omitted).toBe(count);
    if (count > 0 && projection.selection.omitted === 0) {
      expect(selectionLineOf(projection.text)).toContain("节点行里标了「选中」");
    }
  });

  it("完整提示词跟所有选中节点走，放不下时仍照旧明说截断", () => {
    const result = canvasOf(40, { prompt: (index) => `${"一位撑红伞的女孩穿过霓虹街口，".repeat(6)}尾标${index}尾` });
    const text = formatCanvasForAgent(result);
    expect(text).toContain("尾标0尾");
    expect(text).toContain("尾标39尾");
    expect(text.length).toBeLessThanOrEqual(MAX_CANVAS_PROMPT_CHARACTERS);
  });

  it("节点标题再长也不改变行内选中账", () => {
    const short = projectCanvasForAgent(canvasOf(40)).selection;
    const longResult = canvasOf(40);
    const longCanvas: CanvasReadResult = { ...longResult, nodes: longResult.nodes.map((node, index) => ({ ...node, title: `极长标题${index}${"很长".repeat(5_000)}` })) };
    const long = projectCanvasForAgent(longCanvas).selection;
    expect(long).toEqual(short);
  });
});

it('keeps a normal 120-node inventory addressable before verbose prompt excerpts', () => {
  const projection = projectCanvasForAgent(canvasOf(120, { prompt: () => 'x'.repeat(100) }));
  expect(projection.selection).toEqual({ total: 120, listed: 120, omitted: 0 });
  expect(projection.text.length).toBeLessThanOrEqual(MAX_CANVAS_PROMPT_CHARACTERS);
});
