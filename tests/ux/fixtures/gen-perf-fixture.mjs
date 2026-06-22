// 标准重 fixture 生成器（性能专项 before/after 基准）。
//
// 以一个真实的 48 节点项目为种子，放大到 ~96 节点 + ~120 边 + 排满时间轴的「重项目」，
// 写成合法的 workspace manifest（.nomi/project.json，保留全部 payload 字段，绝不缺字段）。
// 资产 URL 原样保留种子的 nomi-local://（仍指向种子项目的真实磁盘资产 → 图片真能加载，
// 平移/缩放/播放的渲染开销真实可比）。
//
// 用法：
//   node tests/ux/fixtures/gen-perf-fixture.mjs                 → 写进真实 ~/Documents/Nomi Projects（进库可手测）
//   node tests/ux/fixtures/gen-perf-fixture.mjs <projectsDir>   → 写进指定 projects 目录（隔离实测用）
//
// 同时把记录快照存到 tests/ux/fixtures/perf-heavy.project.json（单一真相源，可回归再物化）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dir, "../../..");

const SEED = path.join(
  os.homedir(),
  "Documents/Nomi Projects/未命名项目 06_18 11_56-mqiyx4om-5e071915/.nomi/project.json",
);
const TARGET_NODES = 96; // 约种子的 2 倍：足以让 god-component 每帧重渲暴露规模卡顿
const COPIES = 2; // 复制份数
const EXTRA_CROSS_EDGES = 40; // 跨副本连边，造密集「毛线球」压边层
const TIMELINE_CLIPS = 20;

function loadSeed() {
  if (!fs.existsSync(SEED)) {
    console.error(`种子项目不存在：${SEED}\n（换一个有 ~40+ 节点的真实项目路径）`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(SEED, "utf8"));
}

// 网格布局：把节点按列摆开，避免全堆叠（真实画布也是铺开的）。
function gridPos(i, cols = 8, gapX = 380, gapY = 360) {
  return { x: 80 + (i % cols) * gapX, y: 80 + Math.floor(i / cols) * gapY };
}

function amplify(seed) {
  const gc = seed.payload?.generationCanvas ?? { nodes: [], edges: [], selectedNodeIds: [], groups: [] };
  const seedNodes = gc.nodes ?? [];
  const seedEdges = gc.edges ?? [];

  const nodes = [];
  const edges = [];
  const idMaps = []; // 每份副本的 旧id→新id 映射

  for (let c = 0; c < COPIES; c += 1) {
    const map = new Map();
    for (const n of seedNodes) {
      const newId = c === 0 ? n.id : `${n.id}__c${c}`;
      map.set(n.id, newId);
    }
    idMaps.push(map);
    seedNodes.forEach((n, i) => {
      const newId = map.get(n.id);
      const globalIdx = nodes.length;
      nodes.push({
        ...n,
        id: newId,
        position: gridPos(globalIdx), // 重新网格布局，铺满画布
      });
    });
    for (const e of seedEdges) {
      const src = map.get(e.source);
      const tgt = map.get(e.target);
      if (!src || !tgt) continue;
      edges.push({ ...e, id: `${e.id}__c${c}`, source: src, target: tgt });
    }
  }

  // 跨副本连边：让连接更密（压边层 bezier 重算）。源/目标随 index 派生，确定性、可复现。
  for (let k = 0; k < EXTRA_CROSS_EDGES && nodes.length > 2; k += 1) {
    const a = (k * 7) % nodes.length;
    const b = (a + 1 + (k % (nodes.length - 1))) % nodes.length;
    if (a === b) continue;
    edges.push({
      id: `edge-cross-${k}`,
      source: nodes[a].id,
      target: nodes[b].id,
      mode: "style_ref",
      order: 0,
    });
  }

  // 时间轴：找视频节点填满 videoTrack（播放压 TimelinePreview 每帧重渲）。
  const videoNodes = nodes.filter((n) => n.kind === "video" || n.renderKind === "shot-frame");
  const clips = [];
  const fps = seed.payload?.timeline?.fps ?? 30;
  const per = 150; // 每片 5s
  for (let i = 0; i < TIMELINE_CLIPS; i += 1) {
    const src = videoNodes[i % Math.max(1, videoNodes.length)] ?? nodes[i % nodes.length];
    const start = i * per;
    const res = src?.result ?? src?.history?.[0];
    clips.push({
      id: `clip-perf-${i}`,
      type: "video",
      sourceNodeId: src?.id ?? nodes[0]?.id,
      label: `镜头 ${i + 1}`,
      startFrame: start,
      endFrame: start + per,
      frameCount: per,
      offsetStartFrame: 0,
      offsetEndFrame: 0,
      url: res?.url,
      thumbnailUrl: res?.thumbnailUrl ?? res?.url,
    });
  }

  const timeline = {
    ...(seed.payload?.timeline ?? { version: 1, fps, scale: 1 }),
    playheadFrame: 0,
    tracks: [
      { id: "imageTrack", type: "image", label: "图片轨", clips: [] },
      { id: "videoTrack", type: "video", label: "视频轨", clips },
    ],
  };

  return {
    ...seed.payload,
    generationCanvas: { ...gc, nodes, edges, selectedNodeIds: [] },
    timeline,
  };
}

function main() {
  const seed = loadSeed();
  const payload = amplify(seed);
  const now = Date.now();
  const id = "project-perf-fixture-0001";
  const record = {
    id,
    name: "ZZ 性能基准 fixture",
    version: 2,
    createdAt: now,
    updatedAt: now,
    savedAt: now,
    revision: 1,
    lastKnownRootPath: "",
    payload,
  };

  const nodeCount = payload.generationCanvas.nodes.length;
  const edgeCount = payload.generationCanvas.edges.length;
  const clipCount = payload.timeline.tracks.find((t) => t.id === "videoTrack")?.clips.length ?? 0;

  // 1) 快照存进 fixtures（单一真相源）
  const snapshotPath = path.join(__dir, "perf-heavy.project.json");
  fs.writeFileSync(snapshotPath, JSON.stringify(record, null, 1));

  // 2) 物化到目标 projects 目录
  const projectsDir = process.argv[2] || path.join(os.homedir(), "Documents", "Nomi Projects");
  const dirName = `ZZ-perf-fixture-${id}`;
  const rootPath = path.join(projectsDir, dirName);
  const nomiDir = path.join(rootPath, ".nomi");
  fs.mkdirSync(nomiDir, { recursive: true });
  fs.mkdirSync(path.join(rootPath, "assets", "generated"), { recursive: true });
  fs.mkdirSync(path.join(rootPath, "assets", "imported"), { recursive: true });
  fs.mkdirSync(path.join(rootPath, "exports"), { recursive: true });
  const materialized = { ...record, lastKnownRootPath: path.resolve(rootPath) };
  fs.writeFileSync(path.join(nomiDir, "project.json"), JSON.stringify(materialized, null, 1));

  console.log(`✅ fixture 生成完毕`);
  console.log(`   节点 ${nodeCount} · 边 ${edgeCount} · 时间轴 clip ${clipCount}`);
  console.log(`   快照:  ${snapshotPath}`);
  console.log(`   物化:  ${path.join(nomiDir, "project.json")}`);
  console.log(`   名称:  「${record.name}」(库里搜 ZZ 即可，手测完可删整个 ${dirName} 目录)`);
}

main();
