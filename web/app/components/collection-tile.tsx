import Link from "next/link";
import { cardImageUrl } from "@/app/components/card-pocket";

export function CollectionTile({
  slug,
  title,
  setCode,
  owned,
  total,
  logoFilename,
}: {
  slug: string;
  title: string;
  setCode: string;
  owned: number;
  total: number;
  logoFilename: string | null;
}) {
  return (
    <Link href={`/collections/${slug}`} className="block">
      <article className="flex flex-col gap-3">
        <CollectionEmblem
          slug={slug}
          title={title}
          setCode={setCode}
          logoFilename={logoFilename}
        />
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

function CollectionEmblem({
  slug,
  title,
  setCode,
  logoFilename,
}: {
  slug: string;
  title: string;
  setCode: string;
  logoFilename: string | null;
}) {
  return (
    <div className="emblem">
      <div className="emblem-face">
        {logoFilename ? (
          <>
            {/* Local filesystem scans; next/image is not used by design. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cardImageUrl(slug, logoFilename)}
              alt={`${title} emblem`}
            />
          </>
        ) : (
          <span className="emblem-code">{setCode}</span>
        )}
      </div>
    </div>
  );
}
