import pytest
from unittest.mock import MagicMock, patch

from hyperbet_sdk.solana.client import HyperbetSolanaClient
from hyperbet_sdk.types import CreateOrderParams, CancelOrderParams, ClaimParams, SIDE_BID

@pytest.fixture
def mock_solana_client():
    with patch("hyperbet_sdk.solana.client.AsyncClient"), \
         patch("hyperbet_sdk.solana.client.Program"):
        
        # Generate a valid deterministic keypair instead of mocking raw invalid bytes
        from solders.keypair import Keypair
        import base58
        valid_kp = Keypair()
        b58 = base58.b58encode(bytes(valid_kp)).decode('utf-8')
        
        client = HyperbetSolanaClient(
            "http://localhost:8899",
            b58,
            "11111111111111111111111111111111",
            "11111111111111111111111111111111"
        )
        # Mock anchorpy Program methods
        client.clob_program.account = {"MarketConfig": MagicMock()}
        
        mock_fetch = asyncio.Future()
        mock_config = MagicMock()
        mock_config.treasury = "mock_treasury"
        mock_config.market_maker = "mock_mm"
        mock_fetch.set_result(mock_config)
        client.clob_program.account["MarketConfig"].fetch = MagicMock(return_value=mock_fetch)

        mock_rpc = asyncio.Future()
        mock_rpc.set_result("mock_tx_sig")
        client.clob_program.rpc = {
            "place_order": MagicMock(return_value=mock_rpc),
            "cancel_order": MagicMock(return_value=mock_rpc),
            "claim_winnings": MagicMock(return_value=mock_rpc)
        }
        client.clob_program.type = {"Context": MagicMock()}

        yield client

import asyncio
@pytest.mark.asyncio
async def test_init(mock_solana_client):
    assert mock_solana_client.clob_program is not None
    assert mock_solana_client.oracle_program is not None

@pytest.mark.asyncio
async def test_place_order(mock_solana_client):
    params = CreateOrderParams(
        duel_id="0" * 64,
        side="buy",
        price=600,
        amount=1000
    )
    tx = await mock_solana_client.place_order(params)
    assert tx == "mock_tx_sig"
    mock_solana_client.clob_program.rpc["place_order"].assert_called_once()

@pytest.mark.asyncio
async def test_cancel_order(mock_solana_client):
    params = CancelOrderParams(
        duel_id="0" * 64,
        order_id=5
    )
    tx = await mock_solana_client.cancel_order(params)
    assert tx == "mock_tx_sig"
    mock_solana_client.clob_program.rpc["cancel_order"].assert_called_once()

@pytest.mark.asyncio
async def test_claim(mock_solana_client):
    params = ClaimParams(duel_id="0" * 64)
    tx = await mock_solana_client.claim(params)
    assert tx == "mock_tx_sig"
    mock_solana_client.clob_program.rpc["claim_winnings"].assert_called_once()
