import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="font-display text-4xl tracking-tight text-ink-navy">
        Collection not found
      </h1>
      <p className="mt-4 max-w-lg text-lg leading-relaxed text-ink-navy/85">
        That set is not on disk, or the folder has no cards.
      </p>
      <p className="mt-6">
        <Link
          href="/"
          className="font-mono text-sm tracking-wide text-sleeve underline decoration-sleeve/50 underline-offset-4"
        >
          Back to Poke-Binder
        </Link>
      </p>
    </main>
  );
}
