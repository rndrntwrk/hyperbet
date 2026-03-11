from typing import Optional
from .types import SdkConfig, CreateOrderParams
from .evm.client import HyperbetEVMClient
from .solana.client import HyperbetSolanaClient
from .stream.client import HyperbetStreamClient

import asyncio

class HyperbetClient:
    DEFAULT_BSC_RPC = "https://bsc-dataseed.binance.org/"
    DEFAULT_AVAX_RPC = "https://api.avax.network/ext/bc/C/rpc"
    DEFAULT_SOLANA_RPC = "https://api.mainnet-beta.solana.com"
    DEFAULT_STREAM_URL = "wss://api.hyperbet.gg/ws"

    BSC_CLOB_ADDRESS = "0x1230000000000000000000000000000000000000"
    BSC_ORACLE_ADDRESS = "0x4560000000000000000000000000000000000000"
    AVAX_CLOB_ADDRESS = "0x7890000000000000000000000000000000000000"
    AVAX_ORACLE_ADDRESS = "0xabc0000000000000000000000000000000000000"
    SOLANA_CLOB_PROGRAM_ID = "C1obMarket11111111111111111111111111111111"
    SOLANA_ORACLE_PROGRAM_ID = "F1ghtOrac1e11111111111111111111111111111111"

    def __init__(self, config: SdkConfig):
        self.evm_bsc: Optional[HyperbetEVMClient] = None
        self.evm_avax: Optional[HyperbetEVMClient] = None
        self.solana: Optional[HyperbetSolanaClient] = None
        self.stream: Optional[HyperbetStreamClient] = None

        if config.evm_private_key:
            self.evm_bsc = HyperbetEVMClient(
                config.bsc_rpc_url or self.DEFAULT_BSC_RPC,
                config.evm_private_key,
                self.BSC_CLOB_ADDRESS,
                self.BSC_ORACLE_ADDRESS
            )
            self.evm_avax = HyperbetEVMClient(
                config.avax_rpc_url or self.DEFAULT_AVAX_RPC,
                config.evm_private_key,
                self.AVAX_CLOB_ADDRESS,
                self.AVAX_ORACLE_ADDRESS
            )

        if config.solana_private_key:
            self.solana = HyperbetSolanaClient(
                config.solana_rpc_url or self.DEFAULT_SOLANA_RPC,
                config.solana_private_key,
                self.SOLANA_CLOB_PROGRAM_ID,
                self.SOLANA_ORACLE_PROGRAM_ID
            )

        stream_url = config.stream_url or self.DEFAULT_STREAM_URL
        if stream_url:
            self.stream = HyperbetStreamClient(stream_url)

    async def place_order_all(self, params: CreateOrderParams):
        """Helper to place cross-chain orders simultaneously if configured"""
        tasks = []
        if self.evm_bsc:
            # Running evm functions, which are blocking, in threads to make them async
            tasks.append(asyncio.to_thread(self.evm_bsc.place_order, params))
        if self.evm_avax:
            tasks.append(asyncio.to_thread(self.evm_avax.place_order, params))
        if self.solana:
            tasks.append(self.solana.place_order(params))
        
        return await asyncio.gather(*tasks, return_exceptions=True)
