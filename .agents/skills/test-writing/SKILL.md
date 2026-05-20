---
name: test-writing
description: Use this skill when writing, reviewing, or fixing test scripts in this project. Activate when creating new test scripts, debugging a test failure, improving test robustness, or when a user says tests should be clearer, more robust, or handle different environments. Covers assertion strategy, environment/daemon detection, cleanup ownership, and log clarity for Node.js .mjs test scripts.
---

# Test Writing

## Assertions

Assert the **specific thing under test**, not ambient global state that may vary by environment.

- **Wrong:** `if (conns.total !== 1) fail(...)` — breaks if any other client is connected
- **Right:** `if (!conns.connections.some(c => c.instanceId === MY_ID)) fail(...)` — checks exactly what this test registered

Never assert counts, lengths, or totals for shared resources unless isolation is guaranteed.

## Environment detection

Tests may run against a **pre-existing service** (e.g., a VS Code debug window already has the daemon running). Always probe before spawning:

1. Try connecting to the service with a short timeout (≤ 500 ms)
2. If already up: run as a **consumer** — skip spawn, skip service teardown
3. If not up: run as an **initializer** — spawn the service, own its teardown

Never assume a clean environment.

## Logging

Make it unambiguous which path was taken. Log:
- What was probed and at what address/path
- Whether an existing instance was found or a new one was spawned
- At cleanup: whether the service will or will not be killed

**Initializer path:**
```
[test] Probing for existing daemon at /…/ipc.sock…
[test] No daemon detected — spawning as initializer…
[test] Daemon up ✓ (spawned by this test — will be killed on cleanup)
```

**Consumer path:**
```
[test] Probing for existing daemon at /…/ipc.sock…
[test] Existing daemon found — running as consumer (daemon will not be killed)
```

Failure messages must say **what** failed and **what was found**, not just "expected X got Y" without context.

## Cleanup

Only tear down resources this test owns (`ownsDaemon`, `ownedServer`, etc.). If the test did not create it, do not destroy it.
