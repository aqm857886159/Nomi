import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tailwindPackagePath = require.resolve("tailwindcss/package.json");
const tailwindPackage = require(tailwindPackagePath);
const tailwindPackageDir = path.dirname(tailwindPackagePath);
const tailwindBin = path.join(
  tailwindPackageDir,
  tailwindPackage.bin?.tailwindcss || "lib/cli.js",
);

const argv = new Set(process.argv.slice(2));
const input = path.join(repoRoot, "src", "styles", "index.css");
const output = path.join(repoRoot, "public", "tailwind.generated.css");
const tailwindTempOutput = path.join(repoRoot, ".tmp", "tailwind.generated.css");
const mantineInput = path.join(repoRoot, "node_modules", "@mantine", "core", "styles.css");
const config = path.join(repoRoot, "tailwind.config.ts");

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.mkdirSync(path.dirname(tailwindTempOutput), { recursive: true });

const tailwindArgs = [
  tailwindBin,
  "-i",
  input,
  "-o",
  tailwindTempOutput,
  "--config",
  config,
];

if (argv.has("--minify")) tailwindArgs.push("--minify");
if (argv.has("--watch")) tailwindArgs.push("--watch");
if (argv.has("--poll")) tailwindArgs.push("--poll");

function writeCombinedCss() {
  const mantineCss = fs.existsSync(mantineInput) ? fs.readFileSync(mantineInput, "utf8") : "";
  const tailwindCss = fs.existsSync(tailwindTempOutput) ? fs.readFileSync(tailwindTempOutput, "utf8") : "";
  fs.writeFileSync(
    output,
    [
      mantineCss ? "/* @mantine/core/styles.css */\n" + mantineCss.trim() : "",
      tailwindCss ? "/* tailwind.generated.css */\n" + tailwindCss.trim() : "",
      "",
    ].filter(Boolean).join("\n\n"),
  );
}

console.log(`▶  Tailwind CSS ${argv.has("--watch") ? "watching" : "building"}: ${path.relative(repoRoot, output)}`);

if (argv.has("--watch")) {
  const child = spawn(process.execPath, tailwindArgs, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  let combineTimer = null;
  const scheduleCombine = () => {
    if (combineTimer) clearTimeout(combineTimer);
    combineTimer = setTimeout(() => {
      try {
        writeCombinedCss();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`⚠  Failed to combine generated CSS: ${message}`);
      }
    }, 150);
  };
  scheduleCombine();
  fs.watchFile(tailwindTempOutput, { interval: 250 }, scheduleCombine);
  child.on("exit", (code, signal) => {
    fs.unwatchFile(tailwindTempOutput, scheduleCombine);
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
} else {
  const result = spawnSync(process.execPath, tailwindArgs, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.signal) process.kill(process.pid, result.signal);
  if (typeof result.status === "number" && result.status !== 0) process.exit(result.status);
  writeCombinedCss();
  if (typeof result.status === "number") process.exit(result.status);
}
