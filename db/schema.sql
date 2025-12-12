-- =========================
-- RESET (DEV ONLY)
-- =========================
DROP TABLE IF EXISTS notes CASCADE;
DROP TABLE IF EXISTS dpe_targets CASCADE;
DROP TABLE IF EXISTS zones CASCADE;

-- =========================
-- ZONES
-- =========================
CREATE TABLE zones (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL
);

-- =========================
-- DPE TARGETS
-- =========================
CREATE TABLE dpe_targets (
    id SERIAL PRIMARY KEY,
    address TEXT NOT NULL,
    surface_m2 NUMERIC,
    diagnostic_date DATE,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    status TEXT NOT NULL DEFAULT 'non_traite',
    zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL
);

CREATE INDEX idx_dpe_zone_id ON dpe_targets(zone_id);
CREATE INDEX idx_dpe_address ON dpe_targets(address);

-- =========================
-- NOTES (par DPE + par ADRESSE)
-- =========================
CREATE TABLE notes (
    id SERIAL PRIMARY KEY,
    address TEXT NOT NULL,
    dpe_id INTEGER REFERENCES dpe_targets(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    tags TEXT,
    pinned BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_notes_address ON notes(address);
CREATE INDEX idx_notes_dpe_id ON notes(dpe_id);

-- =========================
-- DATA DE DEV (OPTIONNEL)
-- =========================
INSERT INTO zones (name) VALUES
('Zone Paris Centre'),
('Zone Test Vide');

