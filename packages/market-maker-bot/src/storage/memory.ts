import type {
  ClaimBacklogInput,
  ClaimBacklogItem,
  MarketMakerStateStore,
  OrderEventRecord,
  OrderRecord,
  OutboxInput,
  OutboxItem,
  ReconciliationCursor,
} from "./types.ts";

export class InMemoryMarketMakerStateStore implements MarketMakerStateStore {
  private readonly orders = new Map<string, OrderRecord>();
  private readonly orderEvents: OrderEventRecord[] = [];
  private readonly claimBacklog = new Map<string, ClaimBacklogItem>();
  private readonly outbox = new Map<number, OutboxItem>();
  private readonly cursors = new Map<string, ReconciliationCursor>();
  private nextOutboxId = 1;
  private nextEventId = 1;

  async ensureReady() {}

  async close() {}

  async listActiveOrders(): Promise<OrderRecord[]> {
    return [...this.orders.values()].filter(
      (order) => order.status === "OPEN" || order.status === "ORPHANED",
    );
  }

  async getOrder(orderKey: string): Promise<OrderRecord | null> {
    return this.orders.get(orderKey) ?? null;
  }

  async upsertOrder(order: OrderRecord): Promise<void> {
    this.orders.set(order.orderKey, structuredClone(order));
  }

  async appendOrderEvent(
    orderKey: string,
    eventType: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    this.orderEvents.push({
      id: this.nextEventId++,
      orderKey,
      eventType,
      payload: structuredClone(payload),
      createdAt: Date.now(),
    });
  }

  async markOrderStatus(
    orderKey: string,
    status: OrderRecord["status"],
    updates: Partial<
      Pick<
        OrderRecord,
        | "amount"
        | "price"
        | "lastSeenOnChainAt"
        | "lastReconciledAt"
        | "txSignature"
        | "quarantineReason"
        | "metadata"
      >
    > = {},
  ): Promise<void> {
    const current = this.orders.get(orderKey);
    if (!current) return;
    this.orders.set(orderKey, {
      ...current,
      ...updates,
      metadata: updates.metadata ?? current.metadata,
      status,
    });
  }

  async listDueClaimBacklog(now: number): Promise<ClaimBacklogItem[]> {
    return [...this.claimBacklog.values()].filter(
      (item) => item.status !== "RESOLVED" && item.nextAttemptAt <= now,
    );
  }

  async upsertClaimBacklog(item: ClaimBacklogInput): Promise<void> {
    const current = this.claimBacklog.get(item.backlogKey);
    this.claimBacklog.set(item.backlogKey, {
      attempts: item.attempts ?? current?.attempts ?? 0,
      lastAttemptAt: item.lastAttemptAt ?? current?.lastAttemptAt ?? null,
      resolvedAt: item.resolvedAt ?? current?.resolvedAt ?? null,
      lastError: item.lastError ?? current?.lastError ?? null,
      ...structuredClone(item),
    });
  }

  async markClaimBacklogAttempt(
    backlogKey: string,
    updates: {
      status: ClaimBacklogItem["status"];
      attempts: number;
      nextAttemptAt: number;
      lastAttemptAt: number;
      lastError?: string | null;
      resolvedAt?: number | null;
    },
  ): Promise<void> {
    const current = this.claimBacklog.get(backlogKey);
    if (!current) return;
    this.claimBacklog.set(backlogKey, {
      ...current,
      ...updates,
      lastError: updates.lastError ?? current.lastError,
      resolvedAt: updates.resolvedAt ?? current.resolvedAt,
    });
  }

  async enqueueOutbox(item: OutboxInput): Promise<number> {
    const id = this.nextOutboxId++;
    this.outbox.set(id, {
      id,
      leasedAt: item.leasedAt ?? null,
      attempts: item.attempts ?? 0,
      lastError: item.lastError ?? null,
      ...structuredClone(item),
    });
    return id;
  }

  async leaseOutbox(now: number, limit: number): Promise<OutboxItem[]> {
    const items = [...this.outbox.values()]
      .filter((item) => item.status === "PENDING" && item.availableAt <= now)
      .sort((a, b) => a.availableAt - b.availableAt)
      .slice(0, limit);
    for (const item of items) {
      this.outbox.set(item.id, {
        ...item,
        status: "LEASED",
        leasedAt: now,
        attempts: item.attempts + 1,
      });
    }
    return items.map((item) => ({
      ...item,
      status: "LEASED",
      leasedAt: now,
      attempts: item.attempts + 1,
    }));
  }

  async completeOutbox(id: number): Promise<void> {
    const item = this.outbox.get(id);
    if (!item) return;
    this.outbox.set(id, {
      ...item,
      status: "DONE",
    });
  }

  async failOutbox(id: number, lastError: string, availableAt: number): Promise<void> {
    const item = this.outbox.get(id);
    if (!item) return;
    this.outbox.set(id, {
      ...item,
      status: "PENDING",
      availableAt,
      lastError,
    });
  }

  async getCursor(cursorKey: string): Promise<ReconciliationCursor | null> {
    return this.cursors.get(cursorKey) ?? null;
  }

  async setCursor(
    cursorKey: string,
    cursorValue: string,
    updatedAt = Date.now(),
  ): Promise<void> {
    this.cursors.set(cursorKey, {
      cursorKey,
      cursorValue,
      updatedAt,
    });
  }
}

export function createInMemoryMarketMakerStateStore() {
  return new InMemoryMarketMakerStateStore();
}
