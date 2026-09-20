import Link from "next/link";
import {
  CardPocket,
  PocketScan,
  cardImageUrl,
} from "@/app/components/card-pocket";

export function CollectionTile({
  slug,
  title,
  setCode,
  owned,
  total,
  coverFilename,
  coverName,
}: {
  slug: string;
  title: string;
  setCode: string;
  owned: number;
  total: number;
  coverFilename: string;
  coverName: string;
}) {
  return (
    <Link href={`/collections/${slug}`} className="block">
      <article className="flex flex-col gap-3">
        <CardPocket>
          <PocketScan
            src={cardImageUrl(slug, coverFilename)}
            alt={`${title} cover, ${coverName}`}
          />
        </CardPocket>
        <div className="flex items-start justify-between gap-3 text-ink-navy">
          <div>
            <p className="font-mono text-xs tracking-[0.14em] text-stamp">
              {setCode}
            </p>
            <h2 className="mt-1 font-display text-2xl leading-tight tracking-tight">
              {title}
            </h2>
          </div>
          <p className="font-mono text-sm tabular-nums text-sleeve">
            {owned} / {total}
          </p>
        </div>
      </article>
    </Link>
  );
}
