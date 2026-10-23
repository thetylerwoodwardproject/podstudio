// Custom production server — replaces `react-router-serve`, which doesn't expose
// Express's `trust proxy` setting. Behind Caddy, Express otherwise reports every
// request as plain http (ignoring the real X-Forwarded-Proto), so React Router's
// own CSRF guard (`request.url` origin must match the `Origin` header) rejects
// every POST with a 400 — https://.../studio/feed/tags, episode saves, sign-out,
// all of it. `trust proxy: 1` trusts exactly one hop (Caddy, the only thing in
// front of this container), which fixes req.protocol without trusting arbitrary
// forwarded headers from further upstream.
import path from "node:path";
import url from "node:url";
import { createRequestHandler } from "@react-router/express";
import compression from "compression";
import express from "express";
import morgan from "morgan";

const buildPath = path.resolve("./build/server/index.js");
const build = await import(url.pathToFileURL(buildPath).href);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(compression());
// Baseline security headers on every response. The studio must not be framable
// by other sites (clickjacking), so X-Frame-Options is SAMEORIGIN everywhere
// EXCEPT the embed player document (`/{show}/embed/*`), which exists to be
// framed and sets its own `Content-Security-Policy: frame-ancestors *` (an XFO
// header here would override that in browsers that honour both, so it's skipped).
// The studio's own preview iframe is same-origin, so SAMEORIGIN allows it.
const EMBED_PATH = /^\/[^/]+\/embed\/[^/]+\/?$/;
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (!EMBED_PATH.test(req.path)) res.setHeader("X-Frame-Options", "SAMEORIGIN");
  next();
});
app.use(
  "/assets",
  express.static(path.join("build/client", "assets"), { immutable: true, maxAge: "1y" }),
);
app.use(express.static("build/client", { maxAge: "1h" }));
app.use(express.static("public", { maxAge: "1h" }));
app.use(morgan("tiny"));
app.all("/{*splat}", createRequestHandler({ build, mode: process.env.NODE_ENV }));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`[web] listening on :${port} (trust proxy: 1 hop)`);
});
