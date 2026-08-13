import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const configPath = process.argv[2];
if (!configPath) {
  throw new Error("Usage: node scripts/production-smoke.mjs /path/to/production-config.json");
}

const config = JSON.parse(await readFile(configPath, "utf8"));
const projectUrl = config.projectUrl ?? config.url;
const { publishableKey, serviceRoleKey } = config;
if (!projectUrl || !publishableKey || !serviceRoleKey) {
  throw new Error("The production config must contain projectUrl, publishableKey, and serviceRoleKey.");
}

const publicClient = () => createClient(projectUrl, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const serviceClient = createClient(projectUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const accounts = [
  { email: `rentwise-smoke-a-${runId}@example.com`, password: `SmokeA!${randomBytes(12).toString("base64url")}`, name: "Smoke Landlord A" },
  { email: `rentwise-smoke-b-${runId}@example.com`, password: `SmokeB!${randomBytes(12).toString("base64url")}`, name: "Smoke Landlord B" },
];
const createdUserIds = [];
const uploadedPaths = [];
const cleanupErrors = [];

function expectNoError(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function signUp(account) {
  const client = publicClient();
  const { data, error } = await client.auth.signUp({
    email: account.email,
    password: account.password,
    options: { data: { full_name: account.name } },
  });
  if (error) throw new Error(`Sign-up failed: ${error.message}`);
  assert.ok(data.user?.id, "Sign-up did not create a user.");
  assert.ok(data.session?.access_token, "Email confirmation appears to be enabled; the test user received no session.");
  createdUserIds.push(data.user.id);
  return { client, user: data.user };
}

async function row(client, table, filters = {}) {
  let query = client.from(table).select("*");
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const data = expectNoError(await query.single(), `Read ${table}`);
  return data;
}

async function rows(client, table, userId) {
  return expectNoError(await client.from(table).select("*").eq("user_id", userId), `Read ${table}`) ?? [];
}

async function buildBackup(client, userId) {
  const [
    profile, settings, propertyTypes, paymentMethods, expenseCategories, properties, tenants,
    agreements, increments, rentPeriods, rentCharges, receipts, expenses, allocations, attachments,
  ] = await Promise.all([
    row(client, "profiles", { id: userId }),
    row(client, "user_settings", { user_id: userId }),
    rows(client, "property_types", userId),
    rows(client, "payment_methods", userId),
    rows(client, "expense_categories", userId),
    rows(client, "properties", userId),
    rows(client, "tenants", userId),
    rows(client, "agreements", userId),
    rows(client, "rent_increments", userId),
    rows(client, "rent_periods", userId),
    rows(client, "rent_charges", userId),
    rows(client, "rent_receipts", userId),
    rows(client, "expenses", userId),
    rows(client, "expense_allocations", userId),
    rows(client, "attachments", userId),
  ]);
  return {
    profile, settings, propertyTypes, paymentMethods, expenseCategories, properties, tenants,
    agreements, increments, rentPeriods, rentCharges, receipts, expenses, allocations, attachments,
  };
}

async function deleteTemporaryAccount(userId) {
  const tables = [
    "attachments", "rent_receipts", "rent_charges", "rent_periods", "rent_increments",
    "expense_allocations", "expenses", "agreements", "tenants", "properties",
    "property_types", "payment_methods", "expense_categories", "account_sequences",
  ];
  for (const table of tables) {
    const deletion = await serviceClient.from(table).delete().eq("user_id", userId);
    if (deletion.error) throw new Error(`${table}: ${deletion.error.message}`);
  }
  const deletion = await serviceClient.auth.admin.deleteUser(userId);
  if (deletion.error) throw deletion.error;
}

const result = {
  registration: false,
  duplicateEmailBlocked: false,
  accountIsolation: false,
  userSpecificIds: false,
  rentCollection: false,
  expenseRecording: false,
  attachmentPrivacy: false,
  backupRestore: false,
  cleanup: false,
  generatedIds: {},
};

try {
  const accountA = await signUp(accounts[0]);
  const accountB = await signUp(accounts[1]);
  result.registration = true;

  // Auth and PostgREST can be a few seconds apart while a fresh project settles.
  // Waiting briefly avoids treating harmless clock skew as a permissions failure.
  await new Promise((resolve) => setTimeout(resolve, 5_000));

  const duplicateClient = publicClient();
  const duplicate = await duplicateClient.auth.signUp({ email: accounts[0].email, password: accounts[0].password });
  result.duplicateEmailBlocked = Boolean(duplicate.error || duplicate.data.user?.identities?.length === 0 || !duplicate.data.session);
  assert.equal(result.duplicateEmailBlocked, true, "A duplicate email unexpectedly produced another authenticated account.");

  const [typeA, methodA, categoryA, typeB] = await Promise.all([
    row(accountA.client, "property_types", { user_id: accountA.user.id, name: "Flat" }),
    row(accountA.client, "payment_methods", { user_id: accountA.user.id, name: "Cash" }),
    row(accountA.client, "expense_categories", { user_id: accountA.user.id, name: "Maintenance" }),
    row(accountB.client, "property_types", { user_id: accountB.user.id, name: "Flat" }),
  ]);

  const propertyA = expectNoError(await accountA.client.from("properties").insert({
    user_id: accountA.user.id,
    name: "Smoke Test Apartment",
    property_type_id: typeA.id,
    location: "Dhaka",
    status: "vacant",
    notes: "Production smoke test",
  }).select().single(), "Create property A");
  const propertyB = expectNoError(await accountB.client.from("properties").insert({
    user_id: accountB.user.id,
    name: "Isolated Test Property",
    property_type_id: typeB.id,
    location: "Chattogram",
    status: "vacant",
  }).select().single(), "Create property B");

  const tenantA = expectNoError(await accountA.client.from("tenants").insert({
    user_id: accountA.user.id,
    name: "Smoke Test Tenant",
    phone: "+8801700000000",
    email: `tenant-${runId}@example.com`,
    address: "Dhaka",
    nid: "TEST-NID",
  }).select().single(), "Create tenant");

  const agreementA = expectNoError(await accountA.client.from("agreements").insert({
    user_id: accountA.user.id,
    tenant_id: tenantA.id,
    property_id: propertyA.id,
    start_date: "2026-01-01",
    end_date: "2027-12-31",
    security_deposit: 50000,
    notice_period_months: 2,
    monthly_base_rent: 25000,
    collection_offset: 1,
    due_day: 5,
    notes: "Next-month collection smoke test",
  }).select().single(), "Create agreement");
  assert.equal(agreementA.collection_offset, 1, "Next-month collection setting was not stored.");

  const rentRequestKey = randomUUID();
  const rentArguments = {
    p_request_key: rentRequestKey,
    p_agreement_id: agreementA.id,
    p_rent_month: "2026-08-01",
    p_base_rent: 25000,
    p_collection_date: "2026-09-05",
    p_amount: 25500,
    p_payment_method_id: methodA.id,
    p_collected_by: "Smoke Collector",
    p_notes: "Automated production verification",
    p_charges: [{ reason: "Utilities", amount: 500 }],
  };
  const receiptA = expectNoError(await accountA.client.rpc("record_rent_collection", rentArguments), "Record rent");
  const repeatedReceipt = expectNoError(await accountA.client.rpc("record_rent_collection", rentArguments), "Repeat rent request");
  assert.equal(repeatedReceipt.id, receiptA.id, "Rent collection request was not idempotent.");
  const chargesA = await rows(accountA.client, "rent_charges", accountA.user.id);
  assert.equal(chargesA.length, 1, "Repeating a collection duplicated rent charges.");
  result.rentCollection = true;

  const expenseRequestKey = randomUUID();
  const expenseArguments = {
    p_request_key: expenseRequestKey,
    p_description: "Smoke maintenance expense",
    p_expense_date: "2026-08-13",
    p_amount: 1200,
    p_category_id: categoryA.id,
    p_notes: "Automated production verification",
    p_allocations: [{ property_id: propertyA.id, allocated_amount: 1200 }],
  };
  const expenseA = expectNoError(await accountA.client.rpc("record_expense", expenseArguments), "Record expense");
  const repeatedExpense = expectNoError(await accountA.client.rpc("record_expense", expenseArguments), "Repeat expense request");
  assert.equal(repeatedExpense.id, expenseA.id, "Expense request was not idempotent.");
  result.expenseRecording = true;

  const visibleToB = expectNoError(await accountB.client.from("properties").select("id").eq("id", propertyA.id), "Check account isolation");
  assert.equal(visibleToB.length, 0, "Another landlord could read the first landlord's property.");
  result.accountIsolation = true;

  const crossAccountInsert = await accountB.client.from("agreements").insert({
    user_id: accountB.user.id,
    tenant_id: tenantA.id,
    property_id: propertyA.id,
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    monthly_base_rent: 1,
  });
  assert.ok(crossAccountInsert.error, "Cross-account agreement references were not rejected.");

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const storagePath = `${accountA.user.id}/property/${propertyA.id}/${randomUUID()}-smoke.png`;
  uploadedPaths.push(storagePath);
  expectNoError(await accountA.client.storage.from("rentwise-private").upload(storagePath, png, { contentType: "image/png" }), "Upload attachment");
  expectNoError(await accountA.client.from("attachments").insert({
    user_id: accountA.user.id,
    entity_type: "property",
    entity_id: propertyA.id,
    file_name: "smoke.png",
    storage_path: storagePath,
    content_type: "image/png",
    size_bytes: png.length,
  }), "Save attachment metadata");
  const signedForA = await accountA.client.storage.from("rentwise-private").createSignedUrl(storagePath, 60);
  assert.ok(signedForA.data?.signedUrl && !signedForA.error, "The owner could not open the private attachment.");
  const signedForB = await accountB.client.storage.from("rentwise-private").createSignedUrl(storagePath, 60);
  assert.ok(signedForB.error || !signedForB.data?.signedUrl, "Another landlord could sign the first landlord's attachment URL.");
  result.attachmentPrivacy = true;

  result.generatedIds = {
    property: propertyA.display_id,
    tenant: tenantA.display_id,
    agreement: agreementA.display_id,
    receipt: receiptA.display_id,
    expense: expenseA.display_id,
  };
  assert.deepEqual(result.generatedIds, {
    property: "PRP0001",
    tenant: "TEN0001",
    agreement: "AGR0001",
    receipt: "RCV000001",
    expense: "EXP000001",
  });
  assert.equal(propertyB.display_id, "PRP0001", "IDs are not scoped independently per landlord.");
  assert.ok(Object.values(result.generatedIds).every((id) => !id.includes("-")), "A generated ID contains a hyphen.");
  result.userSpecificIds = true;

  const backup = await buildBackup(accountA.client, accountA.user.id);
  expectNoError(await accountA.client.rpc("restore_account_backup", { p_backup: backup, p_confirmation: "RESTORE" }), "Restore backup");
  const restoredReceipt = await row(accountA.client, "rent_receipts", { id: receiptA.id });
  const restoredExpense = await row(accountA.client, "expenses", { id: expenseA.id });
  assert.equal(restoredReceipt.display_id, "RCV000001");
  assert.equal(restoredExpense.display_id, "EXP000001");
  const nextProperty = expectNoError(await accountA.client.from("properties").insert({
    user_id: accountA.user.id,
    name: "Post-restore sequence check",
    property_type_id: typeA.id,
    status: "vacant",
  }).select().single(), "Create post-restore property");
  assert.equal(nextProperty.display_id, "PRP0002", "Backup restore did not preserve the account ID sequence.");
  result.backupRestore = true;
} finally {
  if (uploadedPaths.length) {
    const removal = await serviceClient.storage.from("rentwise-private").remove(uploadedPaths);
    if (removal.error) cleanupErrors.push(`storage: ${removal.error.message}`);
  }
  const listed = await serviceClient.auth.admin.listUsers({ page: 1, perPage: 1_000 });
  if (listed.error) cleanupErrors.push(`list users: ${listed.error.message}`);
  const temporaryUserIds = new Set([
    ...createdUserIds,
    ...(listed.data?.users ?? []).filter((user) => user.email?.startsWith("rentwise-smoke-")).map((user) => user.id),
  ]);
  for (const userId of [...temporaryUserIds].reverse()) {
    try {
      await deleteTemporaryAccount(userId);
    } catch (reason) {
      cleanupErrors.push(reason instanceof Error ? reason.message : "unknown cleanup error");
    }
  }
  result.cleanup = cleanupErrors.length === 0;
}

if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Production smoke-test cleanup failed.");
console.log(JSON.stringify(result, null, 2));
