import json
import os
from anchorpy import Program, Provider, Wallet
from solana.rpc.async_api import AsyncClient
from solders.keypair import Keypair # type: ignore
from solders.pubkey import Pubkey # type: ignore
from solders.system_program import ID as SYS_PROGRAM_ID # type: ignore
import base58

from hyperbet_sdk.types import (
    CreateOrderParams,
    CancelOrderParams,
    ClaimParams,
    SIDE_BID,
    SIDE_ASK,
    MARKET_KIND_DUEL_WINNER,
)

IDL_DIR = os.path.join(os.path.dirname(__file__), "idl")

def duel_key_hex_to_bytes(duel_key_hex: str) -> bytes:
    normalized = duel_key_hex.strip().lower()
    if len(normalized) != 64:
        raise ValueError("duel_key_hex must be a 32-byte hex string")
    return bytes.fromhex(normalized)

class HyperbetSolanaClient:
    def __init__(self, rpc_url: str, private_key_base58: str, clob_program_id: str, oracle_program_id: str):
        self.client = AsyncClient(rpc_url)
        self.keypair = Keypair.from_bytes(base58.b58decode(private_key_base58))
        self.wallet = Wallet(self.keypair)
        self.provider = Provider(self.client, self.wallet)
        
        self.clob_program_id = Pubkey.from_string(clob_program_id)
        self.oracle_program_id = Pubkey.from_string(oracle_program_id)

        with open(os.path.join(IDL_DIR, "gold_clob_market.json")) as f:
            clob_idl = json.load(f)
        with open(os.path.join(IDL_DIR, "fight_oracle.json")) as f:
            oracle_idl = json.load(f)
            
        self.clob_program = Program(clob_idl, self.clob_program_id, self.provider)
        self.oracle_program = Program(oracle_idl, self.oracle_program_id, self.provider)

    # PDAs
    def get_duel_state_pda(self, duel_key: bytes) -> Pubkey:
        return Pubkey.find_program_address([b"duel", duel_key], self.oracle_program_id)[0]

    def get_market_pda(self, duel_state_pda: Pubkey, market_kind: int = MARKET_KIND_DUEL_WINNER) -> Pubkey:
        return Pubkey.find_program_address(
            [b"market", bytes(duel_state_pda), bytes([market_kind])], 
            self.clob_program_id
        )[0]

    def get_market_config_pda(self) -> Pubkey:
        return Pubkey.find_program_address([b"config"], self.clob_program_id)[0]

    def get_clob_vault_pda(self, market_pda: Pubkey) -> Pubkey:
        return Pubkey.find_program_address([b"vault", bytes(market_pda)], self.clob_program_id)[0]

    # Operations
    async def place_order(self, params: CreateOrderParams):
        duel_key = duel_key_hex_to_bytes(params.duel_id)
        duel_state_pda = self.get_duel_state_pda(duel_key)
        market_state_pda = self.get_market_pda(duel_state_pda)
        vault_pda = self.get_clob_vault_pda(market_state_pda)
        config_pda = self.get_market_config_pda()

        config = await self.clob_program.account["MarketConfig"].fetch(config_pda)
        
        tx = await self.clob_program.rpc["place_order"](
            SIDE_BID if params.side == "buy" else SIDE_ASK,
            params.price,
            params.amount,
            ctx=self.clob_program.type["Context"](
                accounts={
                    "market_state": market_state_pda,
                    "duel_state": duel_state_pda,
                    "config": config_pda,
                    "treasury": config.treasury,
                    "market_maker": config.market_maker,
                    "vault": vault_pda,
                    "user": self.keypair.pubkey(),
                    "system_program": SYS_PROGRAM_ID,
                }
            )
        )
        return tx

    async def cancel_order(self, params: CancelOrderParams):
        duel_key = duel_key_hex_to_bytes(params.duel_id)
        duel_state_pda = self.get_duel_state_pda(duel_key)
        market_state_pda = self.get_market_pda(duel_state_pda)

        tx = await self.clob_program.rpc["cancel_order"](
            params.order_id,
            ctx=self.clob_program.type["Context"](
                accounts={
                    "market_state": market_state_pda,
                    "duel_state": duel_state_pda,
                    "user": self.keypair.pubkey(),
                }
            )
        )
        return tx

    async def claim(self, params: ClaimParams):
        duel_key = duel_key_hex_to_bytes(params.duel_id)
        duel_state_pda = self.get_duel_state_pda(duel_key)
        market_state_pda = self.get_market_pda(duel_state_pda)
        vault_pda = self.get_clob_vault_pda(market_state_pda)
        config_pda = self.get_market_config_pda()

        config = await self.clob_program.account["MarketConfig"].fetch(config_pda)

        tx = await self.clob_program.rpc["claim_winnings"](
            ctx=self.clob_program.type["Context"](
                accounts={
                    "market_state": market_state_pda,
                    "duel_state": duel_state_pda,
                    "config": config_pda,
                    "market_maker": config.market_maker,
                    "vault": vault_pda,
                    "user": self.keypair.pubkey(),
                    "system_program": SYS_PROGRAM_ID,
                }
            )
        )
        return tx
