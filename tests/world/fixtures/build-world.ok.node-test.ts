// 正例：经 buildWorld 造世界、damageWorldFile 弄坏、worldRows 取行、seedOldUserData 拷旧数据，锁都放行。
import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { buildWorld, damageWorldFile, seedOldUserData, worldRows } from "../index";
// @ts-expect-error 纯 JS 名册模块
import { listOldUserData } from "../oldUserData.mjs";

const worlds: Array<{ cleanup: () => void }> = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.cleanup();
});

it("buildWorld 产出主人存盘文件和一个项目", () => {
  const world = buildWorld({});
  worlds.push(world);
  expect(world.producedFiles).toContain("model-catalog.json");
  expect(world.projects).toHaveLength(1);
  expect(fs.existsSync(path.join(world.settingsDir, "model-catalog.json"))).toBe(true);
});

it("damageWorldFile 只动已产出的文件", () => {
  const world = buildWorld({ projects: [] });
  worlds.push(world);
  damageWorldFile(world, "model-catalog.json", "invalid-json");
  expect(() => JSON.parse(fs.readFileSync(path.join(world.settingsDir, "model-catalog.json"), "utf8"))).toThrow();
  expect(() => damageWorldFile(world, "not-produced.json", "empty")).toThrow(/damage_file_not_produced/);
});

it("worldRows 经主人读口给行", () => {
  const rows = worldRows({});
  expect(rows.vendors.length).toBeGreaterThan(0);
});

it("seedOldUserData 把旧数据拷成世界", () => {
  const roster = (listOldUserData() as Array<{ id: string; kind: string }>).filter((item) => item.kind === "settings");
  expect(roster.length).toBeGreaterThan(0);
  const world = seedOldUserData(roster[0].id);
  worlds.push(world);
  expect(world.producedFiles).toContain("model-catalog.json");
});
