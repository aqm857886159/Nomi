import type { CanvasReadResult } from "./canvasRead";

export const MAX_CANVAS_PROMPT_CHARACTERS = 12_000;
const SELECTED_IDS_BUDGET = 900;
const NODE_SUMMARY_BUDGET = 7_500;
const EDGE_SUMMARY_BUDGET = 1_800;

const compactHead = (text: string, max: number): string => {
  let compact = "";
  let pendingSpace = false;
  for (const character of text) {
    if (/\s/.test(character)) {
      if (compact) pendingSpace = true;
      continue;
    }
    const addition = `${pendingSpace ? " " : ""}${character}`;
    if (compact.length + addition.length > max) {
      return `${compact}${addition.slice(0, max - compact.length)}…`;
    }
    compact += addition;
    pendingSpace = false;
  }
  return compact;
};

function boundedJoin<T>(
  values: readonly T[],
  maxCharacters: number,
  separator: string,
  format: (value: T) => string,
): { text: string; truncated: boolean } {
  let text = "";
  for (const value of values) {
    const formatted = format(value);
    const addition = text ? `${separator}${formatted}` : formatted;
    if (text.length + addition.length <= maxCharacters) {
      text += addition;
      continue;
    }
    const marker = text ? `${separator}…` : "…";
    text = text.length + marker.length <= maxCharacters
      ? `${text}${marker}`
      : `${text.slice(0, Math.max(0, maxCharacters - 1)).trimEnd()}…`;
    return { text, truncated: true };
  }
  return { text, truncated: false };
}

function createPromptWriter(maxCharacters: number) {
  const parts: string[] = [];
  let length = 0;
  const appendLine = (line: string): boolean => {
    const separatorLength = parts.length ? 1 : 0;
    if (length + separatorLength + line.length > maxCharacters) return false;
    parts.push(line);
    length += separatorLength + line.length;
    return true;
  };
  const appendRemaining = (text: string, reserve = 0): boolean => {
    const separatorLength = parts.length ? 1 : 0;
    const available = maxCharacters - length - separatorLength - reserve;
    if (available <= 0) return true;
    const truncated = text.length > available;
    const value = truncated
      ? `${text.slice(0, Math.max(0, available - 1)).trimEnd()}…`
      : text;
    parts.push(value);
    length += separatorLength + value.length;
    return truncated;
  };
  return {
    appendLine,
    appendRemaining,
    remaining: () => maxCharacters - length,
    text: () => parts.join("\n"),
  };
}

/** Compact Pi presentation of the canonical, already-safe canvas.read result. */
export function formatCanvasForAgent(result: CanvasReadResult): string {
  if (result.nodes.length === 0) return "画布当前为空。";

  const titleById = new Map(result.nodes.map((node) => [node.id, compactHead(node.title, 80)]));
  const nodes = boundedJoin(result.nodes, NODE_SUMMARY_BUDGET, "\n", (node) => {
    const storyboardDesignId = (node as unknown as { meta?: { storyboardDesignId?: unknown } }).meta?.storyboardDesignId;
    const flags = [
      node.locked ? "已锁定" : null,
      node.hasResult ? "已有结果" : null,
      node.status !== "idle" && node.status !== "success" ? node.status : null,
    ].filter(Boolean);
    const promptHead = compactHead(node.prompt, 60);
    const resultIds = boundedJoin(node.resultIds ?? [], 260, ", ", (id) => compactHead(id, 120)).text;
    return [
      `- ${compactHead(node.id, 120)} | ${compactHead(node.kind, 40)}`,
      typeof node.shotIndex === "number" ? ` | 镜${node.shotIndex}` : "",
      typeof storyboardDesignId === "string" && storyboardDesignId.trim() ? ` | storyboard:${storyboardDesignId.trim()}` : "",
      ` | ${compactHead(node.title, 80)}`,
      flags.length ? ` | ${flags.join(",")}` : "",
      promptHead ? ` | prompt: ${promptHead}` : "",
      node.currentResultId ? ` | currentResultId: ${compactHead(node.currentResultId, 120)}` : "",
      resultIds ? ` | resultIds: ${resultIds}` : "",
    ].join("");
  });
  const edges = boundedJoin(result.edges, EDGE_SUMMARY_BUDGET, ", ", (edge) =>
    `${titleById.get(edge.source) || compactHead(edge.source, 120)}→${titleById.get(edge.target) || compactHead(edge.target, 120)}`);
  const selected = boundedJoin(result.selectedNodeIds ?? [], SELECTED_IDS_BUDGET, ", ", (id) => compactHead(id, 120));
  const writer = createPromptWriter(MAX_CANVAS_PROMPT_CHARACTERS);
  writer.appendLine(`画布节点 ${result.nodes.length} 个(id | 类型 | 标题 | 状态 | prompt 摘要 | 结果身份):`);
  writer.appendLine(`当前选中: ${selected.text || "无"}`);
  writer.appendLine(nodes.text);
  writer.appendLine(`引用边: ${edges.text || "无"}`);

  const selectedIds = new Set(result.selectedNodeIds ?? []);
  let promptTruncated = false;
  let promptsOmitted = false;
  const coreTruncated = selected.truncated || nodes.truncated || edges.truncated;
  for (const node of result.nodes) {
    if (!selectedIds.has(node.id) || node.prompt.length <= 60) continue;
    const heading = `「${compactHead(node.title, 80)}」(${compactHead(node.id, 120)}) 完整提示词:`;
    if (writer.remaining() <= heading.length + 2) {
      promptsOmitted = true;
      break;
    }
    writer.appendLine("");
    writer.appendLine(heading);
    promptTruncated = writer.appendRemaining(node.prompt, coreTruncated ? 2 : 0);
    if (promptTruncated) break;
  }
  if ((coreTruncated || promptsOmitted) && !promptTruncated) writer.appendLine("…");
  return writer.text();
}
