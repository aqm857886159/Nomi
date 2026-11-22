// 测试世界的三扇合法门（D-test-world-owner-only 批 1）：
//   buildWorld(spec)                        声明「和默认世界哪里不同」，存盘文件由主人函数产出
//   seedOldUserData(id)                     只读 tests/fixtures/old-user-data，旧版真函数生成的数据
//   damageWorldFile(world, file, kind)      只动 buildWorld 已产出的文件，坏法从具名清单挑，不收内容
// 写盘锁（tests/setup/world/fsLock.ts）按调用帧认这个目录：这里的写放行，别处手写主人文件的在写的那一刻报错。
// 走查（plain node）用 tsx 加载本文件，调同一份实现；不存在第二份。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureBuiltinModelSeeds, mutateCatalog, readCatalog } from "../../electron/catalog/catalogStore";
import { createProject } from "../../electron/projects/repository";
import { OWNER_FILE_NAMES } from "./ownerFiles";
// @ts-expect-error 纯 JS 模块（名册、发世界登记），走查启动器也用
import { copyOldUserData, resolveOldUserData } from "./oldUserData.mjs";
// @ts-expect-error 纯 JS 模块
import { isIssuedWorld as isIssued, markWorldIssued } from "./issued.mjs";

type Payload = Record<string, unknown>;

export type WorldSpec = {
  /** 内置种子（默认 true）：false 时目录是空的，由 catalog 自己声明。 */
  builtinSeeds?: boolean;
  /**
   * 在默认世界之上多出来的目录条目，原样交给主人的 upsert。
   * 模型条目可带 `selectable: true`：为它的每个发布方式补一条能执行的映射（#1560 起，模型要有启用的映射才算「已发布」、选得到），
   * 映射是个不会真发请求的占位形状，由主人的 upsertMapping 落盘。
   */
  catalog?: { vendors?: Payload[]; models?: Array<Payload & { selectable?: boolean }>; mappings?: Payload[] };
  /** 项目：原样交给主人的 createProject；不写就是一个空项目。 */
  projects?: Payload[];
  /**
   * 钥匙串里已经加密好的 key 记录（走查在 Electron 外加密，见 tests/ux 的 encryptSyntheticKey）：按厂商放进目录，
   * 由主人的 mutateCatalog 一起落盘；这里不收明文 key，也不碰加密。
   */
  encryptedApiKeys?: Record<string, Record<string, unknown>>;
  /** 世界落在哪个目录下；默认在系统临时目录里新建一个。 */
  rootDir?: string;
  /** 走查已经有自己的临时根时，直接指定设置根 / 项目根（默认 <rootDir>/settings、<rootDir>/projects）。 */
  settingsDir?: string;
  projectsDir?: string;
};

export type World = Readonly<{
  rootDir: string;
  settingsDir: string;
  projectsDir: string;
  userDataDir: string;
  /** buildWorld 产出的项目记录（主人返回的原样）。 */
  projects: ReadonlyArray<unknown>;
  /** 主人在设置根里产出的存盘文件名（damageWorldFile 只收这里面的）。 */
  producedFiles: ReadonlyArray<string>;
  /** 把 NOMI_SETTINGS_DIR / NOMI_PROJECTS_DIR 指向这个世界（同进程里测产品代码用）；返回还原函数。 */
  activate: () => () => void;
  /** 删掉整个世界目录。 */
  cleanup: () => void;
}>;

export function isIssuedWorld(value: unknown): value is World {
  return isIssued(value) as boolean;
}

function activateEnv(settingsDir: string, projectsDir: string): () => void {
  const prev = { s: process.env.NOMI_SETTINGS_DIR, p: process.env.NOMI_PROJECTS_DIR };
  process.env.NOMI_SETTINGS_DIR = settingsDir;
  process.env.NOMI_PROJECTS_DIR = projectsDir;
  return () => {
    if (prev.s === undefined) delete process.env.NOMI_SETTINGS_DIR;
    else process.env.NOMI_SETTINGS_DIR = prev.s;
    if (prev.p === undefined) delete process.env.NOMI_PROJECTS_DIR;
    else process.env.NOMI_PROJECTS_DIR = prev.p;
  };
}

function listOwnerFiles(settingsDir: string): string[] {
  return fs.readdirSync(settingsDir).filter((name) => OWNER_FILE_NAMES.has(name)).sort();
}

function makeWorld(rootDir: string, projects: unknown[], dirs?: { settingsDir: string; projectsDir: string }): World {
  const settingsDir = dirs?.settingsDir ?? path.join(rootDir, "settings");
  const projectsDir = dirs?.projectsDir ?? path.join(rootDir, "projects");
  const world: World = {
    rootDir,
    settingsDir,
    projectsDir,
    userDataDir: path.join(rootDir, "user-data"),
    projects,
    producedFiles: listOwnerFiles(settingsDir),
    activate: () => activateEnv(settingsDir, projectsDir),
    cleanup: () => fs.rmSync(rootDir, { recursive: true, force: true }),
  };
  return markWorldIssued(world) as World;
}

function prepareDirs(rootDir: string, dirs?: { settingsDir?: string; projectsDir?: string }): void {
  for (const dir of [dirs?.settingsDir ?? path.join(rootDir, "settings"), dirs?.projectsDir ?? path.join(rootDir, "projects"), path.join(rootDir, "user-data")]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** 让一个模型「选得到」的占位映射：每个发布方式一条（没写发布方式就按模型类型给一条）。 */
function selectableMappings(model: Payload): Payload[] {
  const meta = (model.meta ?? {}) as { adapter?: { publicationModes?: string[]; modes?: Array<{ taskKind?: string }> } };
  const modeTasks = (meta.adapter?.modes ?? []).map((mode) => String(mode.taskKind)).filter((task) => task !== "undefined");
  const kind = String(model.kind ?? "text");
  const tasks = meta.adapter?.publicationModes?.length
    ? meta.adapter.publicationModes
    : modeTasks.length
      ? modeTasks
      : [kind === "video" ? "text_to_video" : kind === "image" ? "text_to_image" : "chat"];
  return tasks.map((taskKind) => ({
    id: `${String(model.modelKey)}-${taskKind}`,
    vendorKey: model.vendorKey,
    modelKey: model.modelKey,
    taskKind,
    name: `${String(model.modelKey)} ${taskKind}`,
    enabled: true,
    create: {
      method: "POST",
      path: `/fixture/${taskKind}`,
      headers: { "Content-Type": "application/json" },
      body: { model: "{{model.modelKey}}", prompt: "{{request.prompt}}" },
      response_mapping: kind === "video" ? { video_url: "data.0.url" } : { image_url: "data.0.url" },
    },
  }));
}

export function buildWorld(spec: WorldSpec = {}): World {
  const rootDir = spec.rootDir ?? (spec.settingsDir ? path.dirname(spec.settingsDir) : fs.mkdtempSync(path.join(os.tmpdir(), "nomi-world-")));
  const settingsDir = spec.settingsDir ?? path.join(rootDir, "settings");
  const projectsDir = spec.projectsDir ?? path.join(rootDir, "projects");
  prepareDirs(rootDir, { settingsDir, projectsDir });
  const restore = activateEnv(settingsDir, projectsDir);
  const projects: unknown[] = [];
  try {
    if (spec.builtinSeeds !== false) ensureBuiltinModelSeeds();
    const c = spec.catalog;
    const keys = spec.encryptedApiKeys;
    if ((c && (c.vendors?.length || c.models?.length || c.mappings?.length)) || (keys && Object.keys(keys).length)) {
      mutateCatalog((tx, state) => {
        for (const vendor of c?.vendors ?? []) tx.upsertVendor(vendor);
        for (const entry of c?.models ?? []) {
          const { selectable, ...model } = entry;
          tx.upsertModel(model);
          if (selectable) for (const mapping of selectableMappings(model)) tx.upsertMapping(mapping);
        }
        for (const mapping of c?.mappings ?? []) tx.upsertMapping(mapping);
        // 事务里的 state 就是马上由主人落盘的那一份；加密好的记录原样放进去，格式仍由主人的写口产出。
        for (const [vendorKey, record] of Object.entries(keys ?? {})) {
          (state as { apiKeysByVendor: Record<string, unknown> }).apiKeysByVendor[vendorKey] = record;
        }
      });
    }
    for (const input of spec.projects ?? [{ name: "Untitled" }]) projects.push(createProject(input));
  } finally {
    restore();
  }
  return makeWorld(rootDir, projects, { settingsDir, projectsDir });
}

/** 把一份旧版真实数据当成这个世界的底：settings 类拷进设置根，projects 类是整份旧 profile。id / 短名见 listOldUserData。 */
export function seedOldUserData(id: string, options: { rootDir?: string } = {}): World {
  const hit = resolveOldUserData(id) as { kind: "settings" | "projects"; dir: string };
  const rootDir = options.rootDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "nomi-world-old-"));
  prepareDirs(rootDir);
  if (hit.kind === "settings") {
    copyOldUserData(hit.dir, path.join(rootDir, "settings"));
    return makeWorld(rootDir, []);
  }
  // projects 类是一整份旧 profile（userData/ 是设置根，项目库在里面或 home/ 下）：整份拷到 old-user，占位符换成这个位置。
  const profile = path.join(rootDir, "old-user");
  copyOldUserData(hit.dir, profile);
  const settingsDir = path.join(profile, "userData");
  const library = path.join(settingsDir, "Nomi Projects");
  return makeWorld(rootDir, [], { settingsDir, projectsDir: fs.existsSync(library) ? library : path.join(rootDir, "projects") });
}

export const DAMAGE_KINDS = ["truncate", "invalid-json", "drop-field", "wrong-type", "empty", "bom"] as const;
export type DamageKind = (typeof DAMAGE_KINDS)[number];

/** 弄坏世界里主人已产出的一份存盘文件。坏法只能从 DAMAGE_KINDS 里挑，不收内容。 */
export function damageWorldFile(world: World, file: string, kind: DamageKind): string {
  if (!isIssuedWorld(world)) throw new Error("damage_world_not_issued: 世界不是 buildWorld / seedOldUserData 发的。");
  if (!world.producedFiles.includes(file)) {
    throw new Error(`damage_file_not_produced: ${file} 不是这个世界产出的主人文件。可选：${world.producedFiles.join(" / ") || "（无）"}`);
  }
  if (!DAMAGE_KINDS.includes(kind)) throw new Error(`damage_kind_unknown: ${String(kind)}。可选：${DAMAGE_KINDS.join(" / ")}`);
  const target = path.join(world.settingsDir, file);
  const text = fs.readFileSync(target, "utf8");
  let next: string;
  if (kind === "truncate") next = text.slice(0, Math.max(1, Math.floor(text.length / 2)));
  else if (kind === "invalid-json") next = `${text}}{`;
  else if (kind === "empty") next = "";
  else if (kind === "bom") next = String.fromCharCode(0xfeff) + text;
  else {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const first = Object.keys(parsed)[0];
    if (first === undefined) throw new Error(`damage_file_not_object: ${file} 顶层不是带字段的对象，${kind} 无从下手。`);
    if (kind === "drop-field") delete parsed[first];
    else parsed[first] = typeof parsed[first] === "string" ? 0 : "damaged";
    next = JSON.stringify(parsed);
  }
  fs.writeFileSync(target, next);
  return target;
}

/** 纯函数测试要「一张模型表」时：先 buildWorld，再经主人读口取行，不手写行。 */
export function worldRows(spec: WorldSpec = {}): { vendors: unknown[]; models: unknown[]; mappings: unknown[] } {
  const world = buildWorld({ ...spec, projects: spec.projects ?? [] });
  const restore = world.activate();
  try {
    const state = readCatalog();
    return { vendors: state.vendors, models: state.models, mappings: state.mappings };
  } finally {
    restore();
    world.cleanup();
  }
}
