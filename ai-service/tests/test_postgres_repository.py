"""Opt-in PostgreSQL schema checks; use a migrated, disposable database."""

import os

import pytest

from data.postgres import PostgresDataAccess


@pytest.mark.skipif(
    not os.getenv("ACCESU_TEST_DATABASE_URL"),
    reason="Set ACCESU_TEST_DATABASE_URL to run PostgreSQL integration tests",
)
def test_postgres_schema_and_empty_repository_queries_work():
    repository=PostgresDataAccess(os.environ["ACCESU_TEST_DATABASE_URL"])
    assert repository.load_building("__missing_test_building__") is None
    assert isinstance(repository.load_contributions(), list)
    latest = repository.latest_analysis()
    assert latest is None or isinstance(latest, dict)
    assert repository.lookup_api_key("__missing_test_prefix__") is None
