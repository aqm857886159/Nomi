const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { prunePlatformBinaries } = require("./packaging/platform-binaries.cjs");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- electron-builder 以 CommonJS 加载本钩子，取同目录的 CommonJS 模块只有 require（上面三行的存量冻结在 eslint-suppressions.json）
const { writeInstallerManifest } = require("./packaging/installer-manifest.cjs");

exports.default = async function afterPack(context) {
  const resourcesPath = context.electronPlatformName === "darwin"
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
    : path.join(context.appOutDir, "resources");
  const unpackedNodeModulesPath = path.join(resourcesPath, "app.asar.unpacked", "node_modules");
  const pruned = prunePlatformBinaries(unpackedNodeModulesPath, context.electronPlatformName, context.arch);
  console.log(`[afterPack] target ${pruned.target}; removed ${pruned.removed.length} foreign-platform packages/binaries${pruned.removed.length ? `: ${pruned.removed.join(", ")}` : ""}`);

  if (context.electronPlatformName === "win32") {
    // 安装器清单必须在剪完平台二进制之后算：build/installer.nsh 卸载时只删清单里的条目（见 installer-manifest.cjs 头注释）。
    const written = writeInstallerManifest({
      appOutDir: context.appOutDir,
      projectDir: context.packager.projectDir,
      productFilename: context.packager.appInfo.productFilename,
      version: context.packager.appInfo.version,
      arch: context.arch,
      nsisOptions: context.packager.config.nsis || {},
      fileAssociations: context.packager.fileAssociations,
    });
    console.log(`[afterPack] installer manifest: ${written.manifest.files.length} files, ${written.manifest.dirs.length} dirs -> ${path.relative(context.packager.projectDir, written.nsh)}`);
    return;
  }

  if (context.electronPlatformName !== "darwin") return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("/usr/bin/codesign", [
    "--force",
    "--deep",
    "--sign",
    "-",
    "--timestamp=none",
    appPath,
  ], { stdio: "inherit" });
};
