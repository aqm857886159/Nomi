// 自建中转一致性台架 · 转写（transcribe）这条**没有的**路。
//
// ★ 本文件是一条「钉住缺口」的用例，不是一条「验证功能」的用例。诚实的覆盖矩阵要求缺口被
// 主动说出来，而不是靠没人写测试来沉默地表示「这里没有」。同族先例：
// builtinOpenAiCompatibleDraft.test.ts:176-187（音频只有 text_to_audio / 3D 零通道）。
//
// 结论先说：**转写经自建中转根本不可达**。用户填了 BaseURL 接进来一个音频模型，拿到的只有
// 配音（text_to_audio）一条通道；「转写音频」这个模式在自建中转上永远发不出去。
//
// 为什么会这样（三段链路，每段都在下面被断言钉住）：
//   ① 传输配方：newapiTransportFor("audio") 只给 { taskKind: "text_to_audio", create }，
//      既没有 edit 也没有 imageToVideo（newapiTransport.ts:309）。
//   ② 建模式：modesForKind 由该配方 derive——主 taskKind 一条，然后**仅在** transport.edit /
//      transport.imageToVideo 存在时各追加一条（builtinOpenAiCompatibleDraft.ts:112-131）。
//      音频两个可选项都没有 → 恒定只有一条 text_to_audio 模式。
//   ③ 落库：catalogCommit 按草稿产出的模式建 mapping，没有草稿模式就没有 mapping。
//
// 为什么**不该**在这里造一个转写台架：通用 OpenAI 兼容协议里转写端点（/v1/audio/transcriptions）
// 当然是存在的，但我们的内置中转卡并没有声明它。硬写一个「转写经中转跑通了」的用例，需要先手工
// 编一条内置卡里不存在的 mode——那测的是测试自己造的东西，不是用户真能走到的路。真中转视频/音频
// 我们一台也没有（见 relayConformanceVideoAudio.integration.test.ts 顶部的诚实边界），更没有任何
// 真机拒绝规则可转录。**覆盖率造假比覆盖率不足更贵。**
//
// 真要补这个缺口，是**生产改动**（给音频配方加 transcribe 通道），不是补测试；补完这里自然会红，
// 那正是本文件想要的效果——它同时是「缺口还在」的哨兵与「缺口被填上」的提醒。
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/nomi-relay-conformance-transcribe", getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
  webContents: { getAllWebContents: () => [] },
}));

import { buildOpenAiCompatibleDraft } from "./builtinOpenAiCompatibleDraft";
import { newapiTransportFor } from "../catalog/newapiTransport";
import { PROFILE_KIND_REFERENCE_CHANNEL } from "../shared/contracts/modelAccessCapabilities";
import { AUDIO_ARCHETYPE } from "../../src/config/modelArchetypes/audioArchetype";
import { archetypeModeIsVisible } from "../../src/workbench/generationCanvas/nodes/controls/channelModeReach";
import { selectTaskMapping, type Mapping } from "../catalog/types";

const BASE_URL = "http://127.0.0.1:39999";
const VENDOR_KEY = "self-hosted-relay";
const AUDIO_MODEL_KEY = "relay-audio-1";

/** 走**真实内置草稿**（用户填 BaseURL 后 service.ts:313 走的就是这条），不手搭形状。 */
function relayAudioModes(): string[] {
  return buildOpenAiCompatibleDraft({
    baseUrl: BASE_URL,
    authType: "bearer",
    providerKind: "openai-compatible",
    models: [{ modelKey: AUDIO_MODEL_KEY, labelZh: AUDIO_MODEL_KEY, kind: "audio" }],
  }).models[0].modes.map((mode) => mode.taskKind);
}

describe("自建中转一致性台架 · 转写不可达（钉住缺口，不是验证功能）", () => {
  it("内置中转卡为音频模型产出的模式集**恰好**是 [text_to_audio]——转写不在其中", () => {
    // 断言的是**整个集合**而不是 `not.toContain("transcribe")`：后者在「哪天多冒出一条别的模式」
    // 时仍会绿，而模式集是用户看得见的承诺面，多一条少一条都必须有人知道。
    expect(
      relayAudioModes(),
      "自建中转的音频模式集变了——若这里现在含 transcribe，说明缺口已被填上：请给它补真正的台架覆盖并更新覆盖矩阵",
    ).toEqual(["text_to_audio"]);
  });

  it("根因在传输配方：newapiTransportFor('audio') 既无 edit 也无 imageToVideo，建模式无从追加", () => {
    // 这条把「为什么没有」钉在**根因那一层**，而不是只钉住表象。modesForKind 的第二/第三条模式
    // 完全由这两个可选字段 derive（builtinOpenAiCompatibleDraft.ts:125-131）；两者皆无 = 只可能一条模式。
    const transport = newapiTransportFor("audio");
    expect(transport.taskKind, "音频主通道不再是 text_to_audio —— 中转音频的形状变了").toBe("text_to_audio");
    expect(transport.edit, "音频配方多出了 edit 通道 —— 建模式会据此追加一条 image_edit，与音频语义不符").toBeUndefined();
    expect(transport.imageToVideo, "音频配方多出了 imageToVideo 通道 —— 与音频语义不符").toBeUndefined();
  });

  it("转写是 runtime-fixed：即便哪天补上通道，也不该强制它声明 referenceParam", () => {
    // 为什么把这条钉在这里：补缺口的人最容易犯的错，是照着 image_edit 的样子给 transcribe 也
    // 声明一份 referenceParam/referenceShape。但转写的音频是 resolveAudioSource() 按 kind 写死地
    // 从参考族键里取的（audioTaskRunner.ts:190-198），随后 resolveFile 直接喂字节（:167）——
    // 声明的 multipart.fileSource 在这条路径上根本不被读。声明它 = 编一个无人读取的契约。
    expect(
      PROFILE_KIND_REFERENCE_CHANNEL.transcribe,
      "transcribe 的参考通道分类被改了 —— 它吃音频，但通道写死在运行期，不经说明卡声明",
    ).toBe("runtime-fixed");
  });

  it("用户视角：模式栏上「转写音频」在自建中转这条渠道上被如实收窄掉（不是显示了却发不出）", () => {
    // 前三条是「产出侧」的事实；这条是**用户看得见的后果**，用的是渲染层真判据 archetypeModeIsVisible。
    // 自建中转接进来的音频模型只落了 text_to_audio 一条 mapping，于是转写模式查 body 得到 null
    // （桶已知、但这个模式没有属于自己的线缆）→ 判据 (a) 隐藏。
    //
    // 这正是我们要的诚实：模式名字本身就是承诺，与其显示「转写音频」再等用户点了生成被第三闸拒，
    // 不如一开始就不显示。若哪天有人把这条判据改成 fail-open（返回 undefined），用户会重新看到
    // 一个永远发不出去的模式——这条会红。
    const relayMappings: Mapping[] = [{
      id: "m-relay-tts",
      vendorKey: VENDOR_KEY,
      taskKind: "text_to_audio",
      modelKey: AUDIO_MODEL_KEY,
      name: "relay 配音",
      enabled: true,
      create: { method: "POST", path: "/v1/audio/speech", body: { model: "{{request.params.model}}", input: "{{request.prompt}}" } },
      createdAt: "t",
      updatedAt: "t",
    } as Mapping];

    const bodyFor = (transportTaskKind: string) => {
      const mapping = selectTaskMapping(relayMappings, VENDOR_KEY, transportTaskKind as never, AUDIO_MODEL_KEY);
      return mapping ? { body: mapping.create?.body ?? null, wireParamKeys: [] as string[] } : null;
    };

    const speech = AUDIO_ARCHETYPE.modes.find((mode) => mode.id === "speech");
    const transcribe = AUDIO_ARCHETYPE.modes.find((mode) => mode.id === "transcribe");
    expect(speech && transcribe, "声音档案的模式改名了 —— 本用例的前提失效，请重读档案再改断言").toBeTruthy();

    expect(
      archetypeModeIsVisible(speech!, bodyFor(speech!.transportTaskKind!)),
      "配音模式被收窄掉了 —— 自建中转明明落了 text_to_audio 这条线缆",
    ).toBe(true);
    expect(
      archetypeModeIsVisible(transcribe!, bodyFor(transcribe!.transportTaskKind!)),
      "「转写音频」在自建中转上显示出来了 —— 但这条渠道没有 transcribe 线缆，用户点了生成只会被第三闸拒",
    ).toBe(false);
  });
});
