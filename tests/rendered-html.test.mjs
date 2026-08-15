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
  const [css, manifest, app, layout, serviceWorker, nextConfig] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/manifest.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/rentwise-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
  ]);
  assert.match(css, /--radius-lg:\s*12px/);
  assert.match(css, /font-family:\s*var\(--font-geist\)/);
  assert.match(css, /\.bottom-nav\s*\{[^}]*position:\s*fixed/s);
  assert.match(css, /--bottom-safe-space:\s*max\(env\(safe-area-inset-bottom\),\s*12px\)/);
  assert.match(css, /\.charge-row\s*\{[^}]*44px/s);
  assert.match(css, /\.detail-footer \.button\s*\{[^}]*min-width:\s*156px/s);
  assert.match(css, /input\[type="date"\][^{]*\{[^}]*min-inline-size:\s*0/s);
  assert.match(css, /input\[type="date"\][^{]*\{[^}]*-webkit-appearance:\s*none/s);
  assert.match(css, /::-webkit-date-and-time-value/);
  assert.match(css, /\.sheet-body\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(css, /\.sheet-actions\s*\{[^}]*position:\s*static/s);
  assert.doesNotMatch(css, /\.sheet-actions\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /\.sheet-actions\s*\{[^}]*minmax\(0,\s*\.8fr\)/s);
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /\.theme-options/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(app, /rentwise-theme/);
  assert.match(app, /className="header-page-context"/);
  assert.doesNotMatch(app, /<div className="mobile-brand"><span className="brand-mark"/);
  assert.match(app, /"light", "Light", Sun/);
  assert.match(app, /"system", "System", Monitor/);
  assert.match(app, /metric-occupied/);
  assert.match(app, /metric-vacant/);
  assert.match(app, /metric-expenses/);
  assert.match(app, /Overall due through today/);
  assert.match(app, /Tenant balances/);
  assert.match(app, /tenant-progress-row/);
  assert.match(app, /Remove property allocation/);
  assert.match(app, /body\.style\.position\s*=\s*"fixed"/);
  assert.match(app, /window\.scrollTo\(0, scrollY\)/);
  assert.match(layout, /themeBootScript/);
  assert.match(layout, /applicationName:\s*"Rento"/);
  assert.match(manifest, /display:\s*"standalone"/);
  assert.match(manifest, /short_name:\s*"Rento"/);
  assert.match(manifest, /icon-512-v3\.png/);
  assert.match(manifest, /icon-192-v3\.png/);
  assert.match(manifest, /purpose:\s*"maskable"/);
  assert.match(app, /updateViaCache:\s*"none"/);
  assert.match(app, /controllerchange/);
  assert.match(serviceWorker, /rento-shell-.*v4/s);
  assert.match(serviceWorker, /\["style", "script", "worker"\]/);
  assert.match(serviceWorker, /fetch\(event\.request\)[\s\S]*catch\(\(\) => caches\.match\(event\.request\)\)/);
  assert.doesNotMatch(serviceWorker, /caches\.match\(event\.request\)\.then\(\(cached\) => cached \|\| fetch\(event\.request\)[\s\S]*\["style", "script"/);
  assert.match(nextConfig, /no-cache, no-store, must-revalidate/);
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
  const [sql, guardSql, billNumberSql, chargeEditSql, app, service] = await Promise.all([
    readFile(new URL("../supabase/migrations/202608140001_rent_billing.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202608150001_rent_invoice_payment_guard.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202608150003_rent_bill_numbers.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202608150004_edit_rent_bill_charges.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/rentwise-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/data-service.ts", import.meta.url), "utf8"),
  ]);
  for (const pattern of [
    /create table if not exists public\.rent_payment_allocations/,
    /unique\(receipt_id, rent_period_id\)/,
    /create or replace function public\.ensure_rent_bills/,
    /create or replace function public\.record_rent_payment/,
    /create or replace function public\.apply_available_rent_credit/,
    /'rent_bill', 'BIL', 6/,
    /A payment allocation exceeds the bill balance/,
    /rentwise-generate-monthly-bills/,
  ]) assert.match(sql, pattern);
  assert.match(app, /Rent bills & payments/);
  assert.match(app, /Oldest due first/);
  assert.match(app, /Remaining as tenant credit/);
  assert.match(app, /Payment activity for this bill/);
  assert.match(app, /Payment history/);
  assert.match(app, /No payments are recorded for this bill/);
  assert.match(app, /Amount left/);
  assert.match(app, /still due/);
  assert.match(app, /Amount due/);
  assert.match(app, /Not counted/);
  assert.match(app, /Edit bill charge/);
  assert.match(app, /Edit .* charge/);
  assert.match(service, /rentBillRemaining/);
  assert.match(service, /rentBillPaymentHistory/);
  assert.match(service, /balanceAfter/);
  assert.match(service, /receiptAllocations/);
  assert.match(service, /replace\(\/\^INV/);
  assert.match(service, /product:\s*"Rento"/);
  assert.match(service, /updateRentBillCharge/);
  assert.match(service, /PGRST202/);
  assert.match(service, /from\("rent_charges"\)\s*\.update/);
  assert.match(app, /\["Rento", "Rentwise"\]/);
  assert.doesNotMatch(sql, /'INV'/);
  assert.match(guardSql, /enforce_rent_invoice_payment_balance/);
  assert.match(guardSql, /pg_advisory_xact_lock/);
  assert.match(guardSql, /v_paid \+ new\.allocated_amount > v_bill_total/);
  assert.match(billNumberSql, /INV000001 becomes BIL000001/);
  assert.match(billNumberSql, /normalize_rent_bill_display_id/);
  assert.match(billNumberSql, /'rent_bill', 'BIL', 6/);
  assert.match(chargeEditSql, /update_rent_bill_charge/);
  assert.match(chargeEditSql, /revised bill total cannot be less than the payments already applied/i);
  assert.match(chargeEditSql, /rent_charges_protect_change/);
});

test("private profile pictures support landlords and tenants", async () => {
  const [app, service, types, migration] = await Promise.all([
    readFile(new URL("../app/rentwise-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/data-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202608140002_profile_images.sql", import.meta.url), "utf8"),
  ]);
  assert.match(types, /avatar_path:\s*string \| null/);
  assert.match(types, /profile_image_path:\s*string \| null/);
  assert.match(app, /function ProfilePhotoPicker/);
  assert.match(app, /name="profilePhoto"/);
  assert.match(app, /ProfileAvatar name=\{tenant\.name\}/);
  assert.match(service, /replaceProfileImage/);
  assert.match(service, /getProfileImageUrl/);
  assert.match(service, /image\\\/\(jpeg\|png\|webp\)/);
  assert.match(migration, /add column if not exists avatar_path text/);
});

test("tenant documents show payment status, signatures and compact A4 print layouts", async () => {
  const [app, css, service, types, demo, migration] = await Promise.all([
    readFile(new URL("../app/rentwise-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/data-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/demo-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202608150002_document_signatures.sql", import.meta.url), "utf8"),
  ]);
  assert.match(app, /function DocumentHeader/);
  assert.match(app, /Amount due/);
  assert.match(app, /function DocumentSignatures/);
  assert.match(app, /Tenant signature/);
  assert.match(app, /<span>Receipt<\/span><span>Method<\/span>/);
  assert.match(app, /function SignaturePicker/);
  assert.match(app, /Document settings/);
  assert.match(app, /maximum 10 MB/);
  assert.match(app, /signature-file-error/);
  assert.doesNotMatch(app, /receipt_name/);
  assert.doesNotMatch(app, /installment/i);
  assert.doesNotMatch(demo, /installment/i);
  assert.match(types, /signature_path:\s*string \| null/);
  assert.match(service, /replaceDocumentSignature/);
  assert.match(service, /removeDocumentSignature/);
  assert.match(service, /saveDocumentSettings/);
  assert.match(service, /Signature upload failed/);
  assert.match(migration, /add column if not exists signature_path text/);
  assert.match(css, /@page\s*\{\s*size:\s*A4 portrait/);
  assert.match(css, /\.receipt-paper\s*\{\s*break-inside:\s*auto/);
  assert.match(css, /\.document-header, \.receipt-party, \.invoice-balance-summary, \.document-signatures, \.receipt-footer\s*\{\s*break-inside:\s*avoid/);
  assert.match(css, /overflow:\s*visible !important/);
  assert.match(css, /\.document-extra-dense/);
});
