import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${path}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: path === "/" ? "text/html" : "application/json" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Rentwise application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Rentwise/);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /apple-touch-icon\.png/);
  assert.doesNotMatch(html, /Your site is taking shape|SkeletonPreview|react-loading-skeleton/);
});

test("health endpoint reports a ready service", async () => {
  const response = await render("/api/health");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.service, "rentwise");
  assert.match(body.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test("mobile design keeps restrained geometry, fixed navigation and reduced motion", async () => {
  const [css, manifest] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/manifest.ts", import.meta.url), "utf8"),
  ]);
  assert.match(css, /--radius-lg:\s*12px/);
  assert.match(css, /font-family:\s*var\(--font-geist\)/);
  assert.match(css, /\.bottom-nav\s*\{[^}]*position:\s*fixed/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(manifest, /display:\s*"standalone"/);
  assert.match(manifest, /purpose:\s*"maskable"/);
});

test("database migration enforces isolated IDs and atomic financial writes", async () => {
  const sql = await readFile(new URL("../supabase/migrations/202608130001_initial_schema.sql", import.meta.url), "utf8");
  for (const pattern of [
    /'PRP',4/,
    /'TEN',4/,
    /'AGR',4/,
    /'RCV',6/,
    /'EXP',6/,
    /create policy owner_all/,
    /record_rent_collection/,
    /record_expense/,
    /restore_account_backup/,
    /pg_advisory_xact_lock/,
    /request_key/,
    /only_one_platform_admin/,
    /protect_record_identity/,
    /prevent_used_record_delete/,
  ]) assert.match(sql, pattern);
  assert.doesNotMatch(sql, /return\s+p_prefix\s*\|\|\s*'-'/i);
});
