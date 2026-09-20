"""Download Liga Pokémon collection card images."""

from __future__ import annotations

import argparse
import html
import re
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

CDN_BASE = "https://repositorio.sbrauble.com"
REFERER = "https://www.ligapokemon.com.br/"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
NEN_SUFFIX_RE = re.compile(r"\s*\(#.*\)\s*$")
UNSAFE_FILENAME_RE = re.compile(r'[/\\:*?"<>|]')
CATALOG_WAIT_JS = """() => {
    const fromEdc = (typeof edc !== 'undefined' && edc && Array.isArray(edc.obj))
        ? edc.obj : [];
    const fromJson = (typeof cardsjson !== 'undefined' && Array.isArray(cardsjson))
        ? cardsjson : [];
    return fromEdc.length > 0 || fromJson.length > 0;
}"""
EXTRACT_JS = """() => {
    const fromEdc = (typeof edc !== 'undefined' && edc && Array.isArray(edc.obj))
        ? edc.obj : [];
    const fromJson = (typeof cardsjson !== 'undefined' && Array.isArray(cardsjson))
        ? cardsjson : [];
    const catalog = fromEdc.length > 0 ? fromEdc : fromJson;
    const sigla = catalog.length ? (catalog[0].sSigla || "") : "";
    return { title: document.title, catalog, sigla };
}"""


def project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def collection_folder_name(title: str, sigla: str) -> str:
    base = title.split("|")[0].strip()
    normalized = unicodedata.normalize("NFKD", base)
    without_marks = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    with_hyphens = re.sub(r"\s+", "-", without_marks)
    cleaned = re.sub(r"[^A-Za-z0-9-]", "", with_hyphens)
    collapsed = re.sub(r"-{2,}", "-", cleaned).strip("-")
    return f"{collapsed}-{sigla}"


def card_display_name(card: dict[str, Any]) -> str:
    npt = html.unescape(str(card.get("nPT") or "")).strip()
    if npt:
        return npt
    nen = html.unescape(str(card.get("nEN") or "")).strip()
    return NEN_SUFFIX_RE.sub("", nen).strip()


def card_filename(card: dict[str, Any], *, back: bool = False) -> str:
    sn = str(card.get("sN") or "").strip() or "000"
    name = UNSAFE_FILENAME_RE.sub("_", card_display_name(card))
    suffix = "_back" if back else ""
    return f"{sn}_{name}{suffix}.jpg"


def image_url(sP: str) -> str:
    return f"{CDN_BASE}/{str(sP).lstrip('/')}"


def sort_cards(cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(cards, key=lambda card: str(card.get("dN") or ""))


def should_skip(dest: Path) -> bool:
    return dest.exists() and dest.stat().st_size > 0


def download_to(url: str, dest: Path, *, retries: int = 3) -> str:
    """Download url to dest. Returns 'skipped', 'downloaded', or 'failed'."""
    if should_skip(dest):
        return "skipped"

    dest.parent.mkdir(parents=True, exist_ok=True)
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            request = Request(
                url,
                headers={"User-Agent": USER_AGENT, "Referer": REFERER},
            )
            with urlopen(request, timeout=30) as response:
                data = response.read()
            if not data:
                raise ValueError("empty response")
            dest.write_bytes(data)
            return "downloaded"
        except (HTTPError, URLError, TimeoutError, ValueError, OSError) as exc:
            last_error = exc
            time.sleep(0.5 * (attempt + 1))

    print(f"failed {dest.name}: {last_error}", file=sys.stderr)
    return "failed"


def card_image_jobs(card: dict[str, Any]) -> list[tuple[str, str]]:
    jobs: list[tuple[str, str]] = []
    sP = str(card.get("sP") or "").strip()
    if sP:
        jobs.append((image_url(sP), card_filename(card)))
    f_sP = str(card.get("f_sP") or "").strip()
    if f_sP:
        jobs.append((image_url(f_sP), card_filename(card, back=True)))
    return jobs


def fetch_page_data(url: str, *, headed: bool = False) -> tuple[str, list[dict[str, Any]], str]:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=not headed)
        try:
            page = browser.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=60_000)
            page.wait_for_function(CATALOG_WAIT_JS, timeout=60_000)
            data = page.evaluate(EXTRACT_JS)
        finally:
            browser.close()

    return data["title"], list(data["catalog"]), str(data["sigla"] or "")


def planned_output(
    title: str, catalog: list[dict[str, Any]], sigla: str
) -> tuple[str, Path, int]:
    cards = sort_cards(catalog)
    slug = collection_folder_name(title, sigla or str(cards[0].get("sSigla") or ""))
    out_dir = project_root() / "cards" / slug
    return slug, out_dir, len(cards)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download Liga Pokémon collection card images.",
    )
    parser.add_argument("url", help="Liga Pokémon collection search URL")
    parser.add_argument(
        "--headed",
        action="store_true",
        help="Show the browser window (headless by default)",
    )
    parser.add_argument(
        "--dry-run",
        "--dryrun",
        action="store_true",
        help="Print collection name, output path, and card count without downloading",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    title, catalog, sigla = fetch_page_data(args.url, headed=args.headed)
    if not catalog:
        print("No cards found in page catalog.", file=sys.stderr)
        return 1

    slug, out_dir, card_count = planned_output(title, catalog, sigla)
    cards = sort_cards(catalog)

    if args.dry_run:
        print(f"Collection: {slug}")
        print(f"Save to: {out_dir}")
        print(f"Cards: {card_count}")
        return 0

    out_dir.mkdir(parents=True, exist_ok=True)

    jobs: list[tuple[str, str]] = []
    for card in cards:
        jobs.extend(card_image_jobs(card))

    print(f"Found {len(cards)} cards ({len(jobs)} images)")
    print(f"Saving to {out_dir}")

    downloaded = skipped = failed = 0
    for index, (url, filename) in enumerate(jobs, start=1):
        dest = out_dir / filename
        status = download_to(url, dest)
        print(f"[{index}/{len(jobs)}] {status} {filename}")
        if status == "downloaded":
            downloaded += 1
            time.sleep(0.15)
        elif status == "skipped":
            skipped += 1
        else:
            failed += 1

    discovered = len(jobs)
    print(
        f"Summary: discovered={discovered} downloaded={downloaded} "
        f"skipped={skipped} failed={failed}"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
