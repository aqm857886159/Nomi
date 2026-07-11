import type { Session } from "electron";

const BROWSER_ACCEPT_LANGUAGE = "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7";
const BROWSER_CHROME_MAJOR_VERSION = Math.max(120, Number.parseInt(process.versions.chrome?.split(".")[0] || "", 10) || 124);
const BROWSER_CHROME_VERSION = `${BROWSER_CHROME_MAJOR_VERSION}.0.0.0`;
const BROWSER_SEC_CH_UA = `"Google Chrome";v="${BROWSER_CHROME_MAJOR_VERSION}", "Chromium";v="${BROWSER_CHROME_MAJOR_VERSION}", "Not.A/Brand";v="99"`;
const BROWSER_SEC_CH_UA_PLATFORM =
  process.platform === "darwin" ? "macOS" : process.platform === "linux" ? "Linux" : "Windows";
const BROWSER_UA_PLATFORM =
  process.platform === "darwin"
    ? "Macintosh; Intel Mac OS X 10_15_7"
    : process.platform === "linux"
      ? "X11; Linux x86_64"
      : "Windows NT 10.0; Win64; x64";

export const STANDARD_CHROME_UA =
  `Mozilla/5.0 (${BROWSER_UA_PLATFORM}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${BROWSER_CHROME_VERSION} Safari/537.36`;
export const BROWSER_PROFILE_PARTITION = "persist:nomi-browser-profile";

const configuredBrowserSessions = new WeakSet<Session>();
const browserSessionProxyPromises = new WeakMap<Session, Promise<void>>();

function setRequestHeader(headers: Record<string, string | string[]>, name: string, value: string): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) delete headers[key];
  }
  headers[name] = value;
}

function configureBrowserSessionProxy(viewSession: Session): Promise<void> {
  const existing = browserSessionProxyPromises.get(viewSession);
  if (existing) return existing;
  const next = import("../../systemProxy")
    .then(({ applySystemProxy }) => applySystemProxy(viewSession))
    .then(() => undefined)
    .catch((error) => {
      console.error("[nomi:browser] applySystemProxy for browser session failed:", error);
    });
  browserSessionProxyPromises.set(viewSession, next);
  return next;
}

export async function configureBrowserSession(viewSession: Session): Promise<void> {
  viewSession.setUserAgent(STANDARD_CHROME_UA, BROWSER_ACCEPT_LANGUAGE);
  if (!configuredBrowserSessions.has(viewSession)) {
    configuredBrowserSessions.add(viewSession);
    viewSession.webRequest.onBeforeSendHeaders((details, callback) => {
      if (!/^https?:\/\//i.test(details.url)) {
        callback({});
        return;
      }
      const requestHeaders = { ...details.requestHeaders };
      setRequestHeader(requestHeaders, "User-Agent", STANDARD_CHROME_UA);
      setRequestHeader(requestHeaders, "Accept-Language", BROWSER_ACCEPT_LANGUAGE);
      setRequestHeader(requestHeaders, "Sec-CH-UA", BROWSER_SEC_CH_UA);
      setRequestHeader(requestHeaders, "Sec-CH-UA-Mobile", "?0");
      setRequestHeader(requestHeaders, "Sec-CH-UA-Platform", `"${BROWSER_SEC_CH_UA_PLATFORM}"`);
      callback({ requestHeaders });
    });
  }
  await configureBrowserSessionProxy(viewSession);
}
