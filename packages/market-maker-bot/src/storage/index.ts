import { createInMemoryMarketMakerStateStore } from "./memory.ts";
import { createPostgresMarketMakerStateStore } from "./postgres.ts";

export { createInMemoryMarketMakerStateStore } from "./memory.ts";
export type {
  ClaimBacklogItem,
  ClaimBacklogInput,
  ManagedOrderStatus,
  MarketMakerStateStore,
  OrderRecord,
  OrderEventRecord,
  OutboxInput,
  OutboxItem,
  ReconciliationCursor,
  ReconciliationResult,
} from "./types.ts";

export function createDefaultMarketMakerStateStore(connectionString?: string) {
  return createPostgresMarketMakerStateStore(
    connectionString || process.env.MM_DATABASE_URL || "",
  );
}

export function createTestMarketMakerStateStore() {
  return createInMemoryMarketMakerStateStore();
}
