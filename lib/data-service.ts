import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cloneDemoWorkspace } from "./demo-data";
import type {
  Agreement,
  AdminUser,
  Attachment,
  CreateReceiptInput,
  Expense,
  ExpenseAllocation,
  LookupOption,
  Profile,
  Property,
  RentCharge,
  RentIncrement,
  RentPeriod,
  RentReceipt,
  Tenant,
  UserSettings,
  WorkspaceData,
} from "./types";

const numberFields = new Set([
  "security_deposit",
  "monthly_base_rent",
  "new_base_rent",
  "base_rent",
  "amount",
  "allocated_amount",
]);

function coerceNumbers<T>(rows: T[]): T[] {
  return rows.map((row) => {
    const output = { ...(row as Record<string, unknown>) };
    for (const field of numberFields) {
      if (field in output && output[field] !== null) output[field] = Number(output[field]);
    }
    return output as T;
  });
}

function temporaryId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function nextDisplayId(prefix: string, records: { display_id: string }[], width: number) {
  const current = records.reduce((max, item) => Math.max(max, Number(item.display_id.replace(prefix, "")) || 0), 0);
  return `${prefix}${String(current + 1).padStart(width, "0")}`;
}

export class RentwiseDataService {
  private demo: WorkspaceData | null;

  constructor(private readonly client: SupabaseClient | null) {
    this.demo = client ? null : cloneDemoWorkspace();
  }

  get isDemo() {
    return !this.client;
  }

  resetDemo() {
    this.demo = cloneDemoWorkspace();
  }

  async loadWorkspace(user: User | null): Promise<WorkspaceData> {
    if (!this.client || !user) return structuredClone(this.demo ?? cloneDemoWorkspace());
    const tables = [
      "property_types",
      "payment_methods",
      "expense_categories",
      "properties",
      "tenants",
      "agreements",
      "rent_increments",
      "rent_periods",
      "rent_charges",
      "rent_receipts",
      "expenses",
      "expense_allocations",
      "attachments",
    ] as const;
    const [profileResult, settingsResult, ...results] = await Promise.all([
      this.client.from("profiles").select("*").eq("id", user.id).single(),
      this.client.from("user_settings").select("*").eq("user_id", user.id).single(),
      ...tables.map((table) => this.client!.from(table).select("*").eq("user_id", user.id)),
    ]);
    const failed = [profileResult, settingsResult, ...results].find((result) => result.error);
    if (failed?.error) throw failed.error;
    const [propertyTypes, paymentMethods, expenseCategories, properties, tenants, agreements, increments, rentPeriods, rentCharges, receipts, expenses, allocations, attachments] = results.map((result) => result.data ?? []);
    if (!profileResult.data || !settingsResult.data) throw new Error("Your account profile is not ready yet. Please sign out and try again.");
    const typedAgreements = coerceNumbers(agreements as Agreement[]);
    const currentDate = new Date().toISOString().slice(0, 10);
    const computedProperties = (properties as Property[]).map((property) => ({
      ...property,
      status: property.status === "maintenance"
        ? "maintenance" as const
        : typedAgreements.some((agreement) => !agreement.archived_at && agreement.property_id === property.id && agreementStatus(agreement, currentDate) === "active")
          ? "occupied" as const
          : "vacant" as const,
    }));
    return {
      profile: profileResult.data as Profile,
      settings: settingsResult.data as UserSettings,
      propertyTypes: propertyTypes as LookupOption[],
      paymentMethods: paymentMethods as LookupOption[],
      expenseCategories: expenseCategories as LookupOption[],
      properties: computedProperties,
      tenants: tenants as Tenant[],
      agreements: typedAgreements,
      increments: coerceNumbers(increments as RentIncrement[]),
      rentPeriods: coerceNumbers(rentPeriods as RentPeriod[]),
      rentCharges: coerceNumbers(rentCharges as RentCharge[]),
      receipts: coerceNumbers(receipts as RentReceipt[]),
      expenses: coerceNumbers(expenses as Expense[]),
      allocations: coerceNumbers(allocations as ExpenseAllocation[]),
      attachments: attachments as Attachment[],
    };
  }

  private requireDemo() {
    if (!this.demo) throw new Error("Demo data is unavailable.");
    return this.demo;
  }

  async createProperty(userId: string, values: Partial<Property>): Promise<Property> {
    if (this.client) {
      const { data, error } = await this.client.from("properties").insert({ ...values, user_id: userId }).select().single();
      if (error) throw error;
      return data as Property;
    }
    const workspace = this.requireDemo();
    const now = new Date().toISOString();
    const item: Property = {
      id: temporaryId("property"), user_id: userId, display_id: nextDisplayId("PRP", workspace.properties, 4),
      name: values.name ?? "Untitled property", property_type_id: values.property_type_id ?? null,
      location: values.location ?? "", status: values.status ?? "vacant", notes: values.notes ?? "",
      archived_at: null, created_at: now, updated_at: now,
    };
    workspace.properties.push(item);
    return item;
  }

  async updateProperty(id: string, values: Partial<Property>) {
    if (this.client) {
      const { error } = await this.client.from("properties").update(values).eq("id", id);
      if (error) throw error;
      return;
    }
    const item = this.requireDemo().properties.find((entry) => entry.id === id);
    if (item) Object.assign(item, values, { updated_at: new Date().toISOString() });
  }

  async deleteUnusedProperty(id: string) {
    if (this.client) {
      const { error } = await this.client.from("properties").delete().eq("id", id);
      if (error) throw error;
      return;
    }
    const workspace = this.requireDemo();
    if (workspace.agreements.some((item) => item.property_id === id) || workspace.allocations.some((item) => item.property_id === id) || workspace.attachments.some((item) => item.entity_type === "property" && item.entity_id === id)) {
      throw new Error("A property connected to another record cannot be deleted.");
    }
    workspace.properties = workspace.properties.filter((item) => item.id !== id);
  }

  async createTenant(userId: string, values: Partial<Tenant>): Promise<Tenant> {
    if (this.client) {
      const { data, error } = await this.client.from("tenants").insert({ ...values, user_id: userId }).select().single();
      if (error) throw error;
      return data as Tenant;
    }
    const workspace = this.requireDemo();
    const now = new Date().toISOString();
    const item: Tenant = {
      id: temporaryId("tenant"), user_id: userId, display_id: nextDisplayId("TEN", workspace.tenants, 4),
      name: values.name ?? "Unnamed tenant", phone: values.phone ?? "", email: values.email ?? null,
      address: values.address ?? "", nid: values.nid ?? null, profile_image_path: null,
      notes: values.notes ?? "", archived_at: null, created_at: now, updated_at: now,
    };
    workspace.tenants.push(item);
    return item;
  }

  async updateTenant(id: string, values: Partial<Tenant>) {
    if (this.client) {
      const { error } = await this.client.from("tenants").update(values).eq("id", id);
      if (error) throw error;
      return;
    }
    const item = this.requireDemo().tenants.find((entry) => entry.id === id);
    if (item) Object.assign(item, values, { updated_at: new Date().toISOString() });
  }

  async deleteUnusedTenant(id: string) {
    if (this.client) {
      const { error } = await this.client.from("tenants").delete().eq("id", id);
      if (error) throw error;
      return;
    }
    const workspace = this.requireDemo();
    if (workspace.agreements.some((item) => item.tenant_id === id) || workspace.attachments.some((item) => item.entity_type === "tenant" && item.entity_id === id)) {
      throw new Error("A tenant connected to another record cannot be deleted.");
    }
    workspace.tenants = workspace.tenants.filter((item) => item.id !== id);
  }

  async createAgreement(userId: string, values: Partial<Agreement>): Promise<Agreement> {
    if (this.client) {
      const { data, error } = await this.client.from("agreements").insert({ ...values, user_id: userId }).select().single();
      if (error) throw error;
      return coerceNumbers([data as Agreement])[0];
    }
    const workspace = this.requireDemo();
    const now = new Date().toISOString();
    const item: Agreement = {
      id: temporaryId("agreement"), user_id: userId, display_id: nextDisplayId("AGR", workspace.agreements, 4),
      tenant_id: values.tenant_id!, property_id: values.property_id!, start_date: values.start_date!, end_date: values.end_date!,
      security_deposit: Number(values.security_deposit ?? 0), notice_period_months: Number(values.notice_period_months ?? 0),
      monthly_base_rent: Number(values.monthly_base_rent ?? 0), collection_offset: values.collection_offset ?? 0,
      due_day: Number(values.due_day ?? 1), notes: values.notes ?? "", terminated_on: null,
      termination_note: null, archived_at: null, created_at: now, updated_at: now,
    };
    workspace.agreements.push(item);
    const property = workspace.properties.find((entry) => entry.id === item.property_id);
    if (property) property.status = "occupied";
    return item;
  }

  async updateAgreement(id: string, values: Partial<Agreement>) {
    if (this.client) {
      const { error } = await this.client.from("agreements").update(values).eq("id", id);
      if (error) throw error;
      return;
    }
    const workspace = this.requireDemo();
    const item = workspace.agreements.find((entry) => entry.id === id);
    if (item) {
      Object.assign(item, values, { updated_at: new Date().toISOString() });
      if (values.terminated_on) {
        const property = workspace.properties.find((entry) => entry.id === item.property_id);
        if (property) property.status = "vacant";
      }
    }
  }

  async addIncrement(userId: string, values: Omit<RentIncrement, "id" | "user_id" | "created_at">) {
    if (this.client) {
      const { error } = await this.client.from("rent_increments").insert({ ...values, user_id: userId });
      if (error) throw error;
      return;
    }
    this.requireDemo().increments.push({ ...values, id: temporaryId("increment"), user_id: userId, created_at: new Date().toISOString() });
  }

  async createReceipt(userId: string, input: CreateReceiptInput): Promise<RentReceipt> {
    const rentMonth = `${input.rentMonth.slice(0, 7)}-01`;
    if (this.client) {
      const { data, error } = await this.client.rpc("record_rent_collection", {
        p_request_key: input.requestKey,
        p_agreement_id: input.agreementId,
        p_rent_month: rentMonth,
        p_base_rent: input.baseRent,
        p_collection_date: input.collectionDate,
        p_amount: input.amount,
        p_payment_method_id: input.paymentMethodId,
        p_collected_by: input.collectedBy,
        p_notes: input.notes,
        p_charges: input.charges,
      });
      if (error) throw error;
      return coerceNumbers([data as RentReceipt])[0];
    }
    const workspace = this.requireDemo();
    const priorReceipt = workspace.receipts.find((entry) => entry.request_key === input.requestKey);
    if (priorReceipt) return priorReceipt;
    const now = new Date().toISOString();
    let period = workspace.rentPeriods.find((entry) => entry.agreement_id === input.agreementId && entry.rent_month === rentMonth);
    if (!period) {
      period = { id: temporaryId("period"), user_id: userId, agreement_id: input.agreementId, rent_month: rentMonth, base_rent: input.baseRent, created_at: now, updated_at: now };
      workspace.rentPeriods.push(period);
    }
    workspace.rentCharges.push(...input.charges.map((charge) => ({ id: temporaryId("charge"), user_id: userId, rent_period_id: period!.id, reason: charge.reason, amount: charge.amount, created_at: now })));
    const receipt: RentReceipt = {
      id: temporaryId("receipt"), user_id: userId, display_id: nextDisplayId("RCV", workspace.receipts, 6), request_key: input.requestKey, rent_period_id: period.id,
      collection_date: input.collectionDate, amount: input.amount, payment_method_id: input.paymentMethodId,
      collected_by: input.collectedBy || null, notes: input.notes, status: "valid", void_reason: null, voided_at: null,
      created_at: now, updated_at: now,
    };
    workspace.receipts.push(receipt);
    return receipt;
  }

  async voidReceipt(id: string, reason: string) {
    const values = { status: "void", void_reason: reason, voided_at: new Date().toISOString() };
    if (this.client) {
      const { error } = await this.client.from("rent_receipts").update(values).eq("id", id);
      if (error) throw error;
      return;
    }
    const item = this.requireDemo().receipts.find((entry) => entry.id === id);
    if (item) Object.assign(item, values);
  }

  async createExpense(userId: string, values: Partial<Expense>, allocations: { property_id: string; allocated_amount: number }[], requestKey: string): Promise<Expense> {
    if (this.client) {
      const { data, error } = await this.client.rpc("record_expense", {
        p_request_key: requestKey,
        p_description: values.description ?? "",
        p_expense_date: values.expense_date,
        p_amount: values.amount ?? 0,
        p_category_id: values.category_id,
        p_notes: values.notes ?? "",
        p_allocations: allocations,
      });
      if (error) throw error;
      return coerceNumbers([data as Expense])[0];
    }
    const workspace = this.requireDemo();
    const priorExpense = workspace.expenses.find((entry) => entry.request_key === requestKey);
    if (priorExpense) return priorExpense;
    const now = new Date().toISOString();
    const item: Expense = {
      id: temporaryId("expense"), user_id: userId, display_id: nextDisplayId("EXP", workspace.expenses, 6), request_key: requestKey,
      description: values.description ?? "Untitled expense", expense_date: values.expense_date!, amount: Number(values.amount ?? 0),
      category_id: values.category_id ?? null, notes: values.notes ?? "", status: "valid", archived_at: null,
      created_at: now, updated_at: now,
    };
    workspace.expenses.push(item);
    workspace.allocations.push(...allocations.map((allocation) => ({ id: temporaryId("allocation"), user_id: userId, expense_id: item.id, ...allocation })));
    return item;
  }

  async updateProfile(id: string, values: Partial<Profile>) {
    if (this.client) {
      const { error } = await this.client.from("profiles").update(values).eq("id", id);
      if (error) throw error;
      return;
    }
    Object.assign(this.requireDemo().profile, values);
  }

  async updateSettings(userId: string, values: Partial<UserSettings>) {
    if (this.client) {
      const { error } = await this.client.from("user_settings").update(values).eq("user_id", userId);
      if (error) throw error;
      return;
    }
    Object.assign(this.requireDemo().settings, values);
  }

  async addLookup(table: "property_types" | "payment_methods" | "expense_categories", userId: string, name: string) {
    if (this.client) {
      const { error } = await this.client.from(table).insert({ user_id: userId, name });
      if (error) throw error;
      return;
    }
    const workspace = this.requireDemo();
    const key = table === "property_types" ? "propertyTypes" : table === "payment_methods" ? "paymentMethods" : "expenseCategories";
    workspace[key].push({ id: temporaryId("option"), user_id: userId, name, is_active: true });
  }

  async toggleLookup(table: "property_types" | "payment_methods" | "expense_categories", id: string, active: boolean) {
    if (this.client) {
      const { error } = await this.client.from(table).update({ is_active: active }).eq("id", id);
      if (error) throw error;
      return;
    }
    const workspace = this.requireDemo();
    const list = table === "property_types" ? workspace.propertyTypes : table === "payment_methods" ? workspace.paymentMethods : workspace.expenseCategories;
    const item = list.find((entry) => entry.id === id);
    if (item) item.is_active = active;
  }

  async listAdminUsers(): Promise<AdminUser[]> {
    if (!this.client) {
      return [
        { ...this.requireDemo().profile, id: "demo-landlord", record_count: 13 },
        { id: "demo-user-2", email: "samira@example.com", full_name: "Samira Khan", phone: "", address: "", is_admin: false, is_active: true, force_password_change: false, created_at: "2026-02-28T08:00:00Z", record_count: 19 },
        { id: "demo-user-3", email: "imran@example.com", full_name: "Imran Chowdhury", phone: "", address: "", is_admin: false, is_active: false, force_password_change: false, created_at: "2026-04-03T08:00:00Z", record_count: 8 },
      ];
    }
    const { data, error } = await this.client.from("profiles").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as AdminUser[];
  }

  async uploadAttachment(userId: string, entityType: Attachment["entity_type"], entityId: string, file: File) {
    if (!this.client) return;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${userId}/${entityType}/${entityId}/${crypto.randomUUID()}-${safeName}`;
    const upload = await this.client.storage.from("rentwise-private").upload(path, file, { upsert: false });
    if (upload.error) throw upload.error;
    const metadata = await this.client.from("attachments").insert({ user_id: userId, entity_type: entityType, entity_id: entityId, file_name: file.name, storage_path: path, content_type: file.type || null, size_bytes: file.size });
    if (metadata.error) {
      await this.client.storage.from("rentwise-private").remove([path]);
      throw metadata.error;
    }
  }

  async getAttachmentUrl(storagePath: string) {
    if (!this.client) return null;
    const { data, error } = await this.client.storage.from("rentwise-private").createSignedUrl(storagePath, 60);
    if (error) throw error;
    return data.signedUrl;
  }

  exportBackup(workspace: WorkspaceData) {
    return JSON.stringify({ product: "Rentwise", version: 1, exportedAt: new Date().toISOString(), data: workspace }, null, 2);
  }

  async restoreBackup(data: WorkspaceData, confirmation: string) {
    if (this.client) {
      const { error } = await this.client.rpc("restore_account_backup", { p_backup: data, p_confirmation: confirmation });
      if (error) throw error;
      return;
    }
    if (confirmation !== "RESTORE") throw new Error("Type RESTORE to confirm.");
    if (data.profile.id !== this.requireDemo().profile.id) throw new Error("This backup belongs to a different landlord account.");
    this.demo = structuredClone(data);
  }
}

export function rentForMonth(agreement: Agreement, increments: RentIncrement[], month: string) {
  const normalized = `${month.slice(0, 7)}-01`;
  const applicable = increments
    .filter((item) => item.agreement_id === agreement.id && item.start_month <= normalized && (!item.end_month || item.end_month >= normalized))
    .sort((a, b) => b.start_month.localeCompare(a.start_month))[0];
  return applicable?.new_base_rent ?? agreement.monthly_base_rent;
}

export function agreementStatus(agreement: Agreement, today = "2026-08-13"): "upcoming" | "active" | "ended" | "terminated" {
  if (agreement.terminated_on) return "terminated";
  if (agreement.start_date > today) return "upcoming";
  if (agreement.end_date < today) return "ended";
  return "active";
}

export function periodBalance(workspace: WorkspaceData, agreementId: string, beforeMonth?: string) {
  const agreement = workspace.agreements.find((item) => item.id === agreementId);
  if (!agreement) return 0;
  const moveMonth = (month: string, offset: number) => {
    const [year, monthNumber] = month.slice(0, 7).split("-").map(Number);
    return new Date(Date.UTC(year, monthNumber - 1 + offset, 1)).toISOString().slice(0, 7);
  };
  const currentCollectionMonth = new Date().toISOString().slice(0, 7);
  const agreementLastMonth = (agreement.terminated_on ?? agreement.end_date).slice(0, 7);
  const requestedLastMonth = beforeMonth
    ? moveMonth(beforeMonth, -1)
    : moveMonth(currentCollectionMonth, -agreement.collection_offset);
  const lastMonth = requestedLastMonth < agreementLastMonth ? requestedLastMonth : agreementLastMonth;
  let cursor = agreement.start_date.slice(0, 7);
  let obligations = 0;
  for (let guard = 0; cursor <= lastMonth && guard < 1200; guard += 1) {
    const normalized = `${cursor}-01`;
    const recorded = workspace.rentPeriods.find((period) => period.agreement_id === agreementId && period.rent_month === normalized);
    obligations += recorded?.base_rent ?? rentForMonth(agreement, workspace.increments, cursor);
    cursor = moveMonth(cursor, 1);
  }
  const duePeriodIds = workspace.rentPeriods
    .filter((period) => period.agreement_id === agreementId && period.rent_month.slice(0, 7) <= lastMonth)
    .map((period) => period.id);
  obligations += workspace.rentCharges
    .filter((charge) => duePeriodIds.includes(charge.rent_period_id))
    .reduce((sum, charge) => sum + charge.amount, 0);
  const payablePeriodIds = workspace.rentPeriods
    .filter((period) => period.agreement_id === agreementId && (!beforeMonth || period.rent_month < beforeMonth))
    .map((period) => period.id);
  const payments = workspace.receipts
    .filter((receipt) => receipt.status === "valid" && payablePeriodIds.includes(receipt.rent_period_id))
    .reduce((sum, receipt) => sum + receipt.amount, 0);
  return obligations - payments;
}

export function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month.slice(0, 7)}-01T00:00:00Z`));
}
