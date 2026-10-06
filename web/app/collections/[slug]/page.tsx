import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CardPocket, PocketScan, cardImageUrl } from "@/app/components/card-pocket";
import { CopyControls } from "@/app/components/copy-controls";
import { FilterTabs } from "@/app/components/filter-tabs";
import { imageBasename, loadCollectionPage } from "@/lib/catalog";
import { copiesOf, filterCards, parseFilter } from "@/lib/filter";
import { countOwned, getOwnedMap } from "@/lib/ownership-db";

export const dynamic = "force-dynamic";

type CollectionPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ filter?: string | string[] }>;
};

export async function generateMetadata({
  params,
}: CollectionPageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = loadCollectionPage(slug);
  if (!page) {
    return { title: "Not found" };
  }
  return { title: `${page.collection.title} · ${page.collection.setCode}` };
}

export default async function CollectionPage({
  params,
  searchParams,
}: CollectionPageProps) {
  const { slug } = await params;
  const query = await searchParams;

  const page = loadCollectionPage(slug);
  if (!page) {
    notFound();
  }

  const { collection, cards } = page;
  const ownedMap = getOwnedMap(collection.id);
  const ownedCount = countOwned(collection.id);
  const filter = parseFilter(
    Array.isArray(query.filter) ? query.filter[0] : query.filter,
  );
  const visible = filterCards(cards, ownedMap, filter);

  return (
    <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs tracking-[0.14em] text-stamp">
            {collection.setCode}
          </p>
          <h1 className="mt-1 font-display text-4xl tracking-tight text-ink-navy">
            {collection.title}
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
            const copies = copiesOf(ownedMap, card.setCardId);
            return (
              <li key={card.setCardId}>
                <article>
                  <CardPocket missing={copies === 0}>
                    <p className="mb-1.5 font-mono text-[0.7rem] leading-tight text-ink-pocket">
                      #{card.setCardId} {card.name}
                      {card.element != null ? (
                        <>
                          <br />
                          {card.element}
                        </>
                      ) : null}
                      {card.rarityCode != null ? (
                        <>
                          <br />
                          {card.rarityCode}
                        </>
                      ) : null}
                    </p>
                    <PocketScan
                      src={cardImageUrl(slug, imageBasename(card.imagePath))}
                      alt={card.name}
                    />
                    <CopyControls
                      slug={slug}
                      setId={collection.id}
                      setCardId={card.setCardId}
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
