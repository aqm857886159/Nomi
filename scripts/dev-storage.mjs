import path from "node:path";

function joinPortable(...parts) {
  const first = String(parts[0] || "");
  return (path.win32.isAbsolute(first) && !path.posix.isAbsolute(first)
    ? path.win32
    : path.posix).join(...parts);
}

function configuredPath(value) {
  const candidate = String(value || "").trim();
  return candidate || null;
}

export function resolveDevStoragePaths({ repoRoot, rendererPort, env = process.env }) {
  const defaultUserDataDir = joinPortable(repoRoot, ".tmp", "electron-user-data", `dev-${rendererPort}`);
  const userDataDir = configuredPath(env.NOMI_ELECTRON_USER_DATA_DIR) || defaultUserDataDir;
  const projectsDir = configuredPath(env.NOMI_PROJECTS_DIR) || joinPortable(userDataDir, "projects");

  return { userDataDir, projectsDir };
}
