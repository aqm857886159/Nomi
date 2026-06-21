// S2 driver —— 用 Nomi **真实领域逻辑**(capabilityCore/canvasGraph 纯函数)按场景建图,
// 产出带真实客观信号的轨迹。离线、零额度、零 electron:只跑到「图建好+连边校验」,
// **真 vendor 生成被 stub**(producedAsset 由能力覆盖推,真画质留额度门后)。
// 从 S1 mock → 真领域逻辑:连边/skip/语义边正确性全是 canvasGraph 真算的。
import {
  emptyCanvasSnapshot,
  addNodes,
  connectNodes,
} from "../../electron/capabilityCore/canvasGraph";
import type { LearnedDefaults } from "./learnedDefaults";

export const REF_CAPS = ["character_ref", "style_ref", "image_ref"];
const VIDEO_CAPS = ["i2v", "t2v"];

// 每个参考能力族的「语义正确边模式」——全部取自 canvasGraph 的 VALID_EDGE_MODES
// (character_ref/style_ref/composition_ref),否则 connectNodes 会把非法模式强制回退 reference。
// 注:image_ref 无专用边模式 → 语义上归 composition_ref(实查 canvasGraph 得出,非臆测)。
export const SEMANTIC_EDGE_MODE: Record<string, string> = {
  character_ref: "character_ref",
  style_ref: "style_ref",
  image_ref: "composition_ref",
};

export type Trajectory = {
  expects: string[];
  usedCapabilities: string[];
  missing: string[];
  nodesBuilt: number;
  edgesBuilt: number;
  skipped: number;
  refEdges: number;
  semanticCorrectEdges: number;
  producedAsset: boolean;
  errors: number;
  retries: number;
  invalidEdges: number;
  cost: number;
};

export function driveScenario(
  scenario: { intent?: string; expects?: string[] },
  learned: LearnedDefaults,
  nomiCaps: Set<string>,
): Trajectory {
  const expects = scenario.expects ?? [];
  const missing = expects.filter((c) => !nomiCaps.has(c));
  const used = expects.filter((c) => nomiCaps.has(c));
  const refCaps = expects.filter((c) => REF_CAPS.includes(c) && nomiCaps.has(c));
  const isVideo = expects.some((c) => VIDEO_CAPS.includes(c));

  // —— 用真 canvasGraph 建图 ——
  let snap = emptyCanvasSnapshot();
  const shots = addNodes(
    snap,
    [0, 1].map((i) => ({
      kind: isVideo ? "video" : "image",
      title: `shot ${i + 1}`,
      prompt: scenario.intent,
    })),
  );
  snap = shots.snapshot;

  const refNodes: { cap: string; id: string }[] = [];
  for (const cap of refCaps) {
    const kind =
      cap === "character_ref" ? "character" : cap === "style_ref" ? "style" : "image";
    const r = addNodes(snap, [{ kind, title: cap }]);
    snap = r.snapshot;
    refNodes.push({ cap, id: r.ids[0] });
  }

  // 参考边模式:有「学到默认」用之,否则回退泛用 'reference'(= 基线的语义 bug)。
  const conns: { source: string; target: string; mode: string }[] = [];
  for (const ref of refNodes)
    for (const shotId of shots.ids)
      conns.push({ source: ref.id, target: shotId, mode: learned.refEdgeMode[ref.cap] ?? "reference" });
  const connected = connectNodes(snap, conns);
  snap = connected.snapshot;

  // 语义边正确性:参考边 mode 是否等于该能力族的规范语义模式(SEMANTIC_EDGE_MODE)。
  let refEdges = 0;
  let semanticCorrect = 0;
  for (const e of snap.edges) {
    const ref = refNodes.find((r) => r.id === e.source);
    if (ref) {
      refEdges += 1;
      if (e.mode === SEMANTIC_EDGE_MODE[ref.cap]) semanticCorrect += 1;
    }
  }

  return {
    expects,
    usedCapabilities: used,
    missing,
    nodesBuilt: snap.nodes.length,
    edgesBuilt: snap.edges.length,
    skipped: connected.skipped.length,
    refEdges,
    semanticCorrectEdges: semanticCorrect,
    producedAsset: missing.length === 0, // stub:真生成留额度门后
    errors: missing.length + connected.skipped.length,
    retries: 1 + missing.length,
    invalidEdges: connected.skipped.length,
    cost: 0,
  };
}
