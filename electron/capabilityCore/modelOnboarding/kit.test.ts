/**
 * 套件里发出去的东西**自己得是合法的**；AI 被拒的时候，拒绝信息教的做法也得**真走得通**。
 *
 * 「发给模型的例子本身就过不了我们自己的校验」是这类套件最贵的失败方式：AI 照着改，
 * 改出来的每一张都被拒，而它只会以为是自己写错了。样例是手写的字面量（出处见 `kitExamples.ts`），
 * 所以这条必须由机器守：schema 改了而样例没跟上，这里当场红。
 *
 * 「合法」是过得了**真实的声明提交**（校验 + 登记 + 能力投影），不只是 schema 校验：同步样例卡曾经 schema 校验
 * 过得去、真实提交却被中性键规则拒了——只测 schema 的那一格看不见登记这一层。
 * 另一半同理：被拒时信息教的改法曾经是「改用 create.paramMap」，而交卡 schema 不收这个键，AI 照做只会再被拒一次。
 * 所以第二组把信息里写的做法原样做一遍，声明就得能过，提示和校验不会再漂开。
 */
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeTempDir } from "../../../scripts/_test-temp.mjs";
import { relayDeclaration } from "../../../tests/ux/_relayVideoFixture.mjs";
import { NEUTRAL_PARAMETER_ALIASES } from "../../providerAdapter/promotionMeta";
import { ONBOARDING_KIT_EXAMPLES } from "./kitExamples";
import { buildOnboardingKit } from "./kit";
import { submitDeclaration } from "./submitDeclaration";

let settingsDir = "";
beforeEach(() => {
  settingsDir = makeTempDir("onboarding-kit-");
  vi.stubEnv("NOMI_SETTINGS_DIR", settingsDir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(settingsDir, { recursive: true, force: true });
});

describe("接入套件", () => {
  it.each(ONBOARDING_KIT_EXAMPLES.map((example) => [example.name, example] as const))(
    "样例 %s 原样交给真实的声明提交，登记成功",
    async (_name, example) => {
      const reply = await submitDeclaration({ name: example.name, declaration: JSON.stringify(example.card) });
      expect(reply, JSON.stringify(reply)).toMatchObject({ ok: true });
      const registered = (reply as unknown as { state: { models: Array<{ modelKey: string }> } }).state.models.map((model) => model.modelKey);
      expect(registered.sort()).toEqual(example.card.models.map((model) => model.modelKey).sort());
    },
  );

  it("两半形状各有一份样例：同步一份、异步+轮询一份", () => {
    const deliveries = new Set(
      ONBOARDING_KIT_EXAMPLES.flatMap((example) =>
        example.card.models.flatMap((model) => model.modes.map((mode) => mode.delivery))),
    );
    expect(deliveries).toContain("synchronous");
    expect(deliveries).toContain("asynchronous");
  });

  it("套件无前置可取，且四样东西一次给全", () => {
    const kit = buildOnboardingKit();
    expect(kit.contractSchema).toHaveProperty("$schema");
    // 整张卡的 schema 必须含 provider 块——这条路上连接可能还不存在，卡得自带身份。
    expect(JSON.stringify(kit.contractSchema)).toContain("authScheme");
    expect(kit.instructions.length).toBeGreaterThan(200);
    expect(kit.examples.length).toBeGreaterThanOrEqual(2);
    // 「怎么交」不能只说 action 名：顺序墙删掉之后，最要紧的一句是「不需要先有句柄、先有 key」。
    expect(kit.howToSubmit.action).toMatch(/no handle|no stage/i);
    expect(kit.howToSubmit.credentials).toMatch(/never print it/i);
    expect(kit.howToSubmit.tryOut).toMatch(/try_model/);
  });

  it("样例里一个凭据字段都没有（它是发给外部 AI 的公开数据）", () => {
    const text = JSON.stringify(ONBOARDING_KIT_EXAMPLES);
    for (const forbidden of ["apiKey", "api_key", "Bearer sk-", "secret"]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe("被拒的时候，信息里教的写法原样照做就能过", () => {
  /** 夹具是 .mjs，没有类型；这里只用到下面三处字段。 */
  type LooseCard = { models: Array<{ parameters: unknown[]; modes: Array<{ create: { multipart: { fields: Record<string, string> } } }> }> };
  /** 只有一个参数、一个线缆字段的最小视频卡：参数键叫 paramKey，线缆字段 wireField 读它。 */
  function card(paramKey: string, wireField: string): LooseCard {
    const draft = relayDeclaration("http://127.0.0.1:9", { shape: "content" }) as unknown as LooseCard;
    const model = draft.models[0];
    model.parameters = [{ key: paramKey, label: "P", type: "select", options: [{ value: "4", label: "4" }], default: "4" }];
    model.modes[0].create.multipart.fields = { model: "{{model.modelKey}}", prompt: "{{request.prompt}}", [wireField]: `{{request.params.${paramKey}}}` };
    return draft;
  }
  const submit = (draft: unknown) => submitDeclaration({ name: "Hint", declaration: JSON.stringify(draft) });
  async function rejectionOf(draft: unknown): Promise<string> {
    const reply = await submit(draft);
    expect(reply, JSON.stringify(reply)).toMatchObject({ ok: false });
    return String((reply as unknown as { rejections?: Array<{ message?: string }> }).rejections?.[0]?.message);
  }

  it.each(Object.entries(NEUTRAL_PARAMETER_ALIASES))("线缆名 %s：信息给的 {\"字段\": \"{{request.params.中性键}}\"} 照写就过", async (wireName, neutrals) => {
    const message = await rejectionOf(card(wireName, wireName));
    expect(message, "信息不再指向 AI 交不上去的键").not.toMatch(/paramMap/);
    const example = /"([A-Za-z0-9_]+)": "\{\{request\.params\.([A-Za-z0-9_]+)\}\}"/.exec(message);
    expect(example, message).not.toBeNull();
    const [, wireField, neutralKey] = example!;
    expect(wireField, "示例里的线缆字段就是被拒的那个名字").toBe(wireName);
    expect(neutrals, "示例里的中性键出自别名表").toContain(neutralKey);
    // 原样照做：参数键用中性名，线缆字段读它。
    const reply = await submit(card(neutralKey, wireField));
    expect(reply, JSON.stringify(reply)).toMatchObject({ ok: true });
  });

  it("不是 Nomi 参数键的名字：信息列出这一类能用的键，列出来的每一个照写都能过", async () => {
    const message = await rejectionOf(card("style_preset", "style_preset"));
    expect(message, "信息不再指向 AI 交不上去的键").not.toMatch(/paramMap/);
    // 列表在信息的最后；放不下时以省略号收尾（只会少列，不会列出一个用不了的键）。
    const listed = /\bvideo keys: (.+)$/.exec(message)?.[1]?.split(", ").filter((key) => /^[A-Za-z0-9_]+$/.test(key)) ?? [];
    expect(listed.length, message).toBeGreaterThan(5);
    for (const key of listed) {
      const reply = await submit(card(key, "style_preset"));
      expect(reply, `${key}: ${JSON.stringify(reply)}`).toMatchObject({ ok: true });
    }
  });

  it("没有中性对应物的字段：信息说的另一条路——不当参数，在线缆里写定值——也走得通", async () => {
    const draft = card("duration", "seconds");
    draft.models[0].parameters = [];
    draft.models[0].modes[0].create.multipart.fields = { model: "{{model.modelKey}}", prompt: "{{request.prompt}}", style_preset: "cinematic" };
    expect(await submit(draft), "没有参数、线缆里是定值").toMatchObject({ ok: true });
  });
});
