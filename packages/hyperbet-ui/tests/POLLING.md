# Prediction-market polling regression tests

Run from `packages/hyperbet-ui` with Node.js 24:

```sh
node --test ./tests/singleFlightPolling.node.mjs
```

The equivalent package script is `test:polling:node`. This suite imports the
TypeScript helper directly using Node's built-in type stripping. It deliberately
uses `.node.mjs`, rather than `.test.*`, to stay outside Bun test discovery;
Node's mock timer API is required. The existing `bun test` command does not run
this suite.

The four tests exercise slow responses across several polling ticks, rejection
recovery, timeout-triggered cancellation and retry, and cleanup while pending.
They test the scheduler, not React hook rendering or live endpoint compatibility.
The helper only starts another request after the current promise settles; the
refresh callback must honor its AbortSignal for a timeout to release the slot.
The production callbacks use abort-aware fetch calls and discard aborted results.

Polling remains read-only. No market creation, transaction, deployment, or change
to parity/trading gates is part of this fix.
