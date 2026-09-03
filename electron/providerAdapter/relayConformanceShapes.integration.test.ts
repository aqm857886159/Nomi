// 自建中转一致性台架 · 第二步「形状矩阵」（docs/plan/…-self-hosted-relay-conformance-harness.md §3.2）。
//
// ★ 覆盖的不是「协议对不对」，而是**用户真能落到的目录形状**。前几个文件驱动的是一条理想链路
// （草稿 → 认证 → 落库 → 生成，每步都对）；但线上真正在跑的目录长什么样，取决于用户的中转支持
// 什么、他接入时走了哪条写入路径、以及库里有没有历史行。同一份生产代码在不同形状下行为差别很大，
// 而形状本身**没有测试覆盖过**——这正是下面两个真 bug 的温床。
//
// 五种形状（横轴），每种问同样三个不变量（纵轴）：
//   ① UI 会显示哪几个模式（判据：archetypeModeIsVisible，渲染层真判据，不另写一份）
//   ② selectTaskMapping 选出哪条线缆（判据：生产同一个函数）
//   ③ 真发得出请求时，声明的参考键**真的到得了 wire**（判据：wireReferencedParamKeys）
//
// ★ 三个判据一律**复用生产的那份**。本仓反复栽的病就是「UI 说能发、闸门判发不出」——两把尺子。
// 这里绝不写第二份可达性判断；测试里出现的每个判断都从生产模块 import。
//
// ── 两个真 bug，钉成回归 ────────────────────────────────────────────────────────
// bug ①「空 mappings 误读」：库里一条 mapping 都没有（认证过了但还没落库/老库/刚导入）时，
//   若把「查不到」当成「发不出」，整个模式栏会被清空——自建中转用户看到一个**什么都不能做**的
//   模型。正解是三态里的 `undefined` = 查不出来 = **fail-open 不收窄**（形状 1）。
// bug ②「无 mapping 兜底借线缆」：请求的模式没有自己的 mapping 时，若借了**别的模式**那条，
//   参考键会静默消失——用户以为在改图，实际发出去的是纯文生图，**而且照样扣费**。正解是
//   selectTaskMapping 对「唯一候选却声明了别的 modeId」fail-closed 返回 null（形状 2/3）。
//
// ★ 诚实边界：本文件是**纯判据级**的，不起假中转、不发请求。因为这五种形状的差异全部发生在
// 「发之前」——选哪条线缆、显示哪些模式、参考键在不在 body 里。真把请求发出去那一段已由同目录
// 另外三个文件覆盖，这里不重复造一个 HTTP server（也就不需要 NOMI_ASSET_RELAY_URL 那类外网封堵）。
import { describe, expect, it } from "vitest";

import { selectTaskMapping, type Mapping } from "../catalog/types";
import { wireReferencedParamKeys } from "../catalog/paramTranslate";
import { archetypeModeIsVisible, type ModeChannelBody } from "../../src/workbench/generationCanvas/nodes/controls/channelModeReach";
import { GPT_IMAGE_2_ARCHETYPE } from "../../src/config/modelArchetypes/gptImage2";

const VENDOR = "self-hosted-relay";
const MODEL = "gpt-image-2";
const now = "t";

/** 档案里的两个模式：纯文生（无槽）与改图（声明了 input_urls 参考槽）。 */
const T2I = GPT_IMAGE_2_ARCHETYPE.modes.find((mode) => mode.id === "t2i")!;
const I2I = GPT_IMAGE_2_ARCHETYPE.modes.find((mode) => mode.id === "i2i")!;

function mapping(over: Partial<Mapping>): Mapping {
  return {
    id: `m-${over.taskKind}-${over.modeId ?? "none"}`,
    vendorKey: VENDOR,
    taskKind: "text_to_image",
    modelKey: MODEL,
    name: "relay",
    enabled: true,
    create: { method: "POST", path: "/v1/images/generations" },
    createdAt: now,
    updatedAt: now,
    ...over,
  } as Mapping;
}

/**
 * 「这个模式在这条渠道上的 create body」——**渲染层真实的取法**（useChannelCreateBody.ts:51 同形状）：
 * 查得到 mapping → { body, wireParamKeys }；桶已知但这个模式没有自己的线缆 → null。
 *
 * `mappings === null` 表示**查不出来**（老 preload / 拿不到 bridge / 未知 vendor）→ 返回 undefined
 * 走 fail-open。这三态的区分就是 bug ① 的全部要害，故这里如实建模，不简化成布尔。
 */
function bodyFor(mappings: readonly Mapping[] | null, transportTaskKind: string): ModeChannelBody {
  if (mappings === null) return undefined;
  const selected = selectTaskMapping(mappings as Mapping[], VENDOR, transportTaskKind as never, MODEL);
  if (!selected) return null;
  return { body: selected.create?.body ?? null, wireParamKeys: wireReferencedParamKeys(selected.create) };
}

/** 该形状下模式栏会显示哪几个（顺序即档案声明序，与 archetypeModeChoices 同口径）。 */
function visibleModeIds(mappings: readonly Mapping[] | null): string[] {
  return GPT_IMAGE_2_ARCHETYPE.modes
    .filter((mode) => archetypeModeIsVisible(mode, bodyFor(mappings, mode.transportTaskKind!)))
    .map((mode) => mode.id);
}

describe("形状 1 · 零 mapping（适配器认证过了，但库里一条线缆都没有）", () => {
  // 用户视角：刚接完中转、认证在跑、或库是从别处导入的。这一刻「查不到」不等于「发不出」。
  it("【回归 · bug ①】零 mapping 不得清空模式栏——查不到一律 fail-open，不收窄", () => {
    // 注意区分两件事：`null`（查不出来）→ 全显示；下面形状 2 的「桶里有行但没这个模式」→ 才收窄。
    // 历史上把这两者混为一谈，结果自建中转用户打开模型看到一个模式都没有的空栏。
    expect(
      visibleModeIds(null),
      "零 mapping 时模式栏被收窄了 —— 自建中转用户会看到一个什么都不能做的模型（bug ① 复发）",
    ).toEqual(["t2i", "i2i"]);
  });

  it("零 mapping 时 selectTaskMapping 对每个通道都返回 null（桶是空的，没有可借的线缆）", () => {
    expect(selectTaskMapping([], VENDOR, "text_to_image", MODEL)).toBeNull();
    expect(selectTaskMapping([], VENDOR, "image_edit", MODEL)).toBeNull();
  });
});

describe("形状 2 · 有 mapping 但不带 modeId（**每条中转写入路径实际产出的形状**）", () => {
  // 为什么这个形状最重要：全仓**没有任何**中转写入路径会设 modeId——catalogCommit.ts:292/312/324、
  // relayImageEditMigration.ts:37 建的行都只有 taskKind。所以线上每一个自建中转用户都落在这个形状里。
  // 形状 4/5 的 modeId 也同理为空，差别只在 transport；这条是**共同底座**。
  const relayShape: Mapping[] = [
    mapping({ taskKind: "text_to_image", create: { method: "POST", path: "/v1/images/generations", body: { model: "{{request.params.model}}", prompt: "{{request.prompt}}" } } }),
    mapping({ taskKind: "image_edit", create: { method: "POST", path: "/v1/images/edits", body: { model: "{{request.params.model}}", input_urls: "{{request.params.input_urls}}" } } }),
  ];

  it("两个模式各有自己的 taskKind 线缆 → 两个都显示，且各选中自己那条（不串台）", () => {
    expect(visibleModeIds(relayShape)).toEqual(["t2i", "i2i"]);
    expect(selectTaskMapping(relayShape, VENDOR, "text_to_image", MODEL)?.create.path).toBe("/v1/images/generations");
    expect(
      selectTaskMapping(relayShape, VENDOR, "image_edit", MODEL)?.create.path,
      "改图选到了别的线缆 —— 参考图会按那条的形状发，静默丢失",
    ).toBe("/v1/images/edits");
  });

  it("无 modeId 的唯一候选可以服务 UI 模式（共享线缆是设计内的，不是漏网）", () => {
    // 这是 selectTaskMapping 里 onlyCandidateIsModeless 那条分支（types.ts:527）。中转行天然无 modeId，
    // 若这里 fail-closed，等于把**所有**自建中转用户的改图通道判死——比 bug ② 更严重的反向误伤。
    expect(
      selectTaskMapping(relayShape, VENDOR, "image_edit", MODEL, "i2i")?.create.path,
      "带 modeId 去查、库里是无 modeId 的中转行 → 取不到线缆，自建中转改图全线判死",
    ).toBe("/v1/images/edits");
  });

  it("【回归 · bug ②】声明了别的 modeId 的唯一候选**不得**被借用——宁可 null，不可静默降级", () => {
    // 借了会怎样：那条 body 是**另一个模式**的契约，请求的模式的参考键在里面根本不存在，
    // 于是参考图静默消失、请求照发、钱照扣。runway/happyhorse「10 张参考图」缩成一张就是这么来的。
    const borrowed: Mapping[] = [
      mapping({ taskKind: "image_edit", modeId: "some-other-mode", create: { method: "POST", path: "/v1/images/edits", body: { model: "{{request.params.model}}" } } }),
    ];
    expect(
      selectTaskMapping(borrowed, VENDOR, "image_edit", MODEL, "i2i"),
      "借用了声明着别的 modeId 的线缆 —— 参考键不在那条 body 里，用户以为在改图、实际发纯文生图且照样扣费（bug ② 复发）",
    ).toBeNull();
    // 后果对齐：取不到线缆 → 判据 (a) → 该模式在 UI 上如实隐藏，而不是显示出来等着扣费。
    expect(archetypeModeIsVisible(I2I, bodyFor(borrowed, "image_edit"))).toBe(false);
  });

  it("声明的参考键真的到得了 wire（input_urls 出现在 create 引用的参数键里）", () => {
    const edit = selectTaskMapping(relayShape, VENDOR, "image_edit", MODEL)!;
    const slotKey = I2I.slots[0].inputKey!;
    expect(
      wireReferencedParamKeys(edit.create),
      `档案声明的参考键 ${slotKey} 不在这条 wire 引用的参数里 —— 参考图发不出去`,
    ).toContain(slotKey);
  });
});

describe("形状 3 · chat 协议改图（中转把改图挂在 /v1/chat/completions 多模态上）", () => {
  // 真实存在的形状：new-api 的通用改图配方就是 chat 多模态（NEWAPI_IMAGE_EDIT_OP）。它读的是
  // 聚合键 image_url，不是档案声明的 input_urls——于是同一个模式在这条渠道上**承载力缩水**。
  const chatShape: Mapping[] = [
    mapping({ taskKind: "text_to_image", create: { method: "POST", path: "/v1/images/generations", body: { prompt: "{{request.prompt}}" } } }),
    mapping({
      taskKind: "image_edit",
      create: {
        method: "POST",
        path: "/v1/chat/completions",
        body: { model: "{{request.params.model}}", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "{{request.params.image_url}}" } }] }] },
      },
    }),
  ];

  it("改图模式仍显示——单图聚合位 image_url 让它降级为 single，而不是判死", () => {
    // 判据是 modeSlotReach 的单图聚合位规则（referenceReachability.ts:77-87）：声明 max=16 的
    // image_ref 槽在这条渠道上只过得去 1 张 = `single` ≠ `none`，所以模式**可用**、不该隐藏。
    // 「承载力缩水」是**槽级**的事（槽如实收成 1 张），不是模式级的隐藏理由——channelModeReach.ts:44-50
    // 明确记着这条，且记着为什么曾经加过又删掉（会误删 Runway/Grok 真能用的 i2v）。
    expect(
      visibleModeIds(chatShape),
      "chat 协议改图被整个隐藏了 —— 这条渠道其实能改图（一次一张），隐藏等于删掉一个真能用的功能",
    ).toEqual(["t2i", "i2i"]);
  });

  it("这条 wire 读的是聚合键 image_url，不是档案声明的 input_urls（形状差异如实暴露）", () => {
    const edit = selectTaskMapping(chatShape, VENDOR, "image_edit", MODEL)!;
    const keys = wireReferencedParamKeys(edit.create);
    expect(keys, "chat 改图 wire 不再读 image_url —— 与 new-api 多模态契约不符").toContain("image_url");
    expect(keys, "chat 改图 wire 竟然直接读 input_urls —— 那是档案键，这条协议不长这样").not.toContain("input_urls");
  });
});

describe("形状 4 · multipart 改图（gpt-image 系真实走的那条，2026-09-03 真机验证过）", () => {
  // 与形状 3 的差别：没有 body（multipart 的图走 imageSource，不是 body 模板）。这一点很要命——
  // 可达性判据读的是 body，而这里 body 为空。
  const multipartShape: Mapping[] = [
    mapping({ taskKind: "text_to_image", create: { method: "POST", path: "/v1/images/generations", body: { prompt: "{{request.prompt}}" } } }),
    mapping({
      taskKind: "image_edit",
      create: {
        method: "POST",
        path: "/v1/images/edits",
        multipart: { fields: { model: "{{request.params.model}}", prompt: "{{request.prompt}}" }, imageField: "image[]", imageSource: "{{request.params.reference_images}}", multiple: true },
      },
    }),
  ];

  it("multipart 改图不得被判死——body 为空时可达性判据 fail-open（放行，不误伤）", () => {
    // 机制：modeSlotReach 第一条就是「body 完全不引用任何参数 → 判不出来 → 一律 full」
    // （referenceReachability.ts:64-65）。multipart 的图根本不经 body，若这里不 fail-open，
    // **真机已验证跑通**的那条改图通道会在 UI 上被藏掉。这正是「判据只看 body」的已知盲区，
    // 靠 fail-open 兜住；下面那条断言把「盲区仍被兜住」钉死。
    expect(
      visibleModeIds(multipartShape),
      "multipart 改图被隐藏了 —— 这条通道 2026-09-03 真机 200 验证过，隐藏它就是撒谎",
    ).toEqual(["t2i", "i2i"]);
  });

  it("参考图经 multipart.imageSource 到 wire（不在 body 里，所以 body 级判据看不见它）", () => {
    const edit = selectTaskMapping(multipartShape, VENDOR, "image_edit", MODEL)!;
    // 诚实记录判据的盲区：wireReferencedParamKeys 只扫 body 与 process.args，扫不到 multipart。
    expect(wireReferencedParamKeys(edit.create), "body 级判据竟扫出了 multipart 的键 —— 判据形状变了，请重读注释").toEqual([]);
    // 真正的参考通道在这里，且键必须与探针注入的那个一致（reference_images，见主台架断言）。
    expect(
      JSON.stringify(edit.create.multipart?.imageSource),
      "multipart 改图的图源不再读 reference_images —— 探针注了参考图却进不了报文",
    ).toContain("reference_images");
  });
});

describe("形状 5 · 进程型 transport（即梦风格 create.process.args，根本没有 HTTP body）", () => {
  // 为什么必须单列：这条形状**没有 body**，参数全经 argv 发出。任何「只扫 body」的判据都会把它
  // 整片判成发不出去。wireReferencedParamKeys 因此显式同时扫 process.args（paramTranslate.ts:264-273,
  // 那里的注释记着：实测险些据此把即梦活着的变体选择器藏掉）。
  const processShape: Mapping[] = [
    mapping({
      taskKind: "text_to_image",
      create: { method: "PROCESS", path: "dreamina:text2image", process: { bin: "dreamina", parser: "dreamina-cli", args: ["text2image", "--prompt={{request.prompt}}", "--model_version={{request.params.model}}"] } } as never,
    }),
    mapping({
      taskKind: "image_edit",
      create: { method: "PROCESS", path: "dreamina:image2image", process: { bin: "dreamina", parser: "dreamina-cli", args: ["image2image", "--images={{request.params.input_urls}}", "--model_version={{request.params.model}}"] } } as never,
    }),
  ];

  it("进程型两个模式都显示（无 body ≠ 发不出去）", () => {
    expect(
      visibleModeIds(processShape),
      "进程型 transport 被判死了 —— 它的参数经 argv 发出，没有 body 不代表发不出去",
    ).toEqual(["t2i", "i2i"]);
  });

  it("参考键与 model 键都从 CLI args 里被扫出来（判据不能只看 body）", () => {
    const edit = selectTaskMapping(processShape, VENDOR, "image_edit", MODEL)!;
    const keys = wireReferencedParamKeys(edit.create);
    expect(keys, "进程型的参考键没被扫出来 —— 判据只看了 body，会把即梦改图判成发不出参考图").toContain("input_urls");
    // model 键决定**变体轴活不活**（archetypeVariantAxisIsLive 读的就是 wireParamKeys）。
    // 漏扫它 = 即梦 6 个变体的选择器被整个藏掉——注释里记着的那次实测就差点这样。
    expect(keys, "进程型的 model 键没被扫出来 —— 变体选择器会被整个藏掉").toContain("model");
  });
});

describe("跨形状不变量（同一套断言横着问一遍）", () => {
  it("五种形状里，凡是**取得到**改图线缆的，档案声明的参考通道都真的到得了 wire", () => {
    // 这条是横向对账：逐个形状问同一个问题「声明的参考到得了 wire 吗」，而不是每个形状各写一套。
    // 判据按 transport 分流（body/args 走 wireReferencedParamKeys，multipart 走 imageSource），
    // 因为它们是**三种不同的载体**——但结论必须一致：声明了就必须到得了。
    const shapes: Array<{ name: string; create: Mapping["create"]; expectKey: string }> = [
      { name: "无 modeId 单端点", create: { method: "POST", path: "/v1/images/edits", body: { input_urls: "{{request.params.input_urls}}" } }, expectKey: "input_urls" },
      { name: "chat 协议", create: { method: "POST", path: "/v1/chat/completions", body: { image_url: "{{request.params.image_url}}" } }, expectKey: "image_url" },
      { name: "进程型", create: { method: "PROCESS", path: "dreamina:image2image", process: { bin: "d", parser: "dreamina-cli", args: ["--images={{request.params.input_urls}}"] } } as never, expectKey: "input_urls" },
    ];
    for (const shape of shapes) {
      expect(
        wireReferencedParamKeys(shape.create),
        `形状「${shape.name}」声明了参考通道，但 ${shape.expectKey} 到不了 wire —— 参考会静默丢失`,
      ).toContain(shape.expectKey);
    }
  });

  it("无槽的纯文生模式在**任何**形状下都不该被收窄（它不依赖任何参考通道）", () => {
    // 兜底不变量：不管目录长成什么样，t2i 永远显示。若哪天有形状能把它藏掉，
    // 那说明收窄判据把「没有参考通道」误当成了「发不出去」。
    const bodies: ModeChannelBody[] = [
      undefined,
      { body: null, wireParamKeys: [] },
      { body: { prompt: "{{request.prompt}}" }, wireParamKeys: ["prompt"] },
    ];
    for (const body of bodies) {
      expect(archetypeModeIsVisible(T2I, body), "纯文生模式被收窄掉了 —— 它没有槽，不该依赖任何参考通道").toBe(true);
    }
    // 唯一该隐藏纯文生的情形：桶已知但连它自己的线缆都没有（判据 a）。
    expect(archetypeModeIsVisible(T2I, null), "桶里没有文生图线缆却仍显示 —— 用户点了只会被拒").toBe(false);
  });
});
