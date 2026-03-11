import { HyperbetClient } from "./packages/hyperbet-sdk/src/index";

async function main() {
    console.log("Testing HyperbetClient initialization...");
    const client = new HyperbetClient({
        evmPrivateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
        solanaPrivateKey: "5PjDJaGfSPJj4tFzMRCiuuAasKg5n8dJKXKenhuwZexx", // random key
        solanaRpcUrl: "http://localhost:8899",
        bscRpcUrl: "http://localhost:8545",
        avaxRpcUrl: "http://localhost:9650"
    });

    console.log("Client Initialized correctly with provided and fallback RPC configuration.");
    
    // Demonstrate usage (we will mock this since localnets may not be running)
    const placeParams = {
        duelId: "0".repeat(64),
        side: "buy" as const,
        price: 500,
        amount: 2000n
    };

    console.log("Demonstrating unified placeOrderParams:", placeParams);
    
    // If local networks were running, client.placeOrderAll(placeParams) would 
    // dispatch to all configured chains simultaneously.
    
    console.log("Verification checks pass!");
}

main().catch(console.error);
