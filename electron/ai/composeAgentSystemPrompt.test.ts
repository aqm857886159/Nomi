import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => process.cwd() } }));

import { composeAgentSystemPrompt, NOMI_AGENT_IDENTITY } from "../harness/context/agentContext";
import { setDesktopLocale } from "../desktopLocale";
import { sanitizeForBroadCompat } from "./promptSanitize";

// 语言规则跟界面语言走,所以字节稳定的口径是「**同一 locale 下**逐字节固定」——
// 这里把 locale 钉在 en,让下面的参照算法有确定的尾段可比。切语言时系统提示本来就该换一套,
// 那一刻击穿 vendor 前缀缓存是正确代价,不是漂移。
beforeEach(() => setDesktopLocale("en"));

// B1c 字节稳定门：systemPrompt 合成器把「身份 + 面板专长 + skill 方法论 + 项目记忆」四层
// 收成单一 filter+join("\n\n")+sanitize 的纯函数。vendor 前缀缓存依赖 byte 稳定——
// 这些快照锁死合成算法的**逐字节**输出，重构（抽函数）前后必须一致，改一个字节即红。

// characterization：现状（agentChatV2.ts:554-555）的等价内联算法，作独立参照。
// 合成器输出必须与它逐字节相同，证明抽函数没改变任何 byte。
// 语言规则首尾各一次（primacy/recency）：提示词主体是中文，只在末尾说一句压不住，
// 英文界面会退化成中英混答。定义仍只有 buildLanguageRule 一处，这里镜像它的注入方式。
const LANGUAGE_RULE_EN = [
  "Response-language rule (highest priority):",
  "Respond in English. Use another language only when the user explicitly requests it.",
  "This rule applies to every response, draft, shot description, and prompt, regardless of the language used by any skill or tool instruction.",
  "Most of the instructions in this prompt are written in Chinese. That is an implementation detail of this app and carries no meaning about your output language: still answer in English.",
].join("\n");

function referenceCompose(parts: Array<string | undefined>): string | undefined {
  const kept = parts.filter((p): p is string => Boolean(p) && p.length > 0);
  if (kept.length === 0) return undefined;
  return sanitizeForBroadCompat([LANGUAGE_RULE_EN, ...kept, LANGUAGE_RULE_EN].join("\n\n"));
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
      - 不把机器串摊给用户：节点/客户端 id、工具名、参数与 payload 的 JSON，一律不出现在回复正文里。提到某个镜头就用它的标题（「镜1」这类人话名），不要报 id。
      - 请用户确认计划时，用一两句人话说清「要做什么、动到哪几个镜头、会不会花钱」就够了；细节由确认卡片呈现，不要把计划的 JSON 再抄一遍给用户看。
      - 主动但不越权：该调工具就调，但所有写入/生成都要等用户在卡片上确认后才生效。"
    `);
  });

  // 回归闸（2026-08-28 用户截图）：模型在正文里逐条报 `gen-v2-image-…` 节点 id、并把待确认的
  // 工具 payload 抄成 JSON。渲染层的 toolCallSummary 只管 Nomi 自己的摘要，管不到模型正文——
  // 只能靠这条输出铁律。它被删掉/改写时这里必须红。
  it("输出铁律含「不报 id、不抄 JSON」两条（模型正文的机器串闸）", () => {
    expect(NOMI_AGENT_IDENTITY).toContain("不把机器串摊给用户");
    expect(NOMI_AGENT_IDENTITY).toContain("不要报 id");
    expect(NOMI_AGENT_IDENTITY).toContain("不要把计划的 JSON 再抄一遍给用户看");
  });

  // 身份层里**不再**带语言规则:它跟界面语言走,由 buildLanguageRule 殿后单独追加(P1 一条规则一个家)。
  // 之前身份层与合成器各存一份、且都写死英文,中文界面的用户会拿到用英文回话的助手。
  it("身份层不含语言规则（跟界面语言走，另起一段殿后）", () => {
    expect(NOMI_AGENT_IDENTITY).not.toMatch(/language rule/i);
    expect(NOMI_AGENT_IDENTITY).not.toContain("Respond in English");
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
    // 语言规则打头，身份 block 紧随其后；规则在末尾再出现一次（sanitize 后）。
    expect(composed?.startsWith(sanitizeForBroadCompat(LANGUAGE_RULE_EN))).toBe(true);
    expect(composed).toContain(sanitizeForBroadCompat(NOMI_AGENT_IDENTITY));
    expect(composed).toContain(sanitizeForBroadCompat(skill));
    expect(composed).toContain("Respond in English.");
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
    expect(composed).toBe(sanitizeForBroadCompat([
      LANGUAGE_RULE_EN,
      NOMI_AGENT_IDENTITY,
      panel,
      skill,
      memory,
      LANGUAGE_RULE_EN,
    ].join("\n\n")));
  });

  it("空段一律被过滤，不产生连续分隔或前后缀空行", () => {
    const composed = composeAgentSystemPrompt({
      identity: "A",
      panelSystemPrompt: "",
      skillSystemPrompt: "B",
      memoryBlock: "",
    });
    expect(composed).toBe(referenceCompose(["A", "", "B", ""])); // 不是 "A\n\n\n\nB"，也不是 "A\n\nB\n\n"
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
    expect(composed).toBe(referenceCompose(["身份 — 用了破折号", "箭头 → 这里"]));
    // 箭头被 ASCII 化（arrow → "->"），确认 sanitize 确实作用到了合成结果。
    expect(composed).toContain("->");
    expect(composed).not.toContain("→");
    expect(composed).not.toContain("—");
  });
});
