CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS buildings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS floors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    floor_code TEXT NOT NULL,
    name TEXT NOT NULL,
    level_number INTEGER NOT NULL,
    UNIQUE (building_id, floor_code),
    UNIQUE (id, building_id)
);

CREATE TABLE IF NOT EXISTS nodes (
    id TEXT NOT NULL,
    building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    floor_id UUID NOT NULL,
    node_type TEXT NOT NULL,
    x DOUBLE PRECISION NOT NULL,
    y DOUBLE PRECISION NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (building_id, id),
    FOREIGN KEY (floor_id, building_id) REFERENCES floors(id, building_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    source_node TEXT NOT NULL,
    target_node TEXT NOT NULL,
    distance DOUBLE PRECISION NOT NULL CHECK (distance >= 0),
    connection_type TEXT NOT NULL,
    is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
    is_accessible BOOLEAN,
    is_bidirectional BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    FOREIGN KEY (building_id, source_node) REFERENCES nodes(building_id, id) ON DELETE CASCADE,
    FOREIGN KEY (building_id, target_node) REFERENCES nodes(building_id, id) ON DELETE CASCADE,
    CHECK (source_node <> target_node)
);
CREATE INDEX IF NOT EXISTS edges_source_idx ON edges(building_id, source_node);
CREATE INDEX IF NOT EXISTS edges_target_idx ON edges(building_id, target_node);

CREATE TABLE IF NOT EXISTS navigation_sessions (
    id UUID PRIMARY KEY,
    anonymous_user_id TEXT NOT NULL,
    building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    start_node TEXT NOT NULL,
    destination_node TEXT NOT NULL,
    accessibility_profile TEXT NOT NULL,
    duration_choice TEXT NOT NULL CHECK (duration_choice IN ('this_navigation', 'until_expiry')),
    consent_status TEXT NOT NULL CHECK (consent_status IN ('consented', 'revoked')),
    consent_version TEXT NOT NULL,
    session_token_hash TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'finished', 'expired')),
    is_synthetic BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY (building_id, start_node) REFERENCES nodes(building_id, id),
    FOREIGN KEY (building_id, destination_node) REFERENCES nodes(building_id, id)
);
CREATE INDEX IF NOT EXISTS sessions_pair_idx ON navigation_sessions(building_id, start_node, destination_node, accessibility_profile);
CREATE INDEX IF NOT EXISTS sessions_retention_idx ON navigation_sessions(expires_at, started_at);

CREATE TABLE IF NOT EXISTS navigation_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES navigation_sessions(id) ON DELETE CASCADE,
    building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    event_id UUID NOT NULL,
    node_id TEXT,
    event_type TEXT NOT NULL,
    event_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (session_id, event_id, event_type, node_id),
    FOREIGN KEY (building_id, node_id) REFERENCES nodes(building_id, id)
);
CREATE INDEX IF NOT EXISTS events_session_time_idx ON navigation_events(session_id, event_timestamp);
CREATE INDEX IF NOT EXISTS events_summary_idx ON navigation_events(event_type, event_timestamp) WHERE event_type = 'journey_summary';
CREATE UNIQUE INDEX IF NOT EXISTS events_unique_journey_idx ON navigation_events(session_id,event_id) WHERE event_type='journey_summary';

CREATE TABLE IF NOT EXISTS accessibility_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    origin_node TEXT NOT NULL,
    destination_node TEXT NOT NULL,
    normal_median_duration DOUBLE PRECISION,
    accessible_median_duration DOUBLE PRECISION,
    normal_median_distance DOUBLE PRECISION,
    accessible_median_distance DOUBLE PRECISION,
    time_ratio DOUBLE PRECISION,
    sample_count INTEGER NOT NULL CHECK (sample_count >= 0),
    distinct_user_count INTEGER NOT NULL DEFAULT 0 CHECK (distinct_user_count >= 0),
    confidence TEXT NOT NULL,
    status TEXT NOT NULL,
    result JSONB NOT NULL,
    analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (building_id, origin_node) REFERENCES nodes(building_id, id),
    FOREIGN KEY (building_id, destination_node) REFERENCES nodes(building_id, id)
);
CREATE INDEX IF NOT EXISTS analytics_building_pair_idx ON accessibility_analytics(building_id, origin_node, destination_node, analyzed_at DESC);

CREATE TABLE IF NOT EXISTS analytics_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    overview JSONB NOT NULL,
    disparities JSONB NOT NULL,
    recommendations JSONB NOT NULL,
    analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_runs_latest_idx ON analytics_runs(analyzed_at DESC);

CREATE TABLE IF NOT EXISTS infrastructure_recommendations (
    id TEXT PRIMARY KEY,
    building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    related_node_id TEXT,
    recommendation_type TEXT NOT NULL,
    suggested_x DOUBLE PRECISION,
    suggested_y DOUBLE PRECISION,
    reason TEXT NOT NULL,
    estimated_distance_saved DOUBLE PRECISION,
    estimated_time_saved DOUBLE PRECISION,
    confidence TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_review',
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (building_id, related_node_id) REFERENCES nodes(building_id, id)
);
CREATE INDEX IF NOT EXISTS recommendations_building_idx ON infrastructure_recommendations(building_id, status);

CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_prefix TEXT NOT NULL UNIQUE,
    key_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION prune_navigation_data(retention INTERVAL DEFAULT INTERVAL '24 hours')
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE removed INTEGER;
BEGIN
    UPDATE navigation_sessions SET status='expired', finished_at=now()
      WHERE status IN ('active','paused') AND expires_at <= now();
    DELETE FROM navigation_events WHERE event_timestamp < now() - retention;
    GET DIAGNOSTICS removed = ROW_COUNT;
    DELETE FROM navigation_sessions s
      WHERE s.status IN ('finished', 'expired')
        AND s.finished_at < now() - retention
        AND NOT EXISTS (SELECT 1 FROM navigation_events e WHERE e.session_id = s.id);
    RETURN removed;
END;
$$;
