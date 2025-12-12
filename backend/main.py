from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from db import get_db  # 👈 nouveau
from pydantic import BaseModel
from fastapi import HTTPException


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
def get_dpe():
    """
    Lit les DPE depuis la base PostgreSQL et les renvoie au frontend.
    """
    with get_db() as conn:
        with conn.cursor() as cur:
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
