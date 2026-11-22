import { makeTempDir } from "../../../scripts/_test-temp.mjs";
// 反例：把含主人文件的目录整个拷过去（cp 也是写）。来源里的 model-catalog.json 由 world 目录之外的普通文件名造，
// 所以这里只有 cpSync 这一步该红，不是造来源那一步。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

it("cpSync 一个含 model-catalog.json 的目录", () => {
  const src = makeTempDir("nomi-fixture-src-");
  fs.mkdirSync(path.join(src, "inner"), { recursive: true });
  fs.writeFileSync(path.join(src, "inner", "catalog.txt"), "x");
  // 子进程的写锁看不见（设计卡「做不到」里写明）：用它造来源，好让下面的 cpSync 单独成为被测的那一步。
  execFileSync("cp", [path.join(src, "inner", "catalog.txt"), path.join(src, "inner", "model-catalog.json")]);
  const dest = makeTempDir("nomi-fixture-dest-");
  fs.cpSync(src, path.join(dest, "copied"), { recursive: true });
  expect(true).toBe(true);
});
