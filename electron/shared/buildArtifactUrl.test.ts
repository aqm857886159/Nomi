import { describe, expect, it } from "vitest";
import { classifyBuildArtifactUrl, mayContainBuildArtifactUrl, rewriteBuildArtifactUrls } from "./buildArtifactUrl";

// 用户 2026-09-25 Mac 控制台里的两条原样地址。
const PACKAGED_KID = "file:///Applications/Nomi.app/Contents/Resources/app.asar/dist/assets/kid-Bv5PJ3l5.jpg";
const DEV_KID = "http://127.0.0.1:5273/src/workbench/onboarding/assets/robot/kid.jpg";

describe("classifyBuildArtifactUrl — 构建产物地址不许进项目数据", () => {
  it("认出用户控制台里的两条引导示例图地址，并给出随包文件名", () => {
    expect(classifyBuildArtifactUrl(PACKAGED_KID)).toEqual({ kind: "onboarding-demo", fileName: "kid.jpg" });
    expect(classifyBuildArtifactUrl(DEV_KID)).toEqual({ kind: "onboarding-demo", fileName: "kid.jpg" });
    expect(classifyBuildArtifactUrl("file:///D:/Nomi/dist/assets/shot-8-a1B2_c3D.jpg")).toEqual({ kind: "onboarding-demo", fileName: "shot-8.jpg" });
    expect(classifyBuildArtifactUrl("file:///C:/Program%20Files/Nomi/resources/app.asar/dist/assets/robot-XXXXXXXX.jpg")).toEqual({ kind: "onboarding-demo", fileName: "robot.jpg" });
  });

  it("其它包内 / 开发服务器源码地址是找不回字节的构建产物", () => {
    expect(classifyBuildArtifactUrl("file:///Applications/Nomi.app/Contents/Resources/app.asar/dist/assets/logo-AbCd1234.png")).toEqual({ kind: "bundle" });
    expect(classifyBuildArtifactUrl("http://localhost:5273/src/assets/hero.webp")).toEqual({ kind: "bundle" });
    expect(classifyBuildArtifactUrl("http://127.0.0.1:5273/@fs/D:/Nomi/src/x.png")).toEqual({ kind: "bundle" });
  });

  it("不误伤：ComfyUI 本地结果、用户本地文件、nomi-local、远端地址", () => {
    expect(classifyBuildArtifactUrl("http://127.0.0.1:8188/view?filename=ComfyUI_0001.png&type=output")).toBeNull();
    expect(classifyBuildArtifactUrl("file:///Users/me/Movies/dist/assets/kid-final.jpg")).toBeNull();
    expect(classifyBuildArtifactUrl("file:///Users/me/web/dist/assets/banner-AbCd1234.png")).toBeNull();
    expect(classifyBuildArtifactUrl("nomi-local://asset/p1/assets/generated/kid.jpg")).toBeNull();
    expect(classifyBuildArtifactUrl("https://cdn.openai.com/sora/videos/tokyo-walk.mp4")).toBeNull();
    expect(classifyBuildArtifactUrl("随手写的 /src/ 路径说明")).toBeNull();
  });
});

describe("rewriteBuildArtifactUrls", () => {
  const toLocal = (url: string) => url.replace(/^.*\/(kid)[^/]*$/, "nomi-local://asset/p1/assets/generated/$1.jpg");

  it("整串地址与提示词里的 @[asset:…] 引用都换掉，其余文字不动", () => {
    expect(rewriteBuildArtifactUrls(PACKAGED_KID, toLocal)).toBe("nomi-local://asset/p1/assets/generated/kid.jpg");
    const prompt = `主角参考 @[asset:${encodeURIComponent(DEV_KID)}] 站在屋顶`;
    expect(rewriteBuildArtifactUrls(prompt, toLocal)).toBe(`主角参考 @[asset:${encodeURIComponent("nomi-local://asset/p1/assets/generated/kid.jpg")}] 站在屋顶`);
  });

  it("没有构建产物地址时原样返回同一个字符串", () => {
    const text = "@[asset:nomi-local%3A%2F%2Fasset%2Fp1%2Fa.png] 普通文本";
    expect(rewriteBuildArtifactUrls(text, () => "x")).toBe(text);
  });
});

describe("mayContainBuildArtifactUrl — 快照预筛", () => {
  it("命中两条原样地址与编码进 @[asset:…] 的写法，不被普通 /src/ 文本触发", () => {
    expect(mayContainBuildArtifactUrl(JSON.stringify({ url: PACKAGED_KID }))).toBe(true);
    expect(mayContainBuildArtifactUrl(JSON.stringify({ url: DEV_KID }))).toBe(true);
    expect(mayContainBuildArtifactUrl(JSON.stringify({ prompt: `@[asset:${encodeURIComponent(DEV_KID)}]` }))).toBe(true);
    expect(mayContainBuildArtifactUrl(JSON.stringify({ note: "see /src/ folder", url: "http://127.0.0.1:8188/view?x=1" }))).toBe(false);
  });
});
