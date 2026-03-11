# hyperbet-sdk

Python SDK for interacting with the Hyperbet prediction market on **EVM (BSC / AVAX)** and **Solana**.

## Installation

```bash
pip install hyperbet-sdk
# or
poetry add hyperbet-sdk
```

## Quick Start

```python
import asyncio
from hyperbet_sdk import HyperbetClient
from hyperbet_sdk.types import SdkConfig, CreateOrderParams

client = HyperbetClient(SdkConfig(
    evm_private_key="0x...",
    solana_private_key="base58-encoded-secret-key",
    # Optional — falls back to public RPCs if omitted
    bsc_rpc_url="https://bsc-mainnet.g.alchemy.com/v2/YOUR_KEY",
    solana_rpc_url="https://mainnet.helius-rpc.com/?api-key=YOUR_KEY",
))

# Place an order on BSC
client.evm_bsc.place_order(CreateOrderParams(
    duel_id="my-duel-id",
    side="buy",
    price=600,          # 60.0% implied probability
    amount=10000000000000000,  # 0.01 ETH worth of shares
))

# Place an order on Solana (async)
async def main():
    await client.solana.place_order(CreateOrderParams(
        duel_id="0" * 64,  # 32-byte hex duel key
        side="sell",
        price=400,
        amount=5000,
    ))

asyncio.run(main())

# Subscribe to live duel updates
async def stream_demo():
    client.stream.subscribe(lambda event: print("Stream:", event))
    await client.stream.connect()

asyncio.run(stream_demo())
```

## Clients

| Client | Chain | Library |
|--------|-------|---------|
| `HyperbetEVMClient` | BSC, AVAX | web3.py v7 |
| `HyperbetSolanaClient` | Solana | solana-py + anchorpy |
| `HyperbetStreamClient` | WebSocket | websockets |

## RPC Fallback Defaults

| Chain | Default Public RPC |
|-------|-------------------|
| BSC | `https://bsc-dataseed.binance.org/` |
| AVAX | `https://api.avax.network/ext/bc/C/rpc` |
| Solana | `https://api.mainnet-beta.solana.com` |

Pass your own Alchemy, Helius, or QuickNode URLs via the `SdkConfig` for better performance.

## API

### `HyperbetEVMClient`
- `place_order(params)` — Place a CLOB order
- `cancel_order(params)` — Cancel an existing order
- `claim(params)` — Claim winnings after resolution

### `HyperbetSolanaClient` (async)
- `place_order(params)` — Place a CLOB order (derives PDAs automatically)
- `cancel_order(params)` — Cancel order
- `claim(params)` — Claim winnings

### `HyperbetStreamClient` (async)
- `connect()` — Open WebSocket connection
- `subscribe(callback)` — Register an event listener
- `disconnect()` — Close connection

## Development

```bash
poetry install
poetry run pytest -p no:anchorpy   # Run tests
poetry build                       # Build for PyPI
```
