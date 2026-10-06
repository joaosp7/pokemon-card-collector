"""Normalize Liga catalog fields for catalog.db rows.

Pure helpers: no network, no database writes, no Playwright.

A missing or blank ``sN`` raises ``ValueError``. Liga's ``id`` is not a card
number, and this module does not substitute the downloader's filename fallback
``000``, which would collide distinct cards inside one set.
"""

from __future__ import annotations

import html
from typing import Any

from download_collection import CARD_TYPE_CODES, NEN_SUFFIX_RE, card_filename

# Observed Liga `iR` values. Unknown ids stay null until a mapping is added.
RARITY_CODES: dict[int, str] = {
    1: "C",
    3: "R",
    11: "S",
    17: "IR",
    18: "IS",
    20: "RD",
    25: "FR",
}


def card_number(card: dict[str, Any]) -> str:
    """Return Liga ``sN`` as text, preserving leading zeroes.

    Raises:
        ValueError: ``sN`` is missing or blank. The source ``id`` field is
        ignored and is not an acceptable fallback.
    """
    raw = card.get("sN")
    if raw is None:
        raise ValueError("missing card number sN")
    number = str(raw).strip()
    if not number:
        raise ValueError("missing card number sN")
    return number


def portuguese_name(card: dict[str, Any]) -> str | None:
    """HTML-unescape ``nPT``, trim, and keep accents. Blank becomes null."""
    raw = card.get("nPT")
    if raw is None:
        return None
    name = html.unescape(str(raw)).strip()
    return name or None


def english_name(card: dict[str, Any]) -> str | None:
    """HTML-unescape ``nEN``, drop a trailing `` (#…/…)`` suffix, and trim."""
    raw = card.get("nEN")
    if raw is None:
        return None
    name = NEN_SUFFIX_RE.sub("", html.unescape(str(raw))).strip()
    return name or None


def element_code(card: dict[str, Any]) -> str | None:
    """Keep a recognized Liga ``sC`` code. Unknown, missing, or ``N`` is null."""
    code = str(card.get("sC") or "").strip()
    if code in CARD_TYPE_CODES:
        return code
    return None


def rarity_code(card: dict[str, Any]) -> str | None:
    """Map numeric ``iR`` to a text rarity code. Unknown values are null."""
    raw = card.get("iR")
    if isinstance(raw, bool) or raw is None:
        return None
    if isinstance(raw, int):
        return RARITY_CODES.get(raw)
    text = str(raw).strip()
    if not text.isdigit():
        return None
    return RARITY_CODES.get(int(text))


def sort_key(card: dict[str, Any]) -> str:
    """Return ``dN`` as text. When it is missing, use ``sN``. Never cast to int."""
    raw = card.get("dN")
    if raw is not None:
        text = str(raw)
        if text.strip():
            return text
    return card_number(card)


def display_name(card: dict[str, Any]) -> str:
    """Normalized Portuguese name when present, otherwise normalized English."""
    return portuguese_name(card) or english_name(card) or ""


def image_path(card: dict[str, Any], slug: str) -> str:
    """Project-root-relative front image path ``cards/{slug}/{filename}``.

    Uses the downloader's front filename rules. ``f_sP`` is ignored, so this
    never returns a ``_back.jpg`` path.
    """
    card_number(card)
    filename = card_filename(card)
    return f"cards/{slug}/{filename}"


def normalize_card(card: dict[str, Any], *, slug: str) -> dict[str, str | None]:
    """Catalog fields for one Liga card. Does not fetch images or write a database."""
    return {
        "id": card_number(card),
        "name_pt": portuguese_name(card),
        "name_en": english_name(card),
        "element_code": element_code(card),
        "rarity_code": rarity_code(card),
        "image_path": image_path(card, slug),
        "sort_key": sort_key(card),
    }
