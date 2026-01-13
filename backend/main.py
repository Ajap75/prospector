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

import json
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

# ✅ Keep ONE CORS middleware (your frontend calls backend from localhost:3000)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------------------------------------------------------------------
# DEV CONTEXT (no-auth MVP)
# -----------------------------------------------------------------------------
DEV_USER_ID = 1

# MVP: garde-fou admin ultra simple (à remplacer par auth/roles plus tard)
ADMIN_USER_IDS = {1}  # <- Mets ton id ici (et éventuellement d'autres)

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


# --- Admin payloads (MVP brutal) ------------------------------------------------


class AdminUserCreate(BaseModel):
    name: str
    agency_id: int
    email: Optional[str] = None  # ✅ optionnel
    role: str = "agent"  # ✅ default
    min_surface_m2: Optional[float] = None
    max_surface_m2: Optional[float] = None


class AdminTerritoryUpsert(BaseModel):
    # ✅ Front sends "name" already
    name: str
    # GeoJSON object: Polygon or MultiPolygon (geometry object)
    geojson: Dict[str, Any]


class AdminZoneUpsert(BaseModel):
    name: str
    geojson: Dict[str, Any]


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------


def _resolve_user_id(user_id: Optional[int]) -> int:
    return int(user_id) if user_id is not None else DEV_USER_ID


def _assert_admin(uid: int) -> None:
    if uid not in ADMIN_USER_IDS:
        raise HTTPException(status_code=403, detail="Forbidden (admin only)")


def _get_user_agency(cur, user_id: int) -> int:
    cur.execute("SELECT agency_id FROM users WHERE id = %s;", (user_id,))
    row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="User inconnu")
    return int(row[0])


def _user_has_territory(cur, user_id: int) -> bool:
    cur.execute(
        "SELECT 1 FROM user_territories WHERE user_id = %s LIMIT 1;", (user_id,)
    )
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
    return int(row[0]) if row else None


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
    return int(row[0]), str(row[1]), str(row[2])


def _validate_geojson_polygon(obj: Dict[str, Any]) -> None:
    if not isinstance(obj, dict):
        raise HTTPException(status_code=400, detail="geojson invalide (object attendu)")
    t = obj.get("type")
    if t not in ("Polygon", "MultiPolygon"):
        raise HTTPException(
            status_code=400, detail="geojson doit être Polygon ou MultiPolygon"
        )
    coords = obj.get("coordinates")
    if not isinstance(coords, list) or len(coords) == 0:
        raise HTTPException(status_code=400, detail="geojson.coordinates invalide")


# -----------------------------------------------------------------------------
# Healthcheck
# -----------------------------------------------------------------------------


@app.get("/")
def read_root():
    return {"message": "PROSPECTOR backend is running"}


# -----------------------------------------------------------------------------
# Zone effective (celle de la BU de l'agent) + has_territory
# -----------------------------------------------------------------------------


@app.get("/me/zone")
def get_my_zone(user_id: Optional[int] = Query(default=None)):
    uid = _resolve_user_id(user_id)

    with get_db() as conn:
        with conn.cursor() as cur:
            agency_id = _get_user_agency(cur, uid)
            has_territory = _user_has_territory(cur, uid)

            zone_id = _get_primary_agency_zone(cur, agency_id)
            if zone_id is None:
                return {"item": None, "has_territory": has_territory}

            zid, name, geojson = _get_zone_geojson(cur, zone_id)

    return {
        "item": {"id": zid, "name": name, "geojson": geojson},
        "has_territory": has_territory,
    }


# -----------------------------------------------------------------------------
# ADMIN (MVP brutal) - create users + assign micro-zones
# -----------------------------------------------------------------------------


@app.post("/admin/users")
def admin_create_user(
    payload: AdminUserCreate, admin_user_id: Optional[int] = Query(default=None)
):
    admin_uid = _resolve_user_id(admin_user_id)
    _assert_admin(admin_uid)

    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name requis")

    email = payload.email.strip().lower() if payload.email else None
    if email == "":
        email = None

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO users (agency_id, name, email, role, min_surface_m2, max_surface_m2)
                VALUES (%s, %s, %s, 'agent', %s, %s)
                RETURNING id, agency_id, name, email, role, min_surface_m2, max_surface_m2;
                """,
                (
                    payload.agency_id,
                    name,
                    email,
                    payload.min_surface_m2,
                    payload.max_surface_m2,
                ),
            )
            row = cur.fetchone()
        conn.commit()

    return {
        "item": {
            "id": row[0],
            "agency_id": row[1],
            "name": row[2],
            "email": row[3],
            "role": row[4],
            "min_surface_m2": float(row[5]) if row[5] is not None else None,
            "max_surface_m2": float(row[6]) if row[6] is not None else None,
            "has_territory": False,
        }
    }


@app.get("/admin/users")
def admin_list_users(
    admin_user_id: Optional[int] = Query(default=None), agency_id: int = Query(...)
):
    admin_uid = _resolve_user_id(admin_user_id)
    _assert_admin(admin_uid)

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  u.id,
                  u.agency_id,
                  u.name,
                  u.email,
                  u.role,
                  u.min_surface_m2,
                  u.max_surface_m2,
                  EXISTS (
                    SELECT 1
                    FROM user_territories ut
                    WHERE ut.user_id = u.id AND ut.agency_id = u.agency_id
                  ) AS has_territory
                FROM users u
                WHERE u.agency_id = %s
                ORDER BY u.id;
                """,
                (agency_id,),
            )
            rows = cur.fetchall()

    return {
        "items": [
            {
                "id": r[0],
                "agency_id": r[1],
                "name": r[2],
                "email": r[3],
                "role": r[4],
                "min_surface_m2": float(r[5]) if r[5] is not None else None,
                "max_surface_m2": float(r[6]) if r[6] is not None else None,
                "has_territory": bool(r[7]),
            }
            for r in rows
        ]
    }


@app.get("/admin/users/{user_id}/territory")
def admin_get_user_territory(
    user_id: int, admin_user_id: Optional[int] = Query(default=None)
):
    admin_uid = _resolve_user_id(admin_user_id)
    _assert_admin(admin_uid)

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT name, ST_AsGeoJSON(geom)
                FROM user_territories
                WHERE user_id = %s
                ORDER BY id DESC
                LIMIT 1;
                """,
                (user_id,),
            )
            row = cur.fetchone()

    if not row or row[1] is None:
        return {"item": None}

    return {"item": {"name": row[0], "geojson": row[1]}}


@app.post("/admin/users/{user_id}/territory")
def admin_upsert_user_territory(
    user_id: int,
    payload: AdminTerritoryUpsert,
    admin_user_id: Optional[int] = Query(default=None),
):
    admin_uid = _resolve_user_id(admin_user_id)
    _assert_admin(admin_uid)

    _validate_geojson_polygon(payload.geojson)

    territory_name = (payload.name or "").strip()
    if not territory_name:
        raise HTTPException(status_code=400, detail="name requis")

    with get_db() as conn:
        with conn.cursor() as cur:
            # Ensure user exists + fetch agency_id (required by DB)
            cur.execute("SELECT agency_id FROM users WHERE id = %s;", (user_id,))
            urow = cur.fetchone()
            if urow is None:
                raise HTTPException(status_code=404, detail="User inconnu")
            agency_id = int(urow[0])

            # MVP: 1 micro-zone par user => overwrite
            cur.execute("DELETE FROM user_territories WHERE user_id = %s;", (user_id,))

            geo_str = json.dumps(payload.geojson)

            # ✅ Conform to schema:
            # - agency_id NOT NULL
            # - name NOT NULL
            # - geom MultiPolygon SRID 4326 NOT NULL
            cur.execute(
                """
                INSERT INTO user_territories (user_id, agency_id, name, geom)
                VALUES (
                  %s,
                  %s,
                  %s,
                  ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
                )
                RETURNING id;
                """,
                (user_id, agency_id, territory_name, geo_str),
            )
            tid = cur.fetchone()[0]
        conn.commit()

    return {"success": True, "item": {"id": tid}}


@app.delete("/admin/users/{user_id}/territory")
def admin_delete_user_territory(
    user_id: int, admin_user_id: Optional[int] = Query(default=None)
):
    admin_uid = _resolve_user_id(admin_user_id)
    _assert_admin(admin_uid)

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM user_territories WHERE user_id = %s;", (user_id,))
        conn.commit()

    return {"success": True}


# -----------------------------------------------------------------------------
# Admin - BU Zone (garde-fou) - 1 zone active par agency (MVP overwrite)
# -----------------------------------------------------------------------------


@app.get("/admin/zone")
def admin_get_bu_zone(
    admin_user_id: Optional[int] = Query(default=None),
    agency_id: int = Query(...),
):
    admin_uid = _resolve_user_id(admin_user_id)
    _assert_admin(admin_uid)

    with get_db() as conn:
        with conn.cursor() as cur:
            zone_id = _get_primary_agency_zone(cur, agency_id)
            if zone_id is None:
                return {"item": None}

            zid, name, geojson = _get_zone_geojson(cur, zone_id)

    return {"item": {"id": zid, "name": name, "geojson": geojson}}


@app.post("/admin/zone")
def admin_upsert_bu_zone(
    payload: AdminZoneUpsert,
    admin_user_id: Optional[int] = Query(default=None),
    agency_id: int = Query(...),
):
    admin_uid = _resolve_user_id(admin_user_id)
    _assert_admin(admin_uid)

    _validate_geojson_polygon(payload.geojson)

    zone_name = (payload.name or "").strip()
    if not zone_name:
        raise HTTPException(status_code=400, detail="name requis")

    geo_str = json.dumps(payload.geojson)

    with get_db() as conn:
        with conn.cursor() as cur:
            # MVP: 1 zone active par agency => overwrite association
            existing_zone_id = _get_primary_agency_zone(cur, agency_id)

            if existing_zone_id is None:
                # Create zone
                cur.execute(
                    """
                    WITH g AS (
                    SELECT ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)) AS geom
                    )
                    INSERT INTO zones (name, min_lat, max_lat, min_lng, max_lng, geom)
                    SELECT
                    %s,
                    ST_YMin(geom) AS min_lat,
                    ST_YMax(geom) AS max_lat,
                    ST_XMin(geom) AS min_lng,
                    ST_XMax(geom) AS max_lng,
                    geom
                    FROM g
                    RETURNING id;
                    """,
                    (geo_str, zone_name),
                )
                zid = int(cur.fetchone()[0])

                # Ensure single link for agency
                cur.execute(
                    "DELETE FROM agency_zones WHERE agency_id = %s;", (agency_id,)
                )
                cur.execute(
                    "INSERT INTO agency_zones (agency_id, zone_id) VALUES (%s, %s);",
                    (agency_id, zid),
                )
            else:
                zid = int(existing_zone_id)
                # Update zone geometry + name
                cur.execute(
                    """
                        WITH g AS (
                        SELECT ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)) AS geom
                        )
                        UPDATE zones z
                        SET
                        name = %s,
                        geom = g.geom,
                        min_lat = ST_YMin(g.geom),
                        max_lat = ST_YMax(g.geom),
                        min_lng = ST_XMin(g.geom),
                        max_lng = ST_XMax(g.geom)
                        FROM g
                        WHERE z.id = %s;
                        """,
                    (geo_str, zone_name, zid),
                )
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="Zone non trouvée")

                # Ensure link exists (and unique)
                cur.execute(
                    "DELETE FROM agency_zones WHERE agency_id = %s;", (agency_id,)
                )
                cur.execute(
                    "INSERT INTO agency_zones (agency_id, zone_id) VALUES (%s, %s);",
                    (agency_id, zid),
                )

        conn.commit()

    return {"success": True, "item": {"id": zid}}


@app.delete("/admin/zone")
def admin_delete_bu_zone(
    admin_user_id: Optional[int] = Query(default=None),
    agency_id: int = Query(...),
):
    admin_uid = _resolve_user_id(admin_user_id)
    _assert_admin(admin_uid)

    with get_db() as conn:
        with conn.cursor() as cur:
            # remove association (non destructive for zones table)
            cur.execute("DELETE FROM agency_zones WHERE agency_id = %s;", (agency_id,))
        conn.commit()

    return {"success": True}


# -----------------------------------------------------------------------------
# Admin - list micro-zones for a BU (agency)
# -----------------------------------------------------------------------------


@app.get("/admin/territories")
def admin_list_territories(
    admin_user_id: int = Query(...),
    agency_id: int = Query(...),
):
    _ = _resolve_user_id(admin_user_id)

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  ut.id,
                  ut.user_id,
                  u.name,
                  ut.name,
                  ST_AsGeoJSON(ut.geom)
                FROM user_territories ut
                JOIN users u ON u.id = ut.user_id
                WHERE ut.agency_id = %s
                ORDER BY ut.user_id ASC, ut.id ASC;
                """,
                (agency_id,),
            )
            rows = cur.fetchall()

    items = []
    for r in rows:
        items.append(
            {
                "id": r[0],
                "user_id": r[1],
                "user_name": r[2],
                "name": r[3],
                "geojson": r[4],  # string
            }
        )

    return {"items": items}


# -----------------------------------------------------------------------------
# DPE Targets (BU-shared overlay + micro-zone mandatory + surface segmentation)
# -----------------------------------------------------------------------------


@app.get("/dpe")
def get_dpe(user_id: Optional[int] = Query(default=None)):
    uid = _resolve_user_id(user_id)

    with get_db() as conn:
        with conn.cursor() as cur:
            agency_id = _get_user_agency(cur, uid)

            if not _user_has_territory(cur, uid):
                return {"items": []}

            zone_id = _get_primary_agency_zone(cur, agency_id)
            if zone_id is None:
                return {"items": []}

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
        raise HTTPException(
            status_code=400, detail="next_action_at requis pour done_repasser"
        )

    next_action_at = payload.next_action_at if new_status == "done_repasser" else None

    with get_db() as conn:
        with conn.cursor() as cur:
            agency_id = _get_user_agency(cur, uid)

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
                raise HTTPException(
                    status_code=404, detail="Target absent de l'overlay agence"
                )
        conn.commit()

    return {
        "success": True,
        "id": dpe_id,
        "status": new_status,
        "next_action_at": next_action_at,
    }


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

    points = [
        {"id": r[0], "lat": r[1], "lng": r[2]}
        for r in rows
        if r[1] is not None and r[2] is not None
    ]
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
    polyline = (
        {"type": "LineString", "coordinates": coords} if len(coords) >= 2 else None
    )

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
                (
                    agency_id,
                    payload.dpe_id,
                    payload.address,
                    content,
                    payload.tags,
                    payload.pinned,
                ),
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
