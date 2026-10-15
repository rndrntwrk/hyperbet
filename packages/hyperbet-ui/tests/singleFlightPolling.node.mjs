import assert from "node:assert/strict";
import { test } from "node:test";
import { startSingleFlightPolling } from "../src/lib/singleFlightPolling.ts";

test("slow refreshes finish without overlapping or being aborted by poll ticks", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const calls = [];
  const stop = startSingleFlightPolling((signal) => new Promise((resolve) => {
    calls.push({ signal, resolve });
  }), 5000);
  t.after(stop);

  assert.equal(calls.length, 1);
  t.mock.timers.tick(15000);
  assert.equal(calls.length, 1, "only one refresh can be in flight");
  assert.equal(calls[0].signal.aborted, false);
  calls[0].resolve();
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(5000);
  assert.equal(calls.length, 2, "polling resumes after the slow request finishes");
  stop();
  assert.equal(calls[1].signal.aborted, true);
  t.mock.timers.tick(10000);
  assert.equal(calls.length, 2, "cleanup prevents future refreshes");
  calls[1].resolve();
});

test("a rejected refresh does not stop subsequent polling", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let calls = 0;
  const stop = startSingleFlightPolling(async () => {
    calls += 1;
    if (calls === 1) throw new Error("temporary connection failure");
  }, 5000);
  t.after(stop);
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(5000);
  assert.equal(calls, 2);
});

test("a hung request is aborted at the timeout and the next tick retries", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const signals = [];
  const stop = startSingleFlightPolling((signal) => new Promise((resolve) => {
    signals.push(signal);
    signal.addEventListener("abort", () => resolve(null), { once: true });
  }), 5000);
  t.after(stop);
  t.mock.timers.tick(25000);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].aborted, false);
  t.mock.timers.tick(5000);
  assert.equal(signals[0].aborted, true);
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(5000);
  assert.equal(signals.length, 2);
});

test("cleanup while the first request is pending prevents restart after it resolves", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  let calls = 0;
  let finish;
  let signal;
  const stop = startSingleFlightPolling((nextSignal) => new Promise((resolve) => {
    calls += 1;
    signal = nextSignal;
    finish = resolve;
  }), 5000);
  stop();
  assert.equal(signal.aborted, true);
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(60000);
  assert.equal(calls, 1);
});
