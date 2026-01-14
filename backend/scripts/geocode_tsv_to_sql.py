#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Geocode a TSV (targets) using BAN (api-adresse.data.gouv.fr) and generate SQL inserts.

Usage:
  python3 scripts/geocode_tsv_to_sql.py data/targets.tsv data/targets_insert.sql --agency-id 1 --reset
  psql -d prospector -f data/targets_insert.sql

Your TSV columns (header):
  date_dpe    adresse    complement_logement    surface_m2    etage

Common columns supported (case-insensitive, tolerant):
  - diagnostic_date | diagnosticDate | date | date_dpe
  - address | adresse
  - address_extra | complement | complement_raw | complement_logement
  - surface_m2 | surface
  - etage_raw | etage | floor | level
"""

import argparse
import csv
import re
import sys
import time
from typing import Dict, List, Optional, Tuple

import requests

BAN_URL = "https://api-adresse.data.gouv.fr/search/"


# ---------------------------
# SQL helpers
# ---------------------------

def sql_quote(s: Optional[str]) -> str:
    """SQL single-quote escaping. Returns NULL if None/empty after trim."""
    if s is None:
        return "NULL"
    s2 = str(s).strip()
    if s2 == "":
        return "NULL"
    return "'" + s2.replace("'", "''") + "'"


def sql_num(x: Optional[str]) -> str:
    """Numeric SQL literal or NULL."""
    if x is None:
        return "NULL"
    s = str(x).strip()
    if s == "":
        return "NULL"
    s = s.replace(",", ".")
    try:
        float(s)
        return s
    except ValueError:
        return "NULL"


def sql_int(x: Optional[str], default: int = 0) -> int:
    if x is None:
        return default
    s = str(x).strip()
    if s == "":
        return default
    s = s.replace(",", ".")
    try:
        # Accept "5.0"
        return int(float(s))
    except ValueError:
        return default


# ---------------------------
# TSV helpers
# ---------------------------

def normalize_colname(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (s or "").strip().lower()).strip("_")


def looks_like_header(row: List[str]) -> bool:
    """Heuristic: header row usually contains keywords."""
    joined = " ".join((c or "").lower() for c in row)
    header_markers = [
        "address", "adresse",
        "surface", "etage", "floor",
        "diagnostic", "date", "date_dpe",
        "complement", "complement_logement",
    ]
    return any(m in joined for m in header_markers)


def pick_col(cols: Dict[str, int], candidates: List[str]) -> Optional[int]:
    for c in candidates:
        if c in cols:
            return cols[c]
    return None


def parse_date_maybe(s: Optional[str]) -> Optional[str]:
    """
    Return YYYY-MM-DD or None.
    We keep it simple for demo: accept only ISO (YYYY-MM-DD).
    """
    if s is None:
        return None
    s = str(s).strip()
    if not s:
        return None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", s)
    if not m:
        return None
    return s


def safe_get_row(r: List[str], idx: Optional[int]) -> Optional[str]:
    if idx is None:
        return None
    if idx < 0 or idx >= len(r):
        return None
    return r[idx]


# ---------------------------
# Geocoding
# ---------------------------

def geocode_ban(address: str, sleep_s: float = 0.08) -> Optional[Tuple[float, float]]:
    """
    Returns (lat, lon) or None.
    BAN returns coords [lon, lat]
    """
    q = (address or "").strip()
    if not q:
        return None

    headers = {
        "User-Agent": "prospector-demo/1.0 (contact: antoine@maisonastruc.com)",
        "Accept": "application/json",
    }
    params = {"q": q, "limit": 1}

    try:
        r = requests.get(BAN_URL, params=params, headers=headers, timeout=15)
        if r.status_code != 200:
            return None
        data = r.json()
        feats = data.get("features") or []
        if not feats:
            return None
        lon, lat = feats[0]["geometry"]["coordinates"]
        return float(lat), float(lon)
    except Exception:
        return None
    finally:
        time.sleep(sleep_s)


# ---------------------------
# Main
# ---------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("input_tsv", help="Path to input TSV file")
    ap.add_argument("output_sql", help="Path to output SQL file")
    ap.add_argument("--agency-id", type=int, default=1, help="agency_id to fill agency_targets")
    ap.add_argument("--no-agency-overlay", action="store_true", help="Do not insert into agency_targets")
    ap.add_argument("--sleep", type=float, default=0.08, help="Sleep between geocoding requests")
    ap.add_argument("--limit", type=int, default=0, help="Limit number of rows processed (0 = all)")
    ap.add_argument("--debug", action="store_true", help="Print detected columns + sample extracted values")
    ap.add_argument("--reset", action="store_true", help="Generate SQL that truncates tables before inserting (demo mode)")
    args = ap.parse_args()

    # Read TSV rows
    rows: List[List[str]] = []
    with open(args.input_tsv, "r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f, delimiter="\t")
        for r in reader:
            if not r or all((c or "").strip() == "" for c in r):
                continue
            rows.append(r)

    if not rows:
        print("No rows found in TSV.", file=sys.stderr)
        return 1

    # Detect header
    header = None
    start_idx = 0
    if looks_like_header(rows[0]):
        header = [normalize_colname(c) for c in rows[0]]
        start_idx = 1

    # Build column mapping if header
    col_idx: Dict[str, int] = {}
    if header:
        for i, name in enumerate(header):
            col_idx[name] = i

    # Column indices
    idx_address = pick_col(col_idx, ["adresse", "address"])
    idx_extra = pick_col(col_idx, [
        "complement_logement",
        "address_extra", "adresse_extra",
        "complement", "complement_raw"
    ])
    idx_surface = pick_col(col_idx, ["surface_m2", "surface"])
    idx_date = pick_col(col_idx, ["date_dpe", "diagnostic_date", "diagnosticdate", "date"])
    idx_floor = pick_col(col_idx, ["etage", "etage_raw", "floor", "level"])

    # Fallback if NO header (position-based)
    # your layout (if ever): date_dpe | adresse | complement_logement | surface_m2 | etage
    if header is None:
        idx_date = 0
        idx_address = 1
        idx_extra = 2
        idx_surface = 3
        idx_floor = 4

    if args.debug:
        print("=== DEBUG: header_detected =", bool(header), file=sys.stderr)
        if header:
            print("=== DEBUG: normalized header =", header, file=sys.stderr)
        print(
            "=== DEBUG: idx_date=%s idx_address=%s idx_extra=%s idx_surface=%s idx_floor=%s"
            % (idx_date, idx_address, idx_extra, idx_surface, idx_floor),
            file=sys.stderr,
        )
        # show first 3 raw rows (data)
        for i, r in enumerate(rows[start_idx:start_idx + 3], start=1):
            addr = (safe_get_row(r, idx_address) or "").strip()
            extra = (safe_get_row(r, idx_extra) or "").strip()
            surf = (safe_get_row(r, idx_surface) or "").strip()
            floor = (safe_get_row(r, idx_floor) or "").strip()
            d = (safe_get_row(r, idx_date) or "").strip()
            print(f"=== DEBUG row#{i}: date='{d}' address='{addr}' extra='{extra}' surface='{surf}' floor='{floor}'", file=sys.stderr)

    inserts: List[str] = []
    ok = 0
    ko = 0
    seen_keys = set()

    max_rows = args.limit if args.limit and args.limit > 0 else None

    for n, r in enumerate(rows[start_idx:], start=1):
        if max_rows and (ok + ko) >= max_rows:
            break

        address = (safe_get_row(r, idx_address) or "").strip()
        if not address:
            ko += 1
            continue

        diagnostic_date = parse_date_maybe(safe_get_row(r, idx_date))
        surface = safe_get_row(r, idx_surface)
        extra = safe_get_row(r, idx_extra)
        etage_raw = sql_int(safe_get_row(r, idx_floor), default=0)

        # SAFE policy:
        # - keep raw (no merge)
        # - complement_raw = complement_logement (raw)
        address_extra = (extra or "").strip() or None
        complement_raw = address_extra  # identical for MVP demo, as decided

        # Optional norm placeholders (not used as truth)
        floor_norm = etage_raw if etage_raw > 0 else None
        complement_norm = (complement_raw.strip() if complement_raw else None)

        # Dedup exact duplicates ONLY (keep different complement/floor)
        key = (
            address.lower(),
            (address_extra or "").lower(),
            etage_raw,
            (complement_raw or "").lower(),
        )
        if key in seen_keys:
            continue
        seen_keys.add(key)

        # Geocode on base address only (reliable)
        coords = geocode_ban(address, sleep_s=args.sleep)
        if coords is None:
            ko += 1
            print(f"[KO] {address}", file=sys.stderr)
            continue

        lat, lon = coords
        ok += 1
        print(f"[OK] {address} -> {lat:.6f},{lon:.6f}", file=sys.stderr)

        inserts.append(
            "  ("
            f"{sql_quote(address)}, "
            f"{sql_num(surface)}, "
            f"{sql_quote(diagnostic_date)}, "
            f"{sql_num(str(lat))}, "
            f"{sql_num(str(lon))}, "
            f"ST_SetSRID(ST_MakePoint({lon}, {lat}), 4326), "
            f"{sql_quote(address_extra)}, "
            f"{etage_raw}, "
            f"{sql_quote(complement_raw)}, "
            f"{'NULL' if floor_norm is None else str(floor_norm)}, "
            f"{sql_quote(complement_norm)}, "
            f"'non_traite'"
            ")"
        )

    if ok == 0:
        print("No rows geocoded successfully, no SQL produced.", file=sys.stderr)
        return 2

    with open(args.output_sql, "w", encoding="utf-8") as out:
        out.write("-- Auto-generated by scripts/geocode_tsv_to_sql.py\n")
        out.write(f"-- OK={ok}  KO={ko}\n")
        out.write("BEGIN;\n\n")

        if args.reset:
            out.write("-- DEMO RESET (safe for demo DB)\n")
            out.write("TRUNCATE agency_targets RESTART IDENTITY CASCADE;\n")
            out.write("TRUNCATE dpe_targets RESTART IDENTITY CASCADE;\n\n")

        out.write("INSERT INTO dpe_targets (\n")
        out.write("  address,\n")
        out.write("  surface_m2,\n")
        out.write("  diagnostic_date,\n")
        out.write("  latitude,\n")
        out.write("  longitude,\n")
        out.write("  geom,\n")
        out.write("  address_extra,\n")
        out.write("  etage_raw,\n")
        out.write("  complement_raw,\n")
        out.write("  floor_norm,\n")
        out.write("  complement_norm,\n")
        out.write("  status\n")
        out.write(") VALUES\n")
        out.write(",\n".join(inserts))
        out.write(";\n\n")

        if not args.no_agency_overlay:
            out.write(f"-- Recreate overlay agency_targets for agency_id={args.agency_id}\n")
            out.write("INSERT INTO agency_targets (agency_id, dpe_target_id, status, next_action_at, updated_at)\n")
            out.write(f"SELECT {args.agency_id}, id, status, next_action_at, now()\n")
            out.write("FROM dpe_targets\n")
            out.write("ORDER BY id;\n\n")

        out.write("COMMIT;\n")

    print(f"Done. Wrote SQL: {args.output_sql} (OK={ok}, KO={ko})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
