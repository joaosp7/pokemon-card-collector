import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isValidSlug } from "./catalog";

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

export type SetImageRemoval = "removed" | "missing" | "refused";

export type ParkedSetDirectory = {
  setDirectory: string;
  parkedPath: string;
  cardsDirectory: string;
};

type InspectedSetDirectory =
  | { status: "missing" }
  | { status: "refused" }
  | { status: "ready"; setDirectory: string; cardsDirectory: string };

function isInsideDirectory(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  if (relative === "") {
    return false;
  }
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function inspectSetDirectory(root: string, slug: string): InspectedSetDirectory {
  if (!isValidSlug(slug)) {
    return { status: "refused" };
  }

  const cardsDirectory = path.resolve(root, "cards");
  const setDirectory = path.resolve(cardsDirectory, slug);
  if (
    setDirectory !== path.join(cardsDirectory, slug) ||
    path.relative(cardsDirectory, setDirectory) !== slug
  ) {
    return { status: "refused" };
  }

  let cardsStat: fs.Stats;
  try {
    cardsStat = fs.lstatSync(cardsDirectory);
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return { status: "missing" };
    }
    throw error;
  }
  if (cardsStat.isSymbolicLink() || !cardsStat.isDirectory()) {
    return { status: "refused" };
  }

  let setStat: fs.Stats;
  try {
    setStat = fs.lstatSync(setDirectory);
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return { status: "missing" };
    }
    throw error;
  }
  if (setStat.isSymbolicLink() || !setStat.isDirectory()) {
    return { status: "refused" };
  }

  const realCards = fs.realpathSync(cardsDirectory);
  const realSet = fs.realpathSync(setDirectory);
  if (!isInsideDirectory(realCards, realSet) || path.basename(realSet) !== slug) {
    return { status: "refused" };
  }

  return { status: "ready", setDirectory, cardsDirectory };
}

/**
 * Move `cards/{slug}` aside on the same filesystem.
 * `missing` means there was no directory. `refused` means the path is unsafe
 * and nothing was moved.
 */
export function parkSetImageDirectory(
  root: string,
  slug: string,
): { status: "missing" | "refused" } | ({ status: "parked" } & ParkedSetDirectory) {
  const inspected = inspectSetDirectory(root, slug);
  if (inspected.status !== "ready") {
    return inspected;
  }
  const parkedPath = path.join(
    inspected.cardsDirectory,
    `.${slug}.deleting-${randomBytes(6).toString("hex")}`,
  );
  fs.renameSync(inspected.setDirectory, parkedPath);
  return {
    status: "parked",
    setDirectory: inspected.setDirectory,
    parkedPath,
    cardsDirectory: inspected.cardsDirectory,
  };
}

export function restoreParkedSetDirectory(parked: ParkedSetDirectory): void {
  const parkedStat = fs.lstatSync(parked.parkedPath);
  if (parkedStat.isSymbolicLink() || !parkedStat.isDirectory()) {
    throw new Error("parked set folder is not a directory");
  }
  if (fs.existsSync(parked.setDirectory)) {
    throw new Error("set folder reappeared");
  }
  fs.renameSync(parked.parkedPath, parked.setDirectory);
}

export function discardParkedSetDirectory(parked: ParkedSetDirectory): void {
  const relative = path.relative(parked.cardsDirectory, parked.parkedPath);
  if (
    relative !== path.basename(parked.parkedPath) ||
    !path.basename(parked.parkedPath).startsWith(`.${path.basename(parked.setDirectory)}.deleting-`)
  ) {
    throw new Error("parked set folder is outside cards");
  }
  fs.rmSync(parked.parkedPath, { recursive: true, force: true });
}

/**
 * Delete `cards/{slug}` under `root`.
 * `missing` means there was no directory to remove.
 * `refused` means the path is unsafe (invalid slug, symlink, or outside `cards/`)
 * and nothing was deleted.
 */
export function removeSetImageDirectory(
  root: string,
  slug: string,
): SetImageRemoval {
  const parked = parkSetImageDirectory(root, slug);
  if (parked.status !== "parked") {
    return parked.status;
  }
  discardParkedSetDirectory(parked);
  return "removed";
}
