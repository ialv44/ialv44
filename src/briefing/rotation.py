"""Which companies you hear today.

Stateless on purpose: the same date always produces the same line-up, on any
machine, with no history file to lose.

Two wheels turn in parallel so no episode is all deep cuts. Headliners
(momentum 5) have their own wheel and every episode takes a slice of it; the
rest fill the remaining slots. Each wheel resumes where the previous day left
off, so you work through the whole watchlist before anything repeats.
"""

from __future__ import annotations

import hashlib
from datetime import date

from .model import Company, Watchlist

EPOCH = date(2026, 9, 1)


def _key(seed: str, company_id: str, slot: int) -> str:
    return hashlib.sha256(f"{seed}:{company_id}:{slot}".encode()).hexdigest()


def full_rotation(companies: list[Company], seed: str = "v1") -> list[str]:
    """A stable, shuffled sequence of ids; busier companies hold more slots."""
    slots = [
        (_key(seed, c.id, i), c.id)
        for c in companies
        for i in range(c.slots)
    ]
    slots.sort()
    return [company_id for _, company_id in slots]


def day_index(on: date) -> int:
    return (on - EPOCH).days


def _walk(order: list[str], start: int, want: int, taken: set[str],
          exclude: set[str]) -> tuple[list[str], int]:
    """Take `want` distinct ids from `start`; return them and where to resume."""
    picked: list[str] = []
    if not order or want <= 0:
        return picked, start
    position = start
    for step in range(len(order)):
        index = (start + step) % len(order)
        position = (index + 1) % len(order)
        company_id = order[index]
        if company_id in taken or company_id in exclude:
            continue
        taken.add(company_id)
        picked.append(company_id)
        if len(picked) == want:
            break
    return picked, position


def _resume_point(order: list[str], per_day: int, day: int,
                  exclude: set[str]) -> int:
    """Replay previous days so today starts where yesterday stopped."""
    if not order or per_day <= 0:
        return 0
    position = 0
    for _ in range(max(0, day) % (len(order) + 1)):
        _, position = _walk(order, position, per_day, set(), exclude)
    return position


def lineup(
    watchlist: Watchlist,
    on: date,
    count: int = 8,
    seed: str = "v1",
    exclude: set[str] | None = None,
) -> list[Company]:
    """Pick `count` companies for `on`, strongest first."""
    exclude = exclude or set()
    hot_companies = [c for c in watchlist.companies if c.momentum >= 5]
    deep_companies = [c for c in watchlist.companies if c.momentum < 5]
    hot = full_rotation(hot_companies, seed + ":hot")
    deep = full_rotation(deep_companies, seed + ":deep")

    day = day_index(on)
    want_hot = min(len(hot_companies), max(2, count // 3))
    want_deep = max(0, count - want_hot)
    taken: set[str] = set()

    picked, _ = _walk(hot, _resume_point(hot, want_hot, day, exclude),
                      want_hot, taken, exclude)
    more, _ = _walk(deep, _resume_point(deep, want_deep, day, exclude),
                    want_deep, taken, exclude)
    picked += more
    if len(picked) < count:  # tiny watchlist: top up with whatever is left
        extra, _ = _walk(hot + deep, 0, count - len(picked), taken, exclude)
        picked += extra

    companies = [watchlist.by_id(cid) for cid in picked]
    companies.sort(key=lambda c: (-c.momentum, c.name))
    return companies


def days_until_repeat(watchlist: Watchlist, count: int = 8, seed: str = "v1") -> float:
    """Roughly how long before the deep wheel comes back round."""
    deep = [c for c in watchlist.companies if c.momentum < 5]
    per_day = max(1, count - max(2, count // 3))
    return len(full_rotation(deep, seed + ":deep")) / per_day
