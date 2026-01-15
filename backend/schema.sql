--
-- PostgreSQL database dump
--

\restrict NgNXxSjszu461hNdkACBLaQy080wNUcCxBbA1cZ9geqPYavwdSo0NoPAHhVfoLk

-- Dumped from database version 18.1 (Postgres.app)
-- Dumped by pg_dump version 18.1 (Postgres.app)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: prospecting_mode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.prospecting_mode AS ENUM (
    'SEGMENTED',
    'OPEN'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: agencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agencies (
    id integer NOT NULL,
    org_id integer NOT NULL,
    name text NOT NULL,
    mode public.prospecting_mode DEFAULT 'SEGMENTED'::public.prospecting_mode NOT NULL
);


--
-- Name: agencies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agencies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agencies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agencies_id_seq OWNED BY public.agencies.id;


--
-- Name: agency_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agency_targets (
    id integer NOT NULL,
    agency_id integer NOT NULL,
    dpe_target_id integer NOT NULL,
    status text DEFAULT 'non_traite'::text NOT NULL,
    next_action_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agency_targets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agency_targets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agency_targets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agency_targets_id_seq OWNED BY public.agency_targets.id;


--
-- Name: agency_zones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agency_zones (
    agency_id integer NOT NULL,
    zone_id integer NOT NULL
);


--
-- Name: dpe_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dpe_targets (
    id integer NOT NULL,
    address text NOT NULL,
    surface_m2 numeric,
    diagnostic_date date,
    latitude double precision,
    longitude double precision,
    status text DEFAULT 'non_traite'::text,
    next_action_at timestamp with time zone,
    geom public.geometry(Point,4326),
    address_extra text,
    etage_raw integer DEFAULT 0 NOT NULL,
    complement_raw text,
    floor_norm integer,
    complement_norm text,
    CONSTRAINT dpe_targets_geom_not_null CHECK ((geom IS NOT NULL))
);


--
-- Name: dpe_targets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dpe_targets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dpe_targets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dpe_targets_id_seq OWNED BY public.dpe_targets.id;


--
-- Name: notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notes (
    id integer NOT NULL,
    dpe_id integer,
    address text NOT NULL,
    content text NOT NULL,
    tags text,
    pinned boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    agency_id integer NOT NULL
);


--
-- Name: notes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notes_id_seq OWNED BY public.notes.id;


--
-- Name: orgs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orgs (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: orgs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.orgs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: orgs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.orgs_id_seq OWNED BY public.orgs.id;


--
-- Name: user_territories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_territories (
    id integer NOT NULL,
    user_id integer NOT NULL,
    agency_id integer NOT NULL,
    name text NOT NULL,
    geom public.geometry(MultiPolygon,4326) NOT NULL
);


--
-- Name: user_territories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_territories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_territories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_territories_id_seq OWNED BY public.user_territories.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    agency_id integer NOT NULL,
    name text NOT NULL,
    min_surface_m2 numeric,
    max_surface_m2 numeric,
    email text,
    role text DEFAULT 'agent'::text NOT NULL
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: zones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zones (
    id integer NOT NULL,
    name text NOT NULL,
    min_lat double precision NOT NULL,
    max_lat double precision NOT NULL,
    min_lng double precision NOT NULL,
    max_lng double precision NOT NULL,
    geom public.geometry(MultiPolygon,4326)
);


--
-- Name: zones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.zones_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: zones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.zones_id_seq OWNED BY public.zones.id;


--
-- Name: agencies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agencies ALTER COLUMN id SET DEFAULT nextval('public.agencies_id_seq'::regclass);


--
-- Name: agency_targets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_targets ALTER COLUMN id SET DEFAULT nextval('public.agency_targets_id_seq'::regclass);


--
-- Name: dpe_targets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dpe_targets ALTER COLUMN id SET DEFAULT nextval('public.dpe_targets_id_seq'::regclass);


--
-- Name: notes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes ALTER COLUMN id SET DEFAULT nextval('public.notes_id_seq'::regclass);


--
-- Name: orgs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orgs ALTER COLUMN id SET DEFAULT nextval('public.orgs_id_seq'::regclass);


--
-- Name: user_territories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_territories ALTER COLUMN id SET DEFAULT nextval('public.user_territories_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: zones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zones ALTER COLUMN id SET DEFAULT nextval('public.zones_id_seq'::regclass);


--
-- Name: agencies agencies_org_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agencies
    ADD CONSTRAINT agencies_org_id_name_key UNIQUE (org_id, name);


--
-- Name: agencies agencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agencies
    ADD CONSTRAINT agencies_pkey PRIMARY KEY (id);


--
-- Name: agency_targets agency_targets_agency_id_dpe_target_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_targets
    ADD CONSTRAINT agency_targets_agency_id_dpe_target_id_key UNIQUE (agency_id, dpe_target_id);


--
-- Name: agency_targets agency_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_targets
    ADD CONSTRAINT agency_targets_pkey PRIMARY KEY (id);


--
-- Name: agency_zones agency_zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_zones
    ADD CONSTRAINT agency_zones_pkey PRIMARY KEY (agency_id, zone_id);


--
-- Name: dpe_targets dpe_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dpe_targets
    ADD CONSTRAINT dpe_targets_pkey PRIMARY KEY (id);


--
-- Name: notes notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_pkey PRIMARY KEY (id);


--
-- Name: orgs orgs_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orgs
    ADD CONSTRAINT orgs_name_key UNIQUE (name);


--
-- Name: orgs orgs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orgs
    ADD CONSTRAINT orgs_pkey PRIMARY KEY (id);


--
-- Name: user_territories user_territories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_territories
    ADD CONSTRAINT user_territories_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: zones zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zones
    ADD CONSTRAINT zones_pkey PRIMARY KEY (id);


--
-- Name: dpe_targets_address_extra_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dpe_targets_address_extra_idx ON public.dpe_targets USING btree (address_extra);


--
-- Name: idx_agency_targets_agency; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agency_targets_agency ON public.agency_targets USING btree (agency_id);


--
-- Name: idx_agency_targets_next_action_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agency_targets_next_action_at ON public.agency_targets USING btree (next_action_at);


--
-- Name: idx_agency_targets_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agency_targets_status ON public.agency_targets USING btree (status);


--
-- Name: idx_dpe_targets_address; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dpe_targets_address ON public.dpe_targets USING btree (address);


--
-- Name: idx_dpe_targets_floor_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dpe_targets_floor_norm ON public.dpe_targets USING btree (floor_norm);


--
-- Name: idx_dpe_targets_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dpe_targets_geom ON public.dpe_targets USING gist (geom);


--
-- Name: idx_dpe_targets_next_action_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dpe_targets_next_action_at ON public.dpe_targets USING btree (next_action_at);


--
-- Name: idx_notes_address; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_address ON public.notes USING btree (address);


--
-- Name: idx_notes_agency_address; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_agency_address ON public.notes USING btree (agency_id, address);


--
-- Name: idx_notes_dpe_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_dpe_id ON public.notes USING btree (dpe_id);


--
-- Name: idx_user_territories_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_territories_geom ON public.user_territories USING gist (geom);


--
-- Name: idx_user_territories_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_territories_user ON public.user_territories USING btree (user_id);


--
-- Name: idx_zones_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_zones_geom ON public.zones USING gist (geom);


--
-- Name: users_email_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_unique ON public.users USING btree (email) WHERE (email IS NOT NULL);


--
-- Name: agencies agencies_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agencies
    ADD CONSTRAINT agencies_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: agency_targets agency_targets_agency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_targets
    ADD CONSTRAINT agency_targets_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES public.agencies(id) ON DELETE CASCADE;


--
-- Name: agency_targets agency_targets_dpe_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_targets
    ADD CONSTRAINT agency_targets_dpe_target_id_fkey FOREIGN KEY (dpe_target_id) REFERENCES public.dpe_targets(id) ON DELETE CASCADE;


--
-- Name: agency_zones agency_zones_agency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_zones
    ADD CONSTRAINT agency_zones_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES public.agencies(id) ON DELETE CASCADE;


--
-- Name: agency_zones agency_zones_zone_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_zones
    ADD CONSTRAINT agency_zones_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES public.zones(id) ON DELETE CASCADE;


--
-- Name: notes notes_agency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES public.agencies(id) ON DELETE CASCADE;


--
-- Name: notes notes_dpe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_dpe_id_fkey FOREIGN KEY (dpe_id) REFERENCES public.dpe_targets(id) ON DELETE SET NULL;


--
-- Name: user_territories user_territories_agency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_territories
    ADD CONSTRAINT user_territories_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES public.agencies(id) ON DELETE CASCADE;


--
-- Name: user_territories user_territories_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_territories
    ADD CONSTRAINT user_territories_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_agency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES public.agencies(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict NgNXxSjszu461hNdkACBLaQy080wNUcCxBbA1cZ9geqPYavwdSo0NoPAHhVfoLk

