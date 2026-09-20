import type { ReactNode } from "react";

export function cardImageUrl(slug: string, filename: string): string {
  return `/api/images/${slug}/${encodeURIComponent(filename)}`;
}

export function CardPocket({
  children,
  missing = false,
}: {
  children: ReactNode;
  missing?: boolean;
}) {
  return (
    <div className={missing ? "pocket is-missing" : "pocket"}>{children}</div>
  );
}

export function PocketScan({
  src,
  alt,
}: {
  src: string;
  alt: string;
}) {
  return (
    <div className="pocket-window">
      {/* Local filesystem scans; next/image is not used by design. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} />
    </div>
  );
}
