// 构建产物地址：指向应用包内部（`file://…/app.asar/…`）或开发服务器源码树（`http://127.0.0.1:<port>/src/…`）
// 的 URL。它们是「这一次构建 / 这一台机器」的值——换构建（内容哈希变）、换机器（安装路径变）、从 dev 换到
// 打包版就失效，所以**不许进用户项目数据**（2026-09-25：v0.16.7–v0.18.0 把引导示例图的这类地址写进了
// 「示例：修好一个小机器人」项目，用户 Mac 上 `Not allowed to load local resource: …app.asar/dist/assets/kid-*.jpg`）。
//
// 纯函数，主进程与渲染层都可用。只认两种**无歧义**的形状，刻意不碰：
//   · 普通 localhost 地址（ComfyUI 结果就是 `http://127.0.0.1:8188/view?…`）——只认开发服务器的源码路径前缀；
//   · 普通 file:// 地址（时间轴 clip 允许用户本地文件）——只认 app.asar 包内路径，与 Nomi 自己的构建输出里
//     引导示例图那几个带内容哈希的文件名。
import { DEMO_ASSET_FILE_NAMES } from "./onboardingDemoAssets";

export type BuildArtifactUrl =
  /** 引导示例图：随包原图还在，可以重新落成项目资产。 */
  | { kind: "onboarding-demo"; fileName: string }
  /** 其它构建产物地址：字节找不回来，只能拒绝写入。 */
  | { kind: "bundle" };

const DEV_SERVER_SOURCE = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/(?:src|@fs|node_modules\/\.vite)\//i;
const PACKAGED_BUNDLE = /^file:\/\/.*\/app\.asar(?:\.unpacked)?\//i;
const DEV_DEMO_SOURCE = /\/src\/workbench\/onboarding\/assets\/robot\/([^/?#]+)(?:[?#].*)?$/i;
const BUILT_DEMO_ASSET = /^file:\/\/.*\/dist\/assets\/([^/?#]+?)-[A-Za-z0-9_-]{8}\.(jpe?g)(?:[?#].*)?$/i;
const ASSET_MENTION = /@\[asset:([^\]]+)\]/g;

function demoFileName(url: string): string | null {
  const dev = DEV_SERVER_SOURCE.test(url) ? DEV_DEMO_SOURCE.exec(url) : null;
  if (dev && DEMO_ASSET_FILE_NAMES.has(dev[1])) return dev[1];
  const built = BUILT_DEMO_ASSET.exec(url);
  if (built && DEMO_ASSET_FILE_NAMES.has(`${built[1]}.jpg`)) return `${built[1]}.jpg`;
  return null;
}

export function classifyBuildArtifactUrl(value: string): BuildArtifactUrl | null {
  const url = value.trim();
  if (!/^(?:file|https?):/i.test(url)) return null;
  const fileName = demoFileName(url);
  if (fileName) return { kind: "onboarding-demo", fileName };
  if (DEV_SERVER_SOURCE.test(url) || PACKAGED_BUNDLE.test(url)) return { kind: "bundle" };
  return null;
}

// 预筛只认分类器会命中的那几种形状（含 @[asset:…] 里 encodeURIComponent 过的写法），
// 普通文本里的「/src/」不触发——快照读取是为了不抢锁才存在的，不能被误报拖回慢路径。
const MAY_CONTAIN = /app\.asar|(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+|%3A\d+)?(?:\/|%2F)(?:src|@fs|%40fs|node_modules)(?:\/|%2F)|\/dist\/assets\/(?:kid|robot|shot-\d)-|%2Fdist%2Fassets%2F(?:kid|robot|shot-\d)-/i;

/** 便宜的预筛：一段 JSON 文本里有没有可能出现构建产物地址（快照读取据此决定要不要走加锁迁移）。 */
export function mayContainBuildArtifactUrl(text: string): boolean {
  return MAY_CONTAIN.test(text);
}

function decodeMention(encoded: string): string | null {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

/**
 * 把一个字符串里的构建产物地址换掉：整串就是地址的，以及提示词里 `@[asset:<encodeURIComponent(url)>]` 引用的。
 * `replace` 返回替换后的地址（返回原值 = 不换）。没有命中时原样返回同一个字符串。
 */
export function rewriteBuildArtifactUrls(value: string, replace: (url: string, artifact: BuildArtifactUrl) => string): string {
  const whole = classifyBuildArtifactUrl(value);
  if (whole) return replace(value, whole);
  if (!value.includes("@[asset:")) return value;
  return value.replace(ASSET_MENTION, (token, encoded: string) => {
    const decoded = decodeMention(encoded);
    const artifact = decoded ? classifyBuildArtifactUrl(decoded) : null;
    if (!decoded || !artifact) return token;
    const next = replace(decoded, artifact);
    return next === decoded ? token : `@[asset:${encodeURIComponent(next)}]`;
  });
}
