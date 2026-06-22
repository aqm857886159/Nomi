// 「我的库」持久化 —— Nomi 第一个用户级(跨项目)存储。
// 单文件 prompt-library-user.json 落 getSettingsRoot()(userData,非项目目录),原子写 + 惰性水合。
// 拷贝语义:送上画布是复制 prompt 进节点,这里只管「用户手写攒的提示词」这份清单的 CRUD。
import crypto from "node:crypto";
import path from "node:path";
import { writeJsonFileAtomic } from "../jsonFile";
import { getSettingsRoot, readJson } from "../runtimePaths";
import type { LibraryPrompt, PromptMediaType } from "./promptLibraryTypes";

const FILE = "prompt-library-user.json"; // 落 userData(NOMI_SETTINGS_DIR 可覆盖,隔离 eval/测试)

type UserPromptInput = { title?: string; prompt: string; promptType: PromptMediaType };

let cache: LibraryPrompt[] | null = null;

function filePath(): string {
  return path.join(getSettingsRoot(), FILE);
}

/** 首次访问从盘水合;之后走内存。文件不存在/损坏 → 空清单。 */
function load(): LibraryPrompt[] {
  if (cache) return cache;
  const raw = readJson<unknown[]>(filePath(), []);
  cache = Array.isArray(raw) ? raw.filter(isUserPrompt) : [];
  return cache;
}

function isUserPrompt(raw: unknown): raw is LibraryPrompt {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.prompt === "string" && r.origin === "user";
}

function persist(list: LibraryPrompt[]): void {
  cache = list;
  writeJsonFileAtomic(filePath(), list);
}

function makePromptType(value: unknown): PromptMediaType {
  return value === "video" ? "video" : "image";
}

export function listUserPrompts(): LibraryPrompt[] {
  // 最近更新在前(新建/编辑即冒泡到顶,贴「我刚存的」直觉)。
  return [...load()].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export function addUserPrompt(input: UserPromptInput): LibraryPrompt {
  const prompt = String(input.prompt ?? "").trim();
  if (!prompt) throw new Error("提示词不能为空");
  const now = new Date().toISOString();
  const promptType = makePromptType(input.promptType);
  const item: LibraryPrompt = {
    id: `user-${crypto.randomUUID()}`,
    title: String(input.title ?? "").trim() || "未命名提示词",
    prompt,
    mediaUrl: "",
    mediaType: promptType,
    promptType,
    origin: "user",
    source: "我的",
    sourceId: "user",
    sourceUrl: "",
    updatedAt: now,
  };
  persist([item, ...load()]);
  return item;
}

export function updateUserPrompt(id: string, patch: Partial<UserPromptInput>): LibraryPrompt[] {
  const next = load().map((item) => {
    if (item.id !== id) return item;
    const prompt = patch.prompt !== undefined ? String(patch.prompt).trim() || item.prompt : item.prompt;
    const promptType = patch.promptType !== undefined ? makePromptType(patch.promptType) : item.promptType;
    const title = patch.title !== undefined ? String(patch.title).trim() || "未命名提示词" : item.title;
    return { ...item, title, prompt, promptType, mediaType: promptType, updatedAt: new Date().toISOString() };
  });
  persist(next);
  return listUserPrompts();
}

export function deleteUserPrompt(id: string): LibraryPrompt[] {
  persist(load().filter((item) => item.id !== id));
  return listUserPrompts();
}

/** 测试用:清内存缓存,下次从盘重读。 */
export function resetUserPromptCache(): void {
  cache = null;
}
