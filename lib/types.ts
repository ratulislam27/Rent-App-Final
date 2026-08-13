export type Id = string;
export type PropertyStatus = "vacant" | "occupied" | "maintenance";
export type AgreementStatus = "upcoming" | "active" | "ended" | "terminated";

export interface Profile {
  id: Id;
  email: string;
  full_name: string;
  phone: string;
  address: string;
  is_admin: boolean;
  is_active: boolean;
  force_password_change: boolean;
  created_at: string;
}

export interface UserSettings {
  user_id: Id;
  currency_code: string;
  currency_symbol: string;
  timezone: string;
  date_format: string;
  receipt_name: string;
  receipt_phone: string;
  receipt_address: string;
  receipt_logo_path?: string | null;
}

export interface LookupOption {
  id: Id;
  user_id: Id;
  name: string;
  is_active: boolean;
}

export interface Property {
  id: Id;
  user_id: Id;
  display_id: string;
  name: string;
  property_type_id: Id | null;
  location: string;
  status: PropertyStatus;
  notes: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Tenant {
  id: Id;
  user_id: Id;
  display_id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string;
  nid: string | null;
  profile_image_path: string | null;
  notes: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Agreement {
  id: Id;
  user_id: Id;
  display_id: string;
  tenant_id: Id;
  property_id: Id;
  start_date: string;
  end_date: string;
  security_deposit: number;
  notice_period_months: number;
  monthly_base_rent: number;
  collection_offset: 0 | 1;
  due_day: number;
  notes: string;
  terminated_on: string | null;
  termination_note: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RentIncrement {
  id: Id;
  user_id: Id;
  agreement_id: Id;
  start_month: string;
  end_month: string | null;
  new_base_rent: number;
  note: string;
  created_at: string;
}

export interface RentPeriod {
  id: Id;
  user_id: Id;
  agreement_id: Id;
  rent_month: string;
  base_rent: number;
  created_at: string;
  updated_at: string;
}

export interface RentCharge {
  id: Id;
  user_id: Id;
  rent_period_id: Id;
  reason: string;
  amount: number;
  created_at: string;
}

export interface RentReceipt {
  id: Id;
  user_id: Id;
  display_id: string;
  request_key?: string;
  rent_period_id: Id;
  collection_date: string;
  amount: number;
  payment_method_id: Id | null;
  collected_by: string | null;
  notes: string;
  status: "valid" | "void";
  void_reason: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Expense {
  id: Id;
  user_id: Id;
  display_id: string;
  request_key?: string;
  description: string;
  expense_date: string;
  amount: number;
  category_id: Id | null;
  notes: string;
  status: "valid" | "void";
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseAllocation {
  id: Id;
  user_id: Id;
  expense_id: Id;
  property_id: Id;
  allocated_amount: number;
}

export interface Attachment {
  id: Id;
  user_id: Id;
  entity_type: "tenant" | "property" | "agreement" | "receipt" | "expense";
  entity_id: Id;
  file_name: string;
  storage_path: string;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

export interface WorkspaceData {
  profile: Profile;
  settings: UserSettings;
  propertyTypes: LookupOption[];
  paymentMethods: LookupOption[];
  expenseCategories: LookupOption[];
  properties: Property[];
  tenants: Tenant[];
  agreements: Agreement[];
  increments: RentIncrement[];
  rentPeriods: RentPeriod[];
  rentCharges: RentCharge[];
  receipts: RentReceipt[];
  expenses: Expense[];
  allocations: ExpenseAllocation[];
  attachments: Attachment[];
}

export interface ChargeInput {
  reason: string;
  amount: number;
}

export interface CreateReceiptInput {
  requestKey: string;
  agreementId: Id;
  rentMonth: string;
  baseRent: number;
  collectionDate: string;
  amount: number;
  paymentMethodId: Id | null;
  collectedBy: string;
  notes: string;
  charges: ChargeInput[];
}

export interface AdminUser extends Profile {
  record_count?: number;
}
