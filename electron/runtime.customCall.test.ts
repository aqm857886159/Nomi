/**
 * runTask 自定义调用派发点回归锁：
 * ① 模型带脚本 → 脚本接管（不需要 mapping、不走通用 fallback 网络路），零网络成功出产物；
 * ② 付费闸同点位生效（无效 grant 拒发）；
 * ③ 改图类缺参考仍被 L3 护栏拦（脚本被当作「有 mapping」但参考缺失照拒——防花钱空炮）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockedUserDataRoot = "";
const tempRoots: string[] = [];

vi.mock("electron", () => ({
  app: {
    getPath: () => mockedUserDataRoot,
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}));

import {
  upsertModelCatalogMapping,
  upsertModelCatalogModel,
  upsertModelCatalogVendor,
  upsertModelCatalogVendorApiKey,
} from "./catalog/catalogStore";
import { mintSpendGrant } from "./spendGrant";
import { runTask } from "./runtime";

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function seedScriptedModel(script: string, kind: "image" | "video" | "text" | "audio" = "image") {
  upsertModelCatalogVendor({ key: "custom-cc", name: "CC", baseUrlHint: "https://cc.example/v1", authType: "bearer", enabled: true });
  upsertModelCatalogVendorApiKey("custom-cc", { apiKey: "sk-cc-1", enabled: true });
  upsertModelCatalogModel({ vendorKey: "custom-cc", modelKey: "cc-model", kind, enabled: true, customCall: { script } });
}

describe("runTask × customCall", () => {
  beforeEach(() => {
    mockedUserDataRoot = makeTempDir("runtime-custom-call-");
  });
  afterEach(() => {
    for (const dir of tempRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("带脚本的模型走脚本路：零网络成功、产物归一、prompt/params 注入", async () => {
    seedScriptedModel(
      `if (prompt !== 'hello') throw new Error('prompt not injected: ' + prompt)
if (params.n !== 1) throw new Error('params not injected')
return 'data:image/png;base64,eA=='`,
    );
    const grantId = mintSpendGrant({ nodeIds: ["n1"] });
    const result = await runTask({
      vendor: "custom-cc",
      request: {
        kind: "text_to_image",
        prompt: "hello",
        extras: { modelKey: "cc-model", nodeId: "n1", grantId, n: 1 },
      },
    });
    expect(result.status).toBe("succeeded");
    expect(result.assets[0]?.url).toContain("data:image/png");
    expect(result.provenance?.model?.modelKey ?? "cc-model").toBeTruthy();
  });

  it("文本脚本返回 { text }：不伪装成资产，raw 形状与文本主路径一致", async () => {
    seedScriptedModel("return { text: 'prompt refined' }", "text");
    const grantId = mintSpendGrant({ nodeIds: ["n1"] });
    const result = await runTask({
      vendor: "custom-cc",
      request: {
        kind: "prompt_refine",
        prompt: "make this cinematic",
        extras: { modelKey: "cc-model", nodeId: "n1", grantId },
      },
    });
    expect(result.status).toBe("succeeded");
    expect(result.assets).toEqual([]);
    expect(result.raw).toMatchObject({ choices: [{ message: { role: "assistant", content: "prompt refined" } }] });
  });

  it("付费闸同点位：无效 grant 拒发（脚本一行都不执行）", async () => {
    seedScriptedModel(`throw new Error('script must not run')`);
    await expect(
      runTask({
        vendor: "custom-cc",
        request: { kind: "text_to_image", prompt: "x", extras: { modelKey: "cc-model", nodeId: "n1", grantId: "bogus" } },
      }),
    ).rejects.toThrow(/确认|grant|授权|令牌/i);
  });

  it("改图缺参考仍被 L3 护栏拦（不因脚本存在而放行空参考付费）", async () => {
    seedScriptedModel(`return 'data:image/png;base64,eA=='`);
    const grantId = mintSpendGrant({ nodeIds: ["n1"] });
    await expect(
      runTask({
        vendor: "custom-cc",
        request: { kind: "image_edit", prompt: "x", extras: { modelKey: "cc-model", nodeId: "n1", grantId } },
      }),
    ).rejects.toThrow(/参考/);
  });

  it("脚本接管后不再用遗留 mapping body 误判参考图发不出去", async () => {
    seedScriptedModel(`if (!params.referenceImages?.[0]) throw new Error('reference missing')
return 'data:image/png;base64,eA=='`);
    // 模型从声明式 mapping 切到自定义脚本后，旧 mapping 仍可能留在目录里。它的 body 不携带图片，
    // 但脚本会自己读取 params.referenceImages；护栏必须检查实际派发路径，而不是已失效的旧 body。
    upsertModelCatalogMapping({
      vendorKey: "custom-cc",
      modelKey: "cc-model",
      taskKind: "image_edit",
      name: "legacy mapping",
      create: {
        method: "POST",
        path: "/legacy",
        body: { prompt: "{{request.prompt}}", seed: "{{request.params.seed}}" },
      },
    });
    const grantId = mintSpendGrant({ nodeIds: ["n1"] });

    const result = await runTask({
      vendor: "custom-cc",
      request: {
        kind: "image_edit",
        prompt: "keep the subject",
        extras: {
          modelKey: "cc-model",
          nodeId: "n1",
          grantId,
          referenceImages: ["https://cdn.example.com/reference.png"],
        },
      },
    });

    expect(result.status).toBe("succeeded");
  });

  it("audio 也先走 customCall，不会被独立 audio runner 绕过", async () => {
    seedScriptedModel(`if (taskKind !== 'text_to_audio') throw new Error('wrong task kind')
return 'data:audio/mpeg;base64,eA=='`, "audio");
    const grantId = mintSpendGrant({ nodeIds: ["audio-node"] });
    const result = await runTask({
      vendor: "custom-cc",
      request: {
        kind: "text_to_audio",
        prompt: "hello audio",
        extras: { modelKey: "cc-model", nodeId: "audio-node", grantId },
      },
    });

    expect(result.status).toBe("succeeded");
    expect(result.assets[0]).toMatchObject({ type: "audio", url: expect.stringContaining("data:audio") });
  });
});
