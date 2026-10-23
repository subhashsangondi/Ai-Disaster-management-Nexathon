
CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'user'
);

CREATE TABLE incidents (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT REFERENCES users(id),
    description TEXT NOT NULL,
    emergency_type VARCHAR(100) NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ai_analyses (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    incident_id BIGINT NOT NULL REFERENCES incidents(id),
    urgency VARCHAR(30),
    summary TEXT,
    victim_count INTEGER,
    analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE rescue_teams (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    team_name VARCHAR(150) NOT NULL,
    availability VARCHAR(30) NOT NULL DEFAULT 'available'
);

CREATE TABLE incident_assignments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    incident_id BIGINT NOT NULL REFERENCES incidents(id),
    team_id BIGINT NOT NULL REFERENCES rescue_teams(id),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
