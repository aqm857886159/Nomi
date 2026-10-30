import type { CanvasReadResult } from "./canvasRead";
import { SHOT_TABLE_COMPACT_CHARACTERS, formatShotTableForAgent } from "./canvasReadShotTable";

export const MAX_CANVAS_PROMPT_CHARACTERS = 12_000;
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
): { text: string; truncated: boolean; listed: number } {
  let text = "";
  let listed = 0;
  for (const value of values) {
    const formatted = format(value);
    const addition = text ? `${separator}${formatted}` : formatted;
    if (text.length + addition.length <= maxCharacters) {
      text += addition;
      listed += 1;
      continue;
    }
    const marker = text ? `${separator}…` : "…";
    text = text.length + marker.length <= maxCharacters
      ? `${text}${marker}`
      : `${text.slice(0, Math.max(0, maxCharacters - 1)).trimEnd()}…`;
    return { text, truncated: true, listed };
  }
  return { text, truncated: false, listed };
}

/**
 * 给模型看的选区的账：总数 = 节点行里标了「选中」的行数 + 没列出的行数，永远写在文本里。
 */
export type CanvasSelectionAccount = Readonly<{ total: number; listed: number; omitted: number }>;

function selectionLine(account: CanvasSelectionAccount): string {
  if (account.total === 0) return "当前选中: 无";
  if (account.omitted === 0) return `当前选中 ${account.total} 个（节点行里标了「选中」）`;
  return `当前选中 ${account.total} 个，只列出了其中 ${account.listed} 个；没列出的不要猜，请让用户缩小选区`;
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

/** 紧凑文本，加上它对选区做的账（让调用方 / 测试读事实，而不是反过来解析排版）。 */
export type CanvasAgentProjection = Readonly<{ text: string; selection: CanvasSelectionAccount }>;

const EMPTY_SELECTION: CanvasSelectionAccount = Object.freeze({ total: 0, listed: 0, omitted: 0 });

/** Compact Pi presentation of the canonical, already-safe canvas.read result. */
export function formatCanvasForAgent(result: CanvasReadResult): string {
  return projectCanvasForAgent(result).text;
}

/**
 * 紧凑文本的唯一 owner。选区那一块的不变量：节点行上的「选中」标记与总数对得上；
 * 选中的节点优先进入节点预算，放不下就明说列出了多少。截断不是静默的——`…` 只用来说节点 / 边 / 分镜表被截了。
 */
export function projectCanvasForAgent(result: CanvasReadResult): CanvasAgentProjection {
  if (result.nodes.length === 0) return { text: "画布当前为空。", selection: EMPTY_SELECTION };

  const selectedAll = result.selectedNodeIds ?? [];
  const selectedIds = new Set(selectedAll);
  const orderedNodes = [
    ...result.nodes.filter((node) => selectedIds.has(node.id)),
    ...result.nodes.filter((node) => !selectedIds.has(node.id)),
  ];

  const titleById = new Map(result.nodes.map((node) => [node.id, compactHead(node.title, 80)]));
  let nodes = boundedJoin(orderedNodes, NODE_SUMMARY_BUDGET, "\n", (node) => {
    const storyboardDesignId = (node as unknown as { meta?: { storyboardDesignId?: unknown } }).meta?.storyboardDesignId;
    const flags = [
      selectedIds.has(node.id) ? "选中" : null,
      node.locked ? "已锁定" : null,
      node.hasResult ? "已有结果" : null,
      node.status !== "idle" && node.status !== "success" ? node.status : null,
    ].filter(Boolean);
    const role = node.shotRole === "first_frame" ? "首帧图" : node.shotRole === "video" ? "视频" : "";
    // 分镜镜头只说分镜号（node.shotLabel，已含「首帧图」）；其余节点没有镜号，只有角色（首帧图 / 视频）。
    const shotLabel = node.shotLabel ?? role;
    const owners = boundedJoin(node.shotOwnerNodeIds ?? [], 260, ", ", (id) => compactHead(id, 120)).text;
    const promptHead = compactHead(node.prompt, 60);
    const resultIds = boundedJoin(node.resultIds ?? [], 260, ", ", (id) => compactHead(id, 120)).text;
    return [
      `- ${compactHead(node.id, 120)} | ${compactHead(node.kind, 40)}`,
      shotLabel ? ` | ${shotLabel}` : "",
      owners ? ` | shotOwnerNodeIds: ${owners}` : "",
      typeof storyboardDesignId === "string" && storyboardDesignId.trim() ? ` | storyboard:${storyboardDesignId.trim()}` : "",
      ` | ${compactHead(node.title, 80)}`,
      flags.length ? ` | ${flags.join(",")}` : "",
      promptHead ? ` | prompt: ${promptHead}` : "",
      node.text ? ` | text: ${compactHead(node.text, 60)}${node.textTruncated ? "(正文已截断)" : ""}` : "",
      node.currentResultId ? ` | currentResultId: ${compactHead(node.currentResultId, 120)}` : "",
      resultIds ? ` | resultIds: ${resultIds}` : "",
      node.taskRef ? ` | taskRef: ${JSON.stringify(node.taskRef)}` : "",
      node.shotTable ? ` | 分镜表 ${node.shotTable.rowCount} 镜（行见下方）` : "",
      node.director ? ` | 3D-BOX revision=${node.director.revision} shots=${boundedJoin(node.director.shots, 120, ",", (name) => compactHead(name, 40)).text} actors=${boundedJoin(node.director.actors, 80, ",", (name) => compactHead(name, 40)).text}${node.director.setPieces.length ? ` setPieces=${boundedJoin(node.director.setPieces, 60, ",", (name) => compactHead(name, 40)).text}` : ""} issues=${node.director.issueCount} preview=${node.director.preview}${node.director.previewTargetNodeId ? `→${compactHead(node.director.previewTargetNodeId, 120)}` : ""}${node.director.previewAssetId ? ` previewAssetId=${compactHead(node.director.previewAssetId, 120)}` : ""}` : "",
    ].join("");
  });
  // Keep the addressable inventory before prompt excerpts and duplicated result
  // history. Otherwise later shots disappear although the full read contains them.
  if (nodes.truncated) {
    nodes = boundedJoin(orderedNodes, NODE_SUMMARY_BUDGET, '\n', (node) => [
      `- ${compactHead(node.id, 120)} | ${compactHead(node.kind, 40)} | ${compactHead(node.title, 80)}`,
      node.shotLabel ? ` | ${node.shotLabel}` : '',
      selectedIds.has(node.id) ? ' | 选中' : '',
      node.hasResult ? ' | 已有结果' : '',
      node.status !== 'idle' && node.status !== 'success' ? ` | ${node.status}` : '',
      node.locked ? ' | 已锁定' : '',
    ].join(''))
  }
  const listedSelected = orderedNodes.slice(0, nodes.listed).filter((node) => selectedIds.has(node.id)).length;
  const selection: CanvasSelectionAccount = selectedAll.length === 0
    ? EMPTY_SELECTION
    : { total: selectedAll.length, listed: listedSelected, omitted: selectedAll.length - listedSelected };
  const edgeBudget = Math.min(4_000, Math.max(EDGE_SUMMARY_BUDGET, MAX_CANVAS_PROMPT_CHARACTERS - nodes.text.length - 600));
  const edges = boundedJoin(result.edges, edgeBudget, ", ", (edge) =>
    `${titleById.get(edge.source) || compactHead(edge.source, 120)}→${titleById.get(edge.target) || compactHead(edge.target, 120)}`);
  const writer = createPromptWriter(MAX_CANVAS_PROMPT_CHARACTERS);
  writer.appendLine(`画布节点 ${result.nodes.length} 个(id | 类型 | 镜头号与角色 | 归属节点 | 标题 | 状态 | prompt 摘要 | 结果身份):`);
  writer.appendLine(selectionLine(selection));
  writer.appendLine(nodes.text);
  writer.appendLine(`引用边: ${edges.text || "无"}`);

  // 分镜表的行：排在选中节点的完整提示词之前（用户说「照第 2 镜复刻」时，那一镜的提示词就是要读的正文）。
  // 每张表分到「剩余预算 / 剩下几张表」与单表上限中的小者；表内的取舍（勾选的先、没放下的镜号明列）归 formatShotTableForAgent。
  const tables = result.nodes.filter((node) => node.shotTable);
  let tableBudgetTruncated = false;
  tables.forEach((node, index) => {
    const share = Math.floor((writer.remaining() - 2) / (tables.length - index)) - 1;
    if (share < 120) { tableBudgetTruncated = true; return; }
    writer.appendLine("");
    writer.appendLine(formatShotTableForAgent({ id: node.id, title: node.title, table: node.shotTable! }, Math.min(SHOT_TABLE_COMPACT_CHARACTERS, share)));
  });

  // 完整提示词 / 正文跟所有选中的节点走；预算不够时沿用正文截断提示。
  let promptTruncated = false;
  let promptsOmitted = false;
  const coreTruncated = nodes.truncated || edges.truncated || tableBudgetTruncated;
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
  for (const node of result.nodes) {
    if (promptTruncated || !selectedIds.has(node.id) || !node.text || node.text.length <= 60) continue;
    const heading = `「${compactHead(node.title, 80)}」(${compactHead(node.id, 120)}) 文本正文${node.textTruncated ? "(已截断)" : ""}:`;
    if (writer.remaining() <= heading.length + 2) {
      promptsOmitted = true;
      break;
    }
    writer.appendLine("");
    writer.appendLine(heading);
    promptTruncated = writer.appendRemaining(node.text, coreTruncated ? 2 : 0);
  }
  if ((coreTruncated || promptsOmitted) && !promptTruncated) writer.appendLine("…");
  return { text: writer.text(), selection };
}
