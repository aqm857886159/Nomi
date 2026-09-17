import { describe, expect, it } from "vitest";
import {
  LOCAL_SPEECH_DEFAULT_TIER,
  LOCAL_SPEECH_ENGINE_PLATFORMS,
  LOCAL_SPEECH_TIERS,
  LOCAL_SPEECH_VAD_MODEL,
  localSpeechAssetOrigins,
  localSpeechEngineForPlatform,
  localSpeechTier,
} from "../shared/localSpeech/localSpeechAssets";

const allAssets = [
  ...LOCAL_SPEECH_ENGINE_PLATFORMS.map((entry) => entry.archive),
  ...LOCAL_SPEECH_TIERS.map((tier) => tier.model),
  // VAD 模型也走同一套「钉死 commit + 精确字节 + sha256」的判据，不因为它只有 885 KB 就松一档。
  LOCAL_SPEECH_VAD_MODEL,
];

describe("本地转写资产清单", () => {
  it("**一条英语专用权重都不许有**（用户 2026-09-17 硬约束：必须多语言）", () => {
    for (const tier of LOCAL_SPEECH_TIERS) {
      expect(tier.model.fileName).not.toMatch(/\.en\b/);
      expect(tier.model.downloadUrl).not.toMatch(/\.en\./);
    }
  });

  it("下载地址钉在不可变版本上（HF 用 40 位 commit、GitHub 用 release tag），不许出现 main/latest", () => {
    for (const asset of allAssets) {
      expect(asset.downloadUrl).not.toMatch(/\/(main|master|latest)\//);
      if (asset.downloadUrl.includes("huggingface.co")) {
        expect(asset.downloadUrl).toMatch(/\/resolve\/[0-9a-f]{40}\//);
      }
    }
  });

  it("每件资产都有精确字节数与 64 位小写 sha256（都是进度分母与第一道校验）", () => {
    for (const asset of allAssets) {
      expect(asset.sizeBytes).toBeGreaterThan(0);
      expect(Number.isInteger(asset.sizeBytes)).toBe(true);
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.license.length).toBeGreaterThan(0);
    }
  });

  it("文件名不含路径分隔符——缓存目录拼路径不靠调用方自觉", () => {
    const names = [...allAssets.map((asset) => asset.fileName), ...LOCAL_SPEECH_ENGINE_PLATFORMS.flatMap((entry) => entry.members.map((member) => member.fileName))];
    for (const name of names) {
      expect(name).not.toMatch(/[/\\]/);
      expect(name).not.toBe("..");
    }
  });

  it("Windows 包必须带齐四个 MSVC 运行时 DLL（少一个是 0xC0000135 闪退，OpenWhispr CUS-113）", () => {
    const win = LOCAL_SPEECH_ENGINE_PLATFORMS.find((entry) => entry.platformKey === "win32-x64");
    expect(win).toBeDefined();
    const files = win!.members.map((member) => member.fileName);
    expect(files).toEqual(expect.arrayContaining(["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll", "vcomp140.dll"]));
  });

  it("每个平台的可执行文件都在成员清单里（否则装完也跑不起来）", () => {
    for (const entry of LOCAL_SPEECH_ENGINE_PLATFORMS) {
      expect(entry.members.map((member) => member.fileName)).toContain(entry.executableFileName);
      expect(entry.members.every((member) => member.sha256.match(/^[0-9a-f]{64}$/))).toBe(true);
    }
  });

  it("不支持的平台返回 undefined —— 显式 unsupported，不是 undefined 当兜底（R17）", () => {
    expect(localSpeechEngineForPlatform("darwin", "arm64")?.platformKey).toBe("darwin-arm64");
    expect(localSpeechEngineForPlatform("win32", "x64")?.platformKey).toBe("win32-x64");
    expect(localSpeechEngineForPlatform("linux", "x64")).toBeUndefined();
    expect(localSpeechEngineForPlatform("win32", "arm64")).toBeUndefined();
  });

  it("默认档存在，且档位 id 唯一（id 会进用户设置，撞名等于换模型身份）", () => {
    expect(localSpeechTier(LOCAL_SPEECH_DEFAULT_TIER)).toBeDefined();
    expect(new Set(LOCAL_SPEECH_TIERS.map((tier) => tier.id)).size).toBe(LOCAL_SPEECH_TIERS.length);
  });

  it("Windows 那条是 CPU 构建、mac 两条是 GPU 构建——这一格决定用户被告知等多久，必须与真机实测一致", () => {
    const byKey = Object.fromEntries(LOCAL_SPEECH_ENGINE_PLATFORMS.map((entry) => [entry.platformKey, entry.gpuAccelerated]));
    expect(byKey["darwin-arm64"]).toBe(true);
    expect(byKey["darwin-x64"]).toBe(true);
    expect(byKey["win32-x64"]).toBe(false);
  });

  it("无 GPU 的倍率必须明显低于有 GPU 的——拿 mac 的数字去糊 Windows，报出来的「1 分钟」在用户那里是十分钟的沉默", () => {
    for (const tier of LOCAL_SPEECH_TIERS) {
      expect(tier.measuredCpuRealtimeFactor).toBeGreaterThan(0);
      expect(tier.measuredCpuRealtimeFactor).toBeLessThan(tier.measuredRealtimeFactor);
    }
  });

  it("每一档都必须带实测数字——没有实测就不该出现在清单里（D3：不许 bluff）", () => {
    for (const tier of LOCAL_SPEECH_TIERS) {
      expect(tier.measuredCer).toBeGreaterThan(0);
      // 中英混真素材上 15% 以上的字错率意味着用户要逐句改，不满足「中英都能用」。
      expect(tier.measuredCer).toBeLessThan(0.15);
      expect(tier.measuredRealtimeFactor).toBeGreaterThan(1);
    }
  });

  it("出站源只有官方 GitHub release 与 HuggingFace，没有第三方镜像", () => {
    expect([...localSpeechAssetOrigins()].sort()).toEqual(["https://github.com", "https://huggingface.co"]);
  });
});
