import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type Database from "better-sqlite3";
import {
  findApprovedImagePath,
  isValidSlug,
  resolveCatalogImagePath,
} from "@/lib/catalog";
import { repoRoot } from "@/lib/data-paths";

export const runtime = "nodejs";

export type ServeCatalogImageOptions = {
  db?: Database.Database;
  root?: string;
};

function decodeFilename(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isSafeRequestFilename(filename: string): boolean {
  if (filename.length === 0) {
    return false;
  }
  if (
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("\0") ||
    filename.includes("..")
  ) {
    return false;
  }
  return path.basename(filename) === filename && !path.isAbsolute(filename);
}

export async function serveCatalogImage(
  slug: string,
  filename: string,
  options: ServeCatalogImageOptions = {},
): Promise<Response> {
  if (!isValidSlug(slug) || !isSafeRequestFilename(filename)) {
    return new Response("Forbidden", { status: 403 });
  }

  const catalogPath = findApprovedImagePath(slug, filename, options.db);
  if (!catalogPath) {
    return new Response("Not Found", { status: 404 });
  }

  const resolved = resolveCatalogImagePath(
    catalogPath,
    options.root ?? repoRoot(),
  );
  if (!resolved.ok) {
    if (resolved.error === "missing" || resolved.error === "not-file") {
      return new Response("Not Found", { status: 404 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  const stream = Readable.toWeb(
    createReadStream(resolved.filePath),
  ) as ReadableStream<Uint8Array>;

  return new Response(stream, {
    headers: { "Content-Type": resolved.contentType },
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string; filename: string }> },
) {
  const { slug, filename: rawFilename } = await context.params;
  return serveCatalogImage(slug, decodeFilename(rawFilename));
}
