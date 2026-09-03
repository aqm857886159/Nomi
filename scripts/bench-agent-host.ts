/**
 * Project Agent host 验证热路径的**按需** A/B 量具（不进 CI，手动跑）。
 *
 * 它存在的理由：2026-09-03 有人用「拆模块前 9.1s、拆后 47s」判定 projectAgentState.ts 的
 * 断言层不能拆。那个判定是错的——它拿墙钟在一台常年 20+ worktree 并行的机器上做一次性 A/B，
 * 量到的是机器负载。同一条测试在**未改动**的代码上就能从 9.1s 漂到 29.7s（PR #410 实测）。
 * 用本量具重测：拆分后 CPU 时间 0% 变化，真实测试套件 3/3 轮持平甚至略快。
 * 详见 docs/lessons/wallclock-bisect-on-a-busy-machine-is-not-evidence.md。
 *
 * ── 怎么用 ─────────────────────────────────────────────────────────────────
 *   pnpm run bench:agent-host            # 测当前工作树
 *
 * 要判断一次重构有没有让热路径变慢，**必须交错 A/B**，不要「先测完 base 再测完 variant」
 * ——机器负载会在两段之间漂移，那正是上面那次误判的成因：
 *
 *   for r in 1 2 3; do
 *     git stash && pnpm run bench:agent-host        # BASE
 *     git stash pop && pnpm run bench:agent-host    # VARIANT
 *   done
 *
 * 判读规则：
 *   · 看 cpuMs 与 ratio，**不要看 wallMs**。wallMs 只作参考打印，机器一忙就没有意义
 *     （实测：同一份代码 wallMs 在 1509↔4222 之间摆，而 cpuMs 稳定在 ~1400）。
 *   · 两臂的 cpuMs 区间**重叠 = 没有信号**，不要凭中位数差几个百分点下结论。
 *   · ratio = cpuMs(热路径) / cpuMs(同进程内的固定对照负载)，额外抵消 CPU 型号与频率差异，
 *     所以它可以跨机器、跨平台比较；cpuMs 只能同机比较。
 *
 * ── 下结论之前先验量具（否则「没信号」什么也证明不了）────────────────────────
 * 任何「我没测出回归」的结论，都必须先证明这把尺子量得出回归。做法是注入一个**已知**的
 * 变慢再跑一遍，例如让 snapshotProjectAgentHostState 里的 assertProjectAgentHostState(value)
 * 连调两次。实测该 2x 注入下两臂完全分离（base 上界 1690 < variant 下界 2324），
 * 而 wallMs 在同一组数据里**分不开**（base 某轮 4222 > variant 某轮 3274）。
 */
import { createInitialProjectAgentState, snapshotProjectAgentHostState } from "../electron/projectAgentHost/projectAgentState";
import { reduceProjectAgentMutation } from "../electron/projectAgentHost/projectAgentReducer";
import type { ProjectAgentMutation } from "../electron/shared/projectAgentContracts";

const binding = {
  projectId: "project-a",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 3,
} as const;
const createdAt = "2026-08-28T00:00:00.000Z";

function enqueueMutation(index: number): ProjectAgentMutation {
  const turnId = `turn-${index}`;
  const timestamp = new Date(Date.parse(createdAt) + index).toISOString();
  const contextRef = {
    binding: {
      project: binding,
      threadId: "thread-a",
      sessionKey: `nomi:project-agent:${binding.immutableProjectUuid}:g${binding.projectGeneration}`,
    },
    recordId: "context-a",
    contextRevision: 7,
  } as const;
  return {
    commandId: `enqueue-${index}`,
    expectedRevision: index,
    binding,
    sender: { kind: "renderer", senderId: "renderer-a" },
    type: "turn.enqueue",
    payload: {
      thread: { threadId: "thread-a", createdAt, updatedAt: timestamp },
      turn: {
        turnId, threadId: "thread-a", status: "queued", retryable: false, deviated: false,
        executionToken: `token-${index}`, model: { id: "model-a", version: 1 },
        skillVersions: [], capabilityVersions: [{ id: "canvas.read", version: 1 }],
        contextRef, createdAt: timestamp, updatedAt: timestamp,
      },
      userItem: {
        kind: "user", itemId: `user-${index}`, threadId: "thread-a", turnId, status: "done",
        retryable: false, deviated: false, text: `queued request ${index}`,
        createdAt: timestamp, updatedAt: timestamp,
      },
      queueItem: {
        queueItemId: `queue-${index}`, threadId: "thread-a", turnId, status: "queued",
        retryable: false, deviated: false, binding,
        target: { kind: "canvas", nodeIds: ["node-a"] },
        preconditions: { nodes: [{ nodeId: "node-a", contentHash: "node-hash" }] },
        contextRef, model: { id: "model-a", version: 1 }, skillVersions: [],
        capabilityVersions: [{ id: "canvas.read", version: 1 }], policyRevision: 1,
        attachmentRefs: [], originSurface: { surfaceId: "surface-a", kind: "canvas" },
        enqueuedAt: timestamp, updatedAt: timestamp,
      },
    },
  } as ProjectAgentMutation;
}

const STATE_TURNS = 40;
const VALIDATIONS = 300;
const CONTROL_ITERATIONS = 300_000;
// 对照负载低于这个 CPU 毫秒数，几乎必然是被 V8 优化掉了而不是「机器真快」——见下方 sanity 检查。
const CONTROL_FLOOR_MS = 2;

/**
 * 固定对照负载。两个要求：
 *  ① 做的是和断言层**同一类**的活（属性访问、typeof/形状检查、Set 查找、正则、字符串构造），
 *    这样它和被测路径受 CPU 特性影响的方式相近，ratio 才有归一化意义；
 *  ② V8 不能把它优化掉。第一版每轮 new 一个临时对象，逃逸分析把整个循环删了
 *    （300 万次「跑」了 5ms），ratio 于是变成纯噪声。现在每一步都汇入被调用方消费的返回值。
 */
const CONTROL_KEYS = new Set(["alpha", "beta", "gamma", "delta"]);
const CONTROL_HEX = /^[a-f0-9]{8}$/;
const CONTROL_NAMES = ["alpha", "beta", "gamma", "delta", "epsilon"];
function controlWorkload(iterations: number): number {
  const seen = new Map<string, number>();
  let acc = 0;
  for (let i = 0; i < iterations; i += 1) {
    const name = CONTROL_NAMES[i % CONTROL_NAMES.length];
    if (CONTROL_KEYS.has(name)) acc += name.length;
    const hex = (i & 0xfffffff).toString(16).padStart(8, "0");
    if (CONTROL_HEX.test(hex)) acc += 1;
    seen.set(name, (seen.get(name) ?? 0) + 1);
    if (typeof name === "string" && name.trim() === name) acc += 1;
  }
  for (const value of seen.values()) acc += value;
  return acc;
}

function cpuMs(): number {
  const usage = process.cpuUsage();
  return (usage.user + usage.system) / 1000;
}

let state = createInitialProjectAgentState(binding);
for (let i = 0; i < STATE_TURNS; i += 1) state = reduceProjectAgentMutation(state, enqueueMutation(i)).state;
const untrustedSource = JSON.stringify(state);

let sink = 0;

function measureHotPath(): { wallMs: number; cpuMs: number } {
  // 每次都验证一个**全新的不受信对象**，于是 trustedStates 快路径永远不短路——这正是仓库
  // 从磁盘 JSON.parse 之后走的那条路，也正是「被拆出去」的那层逐记录断言。
  // 克隆放在计时区间之外：我们要量的是断言层，不是 JSON.parse。
  const clones = Array.from({ length: VALIDATIONS }, () => JSON.parse(untrustedSource));
  const wallStart = performance.now();
  const cpuStart = cpuMs();
  for (const clone of clones) snapshotProjectAgentHostState(clone);
  return { wallMs: performance.now() - wallStart, cpuMs: cpuMs() - cpuStart };
}

function measureControl(): { wallMs: number; cpuMs: number } {
  const wallStart = performance.now();
  const cpuStart = cpuMs();
  sink += controlWorkload(CONTROL_ITERATIONS);
  return { wallMs: performance.now() - wallStart, cpuMs: cpuMs() - cpuStart };
}

const roundsArg = process.argv.find((arg) => arg.startsWith("--rounds="));
const ROUNDS = Math.max(3, Number(roundsArg?.split("=")[1] ?? 5) || 5);

// 预热，让 V8 进到优化后的稳态；否则第一批样本量的是解释器。
for (let i = 0; i < 3; i += 1) { measureHotPath(); measureControl(); }

const samples: { wallMs: number; cpuMs: number; controlCpuMs: number; ratio: number }[] = [];
for (let i = 0; i < ROUNDS; i += 1) {
  const control = measureControl();
  const hot = measureHotPath();
  samples.push({
    wallMs: +hot.wallMs.toFixed(1),
    cpuMs: +hot.cpuMs.toFixed(1),
    controlCpuMs: +control.cpuMs.toFixed(1),
    ratio: +(hot.cpuMs / control.cpuMs).toFixed(3),
  });
}

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const controlMedian = median(samples.map((s) => s.controlCpuMs));
const report = {
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  config: { STATE_TURNS, VALIDATIONS, CONTROL_ITERATIONS, rounds: ROUNDS },
  samples,
  median: {
    wallMs: median(samples.map((s) => s.wallMs)),
    cpuMs: median(samples.map((s) => s.cpuMs)),
    controlCpuMs: controlMedian,
    ratio: median(samples.map((s) => s.ratio)),
  },
  // 量具自检：对照负载被优化掉时 ratio 会静静变成噪声，而不是报错——栽过一次，所以显式拦。
  controlSane: controlMedian >= CONTROL_FLOOR_MS,
};

console.log(JSON.stringify(report, null, 2));
if (!report.controlSane) {
  console.error(
    `\n✖ 对照负载只用了 ${controlMedian}ms CPU（< ${CONTROL_FLOOR_MS}ms），几乎可以肯定是被 V8 优化掉了。` +
      `\n  此时 ratio 是噪声，别拿它下结论；先修 controlWorkload 让结果真的被消费。`,
  );
  process.exit(1);
}
if (sink === 0) {
  console.error("\n✖ 对照负载的累加值为 0——它没有真的运行。");
  process.exit(1);
}
