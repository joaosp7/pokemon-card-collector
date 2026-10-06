import path from "node:path";

/** Repository root when the process working directory is `web/`. */
export function repoRoot(): string {
  return path.resolve(process.cwd(), "..");
}

export function dataDir(): string {
  return path.resolve(process.cwd(), "..", "data");
}

export function catalogDbPath(): string {
  return path.join(dataDir(), "catalog.db");
}

export function ownershipDbPath(): string {
  return path.join(dataDir(), "ownership.db");
}

/** Keep an image or logo path relative to the repository root. */
export function projectRelativePath(filePath: string): string {
  const slash = filePath.replaceAll("\\", "/");
  if (path.isAbsolute(filePath) || slash.startsWith("/")) {
    throw new Error("path must be project-root-relative");
  }
  if (slash.split("/").includes("..")) {
    throw new Error("path must stay inside the repository");
  }
  return slash;
}

export function resolveProjectPath(filePath: string): string {
  return path.resolve(repoRoot(), projectRelativePath(filePath));
}
