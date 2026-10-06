import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import sharp from "sharp";
import { resolveCatalogImagePath, type Card } from "./catalog";
import { copiesOf, filterCards, type CardFilter } from "./filter";

export const EXPORT_COLUMNS = 4;
export const EXPORT_ROWS = 3;
export const CARDS_PER_PAGE = EXPORT_COLUMNS * EXPORT_ROWS;

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 24;
const HEADER_HEIGHT = 28;
const GAP_X = 8;
const GAP_Y = 8;
const CAPTION_HEIGHT = 14;
const IMAGE_ASPECT = 88 / 63;

export type ExportEntry = {
  setCardId: string;
  copies: number;
  imagePath: string;
};

export type PdfCard = {
  setCardId: string;
  copies: number;
  image: Uint8Array | null;
};

export type CollectionPdfInput = {
  title: string;
  setCode: string;
  filter: CardFilter;
  entries: PdfCard[];
};

const FILTER_LABELS: Record<CardFilter, string> = {
  all: "All",
  missing: "Missing",
  owned: "Owned",
};

export function filterViewLabel(filter: CardFilter): string {
  return FILTER_LABELS[filter];
}

export function exportFilename(slug: string, filter: CardFilter): string {
  return `${slug}-${filter}.pdf`;
}

export function pageCountForExport(entryCount: number): number {
  if (entryCount <= 0) {
    return 1;
  }
  return Math.ceil(entryCount / CARDS_PER_PAGE);
}

export function entriesForExport(
  cards: Card[],
  ownedMap: Map<string, number>,
  filter: string,
): ExportEntry[] {
  return filterCards(cards, ownedMap, filter).map((card) => ({
    setCardId: card.setCardId,
    copies: copiesOf(ownedMap, card.setCardId),
    imagePath: card.imagePath,
  }));
}

export async function loadCardJpeg(
  imagePath: string,
  root?: string,
): Promise<Uint8Array | null> {
  const resolved = resolveCatalogImagePath(imagePath, root);
  if (!resolved.ok) {
    return null;
  }
  try {
    const buffer = await sharp(resolved.filePath)
      .rotate()
      .resize({
        width: 360,
        height: 504,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 70 })
      .toBuffer();
    if (buffer.length === 0) {
      return null;
    }
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

function winAnsi(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) {
      out += char;
    }
  }
  return out;
}

function fitLine(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string {
  const safe = winAnsi(text);
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) {
    return safe;
  }
  let end = safe.length;
  while (
    end > 0 &&
    font.widthOfTextAtSize(`${safe.slice(0, end)}...`, size) > maxWidth
  ) {
    end -= 1;
  }
  return end === 0 ? "" : `${safe.slice(0, end)}...`;
}

export async function buildCollectionPdf(
  input: CollectionPdfInput,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.14, 0.18);
  const paper = rgb(0.96, 0.94, 0.91);
  const frame = rgb(0.55, 0.58, 0.62);

  const pageCount = pageCountForExport(input.entries.length);
  const label = filterViewLabel(input.filter);
  const contentWidth = PAGE_WIDTH - MARGIN * 2;
  const cellWidth = (contentWidth - GAP_X * (EXPORT_COLUMNS - 1)) / EXPORT_COLUMNS;
  const imageHeight = cellWidth * IMAGE_ASPECT;
  const contentTop = PAGE_HEIGHT - MARGIN - HEADER_HEIGHT;

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const pageLabel = `${pageIndex + 1} / ${pageCount}`;
    const pageLabelWidth = font.widthOfTextAtSize(pageLabel, 9);
    const headerMax = contentWidth - pageLabelWidth - 12;
    const header = fitLine(
      `${input.title} · ${input.setCode} · ${label}`,
      fontBold,
      11,
      headerMax,
    );
    page.drawText(header, {
      x: MARGIN,
      y: PAGE_HEIGHT - MARGIN - 12,
      size: 11,
      font: fontBold,
      color: ink,
    });
    page.drawText(pageLabel, {
      x: PAGE_WIDTH - MARGIN - pageLabelWidth,
      y: PAGE_HEIGHT - MARGIN - 11,
      size: 9,
      font,
      color: ink,
    });

    if (input.entries.length === 0) {
      page.drawText("No cards on this tab.", {
        x: MARGIN,
        y: contentTop - 4,
        size: 11,
        font,
        color: ink,
      });
      continue;
    }

    const slice = input.entries.slice(
      pageIndex * CARDS_PER_PAGE,
      (pageIndex + 1) * CARDS_PER_PAGE,
    );
    const rowStride = imageHeight + CAPTION_HEIGHT + GAP_Y;

    for (let index = 0; index < slice.length; index += 1) {
      const entry = slice[index];
      const column = index % EXPORT_COLUMNS;
      const row = Math.floor(index / EXPORT_COLUMNS);
      const x = MARGIN + column * (cellWidth + GAP_X);
      const imageTop = contentTop - row * rowStride;
      const imageBottom = imageTop - imageHeight;

      page.drawRectangle({
        x,
        y: imageBottom,
        width: cellWidth,
        height: imageHeight,
        color: paper,
        borderColor: frame,
        borderWidth: 0.6,
      });

      if (entry.image) {
        try {
          const jpg = await doc.embedJpg(entry.image);
          const scale = Math.min(
            (cellWidth - 2) / jpg.width,
            (imageHeight - 2) / jpg.height,
          );
          const width = jpg.width * scale;
          const height = jpg.height * scale;
          page.drawImage(jpg, {
            x: x + (cellWidth - width) / 2,
            y: imageBottom + (imageHeight - height) / 2,
            width,
            height,
          });
        } catch {
          // The frame and caption stay so a bad image does not drop the card.
        }
      }

      const caption = fitLine(
        `#${entry.setCardId}  ×${entry.copies}`,
        font,
        8,
        cellWidth,
      );
      page.drawText(caption, {
        x,
        y: imageBottom - 11,
        size: 8,
        font,
        color: ink,
      });
    }
  }

  return doc.save({ useObjectStreams: false });
}
