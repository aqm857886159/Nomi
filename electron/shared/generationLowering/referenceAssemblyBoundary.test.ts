/**
 * S3 防回潮的结构合同（替掉旧的静态写键扫描与例外登记表）：
 *   · 参考装配入口（`withLoweredReferences`）只认解析器产出的不透明产物；
 *   · 发送入口（`sendProfileJson`）只认装配主人（`profileHttpRequest.ts`）封存的请求体；
 *   · 两边对外都只给独立快照，改快照、展开克隆、断言、反序列化、assign 都拿不到资格。
 * 类型负例用 `@ts-expect-error`（`pnpm run check:test-types` 看）；运行时负例必须在入口被拒、带原因、不吞错；
 * 正例：普通 metadata、合法固定参数优先、旧节点 / 自写目录恢复成标准意图后照样能发。
 * 谁能 import 底层写接口（模块边界）在同目录 `referenceAssemblyBoundary.lint.test.ts`。
 * 方向：`docs/engineering/direction-checks/2026-11-09-reference-assembly-boundary.md`。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const requestJson = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ ok: true })));
vi.mock("../../vendor/vendorHttp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../vendor/vendorHttp")>()),
  requestJson,
}));

import * as assemblyModule from "../../catalog/profileHttpRequest";
import {
  buildProfileHttpRequest,
  profileBodySnapshot,
  ProfileRequestProvenanceError,
  sendProfileJson,
  transformProfileBody,
  transformProfileBodySync,
  type ProfileRequestBody,
} from "../../catalog/profileHttpRequest";
import type { HttpOperation, Model, Vendor } from "../../catalog/types";
import { registerRequestTransform } from "../../tasks/requestTransforms";
import * as loweringModule from "./lowerGenerationIntent";
import {
  lowerGenerationIntent,
  LoweringProvenanceError,
  withLoweredReferences,
  type GenerationDeclaration,
  type LoweredGeneration,
} from "./lowerGenerationIntent";
import { standardizeExplicitRunReferences } from "./runReferences";

const A = "https://cdn.example/a.png";
const PLANTED = "https://attacker.example/planted.png";

const vendor = { key: "fixture", baseUrlHint: "https://api.fixture.example", authType: "bearer" } as Vendor;
const model = { vendorKey: "fixture", modelKey: "fixture-video", kind: "video", labelZh: "Fixture" } as Model;
const operation: HttpOperation = {
  method: "POST",
  path: "/v1/videos/generations",
  body: { model: "{{model.modelKey}}", prompt: "{{request.prompt}}", image_urls: "{{request.params.image_urls}}" },
};

const DECLARATION: GenerationDeclaration = {
  bindings: [{ kind: "image_ref", target: { select: "declared", key: "image_urls" }, encoding: { shape: "url-list" } }],
  readKeys: ["image_urls"],
};

function lowered(): LoweredGeneration {
  return lowerGenerationIntent(DECLARATION, { references: [{ binding: 0, value: A }] });
}

function built(extras: Record<string, unknown> = { image_urls: [A] }) {
  return buildProfileHttpRequest({
    vendor,
    model,
    apiKey: "test-key",
    request: { kind: "image_to_video", prompt: "move", extras },
    operation,
  });
}

function sentBody(): unknown {
  expect(requestJson).toHaveBeenCalledTimes(1);
  return requestJson.mock.calls[0]![6];
}

beforeEach(() => requestJson.mockClear());

describe("参考装配入口只认解析器产物", () => {
  it("产物里没有可写的参数袋，对外只有冻结的独立快照", () => {
    const product = lowered();
    expect("bodyParams" in product).toBe(false);
    expect(JSON.stringify(product)).not.toContain(A);
    const snapshot = product.snapshot();
    expect(snapshot).toEqual({ image_urls: [A] });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.image_urls)).toBe(true);
    expect(() => { (snapshot as Record<string, unknown>).image_urls = [PLANTED]; }).toThrow(TypeError);
    expect(product.snapshot()).not.toBe(snapshot);
    expect(product.placedKeys).toEqual(["image_urls"]);
  });

  it("正例：并入保留调用方的普通 metadata，参考值来自产物", () => {
    const base: Record<string, unknown> = {};
    base.projectId = "project-1";
    base["nodeId"] = "node-1";
    Object.assign(base, { seed: 7 });
    expect(withLoweredReferences(base, lowered())).toEqual({ projectId: "project-1", nodeId: "node-1", seed: 7, image_urls: [A] });
  });

  it("正例：模式固定参数照旧压过已有值", () => {
    const product = lowerGenerationIntent({ ...DECLARATION, fixedParams: { generation_mode: "pro" } }, { references: [{ binding: 0, value: A }] });
    expect(withLoweredReferences({ generation_mode: "std", seed: 1 }, product)).toEqual({ generation_mode: "pro", seed: 1, image_urls: [A] });
  });

  const forgeries: ReadonlyArray<readonly [string, () => unknown]> = [
    ["裸 Record", () => ({ image_urls: [PLANTED] })],
    ["改过的快照", () => ({ ...lowered().snapshot(), image_urls: [PLANTED] })],
    ["展开克隆", () => ({ ...lowered() })],
    ["structuredClone", () => structuredClone(lowered())],
    ["JSON 反序列化", () => JSON.parse(JSON.stringify(lowered()))],
    ["借原型伪造", () => Object.assign(Object.create(Object.getPrototypeOf(lowered())), { image_urls: [PLANTED] })],
    ["Proxy 包装", () => new Proxy(lowered(), {})],
  ];
  for (const [name, forge] of forgeries) {
    it(`运行时负例：${name}在并入口被拒，带原因`, () => {
      expect(() => withLoweredReferences({}, forge() as LoweredGeneration)).toThrow(LoweringProvenanceError);
      expect(() => withLoweredReferences({}, forge() as LoweredGeneration)).toThrow(/lowerGenerationIntent/);
    });
  }

  it("运行时负例：assign 到真产物上不生效，也改不动并入结果", () => {
    const product = lowered();
    expect(() => Object.assign(product, { image_urls: [PLANTED] })).toThrow(TypeError);
    expect(JSON.stringify(withLoweredReferences({}, product))).not.toContain(PLANTED);
  });

  it("运行时负例：拿到构造器也造不出产物", () => {
    const Ctor = Object.getPrototypeOf(lowered()).constructor as new (...args: unknown[]) => unknown;
    expect(() => new Ctor({ image_urls: [PLANTED] }, [])).toThrow(LoweringProvenanceError);
  });
});

describe("发送入口只认装配主人封存的请求体", () => {
  it("正例：封存体发出去的就是渲染出的那份 body，且与预览互相独立", async () => {
    const request = built();
    expect(profileBodySnapshot(request.sealed)).toEqual(request.body);
    (request.body as Record<string, unknown>).image_urls = [PLANTED];
    await sendProfileJson(vendor, "test-key", request, request.sealed);
    const [, , method, url] = requestJson.mock.calls[0]!;
    expect([method, url]).toEqual(["POST", "https://api.fixture.example/v1/videos/generations"]);
    expect(sentBody()).toEqual({ model: "fixture-video", prompt: "move", image_urls: [A] });
  });

  it("正例：没有 body 的轮询照旧发（只传传输层）", async () => {
    const request = built();
    await sendProfileJson(vendor, "test-key", request, undefined);
    expect(sentBody()).toBeUndefined();
  });

  const forgeries: ReadonlyArray<readonly [string, () => unknown]> = [
    ["裸 Record", () => ({ image_urls: [PLANTED] })],
    ["预览体", () => built().body],
    ["改过的预览", () => ({ ...(built().body as Record<string, unknown>), image_urls: [PLANTED] })],
    ["展开克隆", () => ({ ...built().sealed })],
    ["structuredClone", () => structuredClone(built().sealed)],
    ["JSON 反序列化", () => JSON.parse(JSON.stringify(built().sealed))],
    ["借原型伪造", () => Object.assign(Object.create(Object.getPrototypeOf(built().sealed)), { image_urls: [PLANTED] })],
    ["Proxy 包装", () => new Proxy(built().sealed, {})],
  ];
  for (const [name, forge] of forgeries) {
    it(`运行时负例：${name}在发送入口被拒，带原因，不出网`, async () => {
      const request = built();
      await expect(sendProfileJson(vendor, "test-key", request, forge() as ProfileRequestBody)).rejects.toThrow(ProfileRequestProvenanceError);
      await expect(sendProfileJson(vendor, "test-key", request, forge() as ProfileRequestBody)).rejects.toThrow(/profileHttpRequest/);
      expect(requestJson).not.toHaveBeenCalled();
    });
  }

  it("运行时负例：assign 到真封存体上不生效，发出去的仍是原样", async () => {
    const request = built();
    expect(() => Object.assign(request.sealed, { image_urls: [PLANTED] })).toThrow(TypeError);
    await sendProfileJson(vendor, "test-key", request, request.sealed);
    expect(JSON.stringify(sentBody())).not.toContain(PLANTED);
  });

  it("运行时负例：拿到构造器也造不出封存体", () => {
    const Ctor = Object.getPrototypeOf(built().sealed).constructor as new (...args: unknown[]) => unknown;
    expect(() => new Ctor({ image_urls: [PLANTED] })).toThrow(ProfileRequestProvenanceError);
  });

  it("受控变换阶段：变换只拿私有副本，产出重新封存；喂裸体被拒", async () => {
    registerRequestTransform("__s3_boundary_probe__", (body) => {
      (body as Record<string, unknown>).image_urls = ["https://cdn.example/transformed.png"];
      return body;
    });
    const request = built();
    const context = { baseUrl: vendor.baseUrlHint!, request: { kind: "image_to_video", prompt: "move", extras: {} } } as const;
    const transformed = await transformProfileBody("__s3_boundary_probe__", request.sealed, context);
    expect(profileBodySnapshot(transformed)).toMatchObject({ image_urls: ["https://cdn.example/transformed.png"] });
    expect(profileBodySnapshot(request.sealed)).toMatchObject({ image_urls: [A] });
    expect(profileBodySnapshot(transformProfileBodySync("__s3_boundary_probe__", request.sealed, context))).toMatchObject({ image_urls: ["https://cdn.example/transformed.png"] });
    await expect(transformProfileBody("__s3_boundary_probe__", { image_urls: [PLANTED] } as unknown as ProfileRequestBody, context)).rejects.toThrow(ProfileRequestProvenanceError);
    expect(await transformProfileBody(undefined, request.sealed, context)).toBe(request.sealed);
  });

  it("正例：旧 Run 显式参数 / 自写目录模板恢复成标准意图后照样能发", async () => {
    // 旧 Run 合同把参考直接写在 image_urls 上；body 只读 imageUrls → 经同一个解析器落到 body 真读的键。
    const restored = standardizeExplicitRunReferences({ image_urls: [A], seed: 3 }, ["imageUrls"]);
    const selfWritten: HttpOperation = { method: "POST", path: "/v1/custom", body: { pictures: "{{request.params.imageUrls}}", seed: "{{request.params.seed}}" } };
    const request = buildProfileHttpRequest({ vendor, model, apiKey: "test-key", request: { kind: "image_to_video", prompt: "p", extras: restored }, operation: selfWritten });
    await sendProfileJson(vendor, "test-key", request, request.sealed);
    expect(sentBody()).toEqual({ pictures: [A], seed: 3 });
  });
});

describe("导出面性质：没有任何导出能把裸 Record 变成有资格的产物（不导出 seal(rawRecord)）", () => {
  type Callable = (...args: unknown[]) => unknown;
  /** 每个函数导出，加上导出类身上的静态函数（`static seal()` 也算一扇门）。 */
  const exportsOf = (moduleRecord: Record<string, unknown>): Array<[string, Callable, unknown]> =>
    Object.entries(moduleRecord).flatMap(([name, value]): Array<[string, Callable, unknown]> => {
      if (typeof value !== "function") return [];
      const statics = Object.getOwnPropertyNames(value)
        .map((key) => [key, Reflect.get(value, key)] as const)
        .filter((entry): entry is readonly [string, Callable] => typeof entry[1] === "function")
        .map(([key, member]): [string, Callable, unknown] => [`${name}.${key}`, member, value]);
      return [[name, value as Callable, undefined], ...statics];
    });

  async function settle(call: () => unknown): Promise<unknown> {
    try {
      const result = call();
      return result && typeof (result as PromiseLike<unknown>).then === "function" ? await result : result;
    } catch {
      return undefined;
    }
  }

  /** 结果（或它的一层字段）如果是真产物 / 真封存体，里面不许带着种进去的那个地址。 */
  function carriesPlanted(value: unknown, depth = 0): boolean {
    if (!value || typeof value !== "object" || depth > 1) return false;
    try { if (JSON.stringify(withLoweredReferences({}, value as LoweredGeneration)).includes(PLANTED)) return true; } catch { /* 不是产物 */ }
    try { if (JSON.stringify(profileBodySnapshot(value as ProfileRequestBody)).includes(PLANTED)) return true; } catch { /* 不是封存体 */ }
    return Object.values(value as Record<string, unknown>).some((child) => carriesPlanted(child, depth + 1));
  }

  for (const [label, moduleRecord] of [["lowerGenerationIntent.ts", loweringModule], ["profileHttpRequest.ts", assemblyModule]] as const) {
    it(`${label} 的每个函数导出喂裸 Record 都拿不到带种子的产物`, async () => {
      const raw = (): Record<string, unknown> => ({ image_urls: [PLANTED], body: { image_urls: [PLANTED] } });
      const leaking: string[] = [];
      for (const [name, fn, owner] of exportsOf(moduleRecord as Record<string, unknown>)) {
        for (const args of [[raw()], [raw(), raw()], [undefined, raw()]]) {
          const result = await settle(() => Reflect.apply(fn, owner, args));
          if (carriesPlanted(result)) leaking.push(name);
          const constructed = await settle(() => Reflect.construct(fn, args));
          if (carriesPlanted(constructed)) leaking.push(`new ${name}`);
        }
      }
      expect([...new Set(leaking)]).toEqual([]);
    });
  }
});

/**
 * 类型负例：不执行，只给 `check:test-types` 看。哪一行的 `@ts-expect-error` 变成「没用上」，就说明那种伪造在编译期能过了。
 */
function typeNegatives(product: LoweredGeneration, request: ReturnType<typeof buildProfileHttpRequest>): void {
  // @ts-expect-error -- 裸 Record 不是解析产物
  withLoweredReferences({}, { image_urls: [PLANTED] });
  // @ts-expect-error -- 展开克隆没有 #params
  withLoweredReferences({}, { ...product });
  // @ts-expect-error -- 快照不是产物
  withLoweredReferences({}, product.snapshot());
  // @ts-expect-error -- 产物上没有可写的参数袋
  product.bodyParams.image_urls = [PLANTED];
  // @ts-expect-error -- 裸 Record 不能发
  void sendProfileJson(vendor, "k", request, { image_urls: [PLANTED] });
  // @ts-expect-error -- 预览体不能发
  void sendProfileJson(vendor, "k", request, request.body);
  // @ts-expect-error -- 改过的预览也不能发
  void sendProfileJson(vendor, "k", request, { ...(request.body as Record<string, unknown>), image_urls: [PLANTED] });
  // @ts-expect-error -- 展开克隆的封存体没有 #payload
  void sendProfileJson(vendor, "k", request, { ...request.sealed });
  // @ts-expect-error -- 装配主人不导出 seal(rawRecord)
  void assemblyModule.seal;
  // @ts-expect-error -- 解析器模块也不导出 seal(rawRecord)
  void loweringModule.seal;
}
void typeNegatives;
