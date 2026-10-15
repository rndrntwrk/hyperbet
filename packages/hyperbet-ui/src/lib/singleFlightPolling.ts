export function startSingleFlightPolling(
  refresh: (signal: AbortSignal) => Promise<unknown>,
  intervalMs: number,
  requestTimeoutMs = 30_000,
): () => void {
  let controller: AbortController | null = null;
  let stopped = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const poll = async () => {
    if (stopped || controller) return;
    const current = new AbortController();
    controller = current;
    timeout = setTimeout(() => current.abort(), requestTimeoutMs);
    try {
      await refresh(current.signal);
    } catch {
      // Refresh owns the visible error state; a failure must not stop polling.
    } finally {
      clearTimeout(timeout);
      controller = null;
    }
  };

  void poll();
  const interval = setInterval(() => void poll(), intervalMs);
  return () => {
    stopped = true;
    controller?.abort();
    clearTimeout(timeout);
    clearInterval(interval);
  };
}
