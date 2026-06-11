"""PartnerClient against a mocked transport: pagination, auth, money seam, downloads."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from tests import fixtures as fx
from xometry_bot.models import JobOffer
from xometry_bot.partner_client import PartnerApiError, PartnerAuthError, PartnerClient


def gql_handler(pages: dict[int, dict[str, Any]]) -> tuple[Any, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        body = json.loads(request.content)
        offset = body["variables"]["offsetAttributes"]["offset"]
        return httpx.Response(200, json=pages[offset])

    return handler, seen


class TestScan:
    def test_paginates_until_has_more_false(self) -> None:
        pages = {
            0: fx.gql_page([fx.make_offer("HJO-1")], has_more=True, offset=0),
            20: fx.gql_page([fx.make_offer("HJO-2")], has_more=False, offset=20),
        }
        handler, seen = gql_handler(pages)
        client = PartnerClient(auth_token="tok", transport=httpx.MockTransport(handler))
        offers = list(client.scan())
        assert [o.code for o in offers] == ["HJO-1", "HJO-2"]
        assert len(seen) == 2
        # captured filter shape (§1A)
        first = json.loads(seen[0].content)
        assert first["variables"]["filter"] == {
            "urgentStatus": "without_urgent",
            "responseStatus": "empty",
        }

    def test_sends_bearer_header(self) -> None:
        handler, seen = gql_handler({0: fx.gql_page([])})
        client = PartnerClient(auth_token="tok", transport=httpx.MockTransport(handler))
        list(client.scan())
        assert seen[0].headers["authorization"] == "Bearer tok"

    def test_sends_cookie_when_configured(self) -> None:
        handler, seen = gql_handler({0: fx.gql_page([])})
        client = PartnerClient(cookie="session=abc", transport=httpx.MockTransport(handler))
        list(client.scan())
        assert seen[0].headers["cookie"] == "session=abc"
        assert "authorization" not in seen[0].headers

    def test_raw_payload_attached(self) -> None:
        handler, _ = gql_handler({0: fx.gql_page([fx.make_offer("HJO-9")])})
        client = PartnerClient(auth_token="tok", transport=httpx.MockTransport(handler))
        offer = next(iter(client.scan()))
        assert offer.raw["code"] == "HJO-9"

    def test_no_auth_refused(self) -> None:
        with pytest.raises(PartnerAuthError):
            PartnerClient()

    def test_401_raises_auth_error(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(401)

        client = PartnerClient(auth_token="expired", transport=httpx.MockTransport(handler))
        with pytest.raises(PartnerAuthError):
            list(client.scan())

    def test_graphql_errors_raise(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"errors": [{"message": "boom"}], "data": None})

        client = PartnerClient(auth_token="tok", transport=httpx.MockTransport(handler))
        with pytest.raises(PartnerApiError):
            list(client.scan())


class TestMoneyFragmentSeam:
    def test_swaps_fragment_and_retries(self) -> None:
        calls: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            calls.append(body["query"])
            if "amount currency" in body["query"]:
                return httpx.Response(
                    200,
                    json={"errors": [{"message": 'Cannot query field "amount" on "Money"'}]},
                )
            offer = fx.make_offer(cost={"value": 123.45, "currencyCode": "EUR"})
            return httpx.Response(200, json=fx.gql_page([offer]))

        client = PartnerClient(auth_token="tok", transport=httpx.MockTransport(handler))
        offers = list(client.scan())
        assert len(calls) == 2
        assert "value currencyCode" in calls[1]
        assert offers[0].cost is not None
        assert offers[0].cost.amount == 123.45  # alt shape normalised by models.Money


class TestDownloadFiles:
    def test_downloads_and_skips_existing(self, tmp_path: Path) -> None:
        hits: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            hits.append(str(request.url))
            return httpx.Response(200, content=b"solid step data")

        client = PartnerClient(auth_token="tok", transport=httpx.MockTransport(handler))
        offer = JobOffer.model_validate(fx.make_offer())
        paths = client.download_files(offer, tmp_path)
        assert len(paths) == 1
        assert Path(paths[0]).read_bytes() == b"solid step data"
        assert Path(paths[0]).parent.name == "HJO-21991-684"

        again = client.download_files(offer, tmp_path)
        assert again == paths
        assert len(hits) == 1  # second run hit the cache, not the network

    def test_counteroffer_mutation_not_implemented(self) -> None:
        transport = httpx.MockTransport(lambda r: httpx.Response(200))
        client = PartnerClient(auth_token="tok", transport=transport)
        with pytest.raises(NotImplementedError):
            client.submit_counteroffer(offer_id="1")
