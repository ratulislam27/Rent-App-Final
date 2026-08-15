import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cloneDemoWorkspace } from "./demo-data";
import { formatTitleCase } from "./text";
import type {
  Agreement,
  AdminUser,
  Attachment,
  CreateRentPaymentInput,
  Expense,
  ExpenseAllocation,
  LookupOption,
  Profile,
  Property,
  RentCharge,
  RentIncrement,
  RentPeriod,
  RentPaymentAllocation,
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

export const MAX_DOCUMENT_SIGNATURE_BYTES = 10 * 1024 * 1024;

export function validateDocumentSignatureFile(file: Pick<File, "type" | "size">) {
  if (!file.type.match(/^image\/(jpeg|png|webp)$/)) throw new Error("Choose a JPG, PNG or WebP signature image.");
  if (file.size > MAX_DOCUMENT_SIGNATURE_BYTES) throw new Error("Signature images must be 10 MB or smaller.");
}

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

function normalizeWorkspaceNames(workspace: WorkspaceData): WorkspaceData {
  const normalizeLookup = (item: LookupOption) => ({ ...item, name: formatTitleCase(item.name) });
  const normalizeBillNumber = (displayId: string) => displayId.replace(/^INV(?=\d+$)/, "BIL");
  return {
    ...workspace,
    profile: { ...workspace.profile, full_name: formatTitleCase(workspace.profile.full_name) },
    propertyTypes: workspace.propertyTypes.map(normalizeLookup),
    paymentMethods: workspace.paymentMethods.map(normalizeLookup),
    expenseCategories: workspace.expenseCategories.map(normalizeLookup),
    properties: workspace.properties.map((item) => ({ ...item, name: formatTitleCase(item.name) })),
    tenants: workspace.tenants.map((item) => ({ ...item, name: formatTitleCase(item.name) })),
    rentPeriods: workspace.rentPeriods.map((item) => ({ ...item, display_id: normalizeBillNumber(item.display_id) })),
    rentCharges: workspace.rentCharges.map((item) => ({ ...item, reason: formatTitleCase(item.reason) })),
    receipts: workspace.receipts.map((item) => ({ ...item, collected_by: item.collected_by ? formatTitleCase(item.collected_by) : null })),
    expenses: workspace.expenses.map((item) => ({ ...item, description: formatTitleCase(item.description) })),
  };
}

export class RentwiseDataService {
  private demo: WorkspaceData | null;
  private readonly imageUrlCache = new Map<string, { url: string; expiresAt: number }>();

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
    if (!this.client || !user) return normalizeWorkspaceNames(structuredClone(this.demo ?? cloneDemoWorkspace()));
    const ensured = await this.client.rpc("ensure_rent_bills");
    if (ensured.error) throw ensured.error;
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
      "rent_payment_allocations",
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
    const [propertyTypes, paymentMethods, expenseCategories, properties, tenants, agreements, increments, rentPeriods, rentCharges, receipts, paymentAllocations, expenses, allocations, attachments] = results.map((result) => result.data ?? []);
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
    return normalizeWorkspaceNames({
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
      paymentAllocations: coerceNumbers(paymentAllocations as RentPaymentAllocation[]),
      expenses: coerceNumbers(expenses as Expense[]),
      allocations: coerceNumbers(allocations as ExpenseAllocation[]),
      attachments: attachments as Attachment[],
    });
  }

  private requireDemo() {
    if (!this.demo) throw new Error("Demo data is unavailable.");
    return this.demo;
  }

  async createProperty(userId: string, values: Partial<Property>): Promise<Property> {
    const normalizedValues = { ...values, ...(typeof values.name === "string" ? { name: formatTitleCase(values.name) } : {}) };
    if (this.client) {
      const { data, error } = await this.client.from("properties").insert({ ...normalizedValues, user_id: userId }).select().single();
      if (error) throw error;
      return data as Property;
    }
    const workspace = this.requireDemo();
    const now = new Date().toISOString();
    const item: Property = {
      id: temporaryId("property"), user_id: userId, display_id: nextDisplayId("PRP", workspace.properties, 4),
      name: normalizedValues.name ?? "Untitled Property", property_type_id: normalizedValues.property_type_id ?? null,
      location: normalizedValues.location ?? "", status: normalizedValues.status ?? "vacant", notes: normalizedValues.notes ?? "",
      archived_at: null, created_at: now, updated_at: now,
    };
    workspace.properties.push(item);
    return item;
  }

  async updateProperty(id: string, values: Partial<Property>) {
    const normalizedValues = { ...values, ...(typeof values.name === "string" ? { name: formatTitleCase(values.name) } : {}) };
    if (this.client) {
      const { error } = await this.client.from("properties").update(normalizedValues).eq("id", id);
      if (error) throw error;
      return;
    }
    const item = this.requireDemo().properties.find((entry) => entry.id === id);
    if (item) Object.assign(item, normalizedValues, { updated_at: new Date().toISOString() });
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
    const normalizedValues = { ...values, ...(typeof values.name === "string" ? { name: formatTitleCase(values.name) } : {}) };
    if (this.client) {
      const { data, error } = await this.client.from("tenants").insert({ ...normalizedValues, user_id: userId }).select().single();
      if (error) throw error;
      return data as Tenant;
    }
    const workspace = this.requireDemo();
    const now = new Date().toISOString();
    const item: Tenant = {
      id: temporaryId("tenant"), user_id: userId, display_id: nextDisplayId("TEN", workspace.tenants, 4),
      name: normalizedValues.name ?? "Unnamed Tenant", phone: normalizedValues.phone ?? "", email: normalizedValues.email ?? null,
      address: normalizedValues.address ?? "", nid: normalizedValues.nid ?? null, profile_image_path: null,
      notes: normalizedValues.notes ?? "", archived_at: null, created_at: now, updated_at: now,
    };
    workspace.tenants.push(item);
    return item;
  }

  async updateTenant(id: string, values: Partial<Tenant>) {
    const normalizedValues = { ...values, ...(typeof values.name === "string" ? { name: formatTitleCase(values.name) } : {}) };
    if (this.client) {
      const { error } = await this.client.from("tenants").update(normalizedValues).eq("id", id);
      if (error) throw error;
      return;
    }
    const item = this.requireDemo().tenants.find((entry) => entry.id === id);
    if (item) Object.assign(item, normalizedValues, { updated_at: new Date().toISOString() });
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

  async createRentPayment(userId: string, input: CreateRentPaymentInput): Promise<RentReceipt> {
    const collectedBy = formatTitleCase(input.collectedBy);
    if (this.client) {
      const { data, error } = await this.client.rpc("record_rent_payment", {
        p_request_key: input.requestKey,
        p_agreement_id: input.agreementId,
        p_collection_date: input.collectionDate,
        p_amount: input.amount,
        p_payment_method_id: input.paymentMethodId,
        p_collected_by: collectedBy,
        p_notes: input.notes,
        p_allocations: input.allocations.map((item) => ({ rent_period_id: item.rentPeriodId, amount: item.amount })),
      });
      if (error) throw error;
      return coerceNumbers([data as RentReceipt])[0];
    }
    const workspace = this.requireDemo();
    const priorReceipt = workspace.receipts.find((entry) => entry.request_key === input.requestKey);
    if (priorReceipt) return priorReceipt;
    const now = new Date().toISOString();
    const allocationTotal = input.allocations.reduce((sum, item) => sum + item.amount, 0);
    const primaryBill = input.allocations[0]?.rentPeriodId ?? null;
    const receipt: RentReceipt = {
      id: temporaryId("receipt"), user_id: userId, display_id: nextDisplayId("RCV", workspace.receipts, 6), request_key: input.requestKey,
      agreement_id: input.agreementId, rent_period_id: primaryBill, collection_date: input.collectionDate, amount: input.amount,
      unallocated_amount: Math.max(0, input.amount - allocationTotal), payment_method_id: input.paymentMethodId,
      collected_by: collectedBy || null, notes: input.notes, status: "valid", void_reason: null, voided_at: null,
      created_at: now, updated_at: now,
    };
    workspace.receipts.push(receipt);
    workspace.paymentAllocations.push(...input.allocations.filter((item) => item.amount > 0).map((item) => ({
      id: temporaryId("payment-allocation"), user_id: userId, receipt_id: receipt.id,
      rent_period_id: item.rentPeriodId, allocated_amount: item.amount, created_at: now,
    })));
    return receipt;
  }

  async addRentBillCharge(userId: string, rentPeriodId: string, reason: string, amount: number) {
    const normalizedReason = formatTitleCase(reason);
    if (this.client) {
      const { error } = await this.client.rpc("add_rent_bill_charge", {
        p_rent_period_id: rentPeriodId,
        p_reason: normalizedReason,
        p_amount: amount,
      });
      if (error) throw error;
      return;
    }
    this.requireDemo().rentCharges.push({ id: temporaryId("charge"), user_id: userId, rent_period_id: rentPeriodId, reason: normalizedReason, amount, created_at: new Date().toISOString() });
  }

  async updateRentBillCharge(id: string, reason: string, amount: number) {
    const normalizedReason = formatTitleCase(reason);
    if (this.client) {
      const { error } = await this.client.rpc("update_rent_bill_charge", {
        p_charge_id: id,
        p_reason: normalizedReason,
        p_amount: amount,
      });
      if (error) throw error;
      return;
    }
    const workspace = this.requireDemo();
    const charge = workspace.rentCharges.find((item) => item.id === id);
    if (!charge) throw new Error("Bill charge not found.");
    const bill = workspace.rentPeriods.find((item) => item.id === charge.rent_period_id && !item.voided_at);
    if (!bill) throw new Error("This bill can no longer be changed.");
    const otherCharges = workspace.rentCharges
      .filter((item) => item.rent_period_id === bill.id && item.id !== charge.id)
      .reduce((sum, item) => sum + item.amount, 0);
    if (bill.base_rent + otherCharges + amount + 0.01 < rentBillPaid(workspace, bill)) {
      throw new Error("The revised bill total cannot be less than the payments already applied.");
    }
    Object.assign(charge, { reason: normalizedReason, amount });
  }

  async voidReceipt(id: string, reason: string) {
    if (this.client) {
      const { error } = await this.client.rpc("void_rent_receipt", { p_receipt_id: id, p_reason: reason });
      if (error) throw error;
      return;
    }
    const values = { status: "void" as const, void_reason: reason, voided_at: new Date().toISOString() };
    const item = this.requireDemo().receipts.find((entry) => entry.id === id);
    if (item) Object.assign(item, values);
  }

  async createExpense(userId: string, values: Partial<Expense>, allocations: { property_id: string; allocated_amount: number }[], requestKey: string): Promise<Expense> {
    const normalizedDescription = formatTitleCase(values.description ?? "");
    if (this.client) {
      const { data, error } = await this.client.rpc("record_expense", {
        p_request_key: requestKey,
        p_description: normalizedDescription,
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
      description: normalizedDescription || "Untitled Expense", expense_date: values.expense_date!, amount: Number(values.amount ?? 0),
      category_id: values.category_id ?? null, notes: values.notes ?? "", status: "valid", archived_at: null,
      created_at: now, updated_at: now,
    };
    workspace.expenses.push(item);
    workspace.allocations.push(...allocations.map((allocation) => ({ id: temporaryId("allocation"), user_id: userId, expense_id: item.id, ...allocation })));
    return item;
  }

  async updateProfile(id: string, values: Partial<Profile>) {
    const normalizedValues = { ...values, ...(typeof values.full_name === "string" ? { full_name: formatTitleCase(values.full_name) } : {}) };
    if (this.client) {
      const { error } = await this.client.from("profiles").update(normalizedValues).eq("id", id);
      if (error) throw error;
      return;
    }
    Object.assign(this.requireDemo().profile, normalizedValues);
  }

  async replaceProfileImage(userId: string, target: "profile" | "tenant", targetId: string, file: File, previousPath: string | null) {
    if (!file.type.match(/^image\/(jpeg|png|webp)$/)) throw new Error("Choose a JPG, PNG or WebP image.");
    if (file.size > 10 * 1024 * 1024) throw new Error("Profile pictures must be 10 MB or smaller.");
    if (!this.client) {
      if (previousPath?.startsWith("blob:")) URL.revokeObjectURL(previousPath);
      const path = URL.createObjectURL(file);
      if (target === "profile") this.requireDemo().profile.avatar_path = path;
      else {
        const tenant = this.requireDemo().tenants.find((item) => item.id === targetId);
        if (tenant) tenant.profile_image_path = path;
      }
      return path;
    }
    const safeExtension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${userId}/profile-images/${target}/${targetId}/${crypto.randomUUID()}.${safeExtension}`;
    const upload = await this.client.storage.from("rentwise-private").upload(path, file, { contentType: file.type, upsert: false });
    if (upload.error) throw upload.error;
    const table = target === "profile" ? "profiles" : "tenants";
    const values = target === "profile" ? { avatar_path: path } : { profile_image_path: path };
    const update = await this.client.from(table).update(values).eq("id", targetId);
    if (update.error) {
      await this.client.storage.from("rentwise-private").remove([path]);
      throw update.error;
    }
    this.imageUrlCache.delete(previousPath ?? "");
    if (previousPath) await this.client.storage.from("rentwise-private").remove([previousPath]);
    return path;
  }

  async removeProfileImage(target: "profile" | "tenant", targetId: string, previousPath: string | null) {
    if (!previousPath) return;
    if (!this.client) {
      if (previousPath.startsWith("blob:")) URL.revokeObjectURL(previousPath);
      if (target === "profile") this.requireDemo().profile.avatar_path = null;
      else {
        const tenant = this.requireDemo().tenants.find((item) => item.id === targetId);
        if (tenant) tenant.profile_image_path = null;
      }
      return;
    }
    const table = target === "profile" ? "profiles" : "tenants";
    const values = target === "profile" ? { avatar_path: null } : { profile_image_path: null };
    const update = await this.client.from(table).update(values).eq("id", targetId);
    if (update.error) throw update.error;
    this.imageUrlCache.delete(previousPath);
    await this.client.storage.from("rentwise-private").remove([previousPath]);
  }

  async getProfileImageUrl(storagePath: string) {
    if (storagePath.startsWith("blob:")) return storagePath;
    if (!this.client) return null;
    const cached = this.imageUrlCache.get(storagePath);
    if (cached && cached.expiresAt > Date.now()) return cached.url;
    const { data, error } = await this.client.storage.from("rentwise-private").createSignedUrl(storagePath, 3600);
    if (error) throw error;
    this.imageUrlCache.set(storagePath, { url: data.signedUrl, expiresAt: Date.now() + 55 * 60 * 1000 });
    return data.signedUrl;
  }

  async replaceDocumentSignature(userId: string, file: File, previousPath: string | null) {
    validateDocumentSignatureFile(file);
    if (!this.client) {
      if (previousPath?.startsWith("blob:")) URL.revokeObjectURL(previousPath);
      const path = URL.createObjectURL(file);
      this.requireDemo().settings.signature_path = path;
      return path;
    }
    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${userId}/document-signatures/${crypto.randomUUID()}.${extension}`;
    const upload = await this.client.storage.from("rentwise-private").upload(path, file, { contentType: file.type, upsert: false });
    if (upload.error) throw upload.error;
    const update = await this.client.from("user_settings").update({ signature_path: path }).eq("user_id", userId);
    if (update.error) {
      await this.client.storage.from("rentwise-private").remove([path]);
      throw update.error;
    }
    this.imageUrlCache.delete(previousPath ?? "");
    if (previousPath) await this.client.storage.from("rentwise-private").remove([previousPath]);
    return path;
  }

  async removeDocumentSignature(userId: string, previousPath: string | null) {
    if (!previousPath) return;
    if (!this.client) {
      if (previousPath.startsWith("blob:")) URL.revokeObjectURL(previousPath);
      this.requireDemo().settings.signature_path = null;
      return;
    }
    const update = await this.client.from("user_settings").update({ signature_path: null }).eq("user_id", userId);
    if (update.error) throw update.error;
    this.imageUrlCache.delete(previousPath);
    await this.client.storage.from("rentwise-private").remove([previousPath]);
  }

  async updateSettings(userId: string, values: Partial<UserSettings>) {
    if (this.client) {
      const { error } = await this.client.from("user_settings").update(values).eq("user_id", userId);
      if (error) throw error;
      return;
    }
    Object.assign(this.requireDemo().settings, values);
  }

  async saveDocumentSettings(userId: string, values: Partial<UserSettings>, signature: File | null, previousPath: string | null, removeSignature: boolean) {
    if (signature) validateDocumentSignatureFile(signature);
    if (!this.client) {
      const workspace = this.requireDemo();
      let signaturePath = previousPath;
      if (signature) {
        if (previousPath?.startsWith("blob:")) URL.revokeObjectURL(previousPath);
        signaturePath = URL.createObjectURL(signature);
      } else if (removeSignature) {
        if (previousPath?.startsWith("blob:")) URL.revokeObjectURL(previousPath);
        signaturePath = null;
      }
      Object.assign(workspace.settings, values, { signature_path: signaturePath });
      return;
    }

    let nextPath = previousPath;
    let uploadedPath: string | null = null;
    if (signature) {
      const extension = signature.type === "image/png" ? "png" : signature.type === "image/webp" ? "webp" : "jpg";
      uploadedPath = `${userId}/document-signatures/${crypto.randomUUID()}.${extension}`;
      const upload = await this.client.storage.from("rentwise-private").upload(uploadedPath, signature, { contentType: signature.type, upsert: false });
      if (upload.error) throw new Error(`Signature upload failed: ${upload.error.message}`);
      nextPath = uploadedPath;
    } else if (removeSignature) {
      nextPath = null;
    }

    const update = await this.client.from("user_settings").update({ ...values, signature_path: nextPath }).eq("user_id", userId);
    if (update.error) {
      if (uploadedPath) await this.client.storage.from("rentwise-private").remove([uploadedPath]);
      throw new Error(`Document settings could not be saved: ${update.error.message}`);
    }

    if (previousPath !== nextPath) {
      this.imageUrlCache.delete(previousPath ?? "");
      if (previousPath) await this.client.storage.from("rentwise-private").remove([previousPath]);
    }
  }

  async addLookup(table: "property_types" | "payment_methods" | "expense_categories", userId: string, name: string) {
    const normalizedName = formatTitleCase(name);
    if (this.client) {
      const { error } = await this.client.from(table).insert({ user_id: userId, name: normalizedName });
      if (error) throw error;
      return;
    }
    const workspace = this.requireDemo();
    const key = table === "property_types" ? "propertyTypes" : table === "payment_methods" ? "paymentMethods" : "expenseCategories";
    workspace[key].push({ id: temporaryId("option"), user_id: userId, name: normalizedName, is_active: true });
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
        { id: "demo-user-2", email: "samira@example.com", full_name: "Samira Khan", phone: "", address: "", avatar_path: null, is_admin: false, is_active: true, force_password_change: false, created_at: "2026-02-28T08:00:00Z", record_count: 19 },
        { id: "demo-user-3", email: "imran@example.com", full_name: "Imran Chowdhury", phone: "", address: "", avatar_path: null, is_admin: false, is_active: false, force_password_change: false, created_at: "2026-04-03T08:00:00Z", record_count: 8 },
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
    return JSON.stringify({ product: "Rento", version: 2, exportedAt: new Date().toISOString(), data: workspace }, null, 2);
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

export function rentBillTotal(workspace: WorkspaceData, bill: RentPeriod) {
  const charges = workspace.rentCharges
    .filter((charge) => charge.rent_period_id === bill.id)
    .reduce((sum, charge) => sum + charge.amount, 0);
  return bill.base_rent + charges;
}

export function rentBillPaid(workspace: WorkspaceData, bill: RentPeriod) {
  const validReceiptIds = new Set(workspace.receipts.filter((receipt) => receipt.status === "valid").map((receipt) => receipt.id));
  return workspace.paymentAllocations
    .filter((allocation) => allocation.rent_period_id === bill.id && validReceiptIds.has(allocation.receipt_id))
    .reduce((sum, allocation) => sum + allocation.allocated_amount, 0);
}

export function rentBillRemaining(workspace: WorkspaceData, bill: RentPeriod) {
  if (bill.voided_at) return 0;
  return Math.max(0, rentBillTotal(workspace, bill) - rentBillPaid(workspace, bill));
}

export function rentBillStatus(workspace: WorkspaceData, bill: RentPeriod, today = new Date().toISOString().slice(0, 10)) {
  if (bill.voided_at) return "void" as const;
  const paid = rentBillPaid(workspace, bill);
  const total = rentBillTotal(workspace, bill);
  if (paid >= total - 0.01) return "paid" as const;
  if (bill.due_date < today) return "overdue" as const;
  if (paid > 0) return "partially_paid" as const;
  if (bill.due_date > today) return "upcoming" as const;
  return "due" as const;
}

export function rentBillPaymentHistory(workspace: WorkspaceData, bill: RentPeriod) {
  const total = rentBillTotal(workspace, bill);
  let paidToDate = 0;

  return workspace.paymentAllocations
    .filter((allocation) => allocation.rent_period_id === bill.id)
    .map((allocation) => ({
      allocation,
      receipt: workspace.receipts.find((receipt) => receipt.id === allocation.receipt_id),
    }))
    .filter((entry): entry is typeof entry & { receipt: RentReceipt } => Boolean(entry.receipt))
    .sort((left, right) =>
      left.receipt.collection_date.localeCompare(right.receipt.collection_date) ||
      left.receipt.created_at.localeCompare(right.receipt.created_at) ||
      left.allocation.id.localeCompare(right.allocation.id))
    .map(({ allocation, receipt }) => {
      const appliedAmount = receipt.status === "valid" ? allocation.allocated_amount : 0;
      paidToDate += appliedAmount;
      return {
        allocation,
        receipt,
        paymentMethod: workspace.paymentMethods.find((method) => method.id === receipt.payment_method_id) ?? null,
        appliedAmount,
        balanceAfter: Math.max(0, total - paidToDate),
      };
    });
}

export function receiptAllocations(workspace: WorkspaceData, receiptId: string) {
  return workspace.paymentAllocations.filter((allocation) => allocation.receipt_id === receiptId);
}

export function agreementCredit(workspace: WorkspaceData, agreementId: string) {
  return workspace.receipts
    .filter((receipt) => receipt.agreement_id === agreementId && receipt.status === "valid")
    .reduce((sum, receipt) => sum + receipt.unallocated_amount, 0);
}

export function periodBalance(workspace: WorkspaceData, agreementId: string, beforeMonth?: string) {
  const bills = workspace.rentPeriods.filter((bill) =>
    bill.agreement_id === agreementId && !bill.voided_at && (!beforeMonth || bill.rent_month < beforeMonth));
  const due = bills.reduce((sum, bill) => sum + rentBillRemaining(workspace, bill), 0);
  return due - agreementCredit(workspace, agreementId);
}

export function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month.slice(0, 7)}-01T00:00:00Z`));
}
