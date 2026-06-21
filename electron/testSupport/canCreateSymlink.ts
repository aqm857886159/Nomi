import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function canCreateSymlink(kind: "file" | "dir" = "dir"): boolean {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-symlink-support-"));
  const target = path.join(root, kind === "dir" ? "target-dir" : "target.txt");
  const link = path.join(root, kind === "dir" ? "linked-dir" : "linked.txt");
  try {
    if (kind === "dir") {
      fs.mkdirSync(target);
      fs.symlinkSync(target, link, "dir");
    } else {
      fs.writeFileSync(target, "x");
      fs.symlinkSync(target, link);
    }
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
