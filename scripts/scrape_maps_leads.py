#!/usr/bin/env python3
"""
Scrape Google Maps business listings via ScrapingDog and write a CSV
compatible with AllSorted Pro Lead Database → Import CSV.

Set SCRAPINGDOG_API_KEY in the environment or in a .env file (see load_env).
"""

from __future__ import annotations

import csv
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

# ─────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────
NICHE = "trucking company"
OUTPUT_DIR = Path(__file__).resolve().parent
OUTPUT_FILE = OUTPUT_DIR / f"trucking_leads_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"

# Top 20 US cities by business density
CITIES = [
    ("New York", "NY"),
    ("Los Angeles", "CA"),
    ("Chicago", "IL"),
    ("Houston", "TX"),
    ("Phoenix", "AZ"),
    ("Philadelphia", "PA"),
    ("San Antonio", "TX"),
    ("Dallas", "TX"),
    ("San Diego", "CA"),
    ("Jacksonville", "FL"),
    ("Austin", "TX"),
    ("Fort Worth", "TX"),
    ("Columbus", "OH"),
    ("Charlotte", "NC"),
    ("Indianapolis", "IN"),
    ("San Francisco", "CA"),
    ("Seattle", "WA"),
    ("Denver", "CO"),
    ("Nashville", "TN"),
    ("Memphis", "TN"),
]

# Matches Lead Database import (company required; rest optional)
FIELDNAMES = [
    "company",
    "owner",
    "phone",
    "address",
    "email",
    "category",
    "city",
    "state",
    "country",
    "website",
    "google_maps_rating",
    "notes",
    "source",
]


def load_env() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    here = Path(__file__).resolve().parent
    root = here.parent
    for p in (
        here / ".env",
        root / ".env",
        Path.home() / "Documents" / "Keys" / ".env",
    ):
        if p.is_file():
            load_dotenv(p)
            return


def init_csv() -> None:
    with open(OUTPUT_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
    print(f"[+] Output file: {OUTPUT_FILE}")


def append_rows(rows: list[dict]) -> None:
    with open(OUTPUT_FILE, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writerows(rows)


def scrape_city(city: str, state: str, api_key: str, retries: int = 2):
    query = f"{NICHE} in {city} {state}"
    url = "https://api.scrapingdog.com/google_maps"
    params = {
        "api_key": api_key,
        "query": query,
        "results": 20,
    }

    for attempt in range(retries + 1):
        try:
            resp = requests.get(url, params=params, timeout=30)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code == 429:
                print("  [!] Rate limited — waiting 10s...")
                time.sleep(10)
            else:
                print(f"  [!] Status {resp.status_code} for {city}, {state}")
                return None
        except requests.exceptions.RequestException as e:
            print(f"  [!] Request error: {e}")
            if attempt < retries:
                time.sleep(5)
    return None


def norm_phone_us_ca(p: str) -> str:
    d = "".join(c for c in p if c.isdigit())
    if len(d) == 11 and d[0] == "1":
        d = d[1:]
    if len(d) == 10:
        return f"({d[:3]}) {d[3:6]}-{d[6:]}"
    return p.strip()


def parse_results(data, city: str, state: str) -> list[dict]:
    rows: list[dict] = []
    if not data:
        return rows

    places = (
        data.get("search_results")
        or data.get("local_results")
        or data.get("places")
        or data.get("results")
        or []
    )

    if isinstance(places, dict):
        places = list(places.values())

    for place in places:
        if not isinstance(place, dict):
            continue

        name = place.get("title") or place.get("name") or ""
        if not name:
            continue

        phone = (
            place.get("phone")
            or place.get("phone_number")
            or place.get("formatted_phone_number")
            or ""
        )

        raw_addr = (
            place.get("address")
            or place.get("formatted_address")
            or place.get("vicinity")
            or place.get("full_address")
            or place.get("google_address")
            or place.get("street_address")
            or place.get("snippet")
            or ""
        )
        if isinstance(raw_addr, dict):
            raw_addr = (
                raw_addr.get("full")
                or raw_addr.get("address")
                or raw_addr.get("formatted")
                or ""
            )
        address = str(raw_addr).strip() if raw_addr else ""

        website = place.get("website") or place.get("domain") or ""
        if website and not str(website).startswith("http"):
            website = "https://" + str(website)

        rating = place.get("rating") or place.get("stars") or ""
        reviews = (
            place.get("reviews")
            or place.get("reviews_count")
            or place.get("user_ratings_total")
            or ""
        )

        if not phone:
            continue

        phone = norm_phone_us_ca(phone.strip())

        google_maps_rating = ""
        r_str = str(rating).strip() if rating not in ("", None) else ""
        rv_str = str(reviews).strip() if reviews not in ("", None) else ""
        if r_str and rv_str:
            try:
                n_rev = int(float(rv_str))
            except (TypeError, ValueError):
                n_rev = None
            rev_word = "review" if n_rev == 1 else "reviews"
            google_maps_rating = f"{r_str}★ ({rv_str} {rev_word})"
        elif r_str:
            google_maps_rating = f"{r_str}★"

        rows.append(
            {
                "company": name.strip(),
                "owner": "",
                "phone": phone,
                "address": address.strip() if address else "",
                "email": "",
                "category": NICHE.title(),
                "city": city,
                "state": state,
                "country": "US",
                "website": str(website).strip() if website else "",
                "google_maps_rating": google_maps_rating,
                "notes": "",
                "source": "ScrapingDog / Google Maps",
            }
        )

    return rows


def main() -> None:
    load_env()
    api_key = os.environ.get("SCRAPINGDOG_API_KEY", "").strip()

    print("=" * 50)
    print("  AllSorted Pro Lead Scraper")
    print(f"  Niche : {NICHE.title()}")
    print(f"  Cities: {len(CITIES)}")
    print("=" * 50)

    if not api_key:
        print(
            "\n[!] Set SCRAPINGDOG_API_KEY in your environment or in:\n"
            "    - scripts/.env or clearbooks-landing/.env\n"
            "    - ~/Documents/Keys/.env\n"
        )
        sys.exit(1)

    init_csv()
    total = 0

    for i, (city, state) in enumerate(CITIES, 1):
        print(f"\n[{i}/{len(CITIES)}] Scraping: {city}, {state}...")
        data = scrape_city(city, state, api_key)

        if data is None:
            print("  [-] No data returned — skipping")
            continue

        rows = parse_results(data, city, state)

        if rows:
            append_rows(rows)
            total += len(rows)
            print(f"  [+] {len(rows)} leads found (total: {total})")
        else:
            print("  [-] 0 leads with phone numbers")

        if i < len(CITIES):
            time.sleep(2)

    print("\n" + "=" * 50)
    print(f"  DONE — {total} total leads saved")
    print(f"  File : {OUTPUT_FILE}")
    print("=" * 50)
    print("\n  Import this CSV in the dashboard:")
    print("  Lead Database → Import CSV → paste file contents")


if __name__ == "__main__":
    main()
