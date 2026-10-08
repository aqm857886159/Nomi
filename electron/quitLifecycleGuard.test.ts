import { ESLint } from "eslint";
import { expect, it } from "vitest";

it("ESLint rejects quit lifecycle subscriptions outside the owner", async () => {
  const eslint = new ESLint({ cwd: process.cwd() });
  const [result] = await eslint.lintText('app.on("will-quit", () => undefined);', {
    filePath: "electron/ai/quit-lifecycle-counterexample.ts",
  });
  expect(result?.messages.map((message) => message.message)).toContain(
    "Subscribe to will-quit only in electron/quitTeardown.ts; register a drain with quitTeardown instead.",
  );
});

it("ESLint exempts the single owner file", async () => {
  const eslint = new ESLint({ cwd: process.cwd() });
  const [result] = await eslint.lintText('app.on("will-quit", () => undefined);', {
    filePath: "electron/quitTeardown.ts",
  });
  expect(result?.messages.some((message) => message.ruleId === "no-restricted-syntax")).toBe(false);
});

it.each([
  ['app.exit(0);', 'app.exit'],
  ['app.relaunch();', 'app.relaunch'],
  ['autoUpdater.quitAndInstall();', 'autoUpdater.quitAndInstall'],
])("ESLint rejects direct %s outside the owner or documented exemption", async (source) => {
  const eslint = new ESLint({ cwd: process.cwd() });
  const [result] = await eslint.lintText(source, { filePath: "electron/ai/quit-lifecycle-counterexample.ts" });
  expect(result?.messages.some((message) => message.ruleId === "no-restricted-syntax")).toBe(true);
});

it("ESLint allows only the two documented exemptions to exit directly", async () => {
  const eslint = new ESLint({ cwd: process.cwd() });
  for (const filePath of ["electron/capabilityCore/host.ts", "electron/update/autoUpdater.ts"]) {
    const [result] = await eslint.lintText("app.exit(0); autoUpdater.quitAndInstall();", { filePath });
    expect(result?.messages.some((message) => message.message.includes("quitTeardown"))).toBe(false);
  }
  for (const filePath of ["electron/main.ts", "electron/mainProcessLifecycle.ts", "electron/capabilityCore/mcpStdioServer.ts"]) {
    const [result] = await eslint.lintText("app.exit(0);", { filePath });
    expect(result?.messages.some((message) => message.ruleId === "no-restricted-syntax")).toBe(true);
  }
});

it.each([
  'win.on("query-session-end", () => undefined);',
  'win.once("session-end", () => undefined);',
  'powerMonitor.on("shutdown", () => undefined);',
  'app.addListener("will-quit", () => undefined);',
  'app.prependOnceListener("before-quit", () => undefined);',
  'autoUpdaterExemptFile.on("session-end", () => undefined);',
])("ESLint rejects quit or session-end subscription %s outside the owner, exemptions included", async (source) => {
  const eslint = new ESLint({ cwd: process.cwd() });
  for (const filePath of ["electron/ai/quit-lifecycle-counterexample.ts", "electron/update/autoUpdater.ts"]) {
    const [result] = await eslint.lintText(source, { filePath });
    expect(result?.messages.some((message) => message.ruleId === "no-restricted-syntax")).toBe(true);
  }
});
