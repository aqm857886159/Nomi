import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LOCAL_SPEECH_ENGINE_PLATFORMS, LOCAL_SPEECH_TIERS } from "../shared/localSpeech/localSpeechAssets";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const build = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).build as Record<string, unknown>;
const buildText = JSON.stringify(build);

/**
 * **sidecar 二进制与权重不进安装包**，这是一条要被守住的结构决定，不是「暂时还没做」。
 *
 * 为什么必须这样：
 *  · 体积——引擎 1.3 MB 不算什么，但权重 574 MB 进安装包等于让每个从不用本地转写的用户
 *    多下 574 MB。首次使用才下载是把成本交给真正要用的人。
 *  · 签名——这台 macOS 的打包链今天是 `identity: null` + afterPack 里一次 ad-hoc
 *    `codesign --deep --sign -`，**没有 Developer ID、没有公证**。等真做签名公证那天，
 *    包内的每个可执行文件都要被覆盖；一个从别处下来的、由第三方构建的二进制躺在包里，
 *    只会让那件事更难而不是更容易。它住在 userData 里、由我们自己 spawn，反而干净：
 *    不掺进 app bundle 的签名边界，也就不需要被公证。
 *  · 于是也没有 asarUnpack 的问题——那条坑（existsSync 说有、spawn 说 ENOTDIR，
 *    见 electron/shared/asarUnpackedPath.ts 顶注）只发生在「打进 asar 的可执行文件」上。
 *
 * 这条测试守的是**反方向**：哪天有人「顺手」把它打进包里，这里会红，并且看到上面这段话。
 */
describe("本地转写的打包边界", () => {
  const engineFileNames = LOCAL_SPEECH_ENGINE_PLATFORMS.flatMap((entry) => [entry.archive.fileName, ...entry.members.map((member) => member.fileName)]);
  const weightFileNames = LOCAL_SPEECH_TIERS.map((tier) => tier.model.fileName);

  it("electron-builder 配置里一个字都不提 sidecar 与权重（不进 files / extraResources / asarUnpack）", () => {
    for (const fileName of [...engineFileNames, ...weightFileNames]) {
      expect(buildText, `${fileName} 出现在打包配置里`).not.toContain(fileName);
    }
    expect(buildText).not.toContain("whisper");
    expect(buildText).not.toContain("local-speech");
  });

  it("引擎与权重落在 userData 的缓存里，不在 resourcesPath —— 随包分发与按需下载只能有一条路（P1）", async () => {
    process.env.NOMI_SETTINGS_DIR = "/tmp/nomi-localstt-packaging-test";
    const { localSpeechEngineDir, localSpeechExecutablePath } = await import("./localSpeechInstall");
    const engine = LOCAL_SPEECH_ENGINE_PLATFORMS[0];
    expect(localSpeechEngineDir(engine)).toContain("/tmp/nomi-localstt-packaging-test/model-cache/local-speech");
    expect(localSpeechExecutablePath(engine)).not.toContain("resourcesPath");
    expect(localSpeechExecutablePath(engine)).not.toContain("app.asar");
  });

  it("目录名带 release 号：换引擎版本 = 换目录，旧版本不会被误当成新版本", () => {
    process.env.NOMI_SETTINGS_DIR = "/tmp/nomi-localstt-packaging-test";
    return import("./localSpeechInstall").then(({ localSpeechEngineDir }) => {
      expect(localSpeechEngineDir(LOCAL_SPEECH_ENGINE_PLATFORMS[0])).toMatch(/engine-\d+\.\d+\.\d+-/);
    });
  });
});
