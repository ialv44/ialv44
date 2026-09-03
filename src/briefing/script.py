"""Builds the spoken episode: intro, one segment per company, pattern read, outro."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date

from .model import Company, Watchlist
from .rotation import lineup
from .speech import estimate_seconds, speakable

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MONTHS = ["", "January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]


@dataclass
class Segment:
    id: str
    kind: str          # intro | company | patterns | outro
    heading: str
    subhead: str
    speak: str
    seconds: int
    meta: dict = field(default_factory=dict)


@dataclass
class Episode:
    date: str
    title: str
    segments: list[Segment]

    @property
    def seconds(self) -> int:
        return sum(s.seconds for s in self.segments)

    def to_dict(self) -> dict:
        return {
            "date": self.date,
            "title": self.title,
            "seconds": self.seconds,
            "segments": [asdict(s) for s in self.segments],
        }


def spoken_date(on: date) -> str:
    return f"{WEEKDAYS[on.weekday()]}, {on.day} {MONTHS[on.month]} {on.year}"


def _segment(seg_id: str, kind: str, heading: str, subhead: str, lines: list[str],
             meta: dict | None = None) -> Segment:
    speak = speakable(" ".join(line for line in lines if line))
    return Segment(
        id=seg_id, kind=kind, heading=heading, subhead=subhead,
        speak=speak, seconds=estimate_seconds(speak), meta=meta or {},
    )


def _intro(on: date, picks: list[Company], watchlist: Watchlist) -> Segment:
    names = [c.name for c in picks]
    listed = ", ".join(names[:-1]) + f", and {names[-1]}" if len(names) > 1 else names[0]
    return _segment(
        "intro", "intro", "Today's brief", spoken_date(on),
        [
            f"Good morning. This is your startup brief for {spoken_date(on)}.",
            f"Today we have {len(picks)} companies:",
            listed + ".",
            "Each one takes about a minute. I will tell you what they do, what "
            "traction they have, why it matters, and one thing you could steal "
            "from them for your own idea.",
            "Let's go.",
        ],
        {"count": len(picks), "curated_on": watchlist.curated_on},
    )


def _company(index: int, total: int, c: Company, watchlist: Watchlist) -> Segment:
    program = watchlist.program_name(c.program)
    backing = (
        f"{program}, {c.batch}." if c.program != "breakout"
        else "Not in an accelerator batch. This one is on the list as a benchmark, "
             "because it is the company everyone else in its category is measured against."
    )
    return _segment(
        c.id, "company", c.name, f"{program} · {c.batch} · {c.sector}",
        [
            f"Number {index} of {total}. {c.name}.",
            c.one_liner,
            backing,
            c.what_they_do,
            "On traction:", c.traction,
            "On money:", c.funding,
            "Why it matters:", c.why_it_matters,
            "And the thing to steal:", c.founder_angle,
        ],
        {
            "program": c.program, "program_name": program, "batch": c.batch,
            "sector": c.sector, "tags": c.tags, "momentum": c.momentum,
            "sources": c.sources, "as_of": c.as_of, "one_liner": c.one_liner,
        },
    )


def _patterns(picks: list[Company]) -> Segment:
    counts: dict[str, int] = {}
    for c in picks:
        for tag in c.tags:
            counts[tag] = counts.get(tag, 0) + 1
    repeated = sorted(
        (tag for tag, n in counts.items() if n > 1),
        key=lambda t: (-counts[t], t),
    )[:3]

    if repeated:
        readable = ", ".join(tag.replace("-", " ") for tag in repeated)
        body = (
            f"Three things showed up more than once today: {readable}. "
            "When a theme repeats across companies that never met each other, "
            "that is usually the market telling you where the money is going."
        )
    else:
        body = (
            "Today's set had no repeated theme, which is its own signal. "
            "The funded surface is wide right now, not narrow."
        )
    sectors = sorted({c.sector.split(",")[0].strip() for c in picks})
    return _segment(
        "patterns", "patterns", "The pattern", "What repeated today",
        ["That's the companies. Now the pattern.", body,
         "Sectors you just heard: " + ", ".join(sectors) + "."],
        {"repeated_tags": repeated, "sectors": sectors},
    )


def _outro(picks: list[Company], on: date) -> Segment:
    top = max(picks, key=lambda c: c.momentum)
    prompts = [
        f"One. Take what {top.name} is doing and ask who else has that exact problem "
        "but no budget for a specialist. That is usually the cheaper, faster version "
        "of the same company.",
        "Two. Of everything you just heard, which one could you build a rough version "
        "of this weekend? Not the whole thing. The single most annoying part of it.",
        "Three. Which of these companies would be trivial to beat in your own country "
        "or your own industry, because they will never bother to come here?",
    ]
    return _segment(
        "outro", "outro", "Your turn", "Three questions to sit with",
        ["That's the brief. Before you get out of the car, three questions."]
        + prompts
        + ["Same time tomorrow. New companies."],
        {"prompt_count": 3, "date": on.isoformat()},
    )


def build(watchlist: Watchlist, on: date, count: int = 8, seed: str = "v1",
          exclude: set[str] | None = None) -> Episode:
    picks = lineup(watchlist, on, count=count, seed=seed, exclude=exclude)
    if not picks:
        raise ValueError("no companies available for this date")
    segments = [_intro(on, picks, watchlist)]
    segments += [
        _company(i, len(picks), c, watchlist) for i, c in enumerate(picks, start=1)
    ]
    segments.append(_patterns(picks))
    segments.append(_outro(picks, on))
    return Episode(
        date=on.isoformat(),
        title=f"Startup Brief — {spoken_date(on)}",
        segments=segments,
    )


def company_solo(c: Company, watchlist: Watchlist) -> Segment:
    """One company, spoken on its own - used when you tap it out of the library."""
    program = watchlist.program_name(c.program)
    return _segment(
        c.id, "company", c.name, f"{program} · {c.batch} · {c.sector}",
        [
            f"{c.name}. {c.one_liner}",
            f"Backed by {program}, {c.batch}." if c.program != "breakout" else
            "On the list as a benchmark rather than an accelerator company.",
            c.what_they_do,
            "Traction:", c.traction,
            "Money:", c.funding,
            "Why it matters:", c.why_it_matters,
            "What to steal:", c.founder_angle,
        ],
        {"program": c.program, "program_name": program, "batch": c.batch,
         "sector": c.sector, "tags": c.tags, "momentum": c.momentum,
         "one_liner": c.one_liner, "sources": c.sources},
    )
