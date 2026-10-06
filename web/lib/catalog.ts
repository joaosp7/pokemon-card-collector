import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  findSetBySlug,
  listSetCards,
  listSets,
  type Card as CatalogCard,
  type Collection as CatalogSet,
} from "./catalog-db";
import { projectRelativePath, repoRoot } from "./data-paths";

const SLUG_PATTERN = /^[A-Za-z0-9-]+$/;

export const ENERGY_LABELS: Readonly<Record<string, string>> = {
  W: "Água",
  R: "Fogo",
  G: "Planta",
  L: "Elétrico",
  P: "Psíquico",
  F: "Lutador",
  D: "Sombrio",
  M: "Metal",
  Y: "Fada",
  O: "Dragão",
  C: "Incolor",
  E: "Energia",
  N: "desconhecido",
};

export const LOGO_FILENAMES: readonly string[] = [
  "logo.png",
  "logo.webp",
  "logo.jpg",
  "logo.jpeg",
];

export type Collection = {
  id: number;
  slug: string;
  title: string;
  setCode: string;
  logoPath: string | null;
  cardCount: number;
};

export type Card = {
  setId: number;
  setCardId: string;
  name: string;
  element: string | null;
  rarityCode: string | null;
  illustrator: string | null;
  imagePath: string;
  sortKey: string;
};

export type CollectionPageData = {
  collection: Collection;
  cards: Card[];
};

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

function displayName(namePt: string | null, nameEn: string | null): string {
  const portuguese = namePt?.trim() ?? "";
  if (portuguese.length > 0) {
    return portuguese;
  }
  return nameEn?.trim() ?? "";
}

function elementLabel(code: string | null): string | null {
  if (code == null || code.length === 0) {
    return null;
  }
  return ENERGY_LABELS[code] ?? code;
}

function toCollection(set: CatalogSet): Collection {
  return {
    id: set.id,
    slug: set.slug,
    title: displayName(set.namePt, set.nameEn),
    setCode: set.setCode,
    logoPath: set.logoPath,
    cardCount: set.cardCount,
  };
}

function toCard(card: CatalogCard): Card {
  return {
    setId: card.setId,
    setCardId: card.setCardId,
    name: displayName(card.namePt, card.nameEn),
    element: elementLabel(card.elementCode),
    rarityCode: card.rarityCode,
    illustrator: card.illustrator,
    imagePath: card.imagePath,
    sortKey: card.sortKey,
  };
}

export function listCollections(db?: Database.Database): Collection[] {
  return listSets(db).map(toCollection);
}

export function findCollection(
  slug: string,
  db?: Database.Database,
): Collection | null {
  if (!isValidSlug(slug)) {
    return null;
  }
  const set = findSetBySlug(slug, db);
  return set ? toCollection(set) : null;
}

export function listCards(setId: number, db?: Database.Database): Card[] {
  return listSetCards(setId, db).map(toCard);
}

export function loadCollectionPage(
  slug: string,
  db?: Database.Database,
): CollectionPageData | null {
  const collection = findCollection(slug, db);
  if (!collection) {
    return null;
  }
  const cards = listCards(collection.id, db);
  if (cards.length === 0) {
    return null;
  }
  return { collection, cards };
}

export function imageBasename(imagePath: string): string {
  return path.posix.basename(imagePath.replaceAll("\\", "/"));
}

const IMAGE_EXTENSION_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export type CatalogImagePathError =
  | "absolute"
  | "escape"
  | "outside-cards"
  | "missing"
  | "not-file"
  | "unsupported";

export type ResolvedCatalogImage =
  | { ok: true; filePath: string; contentType: string }
  | { ok: false; error: CatalogImagePathError };

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
 * Resolve a catalog image or logo path against the repository root.
 * Unsafe paths are rejected before the file is read.
 */
export function resolveCatalogImagePath(
  catalogPath: string,
  root = repoRoot(),
): ResolvedCatalogImage {
  const slash = catalogPath.replaceAll("\\", "/");
  if (path.isAbsolute(catalogPath) || slash.startsWith("/")) {
    return { ok: false, error: "absolute" };
  }
  if (slash.split("/").includes("..")) {
    return { ok: false, error: "escape" };
  }

  let relative: string;
  try {
    relative = projectRelativePath(catalogPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("project-root-relative")) {
      return { ok: false, error: "absolute" };
    }
    return { ok: false, error: "escape" };
  }

  if (!relative.startsWith("cards/") || relative.endsWith("/")) {
    return { ok: false, error: "outside-cards" };
  }

  const contentType = IMAGE_EXTENSION_TYPES[path.extname(relative).toLowerCase()];
  if (!contentType) {
    return { ok: false, error: "unsupported" };
  }

  const cardsDirectory = path.resolve(root, "cards");
  const filePath = path.resolve(root, relative);
  if (!isInsideDirectory(cardsDirectory, filePath)) {
    return { ok: false, error: "outside-cards" };
  }

  let realCards: string;
  let realFile: string;
  try {
    realCards = fs.realpathSync(cardsDirectory);
    realFile = fs.realpathSync(filePath);
  } catch {
    return { ok: false, error: "missing" };
  }
  if (!isInsideDirectory(realCards, realFile)) {
    return { ok: false, error: "escape" };
  }

  try {
    const stat = fs.statSync(realFile);
    if (!stat.isFile() || stat.size <= 0) {
      return { ok: false, error: "not-file" };
    }
  } catch {
    return { ok: false, error: "missing" };
  }

  return { ok: true, filePath: realFile, contentType };
}

/**
 * Catalog path for this set whose basename is `filename`.
 * Logo names come only from `sets.logo_path`. Card names never fill in a logo.
 */
export function findApprovedImagePath(
  slug: string,
  filename: string,
  db?: Database.Database,
): string | null {
  const collection = findCollection(slug, db);
  if (!collection) {
    return null;
  }
  if (LOGO_FILENAMES.includes(filename)) {
    if (
      collection.logoPath != null &&
      imageBasename(collection.logoPath) === filename
    ) {
      return collection.logoPath;
    }
    return null;
  }
  const matches = [
    ...new Set(
      listCards(collection.id, db)
        .map((card) => card.imagePath)
        .filter((imagePath) => imageBasename(imagePath) === filename),
    ),
  ];
  return matches.length === 1 ? matches[0] : null;
}

/** Basename of a stored logo path when that file exists and is non-empty. */
export function storedLogoFilename(
  logoPath: string | null,
  root = repoRoot(),
): string | null {
  if (logoPath == null || logoPath.length === 0) {
    return null;
  }
  const filename = path.posix.basename(logoPath.replaceAll("\\", "/"));
  if (!LOGO_FILENAMES.includes(filename)) {
    return null;
  }
  const resolved = resolveCatalogImagePath(logoPath, root);
  if (!resolved.ok) {
    return null;
  }
  return filename;
}
