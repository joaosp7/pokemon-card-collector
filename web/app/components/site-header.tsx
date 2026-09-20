import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-sleeve/25">
      <div className="mx-auto flex max-w-[90rem] items-baseline justify-between px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="font-display text-xl tracking-tight text-ink-navy"
        >
          Binder
        </Link>
        <p className="font-mono text-[0.65rem] tracking-[0.12em] text-sleeve">
          Liga scans
        </p>
      </div>
    </header>
  );
}
