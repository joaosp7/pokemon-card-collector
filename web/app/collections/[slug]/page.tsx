import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CardPocket, PocketScan, cardImageUrl } from "@/app/components/card-pocket";
import { CopyControls } from "@/app/components/copy-controls";
import { FilterTabs } from "@/app/components/filter-tabs";
import { isValidSlug, listCards, parseSlug } from "@/lib/catalog";
import { copiesOf, filterCards, parseFilter } from "@/lib/filter";
import { countOwned, getOwnedMap } from "@/lib/ownership";

export const dynamic = "force-dynamic";

type CollectionPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ filter?: string | string[] }>;
};

export async function generateMetadata({
  params,
}: CollectionPageProps): Promise<Metadata> {
  const { slug } = await params;
  if (!isValidSlug(slug) || listCards(slug).length === 0) {
    return { title: "Not found" };
  }
  const { title, setCode } = parseSlug(slug);
  return { title: `${title} · ${setCode}` };
}

export default async function CollectionPage({
  params,
  searchParams,
}: CollectionPageProps) {
  const { slug } = await params;
  const query = await searchParams;

  if (!isValidSlug(slug)) {
    notFound();
  }

  const cards = listCards(slug);
  if (cards.length === 0) {
    notFound();
  }

  const { title, setCode } = parseSlug(slug);
  const ownedMap = getOwnedMap(slug);
  const ownedCount = countOwned(slug);
  const filter = parseFilter(
    Array.isArray(query.filter) ? query.filter[0] : query.filter,
  );
  const visible = filterCards(cards, ownedMap, filter);

  return (
    <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs tracking-[0.14em] text-stamp">
            {setCode}
          </p>
          <h1 className="mt-1 font-display text-4xl tracking-tight text-ink-navy">
            {title}
          </h1>
        </div>
        <p className="font-mono text-lg tabular-nums text-sleeve">
          {ownedCount} / {cards.length}
        </p>
      </header>

      <div className="mt-8">
        <FilterTabs active={filter} />
      </div>

      {visible.length === 0 ? (
        <p className="mt-8 text-ink-navy/85">No cards on this tab.</p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {visible.map((card) => {
            const copies = copiesOf(ownedMap, card.collectorNumber);
            return (
              <li key={card.filename}>
                <article>
                  <CardPocket missing={copies === 0}>
                    <p className="mb-1.5 font-mono text-[0.7rem] leading-tight text-ink-pocket">
                      #{card.collectorNumber} {card.name}
                    </p>
                    <PocketScan
                      src={cardImageUrl(slug, card.filename)}
                      alt={card.name}
                    />
                    <CopyControls
                      slug={slug}
                      collectorNumber={card.collectorNumber}
                      copies={copies}
                    />
                  </CardPocket>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
