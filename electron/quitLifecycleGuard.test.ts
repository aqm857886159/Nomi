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
