import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = 3100;

function startServer() {
  const server = spawn("node", ["server.js"], {
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: "postgres://test/shop" },
  });
  return new Promise((resolve) => {
    server.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("listening")) resolve(server);
    });
  });
}

test("GET /health returns 200", async () => {
  const server = await startServer();
  try {
    const res = await fetch(`http://localhost:${PORT}/health`);
    assert.equal(res.status, 200);
  } finally {
    server.kill("SIGTERM");
  }
});
