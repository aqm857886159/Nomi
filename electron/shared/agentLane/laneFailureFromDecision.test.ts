import { describe, expect, it } from "vitest";

import { isBareCodeMessage, laneFailureFromDecision } from "./laneFailureFromDecision";
import { issuesFromParameterRejection } from "./toolInputIssues";
import { laneToolFailureToRpc, renderLaneToolFailure } from "./laneToolContract";

describe("传输判决 → 模型看得懂的失败", () => {
  it('C18: generation failure ignores raw provider text and forbids repayment before reconciliation', () => {
    const failure = laneFailureFromDecision({ toolName: 'generate', code: 'generation_execution_failed',
      message: 'synthetic-secret-token /private/project/prompt', fallbackCode: 'tool_execution_failed', nextAction: 'Retry and pay again.' });
    expect(JSON.stringify(failure)).not.toContain('synthetic-secret');
    expect(failure.nextAction).toContain('Do not request payment');
    expect(failure.nextAction).toContain('reconcile');
  });
  // 2026-09-18 根因：传输适配器里有 9 处写着 `message: code`。前人诊断过后果并留在
  // `laneRuntimePort.ts` 头部：「`[error] E_DENIED` 对一个要自纠的模型等于什么都没说……
  // 模型据此没法自纠，只会把同一个调用再发一遍，用户撞到的『连续 6 次被自己拒收』就是这么来的」。
  // 他们在延迟组那个出口修了，**兄弟出口 laneDesktopTools 没跟上**（文档/画布/时间轴三条 lane 走那儿）。
  it("裸码进来，出去的绝不是裸码", () => {
    const failure = laneFailureFromDecision({
      toolName: "read_script",
      code: "capability_unsupported",
      message: "capability_unsupported", // ← 适配器里那 9 处写的就是这个
      fallbackCode: "capability_execution_failed",
      nextAction: "Read the current state and retry with what you just read.",
    });
    expect(failure.message).not.toBe(failure.code);
    expect(failure.message).toContain("read_script");
    expect(failure.nextAction.length).toBeGreaterThan(0);
    // 码仍然在正文里出现一次（UI 分档要它），但它不是**唯一**的内容。
    expect(failure.message.length).toBeGreaterThan(failure.code.length * 2);
  });

  it("领域给了真原因就带上——这是模型自纠唯一有用的那部分", () => {
    const failure = laneFailureFromDecision({
      toolName: "draft_shots",
      code: "generation_input_invalid",
      message: "shots.0.candidate: Required",
      fallbackCode: "capability_execution_failed",
      nextAction: "Fix that field and call again.",
    });
    expect(failure.message).toContain("shots.0.candidate: Required");
  });

  it("领域给了人话建议就用它，压过合成的那句", () => {
    const failure = laneFailureFromDecision({
      toolName: "write_script",
      code: "capability_unsupported",
      message: "capability_unsupported",
      fallbackCode: "capability_execution_failed",
      advice: { message: "The project disk has no free space.", nextAction: "Free space, then retry." },
      nextAction: "（这句该被 advice 压过）",
    });
    expect(failure.message).toBe("The project disk has no free space.");
    expect(failure.nextAction).toBe("Free space, then retry.");
  });

  it("空串、缺省也算「等于没说」——不然它们会伪装成有内容", () => {
    expect(isBareCodeMessage(undefined, "x")).toBe(true);
    expect(isBareCodeMessage("   ", "x")).toBe(true);
    expect(isBareCodeMessage("x", "x")).toBe(true);
    expect(isBareCodeMessage(" x ", "x")).toBe(true);
    // 阳性对照：真有内容的那句不能被误判成裸码，否则这道闸会把唯一有用的信息丢掉。
    expect(isBareCodeMessage("shots.0: Required", "generation_input_invalid")).toBe(false);
  });


  // 2026-09-21 真实模型 18 句实测：121 次调用 / 45 次重试，其中 **23 次**（`draft_shots` 17 +
  // `generate` 6）收到的都是「submission outcome may be unknown … reconcile its existing submission」。
  // `draft_shots` 连一次提交都发不出去，于是模型去核对一个从不存在的任务——A3 那一轮 27 次调用 / 696 秒。
  // 判据从动词声明派生，所以这两条是**同一个函数**在两个工具上的两种答案，不是两份措辞。
  describe("「提交结果可能未知」只说给发得出提交的那些工具", () => {
    const failureFor = (toolName: string) => laneFailureFromDecision({
      toolName, code: "generation_execution_failed", message: "generation_execution_failed",
      fallbackCode: "tool_execution_failed", nextAction: "（该被 taskAdvice 压过）",
    });

    it("draft_shots 只起草：不许说可能提交过，也不许指挥它去核对任务", () => {
      const failure = failureFor("draft_shots");
      expect(failure.message).not.toContain("unknown");
      expect(failure.message).toContain("nothing was spent");
      expect(failure.nextAction).not.toContain("Query the same domain-qualified task");
      expect(failure.nextAction).toContain("never created one");
    });

    it("generate 在全自动档下真的会开跑：这句话对它成立，一个字都不改", () => {
      const failure = failureFor("generate");
      expect(failure.message).toContain("submission outcome may be unknown");
      expect(failure.nextAction).toContain("Query the same domain-qualified task");
    });

    it("认不出的工具名 fail-closed 到「可能提交过」——宁可多核对一次，也不哄模型说钱没花", () => {
      expect(failureFor("some_tool_added_tomorrow").message).toContain("submission outcome may be unknown");
    });
  });

  // 发出去之前就失败了（D2 第③步还的债 c）：账本说这份计划一笔都没到过供应商，兜底码就按事实读成「没开始」——
  // 两个出口（laneDesktopTools / laneExtendedTools）都只走这一处，回执和面板说的都是「没发出去、没花钱」。
  describe("账本说一笔都没到过供应商：说「没发出去、没花钱」，不说结果未知", () => {
    const failureWith = (submissionStarted: boolean | undefined) => laneFailureFromDecision({
      toolName: "generate", code: "generation_execution_failed", message: "generation_execution_failed",
      fallbackCode: "tool_execution_failed", nextAction: "（该被 taskAdvice 压过）", submissionStarted,
    });

    it("submissionStarted: false → generation_not_started；不指挥模型去核对一个不存在的任务", () => {
      const failure = failureWith(false);
      expect(failure.code).toBe("generation_not_started");
      expect(failure.message).toContain("nothing was spent");
      expect(failure.message).not.toContain("unknown");
      expect(failure.nextAction).toContain("Do not query for a task");
    });

    it("可能到过（true）或读不到账本（缺席）→ 照旧说结果可能未知、先核对", () => {
      for (const started of [true, undefined]) {
        const failure = failureWith(started);
        expect(failure.code).toBe("generation_execution_failed");
        expect(failure.message).toContain("submission outcome may be unknown");
      }
    });

    it("别的码不受这条事实影响", () => {
      const failure = laneFailureFromDecision({ toolName: "generate", code: "generation_provider_unavailable", message: undefined, fallbackCode: "x", nextAction: "n", submissionStarted: false });
      expect(failure.code).toBe("generation_provider_unavailable");
    });
  });

  it("没有 code 时也永远有 nextAction——没有下一步的拒绝会让模型把同一个调用原样再发一遍", () => {
    const failure = laneFailureFromDecision({
      toolName: "look_at_canvas", code: undefined, message: undefined,
      fallbackCode: "capability_execution_failed",
      nextAction: "Read the canvas again before retrying.",
    });
    expect(failure.code).toBe("capability_execution_failed");
    expect(failure.message).not.toBe(failure.code);
    expect(failure.nextAction).toBe("Read the canvas again before retrying.");
  });

  // 2026-11-07：准入层的字段事实（ParameterRejection）进同一份清单——模型在那句话下面读到同一个格式器写的字段行，
  // 公开信封里有字段与合法值（面板说「哪个字段 · 该填什么」），顶层 allowed 就是撞满转提问时的选项。
  it("准入拒收带着字段事实：同一个格式器写字段行，信封带字段与合法值", () => {
    const issues = issuesFromParameterRejection({ code: "parameter_not_in_enum", path: "parameters.resolution", allowedValues: ["480p", "720p"], allowedKeys: ["duration", "resolution"] });
    const failure = laneFailureFromDecision({
      toolName: "draft_shots", code: "generation_input_invalid", admission: "parameter_not_in_enum",
      message: "参数 parameters.resolution 的取值 4k 不在合法取值里。", issues,
      fallbackCode: "capability_execution_failed", nextAction: "Read state again.",
    });
    expect(failure.issues).toBe(issues);
    expect(failure.allowed).toEqual(["480p", "720p"]);
    const text = renderLaneToolFailure(failure);
    expect(text).toContain("  - parameters.resolution: value is not allowed. Use one of: 480p, 720p.");
    expect(text.match(/480p, 720p/g)).toHaveLength(1);
    expect(laneToolFailureToRpc(failure)).toMatchObject({ code: "generation_input_invalid", allowed: ["480p", "720p"], issues: [{ path: "parameters.resolution", kind: "not_allowed", allowed: ["480p", "720p"] }] });
  });
});
