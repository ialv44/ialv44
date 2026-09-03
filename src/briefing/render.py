"""Turn an episode into the things you actually use: a page, a page-sized JSON, notes."""

from __future__ import annotations

import json
from pathlib import Path

from .model import Watchlist
from .script import Episode, company_solo

PLACEHOLDER = "/*__BRIEF_DATA__*/"


def payload(episode: Episode, watchlist: Watchlist) -> dict:
    library = []
    for c in watchlist.companies:
        solo = company_solo(c, watchlist)
        library.append({
            "id": c.id, "name": c.name, "program": c.program, "batch": c.batch,
            "sector": c.sector, "one_liner": c.one_liner, "momentum": c.momentum,
            "tags": c.tags, "speak": solo.speak, "seconds": solo.seconds,
        })
    return {
        "episode": episode.to_dict(),
        "library": library,
        "programs": watchlist.programs,
        "curated_on": watchlist.curated_on,
    }


def html(episode: Episode, watchlist: Watchlist, template: Path) -> str:
    source = template.read_text(encoding="utf-8")
    if PLACEHOLDER not in source:
        raise ValueError(f"{template} has no {PLACEHOLDER} marker")
    data = json.dumps(payload(episode, watchlist), ensure_ascii=False)
    # Guard against the JSON closing the surrounding <script> element.
    data = data.replace("</", "<\\/")
    head, _, tail = source.partition(PLACEHOLDER)
    tail = tail[tail.index("{"):] if tail.lstrip().startswith("{") else tail
    # Drop the inert fallback literal that follows the marker in the template.
    depth, cut = 0, 0
    for i, ch in enumerate(tail):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                cut = i + 1
                break
    return head + data + tail[cut:]


def markdown(episode: Episode, watchlist: Watchlist) -> str:
    lines = [f"# {episode.title}", "",
             f"_{episode.seconds // 60} min {episode.seconds % 60} s · "
             f"{sum(1 for s in episode.segments if s.kind == 'company')} companies_", ""]
    for segment in episode.segments:
        if segment.kind == "company":
            company = watchlist.by_id(segment.id)
            lines += [
                f"## {company.name}",
                f"**{watchlist.program_name(company.program)} · {company.batch} · "
                f"{company.sector}** — {company.one_liner}", "",
                company.what_they_do, "",
                f"- **Traction.** {company.traction}",
                f"- **Money.** {company.funding}",
                f"- **Why it matters.** {company.why_it_matters}",
                f"- **Steal this.** {company.founder_angle}",
                "",
                "Sources: " + ", ".join(f"<{s}>" for s in company.sources), "",
            ]
        else:
            lines += [f"## {segment.heading}", segment.speak, ""]
    return "\n".join(lines)


def write_all(episode: Episode, watchlist: Watchlist, out_dir: Path,
              template: Path) -> dict[str, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written = {
        "html": out_dir / f"brief-{episode.date}.html",
        "markdown": out_dir / f"brief-{episode.date}.md",
        "json": out_dir / f"brief-{episode.date}.json",
    }
    written["html"].write_text(html(episode, watchlist, template), encoding="utf-8")
    written["markdown"].write_text(markdown(episode, watchlist), encoding="utf-8")
    written["json"].write_text(
        json.dumps(episode.to_dict(), indent=2, ensure_ascii=False), encoding="utf-8")
    latest = out_dir / "index.html"
    latest.write_text(written["html"].read_text(encoding="utf-8"), encoding="utf-8")
    written["latest"] = latest
    return written
