import { describe, expect, it } from "vitest";
import { getArchetypeById, MODEL_ARCHETYPES } from "./builtInCatalog";
import { archetypeIdForModel, builtInHeadlessDefaults, builtInModeManifest, builtInSizeIsRatioSemantic } from "./entry";
import { headlessDefaultsOf, identityPatternsOf, sizeRatioTaskKindsOf } from "./catalogFacts";
import { modeTransportFor } from "../videoCapabilities/modeTransport";
import type { ArchetypeMode, ModelArchetype } from "./types";
import { ARCHETYPE_WIRE_MODEL, resolveWireModel } from "./wireModelIdentity";

// 档案派生的几件事改成发送时现算（设计卡 docs/plan/2026-11-15-archetype-wire-defaults-runtime.md）。
// 这里不拿另一份表当对照：代表档案手写期望值 + 全目录按档案声明的性质断言。

/** 一个方式在某个供应商桶下声明的默认值（固定参数 + 控件默认值），直接从声明读，不经被测函数。 */
function declaredDefaults(mode: ArchetypeMode, vendor: string): Record<string, unknown> {
  const params = (vendor === "*" ? undefined : mode.vendorParams?.[vendor]) ?? mode.params ?? [];
  const out: Record<string, unknown> = { ...(mode.fixedParams ?? {}) };
  for (const control of params) if (control.defaultValue !== undefined) out[control.key] = control.defaultValue;
  return out;
}

const vendorsOf = (archetype: ModelArchetype) => ["*", ...new Set(archetype.modes.flatMap((mode) => [
  ...Object.keys(mode.vendorParams ?? {}), ...Object.keys(mode.vendorTransportTaskKind ?? {}),
]))];

describe("无界面缺参兜底：代表档案（手写期望）", () => {
  it("视频档案 duration 保 number；model 不归默认值（发哪个 model 串只问 wireModelIdentity）", () => {
    const hailuo = builtInHeadlessDefaults("hailuo-2.3", "text_to_video", null)!;
    expect(hailuo).not.toHaveProperty("model");
    expect(typeof hailuo.duration).toBe("number");
    expect(builtInHeadlessDefaults("sora-2", "text_to_video", null)).toBeUndefined();
    expect(builtInHeadlessDefaults("grok-imagine-1.5-video", "text_to_video", "apimart")).toMatchObject({ size: "16:9", quality: "480p", duration: 6 });
  });

  it("vendorParams 分桶：apimart 可灵 duration=number，通用桶（kie）=string——不串台", () => {
    expect(typeof builtInHeadlessDefaults("kling-3.0", "text_to_video", "apimart")!.duration).toBe("number");
    expect(typeof builtInHeadlessDefaults("kling-3.0", "text_to_video", "kie")!.duration).toBe("string");
    expect(typeof builtInHeadlessDefaults("kling-3.0", "text_to_video", null)!.duration).toBe("string");
  });

  it("图 / 音档案默认（替代已删的手写 defaultParams）", () => {
    expect(builtInHeadlessDefaults("volcengine-seedream", "text_to_image", "volcengine")!.size).toBe("2048x2048");
    expect(builtInHeadlessDefaults("volcengine-doubao-tts", "text_to_audio", "volcengine")!.voice).toBeTruthy();
  });

  it("主干上漂过的那组：MiniMax H3 Max（apimart）与可灵 V4 Flash 带档案声明的 nsfw_check=false", () => {
    expect(builtInHeadlessDefaults("minimax-h3-max", "text_to_video", "apimart")).toMatchObject({ nsfw_check: false });
    expect(builtInHeadlessDefaults("minimax-h3-max", "image_to_video", "apimart")).toMatchObject({ nsfw_check: false });
    expect(builtInHeadlessDefaults("kling-v4-flash", "text_to_video", "apimart")).toMatchObject({ nsfw_check: false });
  });

  it("同一 taskKind 多方式取主方式：minimax-h3 文生不被参考方式的 adaptive 盖掉（09-01）", () => {
    const h3 = getArchetypeById("minimax-h3")!;
    const t2v = h3.modes.find((mode) => mode.id === h3.defaultModeId)!;
    const defaults = builtInHeadlessDefaults("minimax-h3", "text_to_video", null)!;
    for (const [key, value] of Object.entries(declaredDefaults(t2v, "*"))) expect(defaults[key], key).toEqual(value);
  });
});

describe("无界面缺参兜底：全目录性质（按档案声明断言）", () => {
  it("每个 (档案, 供应商, 任务种类)：读到的就是主方式声明的默认值——声明了的键一定在、值相同，没声明的键一定不在", () => {
    const failures: string[] = [];
    for (const archetype of MODEL_ARCHETYPES) {
      for (const vendor of vendorsOf(archetype)) {
        const byTask = new Map<string, ArchetypeMode[]>();
        for (const mode of archetype.modes) {
          const own = vendor === "*" || Boolean(mode.vendorParams?.[vendor] || mode.vendorTransportTaskKind?.[vendor]);
          if (!own) continue;
          const taskKind = modeTransportFor(mode, archetype, vendor === "*" ? null : vendor);
          byTask.set(taskKind, [...(byTask.get(taskKind) ?? []), mode]);
        }
        for (const [taskKind, modes] of byTask) {
          const primary = modes.find((mode) => mode.id === archetype.defaultModeId) ?? modes[0];
          const expected = declaredDefaults(primary, vendor);
          const bucket = headlessDefaultsOf(archetype)[taskKind]?.[vendor];
          if (Object.keys(expected).length === 0) {
            if (bucket !== undefined) failures.push(`${archetype.id}/${taskKind}/${vendor}: 没有默认值却落了桶`);
          } else if (JSON.stringify(bucket) !== JSON.stringify(expected)) {
            failures.push(`${archetype.id}/${taskKind}/${vendor}: ${JSON.stringify(bucket)} ≠ ${JSON.stringify(expected)}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("供应商没有单独声明的桶 → 回退通用桶；别家的专属默认值不串过来", () => {
    for (const archetype of MODEL_ARCHETYPES) {
      for (const [taskKind, perKind] of Object.entries(headlessDefaultsOf(archetype))) {
        expect(builtInHeadlessDefaults(archetype.id, taskKind, "nobody-declares-this-vendor")).toEqual(perKind["*"]);
        for (const vendor of Object.keys(perKind)) {
          expect(builtInHeadlessDefaults(archetype.id, taskKind, vendor)).toEqual(perKind[vendor]);
        }
      }
    }
  });

  it("同一份档案对象只算一次（发送一次请求不重算全目录）", () => {
    const archetype = getArchetypeById("kling-3.0")!;
    expect(headlessDefaultsOf(archetype)).toBe(headlessDefaultsOf(archetype));
    expect(sizeRatioTaskKindsOf(archetype)).toBe(sizeRatioTaskKindsOf(archetype));
  });
});

describe("size 键比例语义（从 size 控件选项集推）", () => {
  it("比例族默认（adaptive）但选项集含真比例档 → 比例语义（seedance-2.5-apimart 修复点）", () => {
    expect(builtInSizeIsRatioSemantic("seedance-2.5-apimart", "text_to_video")).toBe(true);
    expect(builtInSizeIsRatioSemantic("seedance-2.5-apimart", "image_to_video")).toBe(true);
  });

  it("默认值本就是比例形的档案照样登记（apimart seedream）", () => {
    expect(builtInSizeIsRatioSemantic("seedream", "text_to_image")).toBe(true);
  });

  it("像素语义档案不登记（volcengine-seedream / modelscope-image 的 size 选项全是像素）→ 闸会剥掉调用方比例", () => {
    for (const taskKind of ["text_to_image", "image_edit"]) {
      expect(builtInSizeIsRatioSemantic("volcengine-seedream", taskKind)).toBeUndefined();
      expect(builtInSizeIsRatioSemantic("modelscope-image", taskKind)).toBeUndefined();
    }
    expect(builtInSizeIsRatioSemantic("not-an-archetype", "text_to_image")).toBeUndefined();
  });

  it("全目录：判为比例语义 ⇔ 这个任务种类有方式的 size 控件带 N:M 选项", () => {
    const RATIO = /^\d+\s*:\s*\d+$/;
    for (const archetype of MODEL_ARCHETYPES) {
      const expected = new Set<string>();
      for (const mode of archetype.modes) {
        const sets = [mode.params ?? [], ...Object.values(mode.vendorParams ?? {})];
        if (!sets.some((params) => params.some((control) => control.key === "size" && control.options.some((option) => RATIO.test(String(option.value).trim()))))) continue;
        for (const vendor of [null, ...Object.keys(mode.vendorTransportTaskKind ?? {})]) expected.add(modeTransportFor(mode, archetype, vendor));
      }
      expect([...sizeRatioTaskKindsOf(archetype)].sort(), archetype.id).toEqual([...expected].sort());
    }
  });
});

// 合成档案（原 scripts/gen-archetype-wire-defaults.test.ts 搬来）：只填推导真正读的字段（id/family/label/kind/modes/defaultModeId/transportTaskKind/variants），
// 其余能力字段（intent/slots/hint/vendorTerm/promptRequired…）用最小占位；`as` 收口给类型。
type PartialMode = Partial<ModelArchetype['modes'][number]> & { id: string }
const mode = (m: PartialMode): ModelArchetype['modes'][number] =>
  ({ intent: 'text', vendorTerm: '', hint: '', slots: [], params: [], promptRequired: true, ...m } as ModelArchetype['modes'][number])
const archetype = (a: Partial<ModelArchetype> & Pick<ModelArchetype, 'id' | 'defaultModeId' | 'transportTaskKind' | 'modes'>): ModelArchetype =>
  ({ family: 'test', label: a.id, kind: 'video', ...a } as ModelArchetype)

// 回归测试：同一 taskKind 多模式，各模式默认**互不污染**（修 minimax-h3 text_to_video 被 ref 盖住的 bug）。
// 更早的生成器「遍历顺序里最后一个模式胜」→ 后声明的模式默默覆盖前面的。现按「主模式」确定性收口。
describe('same-taskKind multi-mode collapse（主模式收口，不互相污染）', () => {
  it('判据①：defaultModeId 落在该 taskKind → 用它，哪怕它不是最后声明的模式', () => {
    // 三模式全落同一档案级 text_to_video；default=t2v 排最前、"污染源" ref 排最后。
    const arch = archetype({
      id: 'fake-t2v-default',
      defaultModeId: 't2v',
      transportTaskKind: 'text_to_video',
      modes: [
        mode({ id: 't2v', modelEnum: 'fake/text-to-video', params: [{ key: 'aspect_ratio', label: '', type: 'select', options: [], defaultValue: '16:9' }] }),
        mode({ id: 'i2v', modelEnum: 'fake/image-to-video', params: [{ key: 'duration', label: '', type: 'number', options: [], defaultValue: 6 }] }),
        mode({ id: 'ref', modelEnum: 'fake/reference-to-video', params: [{ key: 'aspect_ratio', label: '', type: 'select', options: [], defaultValue: 'adaptive' }] }),
      ],
    })
    const out = { [arch.id]: headlessDefaultsOf(arch) }
    // 主模式 = t2v（default），不是最后声明的 ref。
    // 主模式由 t2v 的参数默认证明（16:9）；model 不进默认表，由 resolveWireModel 决定（2026-10-16）。
    expect(out['fake-t2v-default'].text_to_video['*']).toEqual({ aspect_ratio: '16:9' })
    // ref 的 adaptive + reference-to-video 不得泄漏进来（这正是被修的 bug）。
    expect(out['fake-t2v-default'].text_to_video['*'].aspect_ratio).not.toBe('adaptive')
    expect(out['fake-t2v-default'].text_to_video['*']).not.toHaveProperty('model')
  })

  it('判据②：默认模式在别的 taskKind → 该 taskKind 用首个声明的模式（保序、确定）', () => {
    // 档案默认是 t2v（text_to_video）；三个 i2v 族模式共享 image_to_video，无一是 defaultModeId。
    const arch = archetype({
      id: 'fake-i2v-group',
      defaultModeId: 't2v',
      transportTaskKind: 'text_to_video',
      modes: [
        mode({ id: 't2v', params: [{ key: 'aspect_ratio', label: '', type: 'select', options: [], defaultValue: '16:9' }] }),
        mode({ id: 'first', transportTaskKind: 'image_to_video', fixedParams: { generation_type: 'frame' }, params: [{ key: 'duration', label: '', type: 'number', options: [], defaultValue: 5 }] }),
        mode({ id: 'firstlast', transportTaskKind: 'image_to_video', fixedParams: { generation_type: 'frame' } }),
        mode({ id: 'omni', transportTaskKind: 'image_to_video', params: [{ key: 'aspect_ratio', label: '', type: 'select', options: [], defaultValue: 'adaptive' }] }),
      ],
    })
    const out = { [arch.id]: headlessDefaultsOf(arch) }
    // image_to_video 主模式 = 首个声明的 'first'，不是最后的 'omni'。
    expect(out['fake-i2v-group'].image_to_video['*']).toEqual({ generation_type: 'frame', duration: 5 })
    // omni 的 adaptive 不得污染 i2v 默认。
    expect(out['fake-i2v-group'].image_to_video['*'].aspect_ratio).toBeUndefined()
    // 且各 taskKind 互不干扰：t2v 桶保留自己的 16:9。
    expect(out['fake-i2v-group'].text_to_video['*'].aspect_ratio).toBe('16:9')
  })

  it('vendorParams 分桶在主模式收口后仍各自独立', () => {
    const arch = archetype({
      id: 'fake-vendor-split',
      defaultModeId: 't2v',
      transportTaskKind: 'text_to_video',
      modes: [
        mode({
          id: 't2v',
          params: [{ key: 'duration', label: '', type: 'number', options: [], defaultValue: 5 }],
          vendorParams: { apimart: [{ key: 'duration', label: '', type: 'number', options: [], defaultValue: 5 }] },
        }),
      ],
    })
    const out = { [arch.id]: headlessDefaultsOf(arch) }
    expect(out['fake-vendor-split'].text_to_video['*'].duration).toBe(5)
    expect(out['fake-vendor-split'].text_to_video.apimart.duration).toBe(5)
  })

  it('真实目录锚点：minimax-h3 text_to_video 兜底 = t2v 模式（16:9），不是 ref 的 adaptive；model 不进默认值', () => {
    const out = Object.fromEntries(MODEL_ARCHETYPES.map((entry) => [entry.id, headlessDefaultsOf(entry)]))
    expect(out['minimax-h3'].text_to_video['*']).toMatchObject({ aspect_ratio: '16:9' })
    expect(out['minimax-h3'].text_to_video['*'].aspect_ratio).not.toBe('adaptive')
    // 2026-10-16：发哪个 model 串不归默认表，由 resolveWireModel 在参数层最后一步决定（自建中转曾被默认表里的
    // 档案线上名盖掉连接名）。新不变式：默认表任何一格都没有 model；同一条「主模式判据」由 owner 兑现——
    // 声明了收档案线上名的内置 op，headless 不带 modeId 时按 taskKind 选到 t2v，而不是 ref / edit。
    for (const [archetypeId, byKind] of Object.entries(out)) {
      for (const [taskKind, byVendor] of Object.entries(byKind)) {
        for (const [vendor, defaults] of Object.entries(byVendor)) {
          expect(defaults, `${archetypeId}/${taskKind}/${vendor} 无界面默认值不许带 model`).not.toHaveProperty('model')
        }
      }
    }
    const headlessWire = (archetypeId: string) => resolveWireModel({
      operation: { wireModel: ARCHETYPE_WIRE_MODEL },
      connection: { vendorKey: 'kie', modelKey: archetypeId, modelMeta: { archetypeId } },
      taskKind: 'text_to_video',
    })
    expect(headlessWire('minimax-h3')).toBe('minimax-h3/text-to-video')
    // happyhorse 同病（edit 模式曾胜出）：现为 t2v。
    expect(headlessWire('happyhorse')).toBe('happyhorse/text-to-video')
  })
})

describe("主进程只凭模型名认档案（archetypeIdForModel）", () => {
  it("身份 = identifierPatterns + 各档 modelKey（去空去重保序）；每个识别串认回它自己或更早声明的同名档案", () => {
    const withVariantKeys = MODEL_ARCHETYPES.filter((entry) => (entry.variants ?? []).some((variant) => variant.modelKey && !entry.identifierPatterns.includes(variant.modelKey)));
    expect(withVariantKeys.length).toBeGreaterThan(0);
    for (const entry of MODEL_ARCHETYPES) {
      const patterns = identityPatternsOf(entry);
      const declared = [...entry.identifierPatterns, ...(entry.variants ?? []).map((variant) => variant.modelKey ?? "")];
      expect(patterns, entry.id).toEqual([...new Set(declared.map((value) => String(value).trim()).filter(Boolean))]);
      for (const pattern of patterns) {
        const owner = archetypeIdForModel(pattern);
        expect(owner, `${entry.id} ← ${pattern}`).not.toBeNull();
        const ownerIndex = MODEL_ARCHETYPES.findIndex((candidate) => candidate.id === owner);
        expect(ownerIndex <= MODEL_ARCHETYPES.indexOf(entry), `${entry.id} ← ${pattern} 被 ${owner} 抢走`).toBe(true);
      }
    }
    expect(archetypeIdForModel("not-a-known-model")).toBeNull();
    expect(archetypeIdForModel(null, undefined)).toBeNull();
  });
})

describe("方式菜单清单（builtInModeManifest）", () => {
  it("代表档案：主方式 + 每个方式走的任务种类（手写期望）", () => {
    expect(builtInModeManifest("seedance-2.5-apimart")).toEqual({
      defaultModeId: "t2v",
      modes: { t2v: "text_to_video", first: "image_to_video", firstlast: "image_to_video", omni: "image_to_video", edit: "image_to_video", extend: "image_to_video" },
    });
    expect(builtInModeManifest("volcengine-seedream")).toEqual({ defaultModeId: "t2i", modes: { t2i: "text_to_image", edit: "image_edit" } });
    // 同一任务种类的几个方式（参考图 / 首帧都走文生视频接口）各占一行，不并成一个。
    expect(builtInModeManifest("minimax-h3")).toEqual({ defaultModeId: "t2v", modes: { t2v: "text_to_video", i2v: "text_to_video", ref: "text_to_video" } });
  });

  it("全目录：方式行 = 档案声明的方式、同序；主方式就是档案的 defaultModeId；认不出 → undefined", () => {
    for (const entry of MODEL_ARCHETYPES) {
      const manifest = builtInModeManifest(entry.id);
      expect(Object.keys(manifest?.modes ?? {}), entry.id).toEqual(entry.modes.map((mode) => mode.id));
      expect(manifest?.defaultModeId, entry.id).toBe(entry.defaultModeId);
      // 方式表不吃供应商特化：方式自己声明的接口种类，没声明就用档案的（直接读声明，不经被测函数）。
      for (const mode of entry.modes) expect(manifest?.modes[mode.id], `${entry.id}.${mode.id}`).toBe(mode.transportTaskKind ?? entry.transportTaskKind);
    }
    expect(builtInModeManifest("no-such-archetype")).toBeUndefined();
    expect(builtInModeManifest(null)).toBeUndefined();
  });

  it("用到才算、算完记住：同一档案两次拿到同一个对象", () => {
    expect(builtInModeManifest("seedance-2.5-apimart")).toBe(builtInModeManifest("seedance-2.5-apimart"));
  });
})
