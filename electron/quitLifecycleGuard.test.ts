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

const electronApp = 'import { app } from "electron"; ';

it.each([
  [`${electronApp}app.exit(0);`, 'app.exit'],
  [`${electronApp}app.relaunch();`, 'app.relaunch'],
  ['autoUpdater.quitAndInstall();', 'autoUpdater.quitAndInstall'],
])("ESLint rejects direct %s outside the owner or documented exemption", async (source) => {
  const eslint = new ESLint({ cwd: process.cwd() });
  const [result] = await eslint.lintText(source, { filePath: "electron/ai/quit-lifecycle-counterexample.ts" });
  expect(result?.messages.some((message) => message.ruleId === "no-restricted-syntax")).toBe(true);
});

it("ESLint allows only the two documented exemptions to exit directly", async () => {
  const eslint = new ESLint({ cwd: process.cwd() });
  for (const filePath of ["electron/capabilityCore/host.ts", "electron/update/installGate.ts"]) {
    const [result] = await eslint.lintText(`${electronApp}app.exit(0); autoUpdater.quitAndInstall();`, { filePath });
    expect(result?.messages.some((message) => message.message.includes("quitTeardown"))).toBe(false);
  }
  for (const filePath of ["electron/main.ts", "electron/mainProcessLifecycle.ts", "electron/capabilityCore/mcpStdioServer.ts", "electron/update/autoUpdater.ts"]) {
    const [result] = await eslint.lintText(`${electronApp}app.exit(0);`, { filePath });
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
  for (const filePath of ["electron/ai/quit-lifecycle-counterexample.ts", "electron/update/installGate.ts"]) {
    const [result] = await eslint.lintText(source, { filePath });
    expect(result?.messages.some((message) => message.ruleId === "no-restricted-syntax")).toBe(true);
  }
});

// R-review-1125 #3: every bypass the review found must fail lint outside the owner.
it.each([
  `${electronApp}const exit = app.exit; exit(0);`,
  `${electronApp}const { exit: destructuredExit } = app; destructuredExit(0);`,
  `${electronApp}app["exit"](0);`,
  `${electronApp}app.exit.bind(app)(0);`,
  `${electronApp}app?.exit?.(0);`,
  `${electronApp}const alias = app; alias.exit(0);`,
  'import { app as electronApp } from "electron"; electronApp.exit(0);',
  'const { app } = require("electron"); app.exit(0);',
  'import * as electron from "electron"; electron.app.exit(0);',
  `${electronApp}const on = app.on; on("will-quit", () => undefined);`,
  `${electronApp}app["on"]("will-quit", () => undefined);`,
  `${electronApp}app.on(\`before-quit\`, () => undefined);`,
  'const events = ["session-end"]; for (const name of events) win.on(name, () => undefined);',
  'const subscribe = powerMonitor.on.bind(powerMonitor); subscribe("shutdown", () => undefined);',
])("ESLint rejects the quit-owner bypass %s", async (source) => {
  const eslint = new ESLint({ cwd: process.cwd() });
  const [result] = await eslint.lintText(source, { filePath: "electron/ai/quit-lifecycle-counterexample.ts" });
  expect(result?.messages.some((message) => message.ruleId === "no-restricted-syntax")).toBe(true);
});

it("ESLint leaves a plain Node `app` object and the word shutdown alone", async () => {
  const eslint = new ESLint({ cwd: process.cwd() });
  const [result] = await eslint.lintText(
    'const app = { exit: null as null | number }; app.exit = 1; logInfo("main", "shutdown-requested", { reason: "shutdown" }); declare function logInfo(...args: unknown[]): void;',
    { filePath: "electron/capabilityCore/quit-lifecycle-negative.ts" },
  );
  expect(result?.messages.filter((message) => message.ruleId === "no-restricted-syntax")).toEqual([]);
});
