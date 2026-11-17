// 「生成这一组」的共用主人：意图表、缩范围、类型品牌。各入口只翻事实、只读结论（设计卡 docs/plan/2026-11-17-generation-scope-one-home.md）。
import { describe, expect, it } from "vitest";

import {
  SCOPE_INTENT_TABLE,
  classifyGenerationScope,
  hasSelectableScopeRow,
  narrowGenerationScope,
  planGenerationScope,
  unselectableScopeReasons,
  type GenerationScopeIntent,
  type GenerationScopePlan,
  type ScopeFacts,
  type ScopeItemFacts,
} from "./generationShotScope";

const item = (id: string, patch: Partial<ScopeItemFacts> = {}): ScopeItemFacts => ({
  id, generatable: true, hasResult: false, frozen: false, recoverable: false, busy: false, failed: false, settled: false, visualAnchor: false, ...patch,
});

const SHAPES = {
  ready: item("ready"),
  failedNoResult: item("failedNoResult", { failed: true }),
  failedWithResult: item("failedWithResult", { failed: true, hasResult: true }),
  idleWithResult: item("idleWithResult", { hasResult: true }),
  settled: item("settled", { hasResult: true, settled: true }),
  busy: item("busy", { busy: true }),
  recoverable: item("recoverable", { recoverable: true }),
  missingRequired: item("missingRequired", { missingRequired: true }),
  // 定妆（meta.frozen）：有结果的才算「满意了别动它」；没结果的照其余规则。
  frozenDone: item("frozenDone", { frozen: true, hasResult: true, settled: true }),
  frozenNoResult: item("frozenNoResult", { frozen: true }),
} as const;

// 意图 × 事实 → 行状态。每一格都是今天各入口的默认（U1 那一格保持各入口今天的样子）；改哪一格这里就红。
const EXPECTED: Record<GenerationScopeIntent, Record<keyof typeof SHAPES, string>> = {
  group: { ready: "checked", failedNoResult: "checked", failedWithResult: "checked", idleWithResult: "checked", settled: "unchecked", busy: "disabled", recoverable: "disabled", missingRequired: "excluded", frozenDone: "unchecked", frozenNoResult: "checked" },
  single: { ready: "checked", failedNoResult: "checked", failedWithResult: "checked", idleWithResult: "checked", settled: "checked", busy: "disabled", recoverable: "disabled", missingRequired: "excluded", frozenDone: "checked", frozenNoResult: "checked" },
  "shot-row": { ready: "checked", failedNoResult: "checked", failedWithResult: "checked", idleWithResult: "checked", settled: "checked", busy: "disabled", recoverable: "disabled", missingRequired: "excluded", frozenDone: "disabled", frozenNoResult: "checked" },
  "storyboard-batch": { ready: "checked", failedNoResult: "checked", failedWithResult: "checked", idleWithResult: "excluded", settled: "excluded", busy: "disabled", recoverable: "disabled", missingRequired: "excluded", frozenDone: "excluded", frozenNoResult: "checked" },
  "anchor-wave": { ready: "checked", failedNoResult: "checked", failedWithResult: "excluded", idleWithResult: "excluded", settled: "excluded", busy: "disabled", recoverable: "disabled", missingRequired: "excluded", frozenDone: "excluded", frozenNoResult: "checked" },
  "retry-failed": { ready: "checked", failedNoResult: "checked", failedWithResult: "checked", idleWithResult: "excluded", settled: "excluded", busy: "disabled", recoverable: "disabled", missingRequired: "excluded", frozenDone: "excluded", frozenNoResult: "checked" },
  "hand-over": { ready: "checked", failedNoResult: "checked", failedWithResult: "checked", idleWithResult: "checked", settled: "checked", busy: "disabled", recoverable: "disabled", missingRequired: "excluded", frozenDone: "checked", frozenNoResult: "checked" },
};

describe("意图表：每个入口的默认只在这一张表里", () => {
  it("表里的意图就是这七个（新增入口必须先在表里落一行）", () => {
    expect(Object.keys(SCOPE_INTENT_TABLE).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.keys(EXPECTED) as GenerationScopeIntent[])("%s：每种事实落到哪一格", (intent) => {
    const rows = classifyGenerationScope(intent, Object.values(SHAPES));
    expect(Object.fromEntries(rows.map((row) => [row.id, row.state]))).toEqual(EXPECTED[intent]);
  });

  it("生成中、可找回在任何入口都是灰行、勾不上（可找回已经付过钱，出路是免费找回）", () => {
    for (const intent of Object.keys(EXPECTED) as GenerationScopeIntent[]) {
      const rows = classifyGenerationScope(intent, [SHAPES.busy, SHAPES.recoverable]);
      expect(rows.map((row) => [row.state, row.reason])).toEqual([["disabled", "generating"], ["disabled", "recoverable"]]);
      expect(hasSelectableScopeRow(intent, [SHAPES.busy, SHAPES.recoverable])).toBe(false);
    }
  });

  it("不能生成的不成行；按入口给的顺序", () => {
    const rows = classifyGenerationScope("group", [item("b"), item("note", { generatable: false }), item("a")]);
    expect(rows.map((row) => row.id)).toEqual(["b", "a"]);
  });

  it("事实里没有锁：节点锁不进生成范围（用户 2026-11-17 定删节点锁）", () => {
    // @ts-expect-error — `locked` 不是生成范围的事实
    const withLock: ScopeItemFacts = { ...item("x"), locked: true };
    expect(classifyGenerationScope("group", [withLock])[0].state).toBe("checked");
  });
});

describe("规划：成员、补参考、分波", () => {
  const facts = (items: ScopeItemFacts[], edges: Array<[string, string]> = []): ScopeFacts => ({
    items, edges: edges.map(([source, target]) => ({ source, target })),
  });

  it("成员 = 默认勾上的行；灰行 / 默认不勾的在 rows 里、不在 members 里", () => {
    const plan = planGenerationScope({ intent: "group", selection: ["ready", "settled", "busy"], facts: facts(Object.values(SHAPES)) });
    expect(plan.members).toEqual(["ready"]);
    expect(plan.rows.map((row) => [row.id, row.state])).toEqual([["ready", "checked"], ["settled", "unchecked"], ["busy", "disabled"]]);
    expect(plan.waves).toEqual([["ready"]]);
  });

  it("单发：没出图的参考上游先补（在前一波），点的那一个在后", () => {
    const plan = planGenerationScope({ intent: "single", selection: ["shot"], facts: facts([item("char"), item("shot")], [["char", "shot"]]) });
    expect(plan.members).toEqual(["char", "shot"]);
    expect(plan.waves).toEqual([["char"], ["shot"]]);
  });

  it("组生成不补上游：上游没图 → 下游拦下「等上游」，不裸跑", () => {
    const plan = planGenerationScope({ intent: "group", selection: ["shot"], facts: facts([item("char"), item("shot")], [["char", "shot"]]) });
    expect(plan.waves).toEqual([]);
    expect(plan.blocked).toMatchObject([{ nodeId: "shot", reason: "missing-upstream" }]);
  });
});

describe("缩范围：一律再问主人，不从旧波次里删", () => {
  const graph: ScopeFacts = { items: [item("A"), item("B")], edges: [{ source: "A", target: "B" }] };

  it("剔掉没结果的上游 → 下游拦下「等上游」（旧做法从波次里删 A，B 照跑、缺参考）", () => {
    const plan = planGenerationScope({ intent: "group", selection: ["A", "B"], facts: graph });
    expect(plan.waves).toEqual([["A"], ["B"]]);
    const narrowed = narrowGenerationScope(plan, ["B"], graph);
    expect(narrowed.waves).toEqual([]);
    expect(narrowed.blocked).toMatchObject([{ nodeId: "B", reason: "missing-upstream" }]);
  });

  it("灰行勾不进来；卡开着时变成可找回的，再问时出局", () => {
    const facts: ScopeFacts = { items: [item("A"), item("B", { busy: true })], edges: [] };
    const plan = planGenerationScope({ intent: "group", selection: ["A", "B"], facts });
    expect(narrowGenerationScope(plan, ["A", "B"], facts).members).toEqual(["A"]);
    const later: ScopeFacts = { items: [item("A", { recoverable: true }), item("B")], edges: [] };
    expect(narrowGenerationScope(plan, ["A"], later).members).toEqual([]);
  });

  it("默认不勾的、人勾上就进（卡上的选择算数）", () => {
    const facts: ScopeFacts = { items: [item("done", { hasResult: true, settled: true })], edges: [] };
    const plan = planGenerationScope({ intent: "group", selection: ["done"], facts });
    expect(plan.members).toEqual([]);
    expect(narrowGenerationScope(plan, ["done"], facts).waves).toEqual([["done"]]);
  });
});

describe("类型品牌：执行计划只有主人造得出来", () => {
  it("字段一个不差、只是没经过主人的对象，不是执行计划（去掉品牌这里就编译不过）", () => {
    // 所有看得见的字段（字符串键）照抄一份；品牌是模块私有的 symbol 键，外面抄不到。
    type Forged = { [K in Extract<keyof GenerationScopePlan, string>]: GenerationScopePlan[K] };
    const forgedIsPlan: Forged extends GenerationScopePlan ? true : false = false;
    expect(forgedIsPlan).toBe(false);
  });
});

describe("置灰原因：一个都勾不上时各因为什么（按钮的禁用原因只从这里来）", () => {
  it("有能勾的 → null；全是生成中 / 可找回 → 按原因计数；没有能生成的 → 空", () => {
    expect(unselectableScopeReasons("group", [item("a"), item("b", { recoverable: true })])).toBeNull();
    expect(unselectableScopeReasons("group", [item("a", { recoverable: true }), item("b", { busy: true }), item("c", { recoverable: true })]))
      .toEqual([{ reason: "recoverable", count: 2 }, { reason: "generating", count: 1 }]);
    expect(unselectableScopeReasons("group", [item("t", { generatable: false })])).toEqual([]);
  });

  it("和按钮可用态同一判据：对表里每种形状，null ⇔ 有能勾的", () => {
    for (const intent of Object.keys(SCOPE_INTENT_TABLE) as GenerationScopeIntent[]) {
      for (const shape of Object.values(SHAPES)) {
        const items = [item("x", shape as Partial<ScopeItemFacts>)];
        expect(unselectableScopeReasons(intent, items) === null, `${intent} ${JSON.stringify(shape)}`).toBe(hasSelectableScopeRow(intent, items));
      }
    }
  });
});
