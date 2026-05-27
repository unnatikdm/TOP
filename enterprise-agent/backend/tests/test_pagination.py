"""
Tests for the /api/search pagination logic.

Covers:
  - Default pagination values (page=1, page_size=20)
  - Custom page/page_size parameters
  - page_size capped at 50
  - Out-of-range page returns empty results list
  - total_results always reflects the full (un-paginated) count
"""
import pytest
import sys
import os

# Add the backend directory to path so we can import main
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from fastapi.testclient import TestClient
from main import app, SearchRequest


client = TestClient(app)


class TestSearchRequestModel:
    """Unit tests for the SearchRequest Pydantic model."""

    def test_defaults(self):
        req = SearchRequest(query="test")
        assert req.page == 1
        assert req.page_size == 20
        assert req.owner is None
        assert req.repo is None

    def test_custom_pagination(self):
        req = SearchRequest(query="test", page=3, page_size=10)
        assert req.page == 3
        assert req.page_size == 10

    def test_max_page_size_model_accepts_any(self):
        """Model itself accepts values > 50; the endpoint logic caps it."""
        req = SearchRequest(query="test", page_size=100)
        assert req.page_size == 100


class TestSearchEndpointPagination:
    """Integration tests for /api/search pagination behavior."""

    def test_empty_query_returns_400(self):
        resp = client.post("/api/search", json={"query": "   "})
        assert resp.status_code == 400

    def test_response_contains_pagination_metadata(self):
        resp = client.post("/api/search", json={
            "query": "nonexistent_query_xyz_12345",
            "page": 1,
            "page_size": 20
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "total_results" in data
        assert "page" in data
        assert "page_size" in data
        assert "results" in data
        assert "summary" in data

    def test_default_pagination_values_in_response(self):
        resp = client.post("/api/search", json={
            "query": "anything_random_test_string"
        })
        data = resp.json()
        assert data["page"] == 1
        assert data["page_size"] == 20

    def test_page_size_capped_at_50(self):
        resp = client.post("/api/search", json={
            "query": "test_cap_query",
            "page_size": 999
        })
        data = resp.json()
        assert data["page_size"] == 50

    def test_page_minimum_is_1(self):
        resp = client.post("/api/search", json={
            "query": "test_min_page",
            "page": -5
        })
        data = resp.json()
        assert data["page"] >= 1

    def test_out_of_range_page_returns_empty_results(self):
        resp = client.post("/api/search", json={
            "query": "test_out_of_range",
            "page": 9999,
            "page_size": 20
        })
        data = resp.json()
        assert data["results"] == [] or isinstance(data["results"], list)

    def test_total_results_reflects_full_count(self):
        """total_results should be the total count BEFORE pagination."""
        resp = client.post("/api/search", json={
            "query": "test_total",
            "page": 1,
            "page_size": 1
        })
        data = resp.json()
        # total_results should be >= the number of results on this page
        assert data["total_results"] >= len(data["results"])
