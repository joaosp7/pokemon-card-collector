import fs from "node:fs";
import path from "node:path";

const SLUG_PATTERN = /^[A-Za-z0-9-]+$/;
const CARD_FILENAME = /^(\d+)_(.+)\.jpg$/;

export type Collection = {
  slug: string;
  title: string;
  setCode: string;
};

export type Card = {
  collectorNumber: string;
  name: string;
  filename: string;
};

export function cardsDir(): string {
  return path.resolve(process.cwd(), "..", "cards");
}

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

export function assertValidSlug(slug: string): void {
  if (!isValidSlug(slug)) {
    throw new Error(`Invalid collection slug: ${slug}`);
  }
}

export function parseSlug(slug: string): { title: string; setCode: string } {
  assertValidSlug(slug);
  const parts = slug.split("-");
  const setCode = parts.pop() ?? "";
  const title = parts.join(" ");
  return { title, setCode };
}

export function parseCardFilename(filename: string): Card | null {
  if (filename.endsWith("_back.jpg")) {
    return null;
  }
  const match = CARD_FILENAME.exec(filename);
  if (!match) {
    return null;
  }
  return {
    collectorNumber: match[1],
    name: match[2],
    filename,
  };
}

function collectionDir(slug: string, root: string): string {
  assertValidSlug(slug);
  const resolvedRoot = path.resolve(root);
  const dir = path.resolve(resolvedRoot, slug);
  const prefix = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : resolvedRoot + path.sep;
  if (dir !== resolvedRoot && !dir.startsWith(prefix)) {
    throw new Error(`Invalid collection slug: ${slug}`);
  }
  return dir;
}

export function listCollections(root = cardsDir()): Collection[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  const collections: Collection[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isValidSlug(entry.name)) {
      continue;
    }
    const { title, setCode } = parseSlug(entry.name);
    collections.push({ slug: entry.name, title, setCode });
  }
  collections.sort((a, b) => a.slug.localeCompare(b.slug));
  return collections;
}

export function listCards(slug: string, root = cardsDir()): Card[] {
  const dir = collectionDir(slug, root);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return [];
  }
  const cards: Card[] = [];
  for (const filename of fs.readdirSync(dir)) {
    const card = parseCardFilename(filename);
    if (card) {
      cards.push(card);
    }
  }
  cards.sort((a, b) => a.collectorNumber.localeCompare(b.collectorNumber));
  return cards;
}
