"""Watchlist loading and validation."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

REQUIRED_FIELDS = (
    "id", "name", "program", "batch", "sector", "one_liner", "what_they_do",
    "traction", "funding", "why_it_matters", "founder_angle", "momentum",
    "tags", "sources", "as_of",
)


@dataclass(frozen=True)
class Company:
    id: str
    name: str
    program: str
    batch: str
    sector: str
    one_liner: str
    what_they_do: str
    traction: str
    funding: str
    why_it_matters: str
    founder_angle: str
    momentum: int
    tags: list[str] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)
    as_of: str = ""

    @property
    def slots(self) -> int:
        """How many times this company appears in one full rotation."""
        return {5: 3, 4: 2}.get(self.momentum, 1)


@dataclass(frozen=True)
class Watchlist:
    companies: list[Company]
    programs: dict[str, str]
    curated_on: str

    def program_name(self, key: str) -> str:
        return self.programs.get(key, key)

    def by_id(self, cid: str) -> Company:
        for c in self.companies:
            if c.id == cid:
                return c
        raise KeyError(cid)


def load(path: str | Path) -> Watchlist:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    companies = []
    seen: set[str] = set()
    for entry in raw["companies"]:
        missing = [f for f in REQUIRED_FIELDS if f not in entry]
        if missing:
            raise ValueError(f"{entry.get('id', '?')} is missing fields: {missing}")
        if entry["id"] in seen:
            raise ValueError(f"duplicate company id: {entry['id']}")
        seen.add(entry["id"])
        companies.append(Company(**{k: entry[k] for k in REQUIRED_FIELDS}))
    if not companies:
        raise ValueError("watchlist is empty")
    return Watchlist(
        companies=companies,
        programs=raw.get("programs", {}),
        curated_on=raw.get("curated_on", ""),
    )
