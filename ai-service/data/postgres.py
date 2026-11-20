"""PostgreSQL data access for graph, API-key, and minimized session analytics."""

from __future__ import annotations

import hashlib
import hmac
import os
from typing import Any
from datetime import datetime, timezone
from uuid import UUID

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # Keep graph/algorithm unit tests runnable without database extras.
    psycopg = None
    dict_row = None

from models import Building
from analytics.schemas import ConditionContext, ObstacleType, SessionDurationChoice, SessionStatus
from analytics.store import (
    Contribution,
    SessionNotFoundError,
    SessionRecord,
    SessionTokenError,
)
from navigation.accessibility import NavigationProfile


class DatabaseUnavailable(RuntimeError):
    """Database connection or query could not be completed."""


class PostgresDataAccess:
    def __init__(self, dsn: str | None = None) -> None:
        self.dsn = dsn if dsn is not None else os.getenv("DATABASE_URL")

    @property
    def configured(self) -> bool:
        return bool(self.dsn)

    def _connect(self):
        if not self.dsn:
            raise DatabaseUnavailable("DATABASE_URL is not configured")
        if psycopg is None:
            raise DatabaseUnavailable("Install the PostgreSQL driver with pip install -r requirements.txt")
        try:
            return psycopg.connect(self.dsn, row_factory=dict_row, connect_timeout=3)
        except psycopg.Error as exc:
            raise DatabaseUnavailable("PostgreSQL is unavailable") from exc

    def lookup_api_key(self, prefix: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            return connection.execute(
                """SELECT id, key_prefix, key_hash, permissions, expires_at, revoked_at
                   FROM api_keys WHERE key_prefix = %s""",
                (prefix,),
            ).fetchone()

    def authenticate_api_key(self, raw_key: str) -> tuple[str, set[str]] | None:
        # Format is accu_<public-prefix>.<secret>. Only the secret hash is stored.
        if not raw_key.startswith("accu_") or "." not in raw_key:
            return None
        public, secret = raw_key[5:].split(".", 1)
        if not public or not secret:
            return None
        row = self.lookup_api_key(public)
        if row is None or row["revoked_at"] is not None:
            return None
        if row["expires_at"] is not None:
            from datetime import datetime, timezone

            expiry = row["expires_at"]
            if expiry.tzinfo is None:
                expiry = expiry.replace(tzinfo=timezone.utc)
            if expiry <= datetime.now(timezone.utc):
                return None
        presented = hashlib.sha256(secret.encode()).hexdigest()
        if not hmac.compare_digest(str(row["key_hash"]), presented):
            return None
        permissions = row["permissions"]
        if isinstance(permissions, str):
            import json

            permissions = json.loads(permissions)
        return str(row["id"]), set(permissions)

    def load_building(self, building_id: str) -> Building | None:
        with self._connect() as connection:
            building = connection.execute(
                "SELECT id, name FROM buildings WHERE id = %s", (building_id,)
            ).fetchone()
            if building is None:
                return None
            floors = connection.execute(
                """SELECT floor_code, level_number, name FROM floors
                   WHERE building_id = %s ORDER BY level_number, floor_code""",
                (building_id,),
            ).fetchall()
            nodes = connection.execute(
                """SELECT n.id, n.floor_id, f.floor_code, n.node_type, n.x, n.y, n.metadata
                   FROM nodes n JOIN floors f ON f.id = n.floor_id
                   WHERE n.building_id = %s ORDER BY n.id""",
                (building_id,),
            ).fetchall()
            edges = connection.execute(
                """SELECT source_node, target_node, distance, connection_type,
                          is_blocked, is_accessible, is_bidirectional, metadata
                   FROM edges WHERE building_id = %s ORDER BY id""",
                (building_id,),
            ).fetchall()

        node_models = []
        for row in nodes:
            metadata = dict(row["metadata"] or {})
            accessibility = metadata.pop("accessibility", {})
            node_models.append(
                {
                    "node_id": row["id"],
                    "building_id": building_id,
                    "floor_id": row["floor_code"],
                    "x": row["x"],
                    "y": row["y"],
                    "node_type": row["node_type"],
                    "accessibility": accessibility,
                    **metadata,
                }
            )
        edge_models = []
        for row in edges:
            metadata = dict(row["metadata"] or {})
            accessibility = metadata.pop("accessibility", {})
            accessibility.setdefault("blocked", row["is_blocked"])
            if row["is_accessible"] is not None:
                accessibility.setdefault("accessible", row["is_accessible"])
            edge_models.append(
                {
                    "source_node": row["source_node"],
                    "destination_node": row["target_node"],
                    "distance": row["distance"],
                    "connection_type": row["connection_type"],
                    "bidirectional": row["is_bidirectional"],
                    "accessibility": accessibility,
                }
            )
        return Building.model_validate(
            {
                "building_id": building["id"],
                "name": building["name"],
                "floors": [
                    {"floor_id": row["floor_code"], "level": row["level_number"], "name": row["name"]}
                    for row in floors
                ],
                "nodes": node_models,
                "edges": edge_models,
            }
        )

    def persist_session(self, record: SessionRecord) -> None:
        with self._connect() as connection:
            connection.execute(
                """INSERT INTO navigation_sessions
                   (id, anonymous_user_id, building_id, start_node, destination_node,
                    accessibility_profile, duration_choice, consent_status, consent_version, started_at,
                    expires_at, status, session_token_hash)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,'consented',%s,%s,%s,%s,%s)""",
                (record.session_id, record.contributor_digest, record.building_id,
                 record.start_node, record.destination_node, record.profile.value, record.duration_choice.value,
                 record.consent_version, record.created_at, record.expires_at,
                 record.status.value, record.token_digest),
            )

    def authorized_session(self, session_id: UUID, token: str) -> SessionRecord | None:
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM navigation_sessions WHERE id=%s", (session_id,)
            ).fetchone()
            if row is None:
                raise SessionNotFoundError("session not found")
            if not hmac.compare_digest(row["session_token_hash"], digest):
                raise SessionTokenError("invalid session token")
            now = datetime.now(timezone.utc)
            status_value = row["status"]
            if row["expires_at"] <= now and status_value in {"active", "paused"}:
                status_value = "expired"
                connection.execute(
                    "UPDATE navigation_sessions SET status='expired',finished_at=now() WHERE id=%s",
                    (session_id,),
                )
            return SessionRecord(
                session_id=row["id"], building_id=row["building_id"],
                contributor_digest=row["anonymous_user_id"], consent_version=row["consent_version"],
                duration_choice=SessionDurationChoice(row["duration_choice"]),
                created_at=row["started_at"], expires_at=row["expires_at"],
                status=SessionStatus(status_value), token_digest=row["session_token_hash"],
                start_node=row["start_node"], destination_node=row["destination_node"],
                profile=NavigationProfile(row["accessibility_profile"]),
            )

    def update_session_status(self, session_id: UUID, status: SessionStatus) -> None:
        with self._connect() as connection:
            connection.execute(
                """UPDATE navigation_sessions SET status=%s,
                   finished_at=CASE WHEN %s IN ('finished','expired') THEN now() ELSE finished_at END
                   WHERE id=%s""",
                (status.value, status.value, session_id),
            )

    def delete_session(self, session_id: UUID) -> None:
        with self._connect() as connection:
            connection.execute("DELETE FROM navigation_sessions WHERE id=%s", (session_id,))

    def persist_contribution(self, contribution: Contribution) -> None:
        with self._connect() as connection:
            session = connection.execute(
                "SELECT building_id FROM navigation_sessions WHERE id=%s", (contribution.session_id,)
            ).fetchone()
            if session is None:
                raise DatabaseUnavailable("Navigation session was not found")
            edge_keys = sorted([list(pair) for pair in contribution.edge_keys])
            metadata = {
                "profile": contribution.profile.value,
                "context": contribution.context.value,
                "completed": contribution.completed,
                "duration_seconds": contribution.duration_seconds,
                "distance_m": contribution.distance_m,
                "edge_keys": edge_keys,
                "staircase_ids": list(contribution.staircase_ids),
                "obstacle_reports": [[node, kind.value] for node, kind in contribution.obstacle_reports],
            }
            inserted=connection.execute(
                """INSERT INTO navigation_events
                   (session_id,building_id,event_id,event_type,event_timestamp,metadata)
                   VALUES (%s,%s,%s,'journey_summary',%s,%s) ON CONFLICT DO NOTHING RETURNING id""",
                (contribution.session_id, session["building_id"], contribution.event_id,
                 contribution.created_at, psycopg.types.json.Jsonb(metadata)),
            ).fetchone()
            if inserted is None:
                from analytics.store import DuplicateEventError
                raise DuplicateEventError("event_id has already been submitted")
            nodes = sorted({node for edge in contribution.edge_keys for node in edge})
            if nodes:
                connection.cursor().executemany(
                    """INSERT INTO navigation_events
                       (session_id,building_id,event_id,node_id,event_type,event_timestamp)
                       VALUES (%s,%s,%s,%s,'node_visit',%s)""",
                    [(contribution.session_id, session["building_id"], contribution.event_id, node,
                      contribution.created_at) for node in nodes],
                )

    def load_contributions(self, retention_hours: int = 24) -> tuple[Contribution, ...]:
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT s.id AS session_id,s.anonymous_user_id,s.building_id,s.start_node,
                          s.destination_node,e.event_id,e.metadata,e.event_timestamp
                   FROM navigation_events e JOIN navigation_sessions s ON s.id=e.session_id
                   WHERE e.event_type='journey_summary' AND s.consent_status='consented'
                     AND e.event_timestamp >= now() - (%s * interval '1 hour')
                   ORDER BY e.event_timestamp""",
                (retention_hours,),
            ).fetchall()
        result = []
        for row in rows:
            metadata = row["metadata"]
            result.append(Contribution(
                event_id=row["event_id"], session_id=row["session_id"],
                contributor_digest=row["anonymous_user_id"], building_id=row["building_id"],
                origin_node=row["start_node"], destination_node=row["destination_node"],
                profile=NavigationProfile(metadata["profile"]),
                context=ConditionContext(metadata.get("context", "unknown")),
                completed=metadata["completed"], duration_seconds=float(metadata["duration_seconds"]),
                distance_m=float(metadata["distance_m"]),
                edge_keys=tuple(tuple(pair) for pair in metadata.get("edge_keys", [])),
                staircase_ids=tuple(metadata.get("staircase_ids", [])),
                obstacle_reports=tuple((node, ObstacleType(kind)) for node, kind in metadata.get("obstacle_reports", [])),
                created_at=row["event_timestamp"],
            ))
        return tuple(result)

    def persist_analysis(self, result: dict[str, Any]) -> None:
        with self._connect() as connection:
            connection.execute(
                """INSERT INTO analytics_runs(overview,disparities,recommendations)
                   VALUES (%s,%s,%s)""",
                (psycopg.types.json.Jsonb(result["overview"]),
                 psycopg.types.json.Jsonb(result["disparities"]),
                 psycopg.types.json.Jsonb(result["recommendations"])),
            )
            for row in result["disparities"]:
                general=row["general"]; accessible=row["accessibility"]
                connection.execute(
                    """INSERT INTO accessibility_analytics(building_id,origin_node,destination_node,
                         normal_median_duration,accessible_median_duration,normal_median_distance,
                         accessible_median_distance,time_ratio,sample_count,distinct_user_count,
                         confidence,status,result)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (row["building_id"],row["origin_node"],row["destination_node"],
                     general.get("median_duration_seconds"),accessible.get("median_duration_seconds"),
                     general.get("median_distance_m"),accessible.get("median_distance_m"),row.get("duration_ratio"),
                     general["session_count"]+accessible["session_count"],
                     general["distinct_contributors"]+accessible["distinct_contributors"],
                     "moderate" if row["status"]=="detected" else "low",row["status"],
                     psycopg.types.json.Jsonb(row)),
                )
            for rec in result["recommendations"]:
                location=(rec.get("candidate_locations") or [{}])[0]
                connection.execute(
                    """INSERT INTO infrastructure_recommendations(id,building_id,related_node_id,
                         recommendation_type,suggested_x,suggested_y,reason,estimated_distance_saved,
                         estimated_time_saved,confidence,status,result)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                       ON CONFLICT(id) DO UPDATE SET result=EXCLUDED.result,status=EXCLUDED.status""",
                    (rec["recommendation_id"],rec["building_id"],location.get("near_node_id"),
                     rec["recommendation_type"],location.get("x"),location.get("y"),rec["title"],
                     rec.get("estimated_distance_saved_m"),rec.get("estimated_time_saved_seconds"),
                     rec["confidence"],rec["status"],psycopg.types.json.Jsonb(rec)),
                )

    def latest_analysis(self) -> dict[str, Any] | None:
        with self._connect() as connection:
            return connection.execute(
                "SELECT overview,disparities,recommendations,analyzed_at FROM analytics_runs ORDER BY analyzed_at DESC LIMIT 1"
            ).fetchone()
