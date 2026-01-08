"""
─────────────────────────────────────────────────────────────
Project : prospector
File    : main.py
Author  : Antoine Astruc
Email   : antoine@maisonastruc.fr
Created : 2026-01-08
License : MIT
─────────────────────────────────────────────────────────────
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional, List, Dict, Any, Tuple

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from db import get_db

# -----------------------------------------------------------------------------
# App + Middleware
# -----------------------------------------------------------------------------

app = FastAPI()

origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------------------------------------------------------------------
# DEV CONTEXT (no-auth MVP)
# -----------------------------------------------------------------------------
# En prod: user_id vient du token/session.
DEV_USER_ID = 1

TOUR_MAX = 8
POOL_MAX = 50

# -----------------------------------------------------------------------------
# Pydantic Models
# -----------------------------------------------------------------------------

class DpeStatusUpdate(BaseModel):
    status: str
    next_action_at: Optional[datetime] = None


class NoteCreate(BaseModel):
    address: str
    content: str
    dpe_id: Optional[int] = None
    pinned: bool = False
    tags: Optional[str] = None
    user_id: Optional[int] = None  # MVP no-auth


class AutoRouteRequest(BaseModel):
    user_id: Optional[int] = None  # MVP no-auth


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

def _resolve_user_id(user_id: Optional[int]) -> int:
    return int(user_id) if user_id is not None else DEV_USER_ID


def _get_user_agency(cur, user_id: int) -> int:
    cur.execute("SELECT agency_id FROM users WHERE id = %s;", (user_id,))
    row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="User inconnu")
    return row[0]


def _user_has_territory(cur, user_id: int) -> bool:
    cur.execute("SELECT 1 FROM user_territories WHERE user_id = %s LIMIT 1;", (user_id,))
    return cur.fetchone() is not None


def _get_primary_agency_zone(cur, agency_id: int) -> Optional[int]:
    """
    MVP: une agence (BU) a 1+ zones; on prend la première.
    Plus tard: agence peut en avoir plusieurs + UI manager.
    """
    cur.execute(
        """
        SELECT zone_id
        FROM agency_zones
        WHERE agency_id = %s
        ORDER BY zone_id ASC
        LIMIT 1;
        """,
        (agency_id,),
    )
    row = cur.fetchone()
    return row[0] if row else None


def _get_zone_geojson(cur, zone_id: int) -> Tuple[int, str, str]:
    cur.execute(
        """
        SELECT id, name, ST_AsGeoJSON(geom)
        FROM zones
        WHERE id = %s;
        """,
        (zone_id,),
    )
    row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Zone non trouvée")
    if row[2] is None:
        raise HTTPException(status_code=400, detail="Zone non géométrisée (geom NULL)")
    return row[0], row[1], row[2]


# -----------------------------------------------------------------------------
# Healthcheck
# -----------------------------------------------------------------------------

@app.get("/")
def read_root():
    return {"message": "PROSPECTOR backend is running"}


# -----------------------------------------------------------------------------
# Zone effective (celle de la BU de l'agent)
# -----------------------------------------------------------------------------

@app.get("/me/zone")
def get_my_zone(user_id: Optional[int] = Query(default=None)):
    uid = _resolve_user_id(user_id)

    with get_db() as conn:
        with conn.cursor() as cur:
            agency_id = _get_user_agency(cur, uid)
            zone_id = _get_primary_agency_zone(cur, agency_id)
            if zone_id is None:
                # Pas de BU-zone = pas de data
                return {"item": None}

            zid, name, geojson = _get_zone_geojson(cur, zone_id)

    return {"item": {"id": zid, "name": name, "geojson": geojson}}


# -----------------------------------------------------------------------------
# DPE Targets (BU-shared overlay + micro-zone mandatory + surface segmentation)
# -----------------------------------------------------------------------------

@app.get("/dpe")
def get_dpe(user_id: Optional[int] = Query(default=None)):
    uid = _resolve_user_id(user_id)

    with get_db() as conn:
        with conn.cursor() as cur:
            agency_id = _get_user_agency(cur, uid)

            # Décision produit: sans micro-zone => ne voit rien
            if not _user_has_territory(cur, uid):
                return {"items": []}

            zone_id = _get_primary_agency_zone(cur, agency_id)
            if zone_id is None:
                return {"items": []}

            # Projection visible = zone BU ∩ micro-zone user ∩ overlay BU ∩ filtre surface user
            cur.execute(
                """
                SELECT
                  t.id,
                  t.address,
                  t.surface_m2,
                  t.diagnostic_date,
                  t.latitude,
                  t.longitude,
                  at.status,
                  at.next_action_at
                FROM agency_targets at
                JOIN dpe_targets t ON t.id = at.dpe_target_id
                JOIN zones z ON z.id = %s
                JOIN users u ON u.id = %s
                WHERE at.agency_id = %s
                  AND ST_Contains(z.geom, t.geom)
                  AND EXISTS (
                    SELECT 1
                    FROM user_territories ut
                    WHERE ut.user_id = %s
                      AND ST_Intersects(ut.geom, t.geom)
                  )
                  AND (u.min_surface_m2 IS NULL OR t.surface_m2 >= u.min_surface_m2)
                  AND (u.max_surface_m2 IS NULL OR t.surface_m2 <= u.max_surface_m2)
                ORDER BY t.id;
                """,
                (zone_id, uid, agency_id, uid),
            )
            rows = cur.fetchall()

    items = []
    for r in rows:
        items.append(
            {
                "id": r[0],
                "address": r[1],
                "surface": float(r[2]) if r[2] is not None else None,
                "date": r[3].isoformat() if r[3] is not None else None,
                "latitude": r[4],
                "longitude": r[5],
                "status": r[6],
                "next_action_at": r[7].isoformat() if r[7] is not None else None,
            }
        )

    return {"items": items}


@app.post("/dpe/{dpe_id}/status")
def update_dpe_status(
    dpe_id: int,
    payload: DpeStatusUpdate,
    user_id: Optional[int] = Query(default=None),
):
    uid = _resolve_user_id(user_id)
    allowed = ["non_traite", "done", "ignore", "done_repasser"]
    new_status = payload.status

    if new_status not in allowed:
        raise HTTPException(status_code=400, detail="Statut invalide")

    if new_status == "done_repasser" and payload.next_action_at is None:
        raise HTTPException(status_code=400, detail="next_action_at requis pour done_repasser")

    next_action_at = payload.next_action_at if new_status == "done_repasser" else None

    with get_db() as conn:
        with conn.cursor() as cur:
            agency_id = _get_user_agency(cur, uid)

            # update overlay BU-shared, pas dpe_targets
            cur.execute(
                """
                UPDATE agency_targets
                SET status = %s,
                    next_action_at = %s,
                    updated_at = now()
                WHERE agency_id = %s
                  AND dpe_target_id = %s;
                """,
                (new_status, next_action_at, agency_id, dpe_id),
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Target absent de l'overlay agence")
        conn.commit()

    return {"success": True, "id": dpe_id, "status": new_status, "next_action_at": next_action_at}


# -----------------------------------------------------------------------------
# Auto tour (MVP) - overlay BU + micro-zone + segmentation surface
# -----------------------------------------------------------------------------

@app.post("/route/auto")
def route_auto(payload: AutoRouteRequest):
    uid = _resolve_user_id(payload.user_id)

    with get_db() as conn:
        with conn.cursor() as cur:
            agency_id = _get_user_agency(cur, uid)

            if not _user_has_territory(cur, uid):
                return {"target_ids_ordered": [], "polyline": None}

            zone_id = _get_primary_agency_zone(cur, agency_id)
            if zone_id is None:
                return {"target_ids_ordered": [], "polyline": None}

            cur.execute(
                """
                SELECT t.id, t.latitude, t.longitude
                FROM agency_targets at
                JOIN dpe_targets t ON t.id = at.dpe_target_id
                JOIN zones z ON z.id = %s
                JOIN users u ON u.id = %s
                WHERE at.agency_id = %s
                  AND at.status = 'non_traite'
                  AND ST_Contains(z.geom, t.geom)
                  AND EXISTS (
                    SELECT 1
                    FROM user_territories ut
                    WHERE ut.user_id = %s
                      AND ST_Intersects(ut.geom, t.geom)
                  )
                  AND (u.min_surface_m2 IS NULL OR t.surface_m2 >= u.min_surface_m2)
                  AND (u.max_surface_m2 IS NULL OR t.surface_m2 <= u.max_surface_m2)
                ORDER BY t.id DESC
                LIMIT %s;
                """,
                (zone_id, uid, agency_id, uid, POOL_MAX),
            )
            rows = cur.fetchall()

    if not rows:
        return {"target_ids_ordered": [], "polyline": None}

    points = [{"id": r[0], "lat": r[1], "lng": r[2]} for r in rows if r[1] is not None and r[2] is not None]
    if not points:
        return {"target_ids_ordered": [], "polyline": None}

    def dist2(a, b):
        dx = a["lng"] - b["lng"]
        dy = a["lat"] - b["lat"]
        return dx * dx + dy * dy

    ordered = [points[0]]
    remaining = points[1:]

    while remaining and len(ordered) < TOUR_MAX:
        last = ordered[-1]
        best_i = 0
        best_d = dist2(last, remaining[0])
        for i in range(1, len(remaining)):
            d = dist2(last, remaining[i])
            if d < best_d:
                best_d = d
                best_i = i
        ordered.append(remaining.pop(best_i))

    ids = [p["id"] for p in ordered]
    coords = [[p["lng"], p["lat"]] for p in ordered]
    polyline = {"type": "LineString", "coordinates": coords} if len(coords) >= 2 else None

    return {"target_ids_ordered": ids, "polyline": polyline}


# -----------------------------------------------------------------------------
# Notes (BU-shared)
# -----------------------------------------------------------------------------

@app.get("/notes")
def list_notes(address: str, user_id: Optional[int] = Query(default=None)):
    uid = _resolve_user_id(user_id)

    with get_db() as conn:
        with conn.cursor() as cur:
            agency_id = _get_user_agency(cur, uid)
            cur.execute(
                """
                SELECT id, dpe_id, address, content, tags, pinned, created_at
                FROM notes
                WHERE agency_id = %s
                  AND address = %s
                ORDER BY pinned DESC, created_at DESC;
                """,
                (agency_id, address),
            )
            rows = cur.fetchall()

    return {
        "items": [
            {
                "id": r[0],
                "dpe_id": r[1],
                "address": r[2],
                "content": r[3],
                "tags": r[4],
                "pinned": r[5],
                "created_at": r[6].isoformat(),
            }
            for r in rows
        ]
    }


@app.post("/notes")
def create_note(payload: NoteCreate):
    uid = _resolve_user_id(payload.user_id)

    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Contenu de note vide")

    with get_db() as conn:
        with conn.cursor() as cur:
            agency_id = _get_user_agency(cur, uid)
            cur.execute(
                """
                INSERT INTO notes (agency_id, dpe_id, address, content, tags, pinned)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id, dpe_id, address, content, tags, pinned, created_at;
                """,
                (agency_id, payload.dpe_id, payload.address, content, payload.tags, payload.pinned),
            )
            row = cur.fetchone()
        conn.commit()

    return {
        "item": {
            "id": row[0],
            "dpe_id": row[1],
            "address": row[2],
            "content": row[3],
            "tags": row[4],
            "pinned": row[5],
            "created_at": row[6].isoformat(),
        }
    }
