// Coding 工具的**权限策略**（不是「每次确认」）。
//
// 用户 2026-09-07 原话纠正：「不是每次问，而是设计权限」。所以这份文件回答的不是
// 「要不要弹卡」，而是**一条命令落在哪一档**——三档，各有各的用户体感：
//
//   ① 沙箱内 = 自动放行     命令跑在 @anthropic-ai/sandbox-runtime 里、只碰项目目录、
//                          不联网 → 一张卡都不弹。（Codex `workspace-write` + `on-request`
//                          的形状：沙箱里的事不问，越出沙箱才问。）
//   ② 越界 = 问一次、可记住  要联网 / 要碰项目外路径 / 要更高权限 → 弹卡，卡上三选一：
//                          只这次 / 本项目允许这个命令模式 / 本会话允许。模式按
//                          Claude Code 的 `Bash(npm run *)` 前缀通配记进项目级设置。
//   ③ 硬清单 = 永远问或永远拒 不可逆、对外发布、密钥/SSH/设置目录、往外发数据 →
//                          **与档位无关**。`deny` 直接拒并告诉模型原因；`ask` 每次问
//                          且**不提供「记住」**。
//
// ── 为什么判定顺序是 ③ → ② → ①，不能反过来 ──
//
// 沙箱能挡住「写坏了别人的文件」，挡不住「在沙箱里把项目 push 上去」「在沙箱里
// 把密钥 curl 出去」——那两件事沙箱**批准**它们跑，因为它们没越过文件系统边界。
// 所以硬清单必须**先**判：它是与沙箱正交的一层，不是沙箱的补充。反过来写的后果不是
// 报错，是一条 `git push` 在沙箱里安静地成功了。这正是 Claude Code 那六条
// 「任何模式都不自动批」和 Codex「工具声明 destructiveHint 时**总是**要审批」
// 各自解决的同一个问题（`https://code.claude.com/docs/en/permission-modes`
// §"Actions no mode auto-approves"；`https://learn.chatgpt.com/docs/agent-approvals-security`）。
//
// ── 沙箱不可用时会发生什么（这条是 fail-closed 的落点）──
//
// `sandboxActive: false`（平台不支持 / 初始化失败）时，第 ① 档**整档消失**：本来自动放行的
// 命令全部落回 ② 档要人点头。这不是保守，是这一档的**定义**——「沙箱内」这三个字是
// 自动放行的全部理由，理由没了，结论也就没了。单测里的阳性对照量的就是这条：
// 把 `sandboxActive` 摘掉，`auto-allow` 那一组必须整组翻成 `ask`。
//
// ── 这份文件为什么是纯函数、不碰任何 I/O ──
//
// 它要被三个人用：`before_tool` 闸（3a）、单测（20 条命令样本）、以及以后的走查取证。
// 碰了 fs/electron 就只有第一个用得上，于是没人测，于是一条 `sudo` 的漏网要等真机才发现。
import path from "node:path";

/** 三档。用户面只有两句话（可撤销的「本会话允许这类」/ 花钱不可逆的「每次确认」），这是它们的机器侧分档。 */
export type CommandTier = "sandboxed" | "escape" | "hard-list";

/** 硬清单的规则身份。闭合词表——UI 分档、日志归因、单测断言都认它，不认自由文本。 */
export type HardRuleId =
  /** 不可逆删除：递归强删。 */
  | "irreversible-delete"
  /** 对外发布：push / publish / release / pr merge。做出去就收不回来了。 */
  | "outbound-publish"
  /** 读写密钥、SSH、云凭据、Nomi 设置与密钥存储。 */
  | "secret-store"
  /** 往外发数据：curl/wget/nc 带上行载荷。沙箱开了网也不许走这条。 */
  | "data-exfiltration"
  /** 提权与权限放宽：sudo / chmod 777 / chown。 */
  | "privilege-escalation"
  /** 拿整台机器开玩笑：fork bomb、写块设备、关机。 */
  | "host-destructive";

/** 越界的种类。决定卡上那句话怎么写——「它要联网」和「它要动项目外的文件」是两句话。 */
export type EscapeReasonId =
  | "network-access"
  | "outside-project-path"
  | "sandbox-unavailable"
  | "unparseable-command";

export interface CommandPolicyInput {
  /** 模型要跑的那条命令，原样。 */
  readonly command: string;
  /** 当前项目根（绝对路径）。命令的 cwd 就是它。 */
  readonly projectDir: string;
  /**
   * 沙箱这一刻是不是真的在生效。
   *
   * **它必须来自 `SandboxManager` 的真实状态，不能是一个配置意图。** 「我们配了沙箱」
   * 和「这条命令真的跑在沙箱里」之间隔着平台支持、初始化成功、依赖齐备三件事，
   * 而它们全都会在真机上失败（Linux 缺 bubblewrap、Windows 没跑 windows-install）。
   */
  readonly sandboxActive: boolean;
  /** 本项目落盘的命令模式白名单（`npm run *` 这种）。用户点过「本项目允许这个模式」才会进来。 */
  readonly projectAllowedPatterns?: readonly string[];
  /** 本会话内存里的模式白名单。关 app 即忘——「本会话」是字面意思。 */
  readonly sessionAllowedPatterns?: readonly string[];
}

export type CommandVerdict =
  | {
      readonly tier: "sandboxed";
      readonly decision: "auto-allow";
      /** 为什么放行。进日志与走查取证，不进模型上下文（放行不需要解释）。 */
      readonly because: "sandbox-confined" | "pattern-allowed-project" | "pattern-allowed-session";
      /** 命中的是哪条模式（走 pattern 分支时）。 */
      readonly matchedPattern?: string;
    }
  | {
      readonly tier: "escape";
      readonly decision: "ask";
      readonly reason: EscapeReasonId;
      /** 卡上「本项目允许这个命令模式」那一项要记的模式。`null` = 这条命令推不出稳定模式，只给「只这次」。 */
      readonly rememberablePattern: string | null;
      /** 拒收时一字不改交给模型的那句话（英文：它进模型上下文，和 lane 其余失败正文同语域）。 */
      readonly modelReason: string;
    }
  | {
      readonly tier: "hard-list";
      readonly decision: "ask" | "deny";
      readonly rule: HardRuleId;
      /** 硬清单**永不可记住**——这是它和 ② 档唯一的机器差别。 */
      readonly rememberablePattern: null;
      readonly modelReason: string;
    };

// ── 硬清单 ────────────────────────────────────────────────────────────────
//
// 每条都写清「为什么它连沙箱内也不许自动过」。没有这句话的规则会在下一次有人嫌它烦时被删掉。

interface HardRule {
  readonly id: HardRuleId;
  readonly decision: "ask" | "deny";
  readonly pattern: RegExp;
  readonly modelReason: string;
}

/**
 * 密钥与凭据的路径族。**读也拒、写也拒**：一条 `cat ~/.ssh/id_rsa` 的输出会原样进模型上下文，
 * 而模型上下文会被送到供应商那里——沙箱的 `denyRead` 已经在 OS 层挡了一道，这里是第二道，
 * 挡住「沙箱没起来」和「路径写法绕过了 denyRead 的 glob」两种情况（R28：两层不是冗余，
 * 是因为它们失效的原因不一样）。
 */
const SECRET_PATH_FRAGMENTS: readonly string[] = [
  "/.ssh", "/.aws", "/.gnupg", "/.docker/config.json", "/.netrc", "/.npmrc", "/.pypirc",
  "/.config/gcloud", "/.kube/config",
  // Nomi 自己的设置与密钥存储（model-catalog.json 里是 safeStorage 密文，但密文也不该出门）。
  // 设置目录三个平台各一种：macOS `Application Support/Nomi`、Windows `%APPDATA%\nomi`（Preview 为
  // `Nomi Preview`；在比对视图里是 `AppData/Roaming/nomi`、`$APPDATA/nomi`、`%APPDATA%/nomi`）、Linux `~/.config/nomi`。
  "application support/nomi", "appdata/roaming/nomi", "appdata/nomi", "appdata%/nomi", "/.config/nomi",
  "/.nomi/", "model-catalog.json",
];

const HARD_RULES: readonly HardRule[] = [
  {
    id: "host-destructive",
    decision: "deny",
    // fork bomb / 写块设备 / 关机重启 / 抹盘
    pattern: /(:\s*\(\s*\)\s*\{[^}]*\|[^}]*&[^}]*\}\s*;\s*:)|(\bdd\b[^\n]*\bof=\/dev\/)|(\b(shutdown|reboot|halt)\b)|(\bmkfs(\.\w+)?\b)|(\bdiskutil\s+(erase|reformat))/i,
    modelReason:
      "This command can destroy the host machine, not just this project. Nomi never runs it, in any permission mode. "
      + "There is no user setting that enables it.",
  },
  {
    id: "privilege-escalation",
    decision: "deny",
    pattern: /(^|[;&|]\s*)(sudo|doas|su)\s|(\b(chmod|chown)\b[^\n]*\b(777|a\+rwx|-R\s+\S+:\S+\s+\/)\b)/i,
    modelReason:
      "This command asks for privileges above the sandbox. Nomi never grants them. "
      + "Do the same work inside the project directory with the permissions you already have.",
  },
  {
    id: "secret-store",
    decision: "deny",
    pattern: buildSecretPattern(),
    modelReason:
      "This path holds credentials (SSH keys, cloud credentials, or Nomi's own key store). "
      + "Reading it would put the secret into this conversation, which is sent to the model provider. "
      + "Nomi blocks it in every permission mode. If you need a credential, ask the user to add it in Settings instead.",
  },
  {
    id: "data-exfiltration",
    decision: "deny",
    // curl/wget/nc/scp/rsync 带上行载荷。**只认上行**：`curl -O url` 是下载，走 ② 档联网；
    // `curl -d @file url` 是把本地内容发出去，那是另一件事。
    pattern:
      /\b(curl|http|https|wget)\b[^\n]*(\s(-d|--data(-binary|-raw|-urlencode)?|-F|--form|-T|--upload-file)\b|\s--data\b)|(\bnc\b[^\n]*<\s*\S)|(\b(scp|rsync)\b[^\n]*\s\S+@\S+:)/i,
    modelReason:
      "This command uploads local file content to a remote host. Nomi never runs commands that send project or "
      + "machine data outbound, in any permission mode. Read the file with the read tool and put what you need in "
      + "your reply instead.",
  },
  {
    id: "outbound-publish",
    decision: "ask",
    // 做出去就收不回来：推分支、发包、开 release、合 PR、打强制 tag。
    pattern:
      /\bgit\s+push\b|\bgit\s+tag\s+(-f|--force)\b|\b(npm|pnpm|yarn)\s+publish\b|\bgh\s+(release\s+create|pr\s+merge)\b|\btwine\s+upload\b|\bcargo\s+publish\b/i,
    modelReason:
      "Publishing is not reversible, so it always needs the user to confirm this exact command — there is no "
      + "\"allow this pattern\" for it. Wait for the decision instead of trying a different spelling of the same push.",
  },
  {
    id: "irreversible-delete",
    decision: "ask",
    // 递归强删。**不区分目标在不在项目里**：项目里的递归删除同样不可逆（撤销栈管不到 fs）。
    pattern: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive[^\n]*--force|--force[^\n]*--recursive)\b|\bgit\s+clean\s+-[a-z]*[fx]/i,
    modelReason:
      "Recursive force delete cannot be undone, so it always needs the user to confirm this exact command — there is "
      + "no \"allow this pattern\" for it. Prefer deleting the specific files you named, one at a time.",
  },
];

function buildSecretPattern(): RegExp {
  const alternatives = SECRET_PATH_FRAGMENTS.map((fragment) =>
    fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // `security find-generic-password` 是 macOS 钥匙串的读取命令——它不是路径，但它是同一件事。
  return new RegExp(`(${alternatives.join("|")})|\\bsecurity\\s+find-(generic|internet)-password\\b`, "i");
}

/**
 * 硬清单比对用的那份写法。**只用来比对，不改写要执行的命令。**
 *
 * 清单按 POSIX 的一种拼法写（`/.ssh`）。同一个文件在 shell 里还有别的拼法：Windows 的反斜杠与盘符
 * （`C:\Users\<名>\.ssh\id_ed25519`、`%USERPROFILE%\.ssh`），被引号拆开的片段（`~/.s'sh'/id_rsa`，
 * bash 会把它拼回 `.ssh`）。2026-09-24 Windows 实测：反斜杠写法落到一张普通确认卡上，而同一个文件
 * 用 `/` 写会被直接拒。Windows 没有 OS 沙箱的 denyRead，这一层是那里唯一直接拒密钥读取的；
 * 归一只会让它多拦，不会少拦（原串照旧也比一遍）。
 */
function hardListView(command: string): string {
  return command.replace(/["']/g, "").replace(/\\+/g, "/");
}

// ── 越界检测 ──────────────────────────────────────────────────────────────

/**
 * 要联网的命令族。
 *
 * **它不是安全边界，沙箱才是**——沙箱默认全拒网络，这里认出来只是为了让卡片上那句话
 * 说得准（「它要联网装包」比「命令被沙箱拒了」有用得多）。漏掉一个只会让用户看到
 * 一次沙箱层的失败，不会漏出去。
 */
const NETWORK_COMMANDS =
  /\b(curl|wget|http|https|nc|telnet|ssh|scp|rsync|ping|dig|nslookup)\b|\bgit\s+(clone|fetch|pull|remote\s+add|ls-remote)\b|\b(npm|pnpm|yarn|npx|pnpx|bunx)\s+(i|install|add|create|dlx|exec)\b|\bpip3?\s+install\b|\b(brew|apt-get|apt|dnf|pacman)\s+(install|update|upgrade)\b|\bcargo\s+(add|install|fetch)\b|\bgo\s+(get|install)\b/i;

/**
 * 命令里出现的绝对路径与 `~` 路径。用来判断它有没有伸到项目外面去。
 *
 * **先把项目根的字面量抠掉再扫**，这一步不是优化，是正确性：Nomi 的项目根真身长这样——
 * `~/Documents/Nomi Projects/<名字>`，**里面有空格**。不抠掉，`cat "…/Nomi Projects/demo/src/x.ts"`
 * 会被空格切成 `/Users/…/Documents/Nomi`，而那一段确实在项目外——于是每一条读自家文件的命令
 * 都弹一次「它要碰项目外的路径」。带空格的路径在这里是常态不是边界情况，所以判定必须
 * 先认识项目根本身，再去看剩下的部分。
 */
function extractAbsolutePaths(command: string, projectDir: string): string[] {
  // 项目根出现过的地方换成一个不含斜杠的占位符——「它在项目里」这件事按定义成立，不必再扫。
  // 占位符**不带前后空格**：`<root>/src/x.ts` 要变成 `PROJECTROOT/src/x.ts`，后半段才不再
  // 是一个「以 / 开头」的绝对路径。带空格会把它切成 `/src/x.ts`——那看起来像根目录下的文件，
  // 于是自家文件被判成越界。
  //
  // 抠的时候**必须看路径边界**：裸的字符串替换会把 `<project>-evil/secret.txt` 也一起抠掉，
  // 因为项目根是它的字符串前缀——那正是本文件另一处（`isInsideProject`）特意不用 `startsWith`
  // 的那个洞，换了个入口又长了一遍。所以只在项目根后面跟着 `/`、引号、空白、管道或行尾时才抠。
  const roots = [path.resolve(projectDir), projectDir].filter(
    (root, index, all) => Boolean(root) && all.indexOf(root) === index,
  );
  const masked = roots.reduce((text, root) => {
    const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return text.replace(new RegExp(`${escaped}(?=[/\\s"';|&)]|$)`, "g"), "PROJECTROOT");
  }, command);
  const found: string[] = [];
  // `~/x`、`/x`。前面必须是行首、空白、引号或 `=`，避免把 `a/b` 里的斜杠误当路径。
  for (const match of masked.matchAll(/(^|[\s"'=(:])(~\/[^\s"';|&)]*|\/[^\s"';|&)]*)/g)) {
    const candidate = match[2];
    if (candidate) found.push(candidate);
  }
  return found;
}

function expandHome(candidate: string): string {
  if (!candidate.startsWith("~/")) return candidate;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return home ? path.join(home, candidate.slice(2)) : candidate;
}

/**
 * 这条路径在项目里吗。
 *
 * 用 `path.relative` 而不是 `startsWith`：`/proj-evil` 以 `/proj` 开头，但它不在 `/proj` 里。
 * 这是路径包容判定里最经典的那个洞（G-07 同一族）。
 */
function isInsideProject(candidate: string, projectDir: string): boolean {
  const relative = path.relative(path.resolve(projectDir), path.resolve(expandHome(candidate)));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * 沙箱允许的项目外读路径（系统只读区）。命中它们**不算越界**——否则 `ls /usr/bin`、
 * `#!/bin/bash` 这种每条命令都要弹一次卡，而弹到第三次用户就开始无脑点「允许」，
 * 那时这套闸的价值就是负的（D1：让用户多读多点的东西默认砍）。
 */
const SYSTEM_READ_ONLY_PREFIXES: readonly string[] = [
  "/usr", "/bin", "/sbin", "/opt/homebrew", "/System", "/Library/Developer",
  "/etc/ssl", "/private/etc/ssl", "/dev/null", "/dev/stdout", "/dev/stderr", "/dev/urandom",
  "/tmp", "/private/tmp", "/var/folders", "/private/var/folders", "/proc", "/nix/store",
];

function isSystemReadOnly(candidate: string): boolean {
  // 这张表是 POSIX 路径，按 POSIX 解析。宿主 `path.resolve` 在 Windows 上会补盘符（`/usr` → `C:\usr`），
  // 一条都对不上——和 `laneSessionCwd` 被补盘符是同一类错（2026-09-24）。
  const resolved = path.posix.resolve(expandHome(candidate));
  return SYSTEM_READ_ONLY_PREFIXES.some(
    (prefix) => resolved === prefix || resolved.startsWith(`${prefix}/`));
}

// ── 命令模式（Claude Code 的 `Bash(npm run *)` 那种）───────────────────────

/**
 * 从一条命令推出一个**可记住的前缀模式**。
 *
 * 形状照 Claude Code 的 `Bash(<prefix> *)`（`https://code.claude.com/docs/en/permission-modes`
 * §`/permissions`）。为什么不自己发明一种：用户已经在 Claude Code / Codex 里见过这一种，
 * 而「这个 App 的通配符和别处不一样」是纯认知负荷，换不来任何东西（R31）。
 *
 * 推不出模式的返回 `null`——卡上就只剩「只这次」。**推不出来时绝不退回一个更宽的模式**：
 * 一个记错的 `*` 会把后面所有命令都放行，而用户以为他只批了刚才那一条。
 */
export function suggestCommandPattern(command: string): string | null {
  const trimmed = command.trim();
  // 复合命令（`a && b`、管道、重定向、子 shell）不出模式：模式只描述得了第一段，
  // 记住它等于把后面几段一起免检了。
  if (/[;&|><`$(){}]/.test(trimmed)) return null;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const [head, second] = tokens;
  if (!head || !/^[\w.\-/]+$/.test(head)) return null;
  // 二级子命令值得进模式的那几个包管理器/VCS：`npm run *` 比 `npm *` 精确得多，
  // 而 `npm *` 会把 `npm publish` 也盖进去（那条在硬清单里，但模式不该比硬清单还宽）。
  const TWO_TOKEN_HEADS = new Set(["npm", "pnpm", "yarn", "git", "cargo", "go", "docker", "gh", "uv", "poetry"]);
  if (second && TWO_TOKEN_HEADS.has(head) && /^[\w.-]+$/.test(second)) {
    return `${head} ${second} *`;
  }
  return `${head} *`;
}

/**
 * 一条命令命中某个已记住的模式了吗。
 *
 * `*` 只在**末尾**有意义，且只匹配「后面还有别的东西」——`npm run *` 匹配 `npm run build`，
 * 不匹配 `npm run`（那是另一条命令）也不匹配 `npm runx build`（前缀必须落在词边界上）。
 * 中间的 `*` 不支持：一个 `git * --force` 这样的模式看起来精确，实际上把所有子命令都开了。
 */
export function commandMatchesPattern(command: string, pattern: string): boolean {
  const trimmed = command.trim();
  if (!pattern.endsWith("*")) return trimmed === pattern.trim();
  const prefix = pattern.slice(0, -1).trimEnd();
  if (!prefix) return false;
  if (!trimmed.startsWith(prefix)) return false;
  const rest = trimmed.slice(prefix.length);
  return rest.length > 0 && /^\s/.test(rest);
}

// ── 判定 ──────────────────────────────────────────────────────────────────

/**
 * 一条命令落在哪一档。**唯一的判定点**——闸、单测、走查取证读的是同一个函数。
 *
 * 顺序（文件头部说明了为什么不能反）：硬清单 → 已记住的模式 → 越界 → 沙箱内。
 */
export function classifyCommand(input: CommandPolicyInput): CommandVerdict {
  const command = input.command ?? "";

  // ① 硬清单先判。它与沙箱、与档位、与任何「记住」全部正交。原串与归一后的拼法各比一次（`hardListView`）。
  const view = hardListView(command);
  for (const rule of HARD_RULES) {
    if (rule.pattern.test(command) || rule.pattern.test(view)) {
      return { tier: "hard-list", decision: rule.decision, rule: rule.id, rememberablePattern: null, modelReason: rule.modelReason };
    }
  }

  // 空命令 / 只有空白：不是「安全」，是「说不清」。fail-closed 到 ask。
  if (!command.trim()) {
    return {
      tier: "escape", decision: "ask", reason: "unparseable-command", rememberablePattern: null,
      modelReason: "The command was empty. Send the exact shell command you want to run.",
    };
  }

  // ② 用户记住过的模式。**放在越界之前**：用户点「本项目允许 `npm install *`」的全部意思
  //    就是「这条以后别再问我了」，而它之所以弹卡正是因为它要联网。记住之后还问，等于没记。
  //    硬清单在它之前，所以记住一个模式**不可能**顺带把 `git push` 放进来。
  const projectHit = (input.projectAllowedPatterns ?? []).find((pattern) => commandMatchesPattern(command, pattern));
  if (projectHit) {
    return { tier: "sandboxed", decision: "auto-allow", because: "pattern-allowed-project", matchedPattern: projectHit };
  }
  const sessionHit = (input.sessionAllowedPatterns ?? []).find((pattern) => commandMatchesPattern(command, pattern));
  if (sessionHit) {
    return { tier: "sandboxed", decision: "auto-allow", because: "pattern-allowed-session", matchedPattern: sessionHit };
  }

  // ③ 沙箱没在生效 → 第 ① 档整档消失（文件头部：这一档的全部理由就是「在沙箱里」）。
  if (!input.sandboxActive) {
    return {
      tier: "escape", decision: "ask", reason: "sandbox-unavailable",
      rememberablePattern: suggestCommandPattern(command),
      modelReason:
        "This platform has no OS-level sandbox available, so every command needs the user to approve it. "
        + "Keep commands short and say what each one is for — the user is reading them one by one.",
    };
  }

  // ④ 越界：联网。
  if (NETWORK_COMMANDS.test(command)) {
    return {
      tier: "escape", decision: "ask", reason: "network-access",
      rememberablePattern: suggestCommandPattern(command),
      modelReason:
        "The sandbox denies network access by default, so this command needs the user to allow it. "
        + "If you only need files that are already in the project, do that instead — it runs without asking.",
    };
  }

  // ⑤ 越界：碰项目外的路径。
  for (const candidate of extractAbsolutePaths(command, input.projectDir)) {
    if (isSystemReadOnly(candidate)) continue;
    if (isInsideProject(candidate, input.projectDir)) continue;
    return {
      tier: "escape", decision: "ask", reason: "outside-project-path",
      rememberablePattern: suggestCommandPattern(command),
      modelReason:
        `The command touches ${candidate}, which is outside this project. The sandbox only allows writes inside the `
        + "project directory, so this needs the user to allow it. Use a project-relative path if that is what you meant.",
    };
  }

  // ⑥ 剩下的就是「沙箱内、只碰项目、不联网」——自动放行，一张卡都不弹。
  return { tier: "sandboxed", decision: "auto-allow", because: "sandbox-confined" };
}

/** 三档 → 用户面那两句话。UI 拿它挑文案（i18n key 在渲染层，这里只给稳定的语义档）。 */
export function approvalPromptKindOf(verdict: CommandVerdict): "none" | "session-scoped" | "every-time" {
  if (verdict.decision === "auto-allow") return "none";
  if (verdict.tier === "hard-list") return "every-time";
  return "session-scoped";
}
