CREATE TABLE IF NOT EXISTS dpe_targets (
    id SERIAL PRIMARY KEY,
    address TEXT NOT NULL,
    surface_m2 NUMERIC,
    diagnostic_date DATE,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION
    status TEXT NOT NULL
);
