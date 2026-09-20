import { collectionLogo, listCards, listCollections } from "@/lib/catalog";
import { countOwned } from "@/lib/ownership";
import { CollectionTile } from "@/app/components/collection-tile";

export const dynamic = "force-dynamic";

export default function Home() {
  const collections = listCollections()
    .map((collection) => {
      const cards = listCards(collection.slug);
      if (cards.length === 0) {
        return null;
      }
      return {
        ...collection,
        owned: countOwned(collection.slug),
        total: cards.length,
        logoFilename: collectionLogo(collection.slug),
      };
    })
    .filter((tile) => tile !== null);

  return (
    <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-8 sm:px-6 sm:py-10">
      {collections.length === 0 ? (
        <EmptyBinder />
      ) : (
        <>
          <p className="font-mono text-[0.7rem] tracking-[0.12em] text-sleeve">
            Sets on disk
          </p>
          <h1 className="mt-2 font-display text-4xl tracking-tight text-ink-navy">
            Pick a set
          </h1>
          <ul className="mt-8 grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-3">
            {collections.map((collection) => (
              <li key={collection.slug}>
                <CollectionTile {...collection} />
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

function EmptyBinder() {
  return (
    <div className="max-w-lg">
      <h1 className="font-display text-4xl tracking-tight text-ink-navy">
        No sets yet
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-ink-navy/85">
        Run <code className="font-mono text-sleeve">download-collection</code>{" "}
        to save a set under <code className="font-mono text-sleeve">cards/</code>,
        then refresh.
      </p>
    </div>
  );
}
