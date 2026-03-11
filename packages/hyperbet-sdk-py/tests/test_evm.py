import pytest
from unittest.mock import MagicMock, patch

from hyperbet_sdk.evm.client import HyperbetEVMClient
from hyperbet_sdk.types import CreateOrderParams, CancelOrderParams, ClaimParams, SIDE_BID, MARKET_KIND_DUEL_WINNER

@pytest.fixture
def mock_evm_client():
    with patch("hyperbet_sdk.evm.client.Web3") as mock_web3:
        client = HyperbetEVMClient(
            "http://localhost:8545",
            "0x" + "1" * 64,
            "0x" + "2" * 40,
            "0x" + "3" * 40
        )
        # Mock internal calls
        client.w3.eth.get_transaction_count.return_value = 1
        client.clob.functions.tradeTreasuryFeeBps().call.return_value = 100
        client.clob.functions.tradeMarketMakerFeeBps().call.return_value = 100
        
        # Mock sign and send
        client._sign_and_send = MagicMock(return_value={"status": 1})
        yield client

def test_init(mock_evm_client):
    assert mock_evm_client.clob is not None
    assert mock_evm_client.oracle is not None

def test_place_order(mock_evm_client):
    params = CreateOrderParams(
        duel_id="test-duel",
        side="buy",
        price=600,
        amount=1000
    )
    
    receipt = mock_evm_client.place_order(params)
    assert receipt["status"] == 1
    
    mock_evm_client._sign_and_send.assert_called_once()
    # Ensure correct arithmetic value for value to send 
    value_arg = mock_evm_client._sign_and_send.call_args[0][1]["value"]
    assert value_arg > 0

def test_cancel_order(mock_evm_client):
    params = CancelOrderParams(duel_id="test", order_id=1)
    receipt = mock_evm_client.cancel_order(params)
    assert receipt["status"] == 1
    mock_evm_client._sign_and_send.assert_called_once()

def test_claim(mock_evm_client):
    params = ClaimParams(duel_id="test")
    receipt = mock_evm_client.claim(params)
    assert receipt["status"] == 1
    mock_evm_client._sign_and_send.assert_called_once()
