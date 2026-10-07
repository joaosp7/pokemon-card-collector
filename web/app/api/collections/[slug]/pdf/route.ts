import type Database from "better-sqlite3";
import { loadCollectionPage } from "@/lib/catalog";
import {
  buildCollectionPdf,
  entriesForExport,
  exportFilename,
  loadCardJpeg,
  type PdfCard,
} from "@/lib/export-pdf";
import { parseFilter } from "@/lib/filter";
import { getOwnedMap } from "@/lib/ownership-db";

export const runtime = "nodejs";

export type ExportCollectionPdfOptions = {
  catalog?: Database.Database;
  ownership?: Database.Database;
  root?: string;
};

export async function exportCollectionPdf(
  slug: string,
  filterValue: unknown,
  options: ExportCollectionPdfOptions = {},
): Promise<Response> {
  const page = loadCollectionPage(slug, options.catalog);
  if (!page) {
    return new Response("Not Found", { status: 404 });
  }

  const filter = parseFilter(filterValue);
  const ownedMap = getOwnedMap(page.collection.id, options.ownership);
  const selected = entriesForExport(page.cards, ownedMap, filter);
  const entries: PdfCard[] = [];
  for (const entry of selected) {
    entries.push({
      setCardId: entry.setCardId,
      copies: entry.copies,
      image: await loadCardJpeg(entry.imagePath, options.root),
    });
  }

  const bytes = await buildCollectionPdf({
    title: page.collection.title,
    setCode: page.collection.setCode,
    filter,
    entries,
  });
  const filename = exportFilename(page.collection.slug, filter);

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await context.params;
  const filter = new URL(request.url).searchParams.get("filter");
  return exportCollectionPdf(slug, filter);
}
