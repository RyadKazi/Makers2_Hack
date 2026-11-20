"""Create or revoke PostgreSQL-backed FastAPI API keys.

Examples:
    python scripts/api_keys.py create local-backend
    python scripts/api_keys.py create navigation-client --permissions navigation:route
    python scripts/api_keys.py revoke 9f41c2a008
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import sys
from datetime import datetime

import psycopg


DEFAULT_PERMISSIONS = (
    "navigation:route",
    "sessions:write",
    "analytics:write",
    "analytics:read",
    "recommendations:read",
    "recommendations:write",
)


def parse_expiry(value: str | None) -> datetime | None:
    if value is None:
        return None
    expiry = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if expiry.tzinfo is None:
        raise argparse.ArgumentTypeError("expiry must include a timezone, such as 2027-01-01T00:00:00Z")
    return expiry


def main() -> int:
    parser = argparse.ArgumentParser(description="Manage hashed AccesU API keys")
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create", help="Create a key and print its secret once")
    create.add_argument("name")
    create.add_argument("--permissions", default=",".join(DEFAULT_PERMISSIONS))
    create.add_argument("--expires-at", type=parse_expiry)
    revoke = commands.add_parser("revoke", help="Revoke a key by its public prefix")
    revoke.add_argument("prefix")
    args = parser.parse_args()

    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        parser.error("DATABASE_URL must point to the migrated PostgreSQL database")

    try:
        with psycopg.connect(dsn) as connection:
            if args.command == "create":
                permissions = sorted({item.strip() for item in args.permissions.split(",") if item.strip()})
                if not permissions:
                    parser.error("at least one permission is required")
                prefix = secrets.token_hex(5)
                secret = secrets.token_urlsafe(32)
                key = f"accu_{prefix}.{secret}"
                digest = hashlib.sha256(secret.encode("utf-8")).hexdigest()
                connection.execute(
                    """INSERT INTO api_keys(key_prefix, key_hash, name, permissions, expires_at)
                       VALUES (%s, %s, %s, %s::jsonb, %s)""",
                    (prefix, digest, args.name, json.dumps(permissions), args.expires_at),
                )
                print(f"API key created. Store this value securely; it is shown only once:\n{key}")
                return 0

            result = connection.execute(
                "UPDATE api_keys SET revoked_at = now() WHERE key_prefix = %s AND revoked_at IS NULL",
                (args.prefix,),
            )
            if result.rowcount == 0:
                print("No active API key found for that prefix.", file=sys.stderr)
                return 1
            print(f"Revoked API key prefix {args.prefix}.")
            return 0
    except psycopg.Error as exc:
        print(f"API key operation failed ({type(exc).__name__}). Check DATABASE_URL and migration status.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
