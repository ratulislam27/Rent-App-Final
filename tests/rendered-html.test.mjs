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

test("server-renders the Rento application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Rento/);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /apple-touch-icon-v3\.png/);
  assert.doesNotMatch(html, /Your site is taking shape|SkeletonPreview|react-loading-skeleton/);
});

test("health endpoint reports a ready service", async () => {
  const response = await render("/api/health");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.service, "rento");
  assert.match(body.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test("mobile design keeps restrained geometry, fixed navigation, themes and reduced motion", async () => {
  const [css, manifest, app, layout] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/manifest.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/rentwise-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(css, /--radius-lg:\s*12px/);
  assert.match(css, /font-family:\s*var\(--font-geist\)/);
  assert.match(css, /\.bottom-nav\s*\{[^}]*position:\s*fixed/s);
  assert.match(css, /--bottom-safe-space:\s*max\(env\(safe-area-inset-bottom\),\s*12px\)/);
  assert.match(css, /\.charge-row\s*\{[^}]*44px/s);
  assert.match(css, /\.detail-footer \.button\s*\{[^}]*min-width:\s*156px/s);
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /\.theme-options/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(app, /rentwise-theme/);
  assert.match(app, /<div className="mobile-brand">\{titleMap\[route\]\}<\/div>/);
  assert.doesNotMatch(app, /<div className="mobile-brand"><span className="brand-mark"/);
  assert.match(app, /"light", "Light", Sun/);
  assert.match(app, /"system", "System", Monitor/);
  assert.match(app, /metric-occupied/);
  assert.match(app, /metric-vacant/);
  assert.match(app, /metric-expenses/);
  assert.match(app, /Remove property allocation/);
  assert.match(layout, /themeBootScript/);
  assert.match(layout, /applicationName:\s*"Rento"/);
  assert.match(manifest, /display:\s*"standalone"/);
  assert.match(manifest, /short_name:\s*"Rento"/);
  assert.match(manifest, /icon-512-v3\.png/);
  assert.match(manifest, /icon-192-v3\.png/);
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

test("rent billing upgrade preserves monthly obligations and allocates multi-bill payments", async () => {
  const [sql, app, service] = await Promise.all([
    readFile(new URL("../supabase/migrations/202608140001_rent_billing.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/rentwise-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/data-service.ts", import.meta.url), "utf8"),
  ]);
  for (const pattern of [
    /create table if not exists public\.rent_payment_allocations/,
    /unique\(receipt_id, rent_period_id\)/,
    /create or replace function public\.ensure_rent_bills/,
    /create or replace function public\.record_rent_payment/,
    /create or replace function public\.apply_available_rent_credit/,
    /'rent_bill', 'INV', 6/,
    /A payment allocation exceeds the bill balance/,
    /rentwise-generate-monthly-bills/,
  ]) assert.match(sql, pattern);
  assert.match(app, /Rent bills & payments/);
  assert.match(app, /Oldest due first/);
  assert.match(app, /Remaining as tenant credit/);
  assert.match(app, /Payments applied to this bill/);
  assert.match(service, /rentBillRemaining/);
  assert.match(service, /receiptAllocations/);
  assert.match(service, /product:\s*"Rento"/);
  assert.match(app, /\["Rento", "Rentwise"\]/);
  assert.doesNotMatch(sql, /'INV-'/);
});
