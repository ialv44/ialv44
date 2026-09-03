"""Podcast RSS, so the brief lands in whatever app you already drive with."""

from __future__ import annotations

from datetime import datetime, timezone
from email.utils import format_datetime
from pathlib import Path
from xml.etree import ElementTree as ET

ITUNES = "http://www.itunes.com/dtds/podcast-1.0.dtd"


def _rfc2822(iso_date: str) -> str:
    stamp = datetime.fromisoformat(iso_date).replace(hour=6, tzinfo=timezone.utc)
    return format_datetime(stamp)


def build(episodes: list[dict], base_url: str, title: str = "Your Startup Brief",
          author: str = "Daily Startup Briefings") -> str:
    """`episodes` are dicts of {date, title, seconds, audio (filename), summary}."""
    ET.register_namespace("itunes", ITUNES)
    rss = ET.Element("rss", {"version": "2.0"})
    channel = ET.SubElement(rss, "channel")
    base = base_url.rstrip("/")

    ET.SubElement(channel, "title").text = title
    ET.SubElement(channel, "link").text = base
    ET.SubElement(channel, "language").text = "en-us"
    ET.SubElement(channel, "description").text = (
        "A daily, listenable briefing on funded and fast-moving startups from "
        "Y Combinator, a16z Speedrun, HF0 and beyond."
    )
    ET.SubElement(channel, f"{{{ITUNES}}}author").text = author
    ET.SubElement(channel, f"{{{ITUNES}}}explicit").text = "false"

    for episode in sorted(episodes, key=lambda e: e["date"], reverse=True):
        item = ET.SubElement(channel, "item")
        ET.SubElement(item, "title").text = episode["title"]
        ET.SubElement(item, "description").text = episode.get("summary", episode["title"])
        ET.SubElement(item, "pubDate").text = _rfc2822(episode["date"])
        ET.SubElement(item, "guid", {"isPermaLink": "false"}).text = f"brief-{episode['date']}"
        ET.SubElement(item, f"{{{ITUNES}}}duration").text = str(episode.get("seconds", 0))
        if episode.get("audio"):
            ET.SubElement(item, "enclosure", {
                "url": f"{base}/{episode['audio'].lstrip('/')}",
                "type": "audio/mpeg",
                "length": str(episode.get("bytes", 0)),
            })
    return ET.tostring(rss, encoding="unicode", xml_declaration=True)


def write(path: Path, episodes: list[dict], base_url: str, **kwargs) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(build(episodes, base_url, **kwargs), encoding="utf-8")
    return path
