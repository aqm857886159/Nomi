import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// 目录来自 pi 的加载器（岛上、async）；这里测的是 skillStore 留下的**策略**层，喂它的是真目录。
import { discoverSkillRecords } from "../agentLane/laneSkillCatalog.mjs";
import type { SkillManifest } from "./skillManifestSchema";
import { SKILL_PACKAGE_VERSION } from "./skillPackage";
import {
  findSkillRecord,
  listSkillSummariesForMcp,
  readSkillContentForMcp,
  isSkillSelectableInWorkbench,
  normalizeSkillLookupKey,
  type SkillRecord,
} from "./skillStore";

function manifest(partial: Partial<SkillManifest>): SkillManifest {
  return {
    version: "1.0.0",
    tools: [],
    requiredProviders: [],
    ...partial,
  };
}

function record(name: string, directoryName: string): SkillRecord {
  return {
    name,
    directoryName,
    filePath: `${directoryName}/SKILL.md`,
    packageDir: directoryName,
    description: "Test skill",
    content: "x",
    body: "x",
    manifest: null,
    origin: "builtin",
    audience: "internal",
    packageVersion: SKILL_PACKAGE_VERSION,
    contentHash: "a".repeat(64),
    requiresCodingTools: false,
  };
}

const records: SkillRecord[] = [
  record("workbench.generation", "workbench-generation"),
  record("workbench.storyboard.planner", "workbench-storyboard-planner"),
  record("brand.promo", "brand-promo"),
];

describe("normalizeSkillLookupKey", () => {
  it("normalizes camelCase / dots / underscores to kebab", () => {
    expect(normalizeSkillLookupKey("workbench.storyboard.planner")).toBe("workbench-storyboard-planner");
    expect(normalizeSkillLookupKey("brandPromo")).toBe("brand-promo");
  });
});

describe("findSkillRecord", () => {
  it("matches exact name first", () => {
    expect(findSkillRecord("brand.promo", "", records)?.name).toBe("brand.promo");
  });

  it("matches by prefix (e.g. creation mode key under a base skill name)", () => {
    expect(findSkillRecord("workbench-generation", "", records)?.name).toBe(
      "workbench.generation",
    );
  });

  it("falls back to normalized directory-name match", () => {
    expect(findSkillRecord("brand-promo", "", records)?.name).toBe("brand.promo");
  });

  it("returns null when nothing matches", () => {
    expect(findSkillRecord("does.not.exist", "nope", records)).toBeNull();
  });
});

describe("isSkillSelectableInWorkbench", () => {
  it("requires explicit opt-in for a built-in single-stage Skill", () => {
    expect(isSkillSelectableInWorkbench({
      ...record("workbench.storyboard.planner", "workbench-storyboard-planner"),
      manifest: manifest({ selectableInWorkbench: true }),
    })).toBe(true);
    expect(isSkillSelectableInWorkbench({
      ...record("workbench-generation", "workbench-generation"),
      manifest: manifest({ selectableInWorkbench: false }),
    })).toBe(false);
  });

  it("keeps user Skills and existing multi-stage playbooks selectable, independent of MCP audience", () => {
    expect(isSkillSelectableInWorkbench({
      ...record("brand.promo", "brand-promo"),
      manifest: manifest({ stages: [{ id: "script", goal: "Write", tools: [] }] }),
    })).toBe(true);
    expect(isSkillSelectableInWorkbench({
      ...record("user.skill", "user-skill"),
      origin: "user",
      manifest: null,
    })).toBe(true);
    expect(isSkillSelectableInWorkbench({
      ...record("mcp.only", "mcp-only"),
      manifest: manifest({ audience: "mcp" }),
    })).toBe(false);
  });
});

describe("catalog precedence (S9)", () => {
  // 2026-09-07：这条断言原来住在 `harness/runtime/pi/nomiSkillResources.test.ts`，2026-09-18 发现交给 pi 之后
  // 它测的仍是我们留下的那条投影规则（`laneSkillCatalog.mts` 的「损坏包不许占坑遮蔽」）——pi 的 YAML 解析
  // 只看 frontmatter，会把含 NUL 的正文当合法技能交出来，所以这一条是我们薄薄保留的。内容逐字不变。
  it("does not let an invalid higher-priority package shadow a valid same-directory package", async () => {
    const root = await mkdtemp(join(tmpdir(), "nomi-skill-precedence-"));
    const broken = join(root, "broken");
    const valid = join(root, "valid");
    await mkdir(join(broken, "shared"), { recursive: true });
    await mkdir(join(valid, "shared"), { recursive: true });
    await writeFile(join(broken, "shared", "SKILL.md"), "---\nname: shared\ndescription: Broken\n---\n\0");
    await writeFile(join(valid, "shared", "SKILL.md"), "---\nname: shared\ndescription: Valid\n---\nUse me.");
    try {
      const discovered = await discoverSkillRecords([
        { path: broken, origin: "builtin" },
        { path: valid, origin: "user" },
      ]);
      expect(discovered.records).toHaveLength(1);
      expect(discovered.records[0]).toMatchObject({ origin: "user", description: "Valid" });
      expect(discovered.diagnostics).toEqual([
        expect.objectContaining({ type: "warning", code: "corrupt", path: join(broken, "shared", "SKILL.md") }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});


describe('MCP complete skill content', () => {
  it('keeps references discoverable and hash-bound, with visibility and path checks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nomi-mcp-content-'));
    const skillDir = join(root, 'complete');
    await mkdir(join(skillDir, 'references'), { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: complete\ndescription: Complete package\n---\nRead references/full.md.');
    await writeFile(join(skillDir, 'references/full.md'), 'Full reference body.');
    await writeFile(join(root, 'outside.md'), 'Outside package.');
    await symlink(join(root, 'outside.md'), join(skillDir, 'references/escape.md'));
    try {
      const records = (await discoverSkillRecords([{ path: root, origin: 'user' }])).records;
      expect(records.map((item) => item.directoryName)).toEqual(['complete']);
      const identity = { packageVersion: records[0].packageVersion, contentHash: records[0].contentHash };
      expect(listSkillSummariesForMcp('local-authenticated', records)[0]).toMatchObject({ filePaths: ['SKILL.md', 'references/full.md'] });
      expect(readSkillContentForMcp('complete', 'local-authenticated', records, identity, 'references/full.md')?.body).toBe('Full reference body.');
      expect(listSkillSummariesForMcp('public', records)).toEqual([]);
      expect(readSkillContentForMcp('complete', 'public', records, identity, 'references/full.md')).toBeNull();
      expect(readSkillContentForMcp('complete', 'local-authenticated', records, identity, 'references/escape.md')).toBeNull();
      expect(readSkillContentForMcp('complete', 'local-authenticated', records, identity, '../SKILL.md')).toBeNull();
      expect(readSkillContentForMcp('complete', 'local-authenticated', records, identity, 'references/missing.md')).toBeNull();
      await writeFile(join(skillDir, 'references/full.md'), 'Changed reference.');
      expect(readSkillContentForMcp('complete', 'local-authenticated', records, identity, 'references/full.md')).toBeNull();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe('flag-bound Skill selectability (3D-BOX)', () => {
  it('a Skill that requires the 3D-BOX flag is selectable only when the shared face is on', async () => {
    const { installDirector3DBoxFace, resetDirector3DBoxFaceForTests } = await import('../shared/featureFlags/director3dboxFace')
    const { isSkillSelectableInWorkbench } = await import('./skillStore')
    const record = { name: 'director-3dbox', origin: 'builtin' as const, manifest: { version: '1.0.0', tools: [], requiredProviders: [], selectableInWorkbench: true, requiresFlag: 'director3dbox' as const } }
    try {
      resetDirector3DBoxFaceForTests()
      installDirector3DBoxFace(false)
      expect(isSkillSelectableInWorkbench(record)).toBe(false)
      resetDirector3DBoxFaceForTests()
      installDirector3DBoxFace(true)
      expect(isSkillSelectableInWorkbench(record)).toBe(true)
      expect(isSkillSelectableInWorkbench({ ...record, manifest: { ...record.manifest, requiresFlag: undefined } })).toBe(true)
    } finally {
      resetDirector3DBoxFaceForTests()
    }
  })
})
