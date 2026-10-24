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
  if (!isValidSlug(slug)) {
    return "refused";
  }

  const cardsDirectory = path.resolve(root, "cards");
  const setDirectory = path.resolve(cardsDirectory, slug);
  if (
    setDirectory !== path.join(cardsDirectory, slug) ||
    path.relative(cardsDirectory, setDirectory) !== slug
  ) {
    return "refused";
  }

  let cardsStat: fs.Stats;
  try {
    cardsStat = fs.lstatSync(cardsDirectory);
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return "missing";
    }
    throw error;
  }
  if (cardsStat.isSymbolicLink() || !cardsStat.isDirectory()) {
    return "refused";
  }

  let setStat: fs.Stats;
  try {
    setStat = fs.lstatSync(setDirectory);
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return "missing";
    }
    throw error;
  }
  if (setStat.isSymbolicLink() || !setStat.isDirectory()) {
    return "refused";
  }

  const realCards = fs.realpathSync(cardsDirectory);
  const realSet = fs.realpathSync(setDirectory);
  if (!isInsideDirectory(realCards, realSet) || path.basename(realSet) !== slug) {
    return "refused";
  }

  fs.rmSync(setDirectory, { recursive: true, force: true });
  return "removed";
}
