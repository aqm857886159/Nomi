import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => process.cwd() } }));

import { composeAgentSystemPrompt, NOMI_AGENT_IDENTITY } from "../harness/context/agentContext";
import { sanitizeForBroadCompat } from "./promptSanitize";

// B1c 字节稳定门：systemPrompt 合成器把「身份 + 面板专长 + skill 方法论 + 项目记忆」四层
// 收成单一 filter+join("\n\n")+sanitize 的纯函数。vendor 前缀缓存依赖 byte 稳定——
// 这些快照锁死合成算法的**逐字节**输出，重构（抽函数）前后必须一致，改一个字节即红。

// characterization：现状（agentChatV2.ts:554-555）的等价内联算法，作独立参照。
// 合成器输出必须与它逐字节相同，证明抽函数没改变任何 byte。
function referenceCompose(parts: Array<string | undefined>): string | undefined {
  const kept = parts.filter((p): p is string => Boolean(p) && p.length > 0);
  return kept.length > 0 ? sanitizeForBroadCompat(kept.join("\n\n")) : undefined;
}

describe("composeAgentSystemPrompt — 四层合成的字节稳定", () => {
  it("身份单一真相源：NOMI_AGENT_IDENTITY 字节串锁死", () => {
    expect(NOMI_AGENT_IDENTITY).toMatchInlineSnapshot(`
      "你是 Nomi 的 AI 创作伙伴。

      Nomi 是一个本地优先的 AI 视频创作工作台。用户在这里把一个想法做成视频，路径是：创作区写文案/故事/剧本 →（拆镜头）→ 生成画布把每个镜头排成节点、选模型配参数 → 时间轴拼接预览 → 导出 MP4。你始终清楚用户正处在这条链的哪一环，给的帮助要能把他推进到下一环。
      用户是创作者，要的是能直接用的成品，不是方法论。

      输出铁律：
      - 具体、可执行、可视化：给画面、给细节、给能直接落地的内容；不要空泛建议和正确的废话。
      - 密度优先、少即是多：克制利落，不堆套话、不复述用户的话、不写「希望对你有帮助」这类填充。
      - 模型与能力一律用它的真名（vendor 原词，如 Seedance、全能参考），不要替用户翻译成自创词，以免把能力说窄。
      - 不泄露内部推理链路，直接给结论和成品。
      - 主动但不越权：该调工具就调，但所有写入/生成都要等用户在卡片上确认后才生效。

      语言规则（最高优先级，覆盖一切其他指令）：
      始终用与用户相同的自然语言回复——用户用中文你就用中文，用英文就用英文，用日文就用日文；写进文稿和节点 prompt 的内容同样跟随用户语言。
      永远不要因为本系统提示或某个 skill 是用中文/英文写的，就固定用那种语言；以用户最近一条消息的语言为准。"
    `);
  });

  it("创作区形态（无面板专长层）：身份 + skill 方法论，与参照逐字节相同", () => {
    const skill = "Nomi 桌面 Agent 已加载本地 skill。\nskillKey: workbench.creation.general\n\n方法论正文……";
    const composed = composeAgentSystemPrompt({
      identity: NOMI_AGENT_IDENTITY,
      panelSystemPrompt: "",
      skillSystemPrompt: skill,
      memoryBlock: "",
    });
    // 与现状内联逻辑逐字节相同（空面板段被过滤，身份与 skill 以 \n\n 相接）。
    expect(composed).toBe(referenceCompose([NOMI_AGENT_IDENTITY, "", skill, ""]));
    // 身份 block 完整出现在最前、skill 完整出现在末尾（sanitize 后）。
    expect(composed?.startsWith(sanitizeForBroadCompat(NOMI_AGENT_IDENTITY))).toBe(true);
    expect(composed?.endsWith(sanitizeForBroadCompat(skill))).toBe(true);
    expect(composed).toContain(`${sanitizeForBroadCompat(NOMI_AGENT_IDENTITY)}\n\n${sanitizeForBroadCompat(skill)}`);
  });

  it("生成画布形态（含面板专长层 + skill + 记忆）四层齐全，与参照逐字节相同", () => {
    const panel = "你现在在「生成画布」工作：把用户的想法落成画布上的节点、引用边和真实生成任务。";
    const skill = "已加载 storyboard-planner skill。";
    const memory = "项目记忆：\n- 主角叫小云雀";
    const composed = composeAgentSystemPrompt({
      identity: NOMI_AGENT_IDENTITY,
      panelSystemPrompt: panel,
      skillSystemPrompt: skill,
      memoryBlock: memory,
    });
    // 四段顺序：身份 -> 面板 -> skill -> 记忆，各以 \n\n 相接，再整体 sanitize；与现状逐字节相同。
    expect(composed).toBe(referenceCompose([NOMI_AGENT_IDENTITY, panel, skill, memory]));
    expect(composed).toBe(sanitizeForBroadCompat([NOMI_AGENT_IDENTITY, panel, skill, memory].join("\n\n")));
  });

  it("空段一律被过滤，不产生连续分隔或前后缀空行", () => {
    const composed = composeAgentSystemPrompt({
      identity: "A",
      panelSystemPrompt: "",
      skillSystemPrompt: "B",
      memoryBlock: "",
    });
    expect(composed).toBe("A\n\nB"); // 不是 "A\n\n\n\nB"，也不是 "A\n\nB\n\n"
  });

  it("四层全空 → undefined（不发 system 槽）", () => {
    expect(
      composeAgentSystemPrompt({ identity: "", panelSystemPrompt: "", skillSystemPrompt: "", memoryBlock: "" }),
    ).toBeUndefined();
  });

  it("sanitize 生效：合成结果整体过 sanitizeForBroadCompat（与现状同一处 sanitize）", () => {
    const composed = composeAgentSystemPrompt({
      identity: "身份 — 用了破折号",
      panelSystemPrompt: "箭头 → 这里",
      skillSystemPrompt: "",
      memoryBlock: "",
    });
    // 合成 = 过滤空段 → join('\n\n') → sanitize，与现状同一处 sanitize 逐字节相同。
    expect(composed).toBe(sanitizeForBroadCompat("身份 — 用了破折号\n\n箭头 → 这里"));
    // 箭头被 ASCII 化（arrow → "->"），确认 sanitize 确实作用到了合成结果。
    expect(composed).toContain("->");
    expect(composed).not.toContain("→");
    expect(composed).not.toContain("—");
  });
});
