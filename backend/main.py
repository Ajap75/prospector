from __future__ import annotations

from datetime import datetime
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException
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
# Pydantic Models (MUST be defined before routes)
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


# --- Tour / Route (MVP) ---

class AutoRouteRequest(BaseModel):
    zone_id: int


class AutoRouteResponse(BaseModel):
    target_ids_ordered: List[int]
    polyline: Optional[Dict[str, Any]] = None  # GeoJSON LineString


# -----------------------------------------------------------------------------
# Healthcheck
# -----------------------------------------------------------------------------

@app.get("/")
def read_root():
    return {"message": "PROSPECTOR backend is running"}


# -----------------------------------------------------------------------------
# Zones
# -----------------------------------------------------------------------------

@app.get("/zones")
def list_zones():
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name FROM zones ORDER BY id;")
            rows = cur.fetchall()

    return {"items": [{"id": r[0], "name": r[1]} for r in rows]}


@app.get("/zones/{zone_id}")
def get_zone(zone_id: int):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, ST_AsGeoJSON(geom)
                FROM zones
                WHERE id = %s
                """,
                (zone_id,),
            )
            row = cur.fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Zone non trouvée")
    if row[2] is None:
        raise HTTPException(status_code=400, detail="Zone non géométrisée (geom NULL)")

    return {
        "item": {
            "id": row[0],
            "name": row[1],
            "geojson": row[2],  # GeoJSON string
        }
    }


# -----------------------------------------------------------------------------
# DPE Targets
# -----------------------------------------------------------------------------

@app.get("/dpe")
def get_dpe(zone_id: Optional[int] = None):
    with get_db() as conn:
        with conn.cursor() as cur:
            if zone_id is not None:
                # 1) Zone existe + geom non NULL
                cur.execute("SELECT geom IS NOT NULL FROM zones WHERE id = %s;", (zone_id,))
                row = cur.fetchone()
                if row is None:
                    raise HTTPException(status_code=404, detail="Zone non trouvée")
                if row[0] is False:
                    raise HTTPException(status_code=400, detail="Zone non géométrisée (geom NULL)")

                # 2) Filtre spatial par polygone
                cur.execute(
                    """
                    SELECT t.id, t.address, t.surface_m2, t.diagnostic_date,
                           t.latitude, t.longitude, t.status, t.next_action_at
                    FROM dpe_targets t
                    JOIN zones z ON z.id = %s
                    WHERE ST_Contains(z.geom, t.geom)
                    ORDER BY t.id;
                    """,
                    (zone_id,),
                )
            else:
                # Fallback dev/debug : tout
                cur.execute(
                    """
                    SELECT id, address, surface_m2, diagnostic_date,
                           latitude, longitude, status, next_action_at
                    FROM dpe_targets
                    ORDER BY id;
                    """
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
def update_dpe_status(dpe_id: int, payload: DpeStatusUpdate):
    new_status = payload.status
    allowed = ["non_traite", "done", "ignore", "done_repasser"]

    if new_status not in allowed:
        raise HTTPException(status_code=400, detail="Statut invalide")

    if new_status == "done_repasser" and payload.next_action_at is None:
        raise HTTPException(status_code=400, detail="next_action_at requis pour done_repasser")

    next_action_at = payload.next_action_at if new_status == "done_repasser" else None

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE dpe_targets
                SET status = %s,
                    next_action_at = %s
                WHERE id = %s
                """,
                (new_status, next_action_at, dpe_id),
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="DPE non trouvé")
        conn.commit()

    return {"success": True, "id": dpe_id, "status": new_status, "next_action_at": next_action_at}


# -----------------------------------------------------------------------------
# Route / Tour (MVP)
# -----------------------------------------------------------------------------

@app.post("/route/auto")
def route_auto(payload: AutoRouteRequest):
    zone_id = payload.zone_id
    X = 8
    POOL_MAX = 50

    with get_db() as conn:
        with conn.cursor() as cur:
            # 1) Zone existe + geom non NULL
            cur.execute("SELECT geom IS NOT NULL FROM zones WHERE id = %s;", (zone_id,))
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="Zone non trouvée")
            if row[0] is False:
                raise HTTPException(status_code=400, detail="Zone non géométrisée (geom NULL)")

            # 2) Pool = non_traite dans la zone (cap POOL_MAX)
            cur.execute(
                """
                SELECT t.id, t.latitude, t.longitude
                FROM dpe_targets t
                JOIN zones z ON z.id = %s
                WHERE t.status = 'non_traite'
                  AND ST_Contains(z.geom, t.geom)
                ORDER BY t.id DESC
                LIMIT %s;
                """,
                (zone_id, POOL_MAX),
            )
            rows = cur.fetchall()

    if not rows:
        return {"target_ids_ordered": [], "polyline": None}

    points = [{"id": r[0], "lat": r[1], "lng": r[2]} for r in rows]

    # Heuristique MVP : "nearest neighbor" successive
    def dist2(a, b):
        dx = a["lng"] - b["lng"]
        dy = a["lat"] - b["lat"]
        return dx * dx + dy * dy

    ordered = [points[0]]
    remaining = points[1:]

    while remaining and len(ordered) < X:
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

    # GeoJSON LineString = [lng, lat]
    coords = [[p["lng"], p["lat"]] for p in ordered]
    polyline = {"type": "LineString", "coordinates": coords} if len(coords) >= 2 else None

    return {"target_ids_ordered": ids, "polyline": polyline}


# -----------------------------------------------------------------------------
# Notes
# -----------------------------------------------------------------------------

@app.get("/notes")
def list_notes(address: str):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, dpe_id, address, content, tags, pinned, created_at
                FROM notes
                WHERE address = %s
                ORDER BY pinned DESC, created_at DESC;
                """,
                (address,),
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
    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Contenu de note vide")

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO notes (dpe_id, address, content, tags, pinned)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, dpe_id, address, content, tags, pinned, created_at;
                """,
                (payload.dpe_id, payload.address, content, payload.tags, payload.pinned),
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
