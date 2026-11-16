import http from "node:http";

const port = Number(process.env.PORT ?? 3000);
const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200).end("ok");
    return;
  }
  console.log(JSON.stringify({ method: req.method, path: req.url }));
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ product: 42, version: process.env.APP_VERSION }));
});

server.listen(port, () => console.log(`catalog listening on port ${port}`));

process.on("SIGTERM", () => {
  console.log("SIGTERM received, closing server");
  server.close(() => process.exit(0));
});
