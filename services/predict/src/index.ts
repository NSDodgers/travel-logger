// Travel Logger predict service
// M2: skeleton with /health only. Real percentile + widening logic lands in M10.
// Auth: none — this service trusts anything that reaches it via Caddy,
// which has already run the Authelia forward_auth check.

import postgres from "postgres";

const PG_URI = process.env.PG_URI;
if (!PG_URI) {
  console.error("PG_URI not set");
  process.exit(1);
}

const sql = postgres(PG_URI, {
  max: 4,
  idle_timeout: 30,
  connect_timeout: 10,
});

const PORT = Number(process.env.PORT ?? 3001);

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/api/predict/health") {
      try {
        const [{ one }] = await sql`select 1 as one`;
        return json({ status: "ok", db: one === 1 });
      } catch (err) {
        return json({ status: "error", error: String(err) }, 503);
      }
    }

    if (url.pathname === "/api/predict" && req.method === "POST") {
      // TODO(M10): real percentile + filter-widening implementation
      return json({
        error: "not_implemented",
        message: "Predict endpoint ships in M10. This is the M2 skeleton.",
      }, 501);
    }

    return json({ error: "not_found", path: url.pathname }, 404);
  },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

console.log(`predict service listening on :${server.port}`);
