import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Ajv from "ajv";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";
import { CATALOG_PACKAGE_VERSION, catalogPackageSchema } from "./catalogPackageFormat";

// `desktop-local-v1` 是**外面也读写**的格式（R31）：一个人导出、另一个人（或一个照着接口文档
// 写配置的 LLM）导入。三件事必须同时成立，缺一这份契约就只是一段注释：
//   ① 盘上那份 .schema.json 就是从 zod 派生出来的，不是手抄的第二份（漂移 = 本条红）；
//   ② 官方样例（我们自己发布的那份夹具）过得了这份 schema；
//   ③ **读取器读得过它**——importModelCatalogPackage 能把夹具真读进 catalog。

const SCHEMA_PATH = path.join(process.cwd(), "docs/engineering/formats/desktop-local-v1.schema.json");
const FIXTURE_PATH = path.join(process.cwd(), "tests/fixtures/standard-formats/model-catalog-package/desktop-local-v1.json");

let mockedUserDataRoot = "";
const tempRoots: string[] = [];

vi.mock("electron", () => ({
  app: { getPath: () => mockedUserDataRoot, getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

beforeEach(() => {
  mockedUserDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-catalog-package-"));
  tempRoots.push(mockedUserDataRoot);
  vi.resetModules();
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("desktop-local-v1 catalog package format", () => {
  it("keeps the published JSON Schema derived from the zod contract", () => {
    const convert = zodToJsonSchema as unknown as (schema: unknown, options: Record<string, unknown>) => unknown;
    const generated = convert(catalogPackageSchema, {
      name: "NomiModelCatalogPackage",
      $refStrategy: "none",
      target: "jsonSchema7",
    });
    expect(JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"))).toEqual(generated);
  });

  it("validates the published sample package against the published schema", () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8")));
    const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    expect(fixture.version).toBe(CATALOG_PACKAGE_VERSION);
  });

  it("imports the published sample package into a real catalog", async () => {
    const store = await import("./catalogStore");
    const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));

    expect(store.importModelCatalogPackage(fixture)).toEqual({
      imported: { vendors: 1, models: 2, mappings: 2 },
      errors: [],
    });
    const state = store.readCatalog();
    expect(state.vendors.find((vendor) => vendor.key === "example-relay")?.baseUrlHint)
      .toBe("https://api.example-relay.test/v1");
    expect(state.models.filter((model) => model.vendorKey === "example-relay").map((model) => model.modelKey).sort())
      .toEqual(["example-chat", "example-image"]);
    expect(state.mappings.filter((mapping) => mapping.vendorKey === "example-relay")).toHaveLength(2);
  });

  it("exports a package that satisfies its own published contract", async () => {
    const store = await import("./catalogStore");
    store.importModelCatalogPackage(JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")));

    const exported = store.exportModelCatalogPackage();
    const parsed = catalogPackageSchema.safeParse(exported);
    expect(parsed.success, JSON.stringify(parsed.success ? [] : parsed.error.issues.slice(0, 4))).toBe(true);
    const ajv = new Ajv({ strict: false });
    expect(ajv.validate(JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8")), exported)).toBe(true);
  });

  it("rejects a malformed envelope without writing anything to the catalog", async () => {
    const store = await import("./catalogStore");
    const before = store.readCatalog();

    // 骨架坏掉的那种：vendors 里放的不是 bundle 对象。条目内部的宽松是刻意的（见 format 注释）。
    const result = store.importModelCatalogPackage({ vendors: ["not-a-bundle"] }) as {
      imported: { vendors: number };
      errors: string[];
    };
    expect(result.imported).toEqual({ vendors: 0, models: 0, mappings: 0 });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(store.readCatalog().vendors).toEqual(before.vendors);
  });

  it("still accepts the version-less `{ vendors }` envelope that existing callers send", async () => {
    const store = await import("./catalogStore");
    const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));

    expect(store.importModelCatalogPackage({ vendors: fixture.vendors })).toEqual({
      imported: { vendors: 1, models: 2, mappings: 2 },
      errors: [],
    });
  });
});
