import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import {
  cardsDir,
  imageContentType,
  isAllowedImageFilename,
  isValidSlug,
} from "@/lib/catalog";

export const runtime = "nodejs";

function decodeFilename(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string; filename: string }> },
) {
  const { slug, filename: rawFilename } = await context.params;
  const filename = decodeFilename(rawFilename);

  if (!isValidSlug(slug)) {
    return new Response("Forbidden", { status: 403 });
  }

  if (!isAllowedImageFilename(filename)) {
    return new Response("Forbidden", { status: 403 });
  }

  const resolvedRoot = path.resolve(cardsDir());
  const filePath = path.resolve(resolvedRoot, slug, filename);
  const prefix = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : resolvedRoot + path.sep;

  if (!filePath.startsWith(prefix)) {
    return new Response("Forbidden", { status: 403 });
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return new Response("Not Found", { status: 404 });
  }

  const stream = Readable.toWeb(
    createReadStream(filePath),
  ) as ReadableStream<Uint8Array>;

  return new Response(stream, {
    headers: { "Content-Type": imageContentType(filename) },
  });
}
