from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from db import get_db  # 👈 nouveau
from pydantic import BaseModel
from fastapi import HTTPException
from typing import Optional



app = FastAPI()

# 👇 On autorise ton frontend à appeler ton backend
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,  # seules ces origines sont autorisées
    allow_credentials=True,
    allow_methods=["*"],  # toutes les méthodes (GET, POST, etc.)
    allow_headers=["*"],  # tous les headers
)


class DpeStatusUpdate(BaseModel):
    status: str


@app.get("/")
def read_root():
    return {"message": "PROSPECTOR backend is running"}


@app.get("/dpe")
def get_dpe(zone_id: Optional[int] = None):
    with get_db() as conn:
        with conn.cursor() as cur:
            if zone_id is not None:
                # On récupère la zone demandée
                cur.execute(
                    """
                    SELECT min_lat, max_lat, min_lng, max_lng
                    FROM zones
                    WHERE id = %s
                    """,
                    (zone_id,),
                )
                zone = cur.fetchone()
                if zone is None:
                    raise HTTPException(status_code=404, detail="Zone non trouvée")

                min_lat, max_lat, min_lng, max_lng = zone

                # On récupère uniquement les DPE dans cette zone
                cur.execute(
                    """
                    SELECT id, address, surface_m2, diagnostic_date, latitude, longitude, status
                    FROM dpe_targets
                    WHERE latitude BETWEEN %s AND %s
                      AND longitude BETWEEN %s AND %s
                    ORDER BY id;
                    """,
                    (min_lat, max_lat, min_lng, max_lng),
                )
            else:
                # Comportement par défaut : tous les DPE
                cur.execute(
                    """
                    SELECT id, address, surface_m2, diagnostic_date, latitude, longitude, status
                    FROM dpe_targets
                    ORDER BY id;
                    """
                )

            rows = cur.fetchall()

    items = []
    for row in rows:
        dpe = {
            "id": row[0],
            "address": row[1],
            "surface": float(row[2]) if row[2] is not None else None,
            "date": row[3].isoformat() if row[3] is not None else None,
            "latitude": row[4],
            "longitude": row[5],
            "status": row[6],
        }
        items.append(dpe)

    return {"items": items}



@app.post("/dpe/{dpe_id}/status")
def update_dpe_status(dpe_id: int, payload: DpeStatusUpdate):
    new_status = payload.status

    if new_status not in ["non_traite", "done", "ignore"]:
        raise HTTPException(status_code=400, detail="Statut invalide")

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE dpe_targets SET status = %s WHERE id = %s",
                (new_status, dpe_id),
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="DPE non trouvé")
        conn.commit()

    return {"success": True, "id": dpe_id, "status": new_status}


@app.get("/zones")
def list_zones():
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name FROM zones ORDER BY id;")
            rows = cur.fetchall()

    return {"items": [{"id": r[0], "name": r[1]} for r in rows]}


class NoteCreate(BaseModel):
    address: str
    content: str
    dpe_id: Optional[int] = None
    pinned: bool = False
    tags: Optional[str] = None

@app.post("/notes")
def create_note(payload: NoteCreate):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO notes (dpe_id, address, content, tags, pinned)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, dpe_id, address, content, tags, pinned, created_at;
                """,
                (payload.dpe_id, payload.address, payload.content, payload.tags, payload.pinned),
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

