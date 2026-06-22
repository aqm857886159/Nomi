import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockedUserDataRoot = "";

vi.mock("electron", () => ({
  app: {
    getPath: () => mockedUserDataRoot,
    getAppPath: () => process.cwd(),
  },
}));

import { addUserPrompt, deleteUserPrompt, listUserPrompts, resetUserPromptCache, updateUserPrompt } from "./userPromptStore";

const tempRoots: string[] = [];

beforeEach(() => {
  mockedUserDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-userprompt-"));
  tempRoots.push(mockedUserDataRoot);
  resetUserPromptCache();
});

afterEach(() => {
  for (const dir of tempRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("userPromptStore", () => {
  it("add → list 落盘且可读回", () => {
    const item = addUserPrompt({ title: "黄昏剪影", prompt: "屋顶逆光少年", promptType: "image" });
    expect(item.id).toMatch(/^user-/);
    expect(item.origin).toBe("user");
    expect(item.source).toBe("我的");
    const list = listUserPrompts();
    expect(list).toHaveLength(1);
    expect(list[0]?.prompt).toBe("屋顶逆光少年");
    // 真落盘:重置内存缓存后从盘水合仍在
    resetUserPromptCache();
    expect(listUserPrompts()).toHaveLength(1);
  });

  it("空提示词拒绝写入", () => {
    expect(() => addUserPrompt({ prompt: "   ", promptType: "image" })).toThrow();
    expect(listUserPrompts()).toHaveLength(0);
  });

  it("无标题落「未命名提示词」,类型默认 image", () => {
    const item = addUserPrompt({ prompt: "纯文本", promptType: "video" });
    expect(item.title).toBe("未命名提示词");
    expect(item.promptType).toBe("video");
    expect(item.mediaType).toBe("video");
  });

  it("update 改内容 + 类型,mediaType 跟随,updatedAt 刷新", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const item = addUserPrompt({ title: "A", prompt: "old", promptType: "image" });
    const before = item.updatedAt;
    vi.setSystemTime(new Date("2026-01-01T00:00:01Z"));
    const after = updateUserPrompt(item.id, { prompt: "new", promptType: "video" });
    const updated = after.find((p) => p.id === item.id);
    expect(updated?.prompt).toBe("new");
    expect(updated?.promptType).toBe("video");
    expect(updated?.mediaType).toBe("video");
    expect(updated?.updatedAt).not.toBe(before);
    vi.useRealTimers();
  });

  it("delete 移除指定条目,幂等", () => {
    const a = addUserPrompt({ prompt: "a", promptType: "image" });
    const b = addUserPrompt({ prompt: "b", promptType: "image" });
    const afterDel = deleteUserPrompt(a.id);
    expect(afterDel.map((p) => p.id)).toEqual([b.id]);
    expect(deleteUserPrompt(a.id).map((p) => p.id)).toEqual([b.id]); // 再删不报错
  });

  it("最近更新排前", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const a = addUserPrompt({ prompt: "first", promptType: "image" });
    vi.setSystemTime(new Date("2026-01-01T00:00:01Z"));
    addUserPrompt({ prompt: "second", promptType: "image" });
    vi.setSystemTime(new Date("2026-01-01T00:00:02Z"));
    updateUserPrompt(a.id, { prompt: "first-edited" });
    expect(listUserPrompts()[0]?.id).toBe(a.id); // a 刚编辑过,冒到顶
    vi.useRealTimers();
  });
});
