"use client";

import {
  Archive,
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleStop,
  CreditCard,
  DatabaseBackup,
  Download,
  Eye,
  EyeOff,
  FileDown,
  FilePlus2,
  FileText,
  Home,
  Info,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  Pencil,
  Phone,
  Plus,
  Printer,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Store,
  Tags,
  Trash2,
  Upload,
  UserPlus,
  UserRound,
  Users,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { agreementStatus, monthLabel, periodBalance, rentForMonth, RentwiseDataService } from "@/lib/data-service";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import type {
  AdminUser,
  Agreement,
  ChargeInput,
  Expense,
  LookupOption,
  Property,
  RentReceipt,
  Tenant,
  WorkspaceData,
} from "@/lib/types";

type MainRoute = "home" | "properties" | "tenants" | "collections" | "more";
type Route = MainRoute | "agreements" | "expenses" | "reports" | "settings" | "admin";
type Detail = { kind: "property" | "tenant" | "agreement" | "receipt" | "expense"; id: string } | null;
type FormKind = "property" | "tenant" | "agreement" | "collection" | "expense" | "increment" | "profile" | "receipt-settings" | "lookup" | "password" | null;

const today = new Date();
const todayISO = today.toISOString().slice(0, 10);
const currentMonth = todayISO.slice(0, 7);
const currentMonthStart = `${currentMonth}-01`;

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function formatMoney(value: number, symbol = "৳") {
  return `${symbol}${Math.round(value).toLocaleString("en-BD")}`;
}

function formatDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "RW";
}

function safeNumber(value: FormDataEntryValue | null) {
  return Number(value || 0);
}

function idSuffix(value: string | null) {
  if (!value) return "Not provided";
  return `•••• ${value.slice(-4)}`;
}

function shiftMonth(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}

function activeAgreement(workspace: WorkspaceData, propertyId?: string, tenantId?: string) {
  return workspace.agreements.find((agreement) =>
    !agreement.archived_at && agreementStatus(agreement, todayISO) === "active" &&
    (!propertyId || agreement.property_id === propertyId) && (!tenantId || agreement.tenant_id === tenantId));
}

function IconTile({ icon: Icon, tone = "neutral" }: { icon: LucideIcon; tone?: "neutral" | "positive" | "warning" | "danger" }) {
  return <span className={cn("icon-tile", `icon-tile-${tone}`)}><Icon size={18} strokeWidth={1.8} /></span>;
}

function StatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "positive" | "warning" | "danger" | "info" }) {
  return <span className={cn("status-pill", `status-${tone}`)}><span className="status-dot" />{children}</span>;
}

function EmptyState({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state"><Icon size={28} strokeWidth={1.5} /><h3>{title}</h3><p>{text}</p>{action}</div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}

function AttachmentList({ workspace, service, entityType, entityId, onError }: { workspace: WorkspaceData; service: RentwiseDataService; entityType: "tenant" | "property" | "agreement" | "receipt" | "expense"; entityId: string; onError: (message: string) => void }) {
  const files = workspace.attachments.filter((item) => item.entity_type === entityType && item.entity_id === entityId);
  if (!files.length) return null;
  return <section className="page-section"><SectionHeading title="Attachments" /><div className="record-list">{files.map((file) => <button className="record-row" type="button" key={file.id} onClick={async () => { try { const url = await service.getAttachmentUrl(file.storage_path); if (url) window.open(url, "_blank", "noopener,noreferrer"); } catch (reason) { onError(reason instanceof Error ? reason.message : "The attachment could not be opened."); } }}><IconTile icon={FileText} /><span className="record-main"><strong>{file.file_name}</strong><small>{file.content_type ?? "File"}{file.size_bytes ? ` · ${Math.ceil(file.size_bytes / 1024)} KB` : ""}</small></span><Eye size={17} /></button>)}</div></section>;
}

function Sheet({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="sheet-layer" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className={cn("sheet", wide && "sheet-wide")} role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet-grabber" />
      <header className="sheet-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={19} /></button></header>
      <div className="sheet-body">{children}</div>
    </section>
  </div>;
}

function ConfirmDialog({ title, text, confirmLabel, tone = "primary", onConfirm, onClose, inputLabel }: { title: string; text: string; confirmLabel: string; tone?: "primary" | "danger"; onConfirm: (value?: string) => void | Promise<void>; onClose: () => void; inputLabel?: string }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  return <Sheet title={title} subtitle={text} onClose={onClose}>
    {inputLabel && <Field label={inputLabel}><textarea value={value} onChange={(event) => setValue(event.target.value)} required /></Field>}
    <div className="sheet-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className={cn("button", tone === "danger" ? "button-danger" : "button-primary")} type="button" disabled={busy || Boolean(inputLabel && !value.trim())} onClick={async () => { setBusy(true); await onConfirm(value.trim()); setBusy(false); }}>{busy && <LoaderCircle className="spin" size={16} />}{confirmLabel}</button></div>
  </Sheet>;
}

function Toast({ message }: { message: string }) {
  return <div className="toast" role="status"><Check size={16} />{message}</div>;
}

function LoadingScreen() {
  return <main className="loading-screen"><div className="brand-mark"><Building2 size={22} /></div><LoaderCircle className="spin" size={24} /><span>Preparing your workspace</span></main>;
}

function AuthScreen({ service, onDemo, onAuthenticated }: { service: RentwiseDataService; onDemo: () => void; onAuthenticated: (user: User) => void }) {
  const [mode, setMode] = useState<"login" | "register" | "admin">("login");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const client = getSupabaseBrowserClient();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");
    try {
      if (mode === "register") {
        const fullName = String(form.get("name") || "").trim();
        const confirmation = String(form.get("confirmation") || "");
        if (password !== confirmation) throw new Error("The passwords do not match.");
        const { data, error: signUpError } = await client.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
        if (signUpError) throw signUpError;
        if (!data.user) throw new Error("Account creation did not complete.");
        if (!data.session) throw new Error("Email confirmation is enabled in Supabase. Disable Confirm Email for the agreed instant signup flow.");
        onAuthenticated(data.user);
      } else {
        const { data, error: signInError } = await client.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        if (!data.user) throw new Error("Sign in did not complete.");
        if (mode === "admin") {
          const { data: profile } = await client.from("profiles").select("is_admin,is_active").eq("id", data.user.id).single();
          if (!profile?.is_admin || !profile.is_active) { await client.auth.signOut(); throw new Error("This account does not have administrator access."); }
        }
        onAuthenticated(data.user);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Something went wrong. Please try again.");
    } finally { setBusy(false); }
  }

  return <main className="auth-page">
    <section className="auth-intro">
      <div className="brand-lockup"><span className="brand-mark"><Building2 size={21} /></span><span>Rentwise</span></div>
      <div className="auth-copy"><p className="eyebrow">Landlord workspace</p><h1>Rental management, without the clutter.</h1><p>Keep properties, tenants, agreements, rent receipts and expenses organized in one private workspace.</p></div>
      <div className="auth-points"><span><CircleCheck size={17} />Clear monthly balances</span><span><ShieldCheck size={17} />Private account data</span><span><FileDown size={17} />Printable receipts and reports</span></div>
    </section>
    <section className="auth-panel">
      <div className="auth-card">
        <div className="auth-card-heading"><h2>{mode === "register" ? "Create your account" : mode === "admin" ? "Administrator sign in" : "Welcome back"}</h2><p>{mode === "register" ? "No email verification is required." : "Use your email and password to continue."}</p></div>
        <form onSubmit={submit}>
          {mode === "register" && <Field label="Full name"><input name="name" autoComplete="name" required /></Field>}
          <Field label="Email"><input name="email" type="email" inputMode="email" autoCapitalize="none" autoComplete="email" required /></Field>
          <Field label="Password"><span className="password-field"><input name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={8} required /><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></Field>
          {mode === "register" && <Field label="Confirm password"><input name="confirmation" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required /></Field>}
          {error && <div className="inline-alert inline-alert-danger"><CircleAlert size={17} />{error}</div>}
          <button className="button button-primary button-block" type="submit" disabled={busy}>{busy && <LoaderCircle className="spin" size={17} />}{mode === "register" ? "Create account" : "Sign in"}</button>
        </form>
        <div className="auth-switch">{mode === "register" ? "Already registered?" : "New landlord?"}<button type="button" onClick={() => { setMode(mode === "register" ? "login" : "register"); setError(""); }}>{mode === "register" ? "Sign in" : "Create an account"}</button></div>
        {mode !== "register" && <button className="admin-link" type="button" onClick={() => { setMode(mode === "admin" ? "login" : "admin"); setError(""); }}><LockKeyhole size={15} />{mode === "admin" ? "Return to landlord sign in" : "Administrator access"}</button>}
        {service.isDemo && <div className="demo-entry"><span>Production services are not connected in this preview.</span><button className="button button-secondary button-block" type="button" onClick={onDemo}>Open sample workspace</button></div>}
      </div>
    </section>
  </main>;
}

const navItems: Array<{ route: MainRoute; label: string; icon: LucideIcon }> = [
  { route: "home", label: "Home", icon: Home },
  { route: "properties", label: "Properties", icon: Building2 },
  { route: "tenants", label: "Tenants", icon: Users },
  { route: "collections", label: "Collections", icon: WalletCards },
  { route: "more", label: "More", icon: Menu },
];

function Navigation({ route, onNavigate }: { route: Route; onNavigate: (route: Route) => void }) {
  return <>
    <aside className="desktop-nav">
      <div className="brand-lockup"><span className="brand-mark"><Building2 size={20} /></span><span>Rentwise</span></div>
      <nav aria-label="Main navigation">
        {navItems.map(({ route: itemRoute, label, icon: Icon }) => <button key={itemRoute} className={cn("nav-item", route === itemRoute && "is-active")} type="button" onClick={() => onNavigate(itemRoute)}><Icon size={19} strokeWidth={1.8} /><span>{label}</span></button>)}
        <div className="nav-divider" />
        <button className={cn("nav-item", route === "agreements" && "is-active")} type="button" onClick={() => onNavigate("agreements")}><FileText size={19} /><span>Agreements</span></button>
        <button className={cn("nav-item", route === "expenses" && "is-active")} type="button" onClick={() => onNavigate("expenses")}><ReceiptText size={19} /><span>Expenses</span></button>
        <button className={cn("nav-item", route === "reports" && "is-active")} type="button" onClick={() => onNavigate("reports")}><FileDown size={19} /><span>Reports</span></button>
      </nav>
    </aside>
    <nav className="bottom-nav" aria-label="Main navigation">{navItems.map(({ route: itemRoute, label, icon: Icon }) => <button key={itemRoute} type="button" className={route === itemRoute ? "is-active" : ""} onClick={() => onNavigate(itemRoute)} aria-current={route === itemRoute ? "page" : undefined}><Icon size={20} strokeWidth={1.8} /><span>{label}</span></button>)}</nav>
  </>;
}

function AppHeader({ workspace, route, onSettings, onAdmin, onSignOut }: { workspace: WorkspaceData; route: Route; onSettings: () => void; onAdmin: () => void; onSignOut: () => void }) {
  const titleMap: Record<Route, string> = { home: "Home", properties: "Properties", tenants: "Tenants", collections: "Collections", more: "More", agreements: "Agreements", expenses: "Expenses", reports: "Reports", settings: "Settings", admin: "Administrator" };
  const [menuOpen, setMenuOpen] = useState(false);
  return <header className="app-header"><div className="mobile-brand"><span className="brand-mark"><Building2 size={18} /></span><span>{titleMap[route]}</span></div><div className="desktop-page-title">{titleMap[route]}</div><div className="account-menu-wrap"><button className="account-button" type="button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen}><span className="avatar">{initials(workspace.profile.full_name)}</span><span className="account-copy"><strong>{workspace.profile.full_name}</strong><small>{workspace.profile.email}</small></span><ChevronRight className={menuOpen ? "rotate-90" : ""} size={16} /></button>{menuOpen && <div className="account-popover"><button type="button" onClick={() => { setMenuOpen(false); onSettings(); }}><Settings size={17} />Settings</button>{workspace.profile.is_admin && <button type="button" onClick={() => { setMenuOpen(false); onAdmin(); }}><ShieldCheck size={17} />Administrator</button>}<button type="button" onClick={onSignOut}><LogOut size={17} />Sign out</button></div>}</div></header>;
}

export default function RentwiseApp() {
  const client = useMemo(() => getSupabaseBrowserClient(), []);
  const service = useMemo(() => new RentwiseDataService(client), [client]);
  const [authReady, setAuthReady] = useState(!client);
  const [user, setUser] = useState<User | null>(null);
  const [demoSignedIn, setDemoSignedIn] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [route, setRoute] = useState<Route>("home");
  const [detail, setDetail] = useState<Detail>(null);
  const [form, setForm] = useState<FormKind>(null);
  const [formTarget, setFormTarget] = useState<string | null>(null);
  const [lookupTarget, setLookupTarget] = useState<"property_types" | "payment_methods" | "expense_categories">("property_types");
  const [confirm, setConfirm] = useState<{ title: string; text: string; label: string; tone?: "primary" | "danger"; inputLabel?: string; action: (value?: string) => Promise<void> } | null>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(client));

  const notify = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2600); }, []);

  const refresh = useCallback(async (activeUser = user) => {
    setLoading(true); setError("");
    try { setWorkspace(await service.loadWorkspace(activeUser)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load your workspace."); }
    finally { setLoading(false); }
  }, [service, user]);

  useEffect(() => {
    if (!client) return;
    client.auth.getSession().then(({ data }) => { setUser(data.session?.user ?? null); setAuthReady(true); });
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, [client]);

  useEffect(() => {
    // This effect synchronizes authenticated state with the external data store.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if ((user || demoSignedIn) && authReady) void refresh(user);
    else if (authReady) { setWorkspace(null); setLoading(false); }
  }, [user, demoSignedIn, authReady, refresh]);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  const navigate = (next: Route) => { setRoute(next); setDetail(null); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const openForm = (kind: FormKind, target?: string | null) => { setFormTarget(target ?? null); setForm(kind); };
  const closeForm = () => { setForm(null); setFormTarget(null); };
  const mutate = async (operation: () => Promise<unknown>, success: string) => {
    try { await operation(); await refresh(); closeForm(); notify(success); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The change could not be saved."); }
  };
  const signOut = async () => { if (client) await client.auth.signOut(); setUser(null); setDemoSignedIn(false); setWorkspace(null); setRoute("home"); };

  if (!authReady || loading && !workspace) return <LoadingScreen />;
  if (!user && !demoSignedIn) return <AuthScreen service={service} onDemo={() => setDemoSignedIn(true)} onAuthenticated={(signedInUser) => setUser(signedInUser)} />;
  if (!workspace) return <main className="fatal-state"><CircleAlert size={30} /><h1>Workspace unavailable</h1><p>{error || "Please try again."}</p><button className="button button-primary" onClick={() => void refresh()}>Try again</button></main>;

  const pageProps = { workspace, service, refresh, notify, setDetail, openForm, setConfirm, navigate };
  let page: ReactNode;
  if (detail?.kind === "property") page = <PropertyDetail {...pageProps} id={detail.id} />;
  else if (detail?.kind === "tenant") page = <TenantDetail {...pageProps} id={detail.id} />;
  else if (detail?.kind === "agreement") page = <AgreementDetail {...pageProps} id={detail.id} />;
  else if (detail?.kind === "receipt") page = <ReceiptDetail {...pageProps} id={detail.id} />;
  else if (detail?.kind === "expense") page = <ExpenseDetail {...pageProps} id={detail.id} />;
  else {
    switch (route) {
      case "properties": page = <PropertiesPage {...pageProps} />; break;
      case "tenants": page = <TenantsPage {...pageProps} />; break;
      case "agreements": page = <AgreementsPage {...pageProps} />; break;
      case "collections": page = <CollectionsPage {...pageProps} />; break;
      case "expenses": page = <ExpensesPage {...pageProps} />; break;
      case "reports": page = <ReportsPage {...pageProps} />; break;
      case "settings": page = <SettingsPage {...pageProps} setLookupTarget={setLookupTarget} />; break;
      case "admin": page = <AdminPage {...pageProps} client={client} />; break;
      case "more": page = <MorePage workspace={workspace} navigate={navigate} signOut={signOut} />; break;
      default: page = <HomePage {...pageProps} />;
    }
  }

  return <div className="app-shell">
    <Navigation route={route} onNavigate={navigate} />
    <div className="app-column">
      <AppHeader workspace={workspace} route={route} onSettings={() => navigate("settings")} onAdmin={() => navigate("admin")} onSignOut={signOut} />
      {service.isDemo && <div className="demo-banner"><Info size={15} /><span>Sample workspace · changes reset when the page reloads</span></div>}
      {error && <div className="global-alert"><CircleAlert size={17} /><span>{error}</span><button type="button" onClick={() => setError("")}><X size={16} /></button></div>}
      <main className="app-main"><div className="page-transition" key={`${route}-${detail?.kind ?? "list"}-${detail?.id ?? ""}`}>{detail && <button className="back-button" type="button" onClick={() => setDetail(null)}><ChevronLeft size={18} />Back</button>}{page}{detail && <AttachmentList workspace={workspace} service={service} entityType={detail.kind} entityId={detail.id} onError={setError} />}</div></main>
    </div>
    {form === "property" && <PropertyForm workspace={workspace} service={service} targetId={formTarget} onClose={closeForm} mutate={mutate} />}
    {form === "tenant" && <TenantForm workspace={workspace} service={service} targetId={formTarget} onClose={closeForm} mutate={mutate} />}
    {form === "agreement" && <AgreementForm workspace={workspace} service={service} targetId={formTarget} onClose={closeForm} mutate={mutate} />}
    {form === "collection" && <CollectionForm workspace={workspace} service={service} targetId={formTarget} onClose={closeForm} mutate={mutate} />}
    {form === "expense" && <ExpenseForm workspace={workspace} service={service} onClose={closeForm} mutate={mutate} />}
    {form === "increment" && formTarget && <IncrementForm workspace={workspace} service={service} agreementId={formTarget} onClose={closeForm} mutate={mutate} />}
    {form === "profile" && <ProfileForm workspace={workspace} service={service} onClose={closeForm} mutate={mutate} />}
    {form === "receipt-settings" && <ReceiptSettingsForm workspace={workspace} service={service} onClose={closeForm} mutate={mutate} />}
    {form === "lookup" && <LookupManager workspace={workspace} service={service} table={lookupTarget} onClose={closeForm} mutate={mutate} />}
    {(form === "password" || workspace.profile.force_password_change) && <PasswordForm client={client} onChanged={refresh} onClose={workspace.profile.force_password_change ? () => undefined : closeForm} notify={notify} />}
    {confirm && <ConfirmDialog title={confirm.title} text={confirm.text} confirmLabel={confirm.label} tone={confirm.tone} inputLabel={confirm.inputLabel} onClose={() => setConfirm(null)} onConfirm={async (value) => { try { await confirm.action(value); setConfirm(null); } catch (reason) { setError(reason instanceof Error ? reason.message : "The action could not be completed."); } }} />}
    {toast && <Toast message={toast} />}
  </div>;
}

interface PageProps {
  workspace: WorkspaceData;
  service: RentwiseDataService;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  setDetail: (detail: Detail) => void;
  openForm: (kind: FormKind, target?: string | null) => void;
  setConfirm: (value: { title: string; text: string; label: string; tone?: "primary" | "danger"; inputLabel?: string; action: (value?: string) => Promise<void> } | null) => void;
  navigate: (route: Route) => void;
}

function PageHeading({ eyebrow, title, subtitle, action }: { eyebrow?: string; title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}

function SectionHeading({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="section-heading"><h2>{title}</h2>{action}</div>;
}

function MorePage({ workspace, navigate, signOut }: { workspace: WorkspaceData; navigate: (route: Route) => void; signOut: () => void }) {
  const items: Array<[Route, string, string, LucideIcon]> = [
    ["agreements", "Agreements", "Tenancy terms and rent schedules", FileText],
    ["expenses", "Expenses", "Property costs and allocations", ReceiptText],
    ["reports", "Reports", "Statements, balances and summaries", FileDown],
    ["settings", "Settings", "Profile, receipts and custom options", Settings],
  ];
  return <><PageHeading eyebrow="Account" title={workspace.profile.full_name} subtitle={workspace.profile.email} /><div className="menu-list">{items.map(([route, title, subtitle, Icon]) => <button className="menu-row" type="button" key={route} onClick={() => navigate(route)}><IconTile icon={Icon} /><span><strong>{title}</strong><small>{subtitle}</small></span><ChevronRight size={17} /></button>)}</div>{workspace.profile.is_admin && <button className="menu-row admin-entry" type="button" onClick={() => navigate("admin")}><IconTile icon={ShieldCheck} /><span><strong>Administrator</strong><small>Manage landlord accounts and support access</small></span><ChevronRight size={17} /></button>}<button className="button button-secondary signout-button" type="button" onClick={signOut}><LogOut size={17} />Sign out</button></>;
}

function HomePage(props: PageProps) {
  const { workspace, openForm, setDetail, navigate } = props;
  const symbol = workspace.settings.currency_symbol;
  const activeAgreements = workspace.agreements.filter((agreement) => agreementStatus(agreement, todayISO) === "active" && !agreement.archived_at);
  const expectedRows = activeAgreements.map((agreement) => {
    const rentMonth = shiftMonth(currentMonth, -agreement.collection_offset);
    const period = workspace.rentPeriods.find((item) => item.agreement_id === agreement.id && item.rent_month.startsWith(rentMonth));
    const periodReceipts = period ? workspace.receipts.filter((receipt) => receipt.rent_period_id === period.id && receipt.status === "valid") : [];
    const received = periodReceipts.reduce((sum, receipt) => sum + receipt.amount, 0);
    const expected = rentForMonth(agreement, workspace.increments, rentMonth);
    return { agreement, rentMonth, expected, received, remaining: Math.max(periodBalance(workspace, agreement.id), 0) };
  });
  const expected = expectedRows.reduce((sum, row) => sum + row.expected, 0);
  const collected = workspace.receipts.filter((receipt) => receipt.status === "valid" && receipt.collection_date.startsWith(currentMonth)).reduce((sum, receipt) => sum + receipt.amount, 0);
  const remaining = expectedRows.reduce((sum, row) => sum + row.remaining, 0);
  const expenses = workspace.expenses.filter((expense) => expense.status === "valid" && expense.expense_date.startsWith(currentMonth)).reduce((sum, expense) => sum + expense.amount, 0);
  const percent = expected ? Math.min(100, Math.round((collected / expected) * 100)) : 0;
  const occupied = workspace.properties.filter((property) => !property.archived_at && property.status === "occupied").length;
  const vacant = workspace.properties.filter((property) => !property.archived_at && property.status === "vacant").length;
  const attention = expectedRows.filter((row) => row.remaining > 0);
  const recent = [
    ...workspace.receipts.filter((item) => item.status === "valid").map((item) => ({ type: "receipt" as const, date: item.collection_date, item })),
    ...workspace.expenses.filter((item) => item.status === "valid").map((item) => ({ type: "expense" as const, date: item.expense_date, item })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);

  return <>
    <PageHeading eyebrow={new Intl.DateTimeFormat("en", { weekday: "long", day: "numeric", month: "long" }).format(today)} title={`Good ${today.getHours() < 12 ? "morning" : today.getHours() < 18 ? "afternoon" : "evening"}, ${workspace.profile.full_name.split(" ")[0]}`} subtitle="Here is what needs your attention today." />
    <section className="monthly-summary">
      <div className="summary-lead"><span>Collected this month</span><strong>{formatMoney(collected, symbol)}</strong><small>of {formatMoney(expected, symbol)} expected</small></div>
      <div className="summary-progress"><div><span style={{ width: `${percent}%` }} /></div><strong>{percent}%</strong></div>
      <div className="summary-balance"><span>Remaining</span><strong>{formatMoney(remaining, symbol)}</strong></div>
    </section>
    <div className="metric-grid">
      <button type="button" className="metric" onClick={() => navigate("properties")}><span>Occupied</span><strong>{occupied}</strong><small>properties</small></button>
      <button type="button" className="metric" onClick={() => navigate("properties")}><span>Vacant</span><strong>{vacant}</strong><small>properties</small></button>
      <button type="button" className="metric" onClick={() => navigate("expenses")}><span>Expenses</span><strong>{formatMoney(expenses, symbol)}</strong><small>this month</small></button>
    </div>
    <section className="page-section">
      <SectionHeading title="Quick actions" />
      <div className="quick-actions">
        <button type="button" onClick={() => openForm("collection")}><WalletCards size={19} /><span>Collect rent</span></button>
        <button type="button" onClick={() => openForm("property")}><Building2 size={19} /><span>Add property</span></button>
        <button type="button" onClick={() => openForm("tenant")}><UserPlus size={19} /><span>Add tenant</span></button>
        <button type="button" onClick={() => openForm("agreement")}><FilePlus2 size={19} /><span>New agreement</span></button>
      </div>
    </section>
    <section className="page-section">
      <SectionHeading title="Needs attention" action={<button className="text-button" type="button" onClick={() => navigate("reports")}>Outstanding report</button>} />
      <div className="record-list">
        {attention.length ? attention.map(({ agreement, rentMonth, remaining: due }) => {
          const tenant = workspace.tenants.find((item) => item.id === agreement.tenant_id);
          const property = workspace.properties.find((item) => item.id === agreement.property_id);
          const dueDate = new Date(`${shiftMonth(rentMonth, agreement.collection_offset)}-${String(agreement.due_day).padStart(2, "0")}T00:00:00`);
          const overdue = dueDate < today;
          return <button className="record-row" type="button" key={agreement.id} onClick={() => openForm("collection", agreement.id)}><IconTile icon={CalendarClock} tone={overdue ? "danger" : "warning"} /><span className="record-main"><strong>{monthLabel(rentMonth)} · {tenant?.name}</strong><small>{property?.name} · due {formatDate(dueDate.toISOString())}</small></span><span className="record-end"><strong>{formatMoney(due, symbol)}</strong><small className={overdue ? "text-danger" : ""}>{overdue ? "Overdue" : "Upcoming"}</small></span></button>;
        }) : <EmptyState icon={CircleCheck} title="All caught up" text="No current rent needs attention." />}
      </div>
    </section>
    <section className="page-section">
      <SectionHeading title="Recent activity" action={<button className="text-button" type="button" onClick={() => navigate("collections")}>View all</button>} />
      <div className="record-list">{recent.map((entry) => {
        if (entry.type === "receipt") {
          const period = workspace.rentPeriods.find((item) => item.id === entry.item.rent_period_id);
          const agreement = workspace.agreements.find((item) => item.id === period?.agreement_id);
          const tenant = workspace.tenants.find((item) => item.id === agreement?.tenant_id);
          return <button className="record-row" type="button" key={entry.item.id} onClick={() => setDetail({ kind: "receipt", id: entry.item.id })}><IconTile icon={ArrowDownLeft} tone="positive" /><span className="record-main"><strong>Rent received · {tenant?.name}</strong><small>{entry.item.display_id} · {formatDate(entry.item.collection_date)}</small></span><span className="record-end positive-value">+{formatMoney(entry.item.amount, symbol)}</span></button>;
        }
        return <button className="record-row" type="button" key={entry.item.id} onClick={() => navigate("expenses")}><IconTile icon={ArrowUpRight} /><span className="record-main"><strong>{entry.item.description}</strong><small>{entry.item.display_id} · {formatDate(entry.item.expense_date)}</small></span><span className="record-end">−{formatMoney(entry.item.amount, symbol)}</span></button>;
      })}</div>
    </section>
  </>;
}

function PropertiesPage({ workspace, setDetail, openForm }: PageProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | Property["status"]>("all");
  const rows = workspace.properties.filter((property) => !property.archived_at && (filter === "all" || property.status === filter) && `${property.name} ${property.display_id} ${property.location}`.toLowerCase().includes(query.toLowerCase()));
  return <><PageHeading eyebrow={`${workspace.properties.filter((item) => !item.archived_at).length} active records`} title="Properties" subtitle="Each record represents one rentable unit." action={<button className="button button-primary" type="button" onClick={() => openForm("property")}><Plus size={17} />Add property</button>} />
    <div className="list-toolbar"><label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, location or ID" /></label><div className="segmented">{(["all", "occupied", "vacant", "maintenance"] as const).map((value) => <button type="button" className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)} key={value}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div></div>
    <div className="record-list">{rows.map((property) => {
      const type = workspace.propertyTypes.find((item) => item.id === property.property_type_id)?.name ?? "Property";
      const agreement = activeAgreement(workspace, property.id);
      const tenant = workspace.tenants.find((item) => item.id === agreement?.tenant_id);
      const Icon = type === "Shop" ? Store : type === "Office" ? BriefcaseBusiness : Building2;
      return <button className="record-row" type="button" key={property.id} onClick={() => setDetail({ kind: "property", id: property.id })}><IconTile icon={Icon} /><span className="record-main"><strong>{property.name}</strong><small>{property.display_id} · {agreement ? tenant?.name : property.location}</small></span><StatusPill tone={property.status === "occupied" ? "positive" : property.status === "maintenance" ? "danger" : "warning"}>{property.status[0].toUpperCase() + property.status.slice(1)}</StatusPill><ChevronRight className="row-chevron" size={17} /></button>;
    })}{!rows.length && <EmptyState icon={Building2} title="No matching properties" text="Try another search or add a property." action={<button className="button button-primary" type="button" onClick={() => openForm("property")}><Plus size={17} />Add property</button>} />}</div>
  </>;
}

function PropertyDetail({ workspace, id, setDetail, openForm, setConfirm, service, refresh, notify }: PageProps & { id: string }) {
  const property = workspace.properties.find((item) => item.id === id);
  if (!property) return <EmptyState icon={Building2} title="Property not found" text="This record may have been archived." />;
  const type = workspace.propertyTypes.find((item) => item.id === property.property_type_id)?.name ?? "Property";
  const agreement = activeAgreement(workspace, property.id);
  const tenant = workspace.tenants.find((item) => item.id === agreement?.tenant_id);
  const expenseTotal = workspace.allocations.filter((item) => item.property_id === property.id).reduce((sum, item) => sum + item.allocated_amount, 0);
  const hasHistory = workspace.agreements.some((item) => item.property_id === property.id) || workspace.allocations.some((item) => item.property_id === property.id) || workspace.attachments.some((item) => item.entity_type === "property" && item.entity_id === property.id);
  return <><PageHeading eyebrow={property.display_id} title={property.name} subtitle={property.location} action={<button className="button button-secondary" type="button" onClick={() => openForm("property", property.id)}><Pencil size={16} />Edit</button>} />
    <div className="detail-grid"><section className="detail-card"><SectionHeading title="Overview" /><dl className="detail-list"><div><dt>Status</dt><dd><StatusPill tone={property.status === "occupied" ? "positive" : property.status === "maintenance" ? "danger" : "warning"}>{property.status}</StatusPill></dd></div><div><dt>Property type</dt><dd>{type}</dd></div><div><dt>Location</dt><dd>{property.location || "Not provided"}</dd></div><div><dt>Notes</dt><dd>{property.notes || "No internal notes"}</dd></div></dl></section>
      <section className="detail-card"><SectionHeading title="Current tenancy" action={agreement && <button className="text-button" type="button" onClick={() => setDetail({ kind: "agreement", id: agreement.id })}>View agreement</button>} />{agreement && tenant ? <button className="tenant-summary" type="button" onClick={() => setDetail({ kind: "tenant", id: tenant.id })}><span className="avatar avatar-large">{initials(tenant.name)}</span><span><strong>{tenant.name}</strong><small>{tenant.display_id} · {agreement.display_id}</small></span><ChevronRight size={17} /></button> : <EmptyState icon={UserRound} title={property.status === "maintenance" ? "Under maintenance" : "No active tenant"} text={property.status === "maintenance" ? "Change the property to vacant before creating an agreement." : "This property is ready for a new agreement."} action={property.status === "vacant" && <button className="button button-primary" type="button" onClick={() => openForm("agreement", property.id)}>Create agreement</button>} />}</section></div>
    <section className="page-section"><div className="metric-grid metric-grid-two"><div className="metric static"><span>Monthly rent</span><strong>{agreement ? formatMoney(agreement.monthly_base_rent, workspace.settings.currency_symbol) : "—"}</strong><small>{agreement?.display_id ?? "No agreement"}</small></div><div className="metric static"><span>Total expenses</span><strong>{formatMoney(expenseTotal, workspace.settings.currency_symbol)}</strong><small>all recorded periods</small></div></div></section>
    <div className="detail-footer">{hasHistory ? <button className="button button-secondary" type="button" onClick={() => setConfirm({ title: "Archive this property?", text: "The property will leave active lists, but its agreement and financial history will remain available.", label: "Archive property", tone: "danger", action: async () => { await service.updateProperty(property.id, { archived_at: new Date().toISOString() }); await refresh(); notify(`${property.display_id} archived`); setDetail(null); } })}><Archive size={16} />Archive</button> : <button className="button button-secondary button-danger-text" type="button" onClick={() => setConfirm({ title: "Delete this unused property?", text: "This is permanent. Deletion is allowed only because the property has never been connected to an agreement or expense.", label: "Delete property", tone: "danger", action: async () => { await service.deleteUnusedProperty(property.id); await refresh(); notify(`${property.display_id} deleted`); setDetail(null); } })}><Trash2 size={16} />Delete permanently</button>}</div>
  </>;
}

function TenantsPage({ workspace, setDetail, openForm }: PageProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "former">("all");
  const rows = workspace.tenants.filter((tenant) => {
    const active = Boolean(activeAgreement(workspace, undefined, tenant.id));
    return !tenant.archived_at && (filter === "all" || (filter === "active" ? active : !active)) && `${tenant.name} ${tenant.display_id} ${tenant.phone}`.toLowerCase().includes(query.toLowerCase());
  });
  return <><PageHeading eyebrow={`${workspace.tenants.filter((item) => !item.archived_at).length} tenant records`} title="Tenants" subtitle="Contact details, identity information and tenancy history." action={<button className="button button-primary" type="button" onClick={() => openForm("tenant")}><Plus size={17} />Add tenant</button>} />
    <div className="list-toolbar"><label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, phone or ID" /></label><div className="segmented">{(["all", "active", "former"] as const).map((value) => <button type="button" className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)} key={value}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div></div>
    <div className="record-list">{rows.map((tenant) => { const agreement = activeAgreement(workspace, undefined, tenant.id); const property = workspace.properties.find((item) => item.id === agreement?.property_id); return <button className="record-row" type="button" key={tenant.id} onClick={() => setDetail({ kind: "tenant", id: tenant.id })}><span className="avatar">{initials(tenant.name)}</span><span className="record-main"><strong>{tenant.name}</strong><small>{tenant.display_id} · {property?.name ?? "No current property"}</small></span><StatusPill tone={agreement ? "positive" : "neutral"}>{agreement ? "Active" : "Former"}</StatusPill><ChevronRight className="row-chevron" size={17} /></button>; })}{!rows.length && <EmptyState icon={Users} title="No matching tenants" text="Try another search or create a tenant record." />}</div>
  </>;
}

function TenantDetail({ workspace, id, setDetail, openForm, setConfirm, service, refresh, notify }: PageProps & { id: string }) {
  const tenant = workspace.tenants.find((item) => item.id === id);
  if (!tenant) return <EmptyState icon={UserRound} title="Tenant not found" text="This record may have been archived." />;
  const agreement = activeAgreement(workspace, undefined, tenant.id);
  const property = workspace.properties.find((item) => item.id === agreement?.property_id);
  const balance = agreement ? periodBalance(workspace, agreement.id) : 0;
  const tenantReceipts = workspace.receipts.filter((receipt) => { const period = workspace.rentPeriods.find((item) => item.id === receipt.rent_period_id); return period?.agreement_id === agreement?.id; }).sort((a, b) => b.collection_date.localeCompare(a.collection_date));
  const hasHistory = workspace.agreements.some((item) => item.tenant_id === tenant.id) || workspace.attachments.some((item) => item.entity_type === "tenant" && item.entity_id === tenant.id);
  return <><PageHeading eyebrow={tenant.display_id} title={tenant.name} subtitle={tenant.phone} action={<div className="heading-actions"><a className="button button-secondary" href={`tel:${tenant.phone}`}><Phone size={16} />Call</a><button className="button button-secondary" type="button" onClick={() => openForm("tenant", tenant.id)}><Pencil size={16} />Edit</button></div>} />
    <div className="detail-grid"><section className="detail-card"><SectionHeading title="Contact & identity" /><dl className="detail-list"><div><dt>Email</dt><dd>{tenant.email || "Not provided"}</dd></div><div><dt>Address</dt><dd>{tenant.address || "Not provided"}</dd></div><div><dt>NID</dt><dd>{idSuffix(tenant.nid)}</dd></div><div><dt>Notes</dt><dd>{tenant.notes || "No internal notes"}</dd></div></dl></section>
      <section className="detail-card"><SectionHeading title="Current tenancy" action={agreement && <button className="text-button" type="button" onClick={() => setDetail({ kind: "agreement", id: agreement.id })}>View agreement</button>} />{agreement && property ? <><button className="property-summary" type="button" onClick={() => setDetail({ kind: "property", id: property.id })}><IconTile icon={Building2} /><span><strong>{property.name}</strong><small>{property.display_id} · {agreement.display_id}</small></span><ChevronRight size={17} /></button><div className="balance-line"><span>Recorded balance</span><strong className={balance > 0 ? "text-danger" : balance < 0 ? "positive-value" : ""}>{balance > 0 ? `${formatMoney(balance, workspace.settings.currency_symbol)} due` : balance < 0 ? `${formatMoney(Math.abs(balance), workspace.settings.currency_symbol)} advance` : "Paid"}</strong></div></> : <EmptyState icon={Home} title="No active agreement" text="The tenant remains available for a new agreement." />}</section></div>
    <section className="page-section"><SectionHeading title="Recent receipts" action={agreement && <button className="text-button" type="button" onClick={() => openForm("collection", agreement.id)}>Collect rent</button>} /><div className="record-list">{tenantReceipts.slice(0, 5).map((receipt) => <button className="record-row" type="button" key={receipt.id} onClick={() => setDetail({ kind: "receipt", id: receipt.id })}><IconTile icon={ReceiptText} /><span className="record-main"><strong>{receipt.display_id}</strong><small>{formatDate(receipt.collection_date)}</small></span><span className="record-end"><strong>{formatMoney(receipt.amount, workspace.settings.currency_symbol)}</strong><small>{receipt.status}</small></span></button>)}{!tenantReceipts.length && <EmptyState icon={ReceiptText} title="No receipts yet" text="Rent receipts for this tenant will appear here." />}</div></section>
    <div className="detail-footer">{hasHistory ? <button className="button button-secondary" type="button" onClick={() => setConfirm({ title: "Archive this tenant?", text: "The tenant will leave active lists, while agreements and receipts remain available.", label: "Archive tenant", tone: "danger", action: async () => { await service.updateTenant(tenant.id, { archived_at: new Date().toISOString() }); await refresh(); notify(`${tenant.display_id} archived`); setDetail(null); } })}><Archive size={16} />Archive</button> : <button className="button button-secondary button-danger-text" type="button" onClick={() => setConfirm({ title: "Delete this unused tenant?", text: "This is permanent. Deletion is allowed only because the tenant has never been connected to an agreement.", label: "Delete tenant", tone: "danger", action: async () => { await service.deleteUnusedTenant(tenant.id); await refresh(); notify(`${tenant.display_id} deleted`); setDetail(null); } })}><Trash2 size={16} />Delete permanently</button>}</div>
  </>;
}

function AgreementsPage({ workspace, setDetail, openForm }: PageProps) {
  const [filter, setFilter] = useState<"all" | "active" | "upcoming" | "ended">("active");
  const rows = workspace.agreements.filter((agreement) => !agreement.archived_at && (filter === "all" || agreementStatus(agreement, todayISO) === filter || filter === "ended" && agreementStatus(agreement, todayISO) === "terminated"));
  return <><PageHeading eyebrow={`${workspace.agreements.filter((item) => !item.archived_at).length} agreements`} title="Agreements" subtitle="Property assignment, rent terms and collection schedules." action={<button className="button button-primary" type="button" onClick={() => openForm("agreement")}><Plus size={17} />New agreement</button>} />
    <div className="segmented page-tabs">{(["active", "upcoming", "ended", "all"] as const).map((value) => <button type="button" className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)} key={value}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
    <div className="record-list">{rows.map((agreement) => { const tenant = workspace.tenants.find((item) => item.id === agreement.tenant_id); const property = workspace.properties.find((item) => item.id === agreement.property_id); const status = agreementStatus(agreement, todayISO); return <button className="record-row" type="button" key={agreement.id} onClick={() => setDetail({ kind: "agreement", id: agreement.id })}><IconTile icon={FileText} /><span className="record-main"><strong>{tenant?.name}</strong><small>{agreement.display_id} · {property?.name}</small></span><span className="record-end"><strong>{formatMoney(agreement.monthly_base_rent, workspace.settings.currency_symbol)}</strong><StatusPill tone={status === "active" ? "positive" : status === "upcoming" ? "info" : "neutral"}>{status}</StatusPill></span><ChevronRight className="row-chevron" size={17} /></button>; })}{!rows.length && <EmptyState icon={FileText} title="No agreements here" text="Create an agreement to connect a vacant property and a tenant." />}</div>
  </>;
}

function AgreementDetail({ workspace, id, setDetail, openForm, setConfirm, service, refresh, notify }: PageProps & { id: string }) {
  const agreement = workspace.agreements.find((item) => item.id === id);
  if (!agreement) return <EmptyState icon={FileText} title="Agreement not found" text="This record may have been archived." />;
  const tenant = workspace.tenants.find((item) => item.id === agreement.tenant_id);
  const property = workspace.properties.find((item) => item.id === agreement.property_id);
  const status = agreementStatus(agreement, todayISO);
  const increments = workspace.increments.filter((item) => item.agreement_id === agreement.id).sort((a, b) => a.start_month.localeCompare(b.start_month));
  return <><PageHeading eyebrow={agreement.display_id} title={`${tenant?.name} · ${property?.name}`} subtitle={`${formatDate(agreement.start_date)} – ${formatDate(agreement.end_date)}`} action={<div className="heading-actions"><button className="button button-secondary" type="button" onClick={() => openForm("agreement", agreement.id)}><Pencil size={16} />Edit</button><button className="button button-primary" type="button" onClick={() => openForm("collection", agreement.id)}><WalletCards size={16} />Collect rent</button></div>} />
    <div className="detail-grid"><section className="detail-card"><SectionHeading title="Agreement terms" /><dl className="detail-list"><div><dt>Status</dt><dd><StatusPill tone={status === "active" ? "positive" : status === "upcoming" ? "info" : "neutral"}>{status}</StatusPill></dd></div><div><dt>Monthly base rent</dt><dd>{formatMoney(agreement.monthly_base_rent, workspace.settings.currency_symbol)}</dd></div><div><dt>Security deposit</dt><dd>{formatMoney(agreement.security_deposit, workspace.settings.currency_symbol)}</dd></div><div><dt>Notice period</dt><dd>{agreement.notice_period_months} month{agreement.notice_period_months === 1 ? "" : "s"}</dd></div></dl></section>
      <section className="detail-card"><SectionHeading title="Collection schedule" /><div className="schedule-callout"><CalendarDays size={20} /><div><strong>{agreement.collection_offset === 0 ? "Collect in the same month" : "Collect in the following month"}</strong><p>{agreement.collection_offset === 0 ? "January rent is expected in January." : "January rent is expected in February."}</p></div></div><dl className="detail-list compact"><div><dt>Expected by</dt><dd>Day {agreement.due_day}</dd></div><div><dt>Current balance</dt><dd>{formatMoney(periodBalance(workspace, agreement.id), workspace.settings.currency_symbol)}</dd></div></dl></section></div>
    <section className="page-section"><SectionHeading title="People & property" /><div className="split-summaries"><button className="tenant-summary" type="button" onClick={() => tenant && setDetail({ kind: "tenant", id: tenant.id })}><span className="avatar">{initials(tenant?.name ?? "")}</span><span><strong>{tenant?.name}</strong><small>{tenant?.display_id}</small></span><ChevronRight size={17} /></button><button className="property-summary" type="button" onClick={() => property && setDetail({ kind: "property", id: property.id })}><IconTile icon={Building2} /><span><strong>{property?.name}</strong><small>{property?.display_id}</small></span><ChevronRight size={17} /></button></div></section>
    <section className="page-section"><SectionHeading title="Rent increments" action={status === "active" || status === "upcoming" ? <button className="text-button" type="button" onClick={() => openForm("increment", agreement.id)}><Plus size={15} />Add increment</button> : undefined} /><div className="record-list">{increments.map((increment) => <div className="record-row static-row" key={increment.id}><IconTile icon={ArrowUpRight} /><span className="record-main"><strong>{formatMoney(increment.new_base_rent, workspace.settings.currency_symbol)} from {monthLabel(increment.start_month)}</strong><small>{increment.end_month ? `Until ${monthLabel(increment.end_month)}` : "Until agreement end"}{increment.note ? ` · ${increment.note}` : ""}</small></span></div>)}{!increments.length && <EmptyState icon={ArrowUpRight} title="No rent increments" text="The base rent remains unchanged for this agreement." />}</div></section>
    {status === "active" && <div className="detail-footer"><button className="button button-secondary button-danger-text" type="button" onClick={() => setConfirm({ title: "Terminate this agreement?", text: "The property becomes vacant today. Existing receipts remain unchanged.", label: "Terminate agreement", tone: "danger", inputLabel: "Reason for early termination", action: async (reason) => { await service.updateAgreement(agreement.id, { terminated_on: todayISO, termination_note: reason || "Terminated by landlord" }); await refresh(); notify(`${agreement.display_id} terminated`); } })}><CircleStop size={16} />Terminate agreement</button></div>}
    {status === "upcoming" && <div className="detail-footer"><button className="button button-secondary button-danger-text" type="button" onClick={() => setConfirm({ title: "Cancel this upcoming agreement?", text: "The agreement will be archived and the property and tenant will remain available.", label: "Cancel agreement", tone: "danger", inputLabel: "Reason for cancellation", action: async (reason) => { await service.updateAgreement(agreement.id, { archived_at: new Date().toISOString(), termination_note: reason || "Cancelled before start" }); await refresh(); notify(`${agreement.display_id} cancelled`); } })}><CircleStop size={16} />Cancel agreement</button></div>}
  </>;
}

function CollectionsPage({ workspace, setDetail, openForm }: PageProps) {
  const [query, setQuery] = useState("");
  const rows = workspace.receipts.filter((receipt) => {
    const period = workspace.rentPeriods.find((item) => item.id === receipt.rent_period_id);
    const agreement = workspace.agreements.find((item) => item.id === period?.agreement_id);
    const tenant = workspace.tenants.find((item) => item.id === agreement?.tenant_id);
    const property = workspace.properties.find((item) => item.id === agreement?.property_id);
    return `${receipt.display_id} ${tenant?.name} ${property?.name}`.toLowerCase().includes(query.toLowerCase());
  }).sort((a, b) => b.collection_date.localeCompare(a.collection_date));
  const monthReceipts = workspace.receipts.filter((item) => item.status === "valid" && item.collection_date.startsWith(currentMonth));
  const total = monthReceipts.reduce((sum, item) => sum + item.amount, 0);
  return <><PageHeading eyebrow={`${rows.length} receipts`} title="Rent collections" subtitle={`${formatMoney(total, workspace.settings.currency_symbol)} collected this month.`} action={<button className="button button-primary" type="button" onClick={() => openForm("collection")}><Plus size={17} />Collect rent</button>} />
    <div className="list-toolbar"><label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search receipt, tenant or property" /></label></div>
    <div className="record-list">{rows.map((receipt) => { const period = workspace.rentPeriods.find((item) => item.id === receipt.rent_period_id); const agreement = workspace.agreements.find((item) => item.id === period?.agreement_id); const tenant = workspace.tenants.find((item) => item.id === agreement?.tenant_id); const property = workspace.properties.find((item) => item.id === agreement?.property_id); return <button className={cn("record-row", receipt.status === "void" && "void-row")} type="button" key={receipt.id} onClick={() => setDetail({ kind: "receipt", id: receipt.id })}><IconTile icon={ReceiptText} tone={receipt.status === "void" ? "danger" : "positive"} /><span className="record-main"><strong>{tenant?.name} · {monthLabel(period?.rent_month ?? currentMonthStart)}</strong><small>{receipt.display_id} · {property?.name}</small></span><span className="record-end"><strong>{formatMoney(receipt.amount, workspace.settings.currency_symbol)}</strong><small>{receipt.status === "void" ? "Void" : formatDate(receipt.collection_date)}</small></span><ChevronRight className="row-chevron" size={17} /></button>; })}{!rows.length && <EmptyState icon={WalletCards} title="No rent receipts" text="Record a rent payment to generate the first receipt." />}</div>
  </>;
}

function ReceiptDetail({ workspace, id, setConfirm, service, refresh, notify }: PageProps & { id: string }) {
  const receipt = workspace.receipts.find((item) => item.id === id);
  if (!receipt) return <EmptyState icon={ReceiptText} title="Receipt not found" text="The requested receipt is unavailable." />;
  const period = workspace.rentPeriods.find((item) => item.id === receipt.rent_period_id);
  const agreement = workspace.agreements.find((item) => item.id === period?.agreement_id);
  const tenant = workspace.tenants.find((item) => item.id === agreement?.tenant_id);
  const property = workspace.properties.find((item) => item.id === agreement?.property_id);
  const method = workspace.paymentMethods.find((item) => item.id === receipt.payment_method_id);
  const charges = workspace.rentCharges.filter((item) => item.rent_period_id === period?.id);
  const share = async () => {
    const text = `${workspace.settings.receipt_name || workspace.profile.full_name}\nReceipt ${receipt.display_id}\n${tenant?.name} · ${property?.name}\n${monthLabel(period?.rent_month ?? currentMonthStart)}\nAmount received: ${formatMoney(receipt.amount, workspace.settings.currency_symbol)}`;
    if (navigator.share) await navigator.share({ title: `Rent receipt ${receipt.display_id}`, text });
    else { await navigator.clipboard.writeText(text); notify("Receipt copied to clipboard"); }
  };
  return <><PageHeading eyebrow={receipt.display_id} title="Rent receipt" subtitle={receipt.status === "void" ? "This receipt has been voided." : `Received ${formatDate(receipt.collection_date)}`} action={<div className="heading-actions"><button className="button button-secondary no-print" type="button" onClick={() => window.print()}><Printer size={16} />Print</button><button className="button button-primary no-print" type="button" onClick={() => void share()}><Share2 size={16} />Share</button></div>} />
    <article className={cn("receipt-paper", receipt.status === "void" && "is-void") }>
      {receipt.status === "void" && <div className="void-watermark">VOID</div>}
      <header className="receipt-header"><div className="brand-lockup"><span className="brand-mark"><Building2 size={19} /></span><span>{workspace.settings.receipt_name || workspace.profile.full_name}</span></div><div><strong>RENT RECEIPT</strong><span>{receipt.display_id}</span></div></header>
      <div className="receipt-party"><div><span>Received from</span><strong>{tenant?.name}</strong><small>{tenant?.display_id} · {tenant?.phone}</small></div><div><span>For property</span><strong>{property?.name}</strong><small>{property?.display_id} · {agreement?.display_id}</small></div></div>
      <div className="receipt-lines"><div><span>Rent period</span><strong>{monthLabel(period?.rent_month ?? currentMonthStart)}</strong></div><div><span>Base rent</span><strong>{formatMoney(period?.base_rent ?? 0, workspace.settings.currency_symbol)}</strong></div>{charges.map((charge) => <div key={charge.id}><span>{charge.reason}</span><strong>{formatMoney(charge.amount, workspace.settings.currency_symbol)}</strong></div>)}<div><span>Payment method</span><strong>{method?.name ?? "Not recorded"}</strong></div><div><span>Collection date</span><strong>{formatDate(receipt.collection_date)}</strong></div><div className="receipt-total"><span>Amount received</span><strong>{formatMoney(receipt.amount, workspace.settings.currency_symbol)}</strong></div></div>
      <footer className="receipt-footer"><span>{workspace.settings.receipt_phone}</span><span>{workspace.settings.receipt_address}</span>{receipt.notes && <p>{receipt.notes}</p>}</footer>
    </article>
    {receipt.status === "valid" && <div className="detail-footer no-print"><button className="button button-secondary button-danger-text" type="button" onClick={() => setConfirm({ title: "Void this receipt?", text: "The receipt will remain in the audit trail and reports as void. This cannot be undone from the app.", label: "Void receipt", tone: "danger", inputLabel: "Reason for voiding", action: async (reason) => { await service.voidReceipt(receipt.id, reason || "Voided by landlord"); await refresh(); notify(`${receipt.display_id} marked void`); } })}><CircleStop size={16} />Void receipt</button></div>}
  </>;
}

function ExpensesPage({ workspace, openForm, setDetail }: PageProps) {
  const [query, setQuery] = useState("");
  const rows = workspace.expenses.filter((expense) => !expense.archived_at && `${expense.display_id} ${expense.description}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.expense_date.localeCompare(a.expense_date));
  const total = rows.filter((item) => item.status === "valid" && item.expense_date.startsWith(currentMonth)).reduce((sum, item) => sum + item.amount, 0);
  return <><PageHeading eyebrow={`${rows.length} expenses`} title="Landlord expenses" subtitle={`${formatMoney(total, workspace.settings.currency_symbol)} recorded this month.`} action={<button className="button button-primary" type="button" onClick={() => openForm("expense")}><Plus size={17} />Add expense</button>} />
    <div className="list-toolbar"><label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search description or ID" /></label></div>
    <div className="record-list">{rows.map((expense) => { const allocations = workspace.allocations.filter((item) => item.expense_id === expense.id); const propertyNames = allocations.map((item) => workspace.properties.find((property) => property.id === item.property_id)?.name).filter(Boolean).join(", ") || "General expense"; const category = workspace.expenseCategories.find((item) => item.id === expense.category_id)?.name; return <button className="record-row" type="button" key={expense.id} onClick={() => setDetail({ kind: "expense", id: expense.id })}><IconTile icon={ReceiptText} /><span className="record-main"><strong>{expense.description}</strong><small>{expense.display_id} · {propertyNames}{category ? ` · ${category}` : ""}</small></span><span className="record-end"><strong>{formatMoney(expense.amount, workspace.settings.currency_symbol)}</strong><small>{formatDate(expense.expense_date)}</small></span><ChevronRight className="row-chevron" size={17} /></button>; })}{!rows.length && <EmptyState icon={ReceiptText} title="No expenses recorded" text="Property expenses will appear here." />}</div>
  </>;
}

function ExpenseDetail({ workspace, id, setDetail }: PageProps & { id: string }) {
  const expense = workspace.expenses.find((item) => item.id === id);
  if (!expense) return <EmptyState icon={ReceiptText} title="Expense not found" text="This record is unavailable." />;
  const category = workspace.expenseCategories.find((item) => item.id === expense.category_id)?.name ?? "Other";
  const allocations = workspace.allocations.filter((item) => item.expense_id === expense.id);
  return <>
    <PageHeading eyebrow={expense.display_id} title={expense.description} subtitle={formatDate(expense.expense_date)} />
    <div className="detail-grid">
      <section className="detail-card"><SectionHeading title="Expense details" /><dl className="detail-list"><div><dt>Amount</dt><dd>{formatMoney(expense.amount, workspace.settings.currency_symbol)}</dd></div><div><dt>Category</dt><dd>{category}</dd></div><div><dt>Status</dt><dd><StatusPill tone={expense.status === "valid" ? "positive" : "danger"}>{expense.status}</StatusPill></dd></div><div><dt>Notes</dt><dd>{expense.notes || "No internal notes"}</dd></div></dl></section>
      <section className="detail-card"><SectionHeading title="Property allocation" /><div className="record-list">{allocations.map((allocation) => { const property = workspace.properties.find((item) => item.id === allocation.property_id); return <button className="record-row" type="button" key={allocation.id} onClick={() => property && setDetail({ kind: "property", id: property.id })}><IconTile icon={Building2} /><span className="record-main"><strong>{property?.name ?? "Unknown property"}</strong><small>{property?.display_id}</small></span><span className="record-end"><strong>{formatMoney(allocation.allocated_amount, workspace.settings.currency_symbol)}</strong></span><ChevronRight size={17} /></button>; })}</div></section>
    </div>
  </>;
}

function ReportsPage({ workspace }: PageProps) {
  const [report, setReport] = useState<"summary" | "collections" | "outstanding" | "expenses" | "tenant" | "property" | "agreement">("summary");
  const [periodMode, setPeriodMode] = useState<"month" | "year" | "custom">("month");
  const [month, setMonth] = useState(currentMonth);
  const [year, setYear] = useState(String(today.getFullYear()));
  const [fromDate, setFromDate] = useState(`${currentMonth}-01`);
  const [toDate, setToDate] = useState(todayISO);
  const [entity, setEntity] = useState("all");
  const symbol = workspace.settings.currency_symbol;
  const periodStart = periodMode === "month" ? `${month}-01` : periodMode === "year" ? `${year}-01-01` : fromDate;
  const periodEnd = periodMode === "month" ? `${month}-31` : periodMode === "year" ? `${year}-12-31` : toDate;
  const periodLabel = periodMode === "month" ? monthLabel(`${month}-01`) : periodMode === "year" ? year : `${formatDate(fromDate)} – ${formatDate(toDate)}`;
  const filteredReceipts = workspace.receipts.filter((receipt) => receipt.status === "valid" && receipt.collection_date >= periodStart && receipt.collection_date <= periodEnd).filter((receipt) => {
    if (entity === "all") return true;
    const period = workspace.rentPeriods.find((item) => item.id === receipt.rent_period_id);
    const agreement = workspace.agreements.find((item) => item.id === period?.agreement_id);
    return agreement?.tenant_id === entity || agreement?.property_id === entity || agreement?.id === entity;
  });
  const filteredExpenses = workspace.expenses.filter((expense) => expense.status === "valid" && expense.expense_date >= periodStart && expense.expense_date <= periodEnd).filter((expense) => {
    if (entity === "all") return true;
    return workspace.allocations.some((allocation) => allocation.expense_id === expense.id && allocation.property_id === entity);
  });
  const income = filteredReceipts.reduce((sum, receipt) => sum + receipt.amount, 0);
  const expenses = filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const balanceCutoff = `${shiftMonth(periodEnd.slice(0, 7), 1)}-01`;
  const outstandingRows = workspace.agreements.filter((agreement) => !agreement.archived_at && agreement.start_date <= periodEnd).map((agreement) => ({ agreement, balance: periodBalance(workspace, agreement.id, balanceCutoff) })).filter((row) => row.balance > 0);
  const entityOptions = report === "tenant" ? workspace.tenants.map((item) => [item.id, item.name]) : report === "agreement" ? workspace.agreements.map((item) => [item.id, item.display_id]) : workspace.properties.map((item) => [item.id, item.name]);
  const titleMap = { summary: "Income & expense summary", collections: "Rent collection report", outstanding: "Outstanding rent", expenses: "Expense report", tenant: "Tenant statement", property: "Property statement", agreement: "Agreement statement" };

  return <><PageHeading eyebrow="Printable records" title="Reports" subtitle="Filter the information you need, then print or save it as a PDF." action={<div className="heading-actions no-print"><button className="button button-secondary" type="button" onClick={() => window.print()}><Printer size={16} />Print</button><button className="button button-primary" type="button" onClick={() => window.print()}><Download size={16} />Save PDF</button></div>} />
    <div className="report-picker no-print"><Field label="Report"><select value={report} onChange={(event) => { setReport(event.target.value as typeof report); setEntity("all"); }}>{Object.entries(titleMap).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="Period"><select value={periodMode} onChange={(event) => setPeriodMode(event.target.value as typeof periodMode)}><option value="month">Month</option><option value="year">Year</option><option value="custom">Custom dates</option></select></Field>{periodMode === "month" && <Field label="Month"><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></Field>}{periodMode === "year" && <Field label="Year"><input type="number" min="2000" max="2100" value={year} onChange={(event) => setYear(event.target.value)} /></Field>}{periodMode === "custom" && <><Field label="From"><input type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} /></Field><Field label="To"><input type="date" value={toDate} min={fromDate} onChange={(event) => setToDate(event.target.value)} /></Field></>}{["tenant", "property", "agreement"].includes(report) && <Field label={report[0].toUpperCase() + report.slice(1)}><select value={entity} onChange={(event) => setEntity(event.target.value)}><option value="all">All {report}s</option>{entityOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>}</div>
    <article className="report-paper"><header className="report-header"><div><span className="eyebrow">Rentwise report</span><h2>{titleMap[report]}</h2><p>{periodLabel} · Generated {formatDate(todayISO)}</p></div><div className="report-owner"><strong>{workspace.settings.receipt_name || workspace.profile.full_name}</strong><span>{workspace.settings.receipt_phone}</span></div></header>
      {report === "summary" && <><div className="report-totals"><div><span>Rent collected</span><strong>{formatMoney(income, symbol)}</strong></div><div><span>Expenses</span><strong>{formatMoney(expenses, symbol)}</strong></div><div><span>Net income</span><strong>{formatMoney(income - expenses, symbol)}</strong></div></div><ReportCollectionTable workspace={workspace} receipts={filteredReceipts} /><ReportExpenseTable workspace={workspace} expenses={filteredExpenses} /></>}
      {(report === "collections" || report === "tenant" || report === "property" || report === "agreement") && <ReportCollectionTable workspace={workspace} receipts={filteredReceipts} />}
      {report === "expenses" && <ReportExpenseTable workspace={workspace} expenses={filteredExpenses} />}
      {report === "outstanding" && <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Agreement</th><th>Tenant</th><th>Property</th><th className="number">Balance</th></tr></thead><tbody>{outstandingRows.map(({ agreement, balance }) => <tr key={agreement.id}><td>{agreement.display_id}</td><td>{workspace.tenants.find((item) => item.id === agreement.tenant_id)?.name}</td><td>{workspace.properties.find((item) => item.id === agreement.property_id)?.name}</td><td className="number">{formatMoney(balance, symbol)}</td></tr>)}</tbody><tfoot><tr><th colSpan={3}>Total outstanding</th><th className="number">{formatMoney(outstandingRows.reduce((sum, row) => sum + row.balance, 0), symbol)}</th></tr></tfoot></table></div>}
    </article>
  </>;
}

function ReportCollectionTable({ workspace, receipts }: { workspace: WorkspaceData; receipts: RentReceipt[] }) {
  return <section className="report-section"><h3>Rent collections</h3><div className="report-table-wrap"><table className="report-table"><thead><tr><th>Receipt</th><th>Date</th><th>Tenant / Property</th><th>Rent period</th><th className="number">Amount</th></tr></thead><tbody>{receipts.map((receipt) => { const period = workspace.rentPeriods.find((item) => item.id === receipt.rent_period_id); const agreement = workspace.agreements.find((item) => item.id === period?.agreement_id); return <tr key={receipt.id}><td>{receipt.display_id}</td><td>{formatDate(receipt.collection_date)}</td><td>{workspace.tenants.find((item) => item.id === agreement?.tenant_id)?.name}<small>{workspace.properties.find((item) => item.id === agreement?.property_id)?.name}</small></td><td>{monthLabel(period?.rent_month ?? currentMonthStart)}</td><td className="number">{formatMoney(receipt.amount, workspace.settings.currency_symbol)}</td></tr>; })}{!receipts.length && <tr><td colSpan={5} className="empty-cell">No collections in this period.</td></tr>}</tbody><tfoot><tr><th colSpan={4}>Total collected</th><th className="number">{formatMoney(receipts.reduce((sum, receipt) => sum + receipt.amount, 0), workspace.settings.currency_symbol)}</th></tr></tfoot></table></div></section>;
}

function ReportExpenseTable({ workspace, expenses }: { workspace: WorkspaceData; expenses: Expense[] }) {
  return <section className="report-section"><h3>Expenses</h3><div className="report-table-wrap"><table className="report-table"><thead><tr><th>Expense</th><th>Date</th><th>Description</th><th>Category</th><th className="number">Amount</th></tr></thead><tbody>{expenses.map((expense) => <tr key={expense.id}><td>{expense.display_id}</td><td>{formatDate(expense.expense_date)}</td><td>{expense.description}</td><td>{workspace.expenseCategories.find((item) => item.id === expense.category_id)?.name ?? "Other"}</td><td className="number">{formatMoney(expense.amount, workspace.settings.currency_symbol)}</td></tr>)}{!expenses.length && <tr><td colSpan={5} className="empty-cell">No expenses in this period.</td></tr>}</tbody><tfoot><tr><th colSpan={4}>Total expenses</th><th className="number">{formatMoney(expenses.reduce((sum, expense) => sum + expense.amount, 0), workspace.settings.currency_symbol)}</th></tr></tfoot></table></div></section>;
}

function SettingsPage({ workspace, openForm, service, notify, refresh, setConfirm, setLookupTarget }: PageProps & { setLookupTarget: (table: "property_types" | "payment_methods" | "expense_categories") => void }) {
  const downloadBackup = () => {
    const blob = new Blob([service.exportBackup(workspace)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `rentwise-backup-${todayISO}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify("Account backup downloaded");
  };
  const openLookup = (table: "property_types" | "payment_methods" | "expense_categories") => { setLookupTarget(table); openForm("lookup"); };
  const chooseBackup = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const backup = JSON.parse(String(reader.result)) as { product?: string; version?: number; data?: WorkspaceData };
        if (backup.product !== "Rentwise" || backup.version !== 1 || !backup.data?.profile || !Array.isArray(backup.data.properties)) throw new Error();
        setConfirm({
          title: "Replace this account from backup?",
          text: "All current records in this landlord account will be replaced. Attached files already stored in this account remain available.",
          label: "Restore backup",
          tone: "danger",
          inputLabel: "Type RESTORE to confirm",
          action: async (confirmation) => {
            if (confirmation !== "RESTORE") { notify("Restore cancelled: confirmation did not match"); return; }
            await service.restoreBackup(backup.data!, confirmation);
            await refresh();
            notify("Account restored from backup");
          },
        });
      } catch { notify("This is not a valid Rentwise backup"); }
    };
    reader.readAsText(file);
  };
  return <>
    <PageHeading eyebrow="Account preferences" title="Settings" subtitle="Manage your profile, receipts and reusable options." />
    <div className="settings-grid">
      <section className="settings-section"><SectionHeading title="Profile" /><div className="menu-list">
        <button className="menu-row" type="button" onClick={() => openForm("profile")}><IconTile icon={UserRound} /><span><strong>Personal information</strong><small>{workspace.profile.full_name} · {workspace.profile.email}</small></span><ChevronRight size={17} /></button>
        <button className="menu-row" type="button" onClick={() => openForm("password")}><IconTile icon={KeyRound} /><span><strong>Change password</strong><small>Update the password used to sign in</small></span><ChevronRight size={17} /></button>
        <button className="menu-row" type="button" onClick={() => openForm("receipt-settings")}><IconTile icon={ReceiptText} /><span><strong>Receipt information</strong><small>Name, phone, address and currency</small></span><ChevronRight size={17} /></button>
      </div></section>
      <section className="settings-section"><SectionHeading title="Custom options" /><div className="menu-list">
        <button className="menu-row" type="button" onClick={() => openLookup("property_types")}><IconTile icon={Building2} /><span><strong>Property types</strong><small>{workspace.propertyTypes.filter((item) => item.is_active).length} active options</small></span><ChevronRight size={17} /></button>
        <button className="menu-row" type="button" onClick={() => openLookup("payment_methods")}><IconTile icon={CreditCard} /><span><strong>Payment methods</strong><small>{workspace.paymentMethods.filter((item) => item.is_active).length} active options</small></span><ChevronRight size={17} /></button>
        <button className="menu-row" type="button" onClick={() => openLookup("expense_categories")}><IconTile icon={Tags} /><span><strong>Expense categories</strong><small>{workspace.expenseCategories.filter((item) => item.is_active).length} active options</small></span><ChevronRight size={17} /></button>
      </div></section>
      <section className="settings-section"><SectionHeading title="Backup & restore" /><div className="menu-list">
        <button className="menu-row" type="button" onClick={downloadBackup}><IconTile icon={DatabaseBackup} /><span><strong>Download account backup</strong><small>Export records and attachment references as JSON</small></span><Download size={17} /></button>
        <label className="menu-row file-menu-row"><IconTile icon={RotateCcw} /><span><strong>Restore account backup</strong><small>Validate and transactionally replace this account</small></span><Upload size={17} /><input type="file" accept="application/json" onChange={(event) => { chooseBackup(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
      </div></section>
    </div>
  </>;
}

function AdminPage({ workspace, service, client, notify }: PageProps & { client: ReturnType<typeof getSupabaseBrowserClient> }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  useEffect(() => { service.listAdminUsers().then(setUsers).finally(() => setLoading(false)); }, [service]);
  if (!workspace.profile.is_admin && !service.isDemo) return <EmptyState icon={ShieldCheck} title="Administrator access required" text="This area is restricted to the single platform administrator." />;
  const filtered = users.filter((item) => `${item.full_name} ${item.email} ${item.id}`.toLowerCase().includes(query.toLowerCase()));
  async function runAction(user: AdminUser, action: "deactivate" | "reactivate" | "reset-password") {
    if (service.isDemo) { setUsers((current) => current.map((item) => item.id === user.id ? { ...item, is_active: action === "reactivate" ? true : action === "deactivate" ? false : item.is_active } : item)); notify(action === "reset-password" ? "Temporary password generated in sample mode" : `Account ${action}d`); setSelected(null); return; }
    const session = (await client?.auth.getSession())?.data.session;
    if (!session) return;
    const response = await fetch("/api/admin/user-action", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ userId: user.id, action, temporaryPassword: action === "reset-password" ? temporaryPassword : undefined }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Administrator action failed");
    notify(action === "reset-password" ? "Password reset and next-login change required" : `Account ${action}d`);
    setSelected(null); setTemporaryPassword(""); setUsers(await service.listAdminUsers());
  }
  return <><PageHeading eyebrow="Platform administration" title="Landlord accounts" subtitle="Manage access and audited support operations. Existing passwords are never visible." />
    <div className="admin-metrics"><div><span>Total accounts</span><strong>{users.filter((item) => !item.is_admin).length}</strong></div><div><span>Active</span><strong>{users.filter((item) => !item.is_admin && item.is_active).length}</strong></div><div><span>Inactive</span><strong>{users.filter((item) => !item.is_admin && !item.is_active).length}</strong></div></div>
    <div className="inline-alert"><ShieldCheck size={18} /><span>User passwords are securely hashed. The administrator can replace a password, but cannot read the old one.</span></div>
    <div className="list-toolbar"><label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email or account ID" /></label></div>
    <div className="record-list">{loading ? <div className="list-loading"><LoaderCircle className="spin" size={20} />Loading accounts</div> : filtered.filter((item) => !item.is_admin).map((account) => <button className="record-row" type="button" key={account.id} onClick={() => setSelected(account)}><span className="avatar">{initials(account.full_name)}</span><span className="record-main"><strong>{account.full_name}</strong><small>{account.email} · joined {formatDate(account.created_at)}</small></span><StatusPill tone={account.is_active ? "positive" : "danger"}>{account.is_active ? "Active" : "Inactive"}</StatusPill><ChevronRight size={17} /></button>)}</div>
    {selected && <Sheet title={selected.full_name} subtitle={selected.email} onClose={() => setSelected(null)}><dl className="detail-list"><div><dt>Account ID</dt><dd className="mono-value">{selected.id}</dd></div><div><dt>Status</dt><dd>{selected.is_active ? "Active" : "Inactive"}</dd></div><div><dt>Joined</dt><dd>{formatDate(selected.created_at)}</dd></div></dl><div className="admin-actions"><Field label="Temporary password" hint="The landlord must choose a new password after signing in."><input type="text" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} minLength={8} placeholder="At least 8 characters" /></Field><button className="button button-secondary button-block" type="button" disabled={temporaryPassword.length < 8} onClick={() => void runAction(selected, "reset-password")}><KeyRound size={16} />Reset password</button><button className={cn("button button-block", selected.is_active ? "button-danger" : "button-primary")} type="button" onClick={() => void runAction(selected, selected.is_active ? "deactivate" : "reactivate")}>{selected.is_active ? <Ban size={16} /> : <RefreshCw size={16} />}{selected.is_active ? "Deactivate account" : "Reactivate account"}</button></div></Sheet>}
  </>;
}

function PropertyForm({ workspace, service, targetId, onClose, mutate }: { workspace: WorkspaceData; service: RentwiseDataService; targetId: string | null; onClose: () => void; mutate: (operation: () => Promise<unknown>, success: string) => Promise<void> }) {
  const existing = workspace.properties.find((item) => item.id === targetId);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const values: Partial<Property> = { name: String(form.get("name") || "").trim(), property_type_id: String(form.get("type") || "") || null, location: String(form.get("location") || "").trim(), status: existing?.status === "occupied" ? "occupied" : form.get("status") as Property["status"], notes: String(form.get("notes") || "").trim() };
    await mutate(() => existing ? service.updateProperty(existing.id, values) : service.createProperty(workspace.profile.id, values), existing ? `${existing.display_id} updated` : "Property created with a new ID");
  }
  return <Sheet title={existing ? "Edit property" : "Add property"} subtitle={existing ? existing.display_id : "A permanent property ID is generated automatically."} onClose={onClose}><form onSubmit={submit}><Field label="Property name"><input name="name" defaultValue={existing?.name} required /></Field><Field label="Property type"><select name="type" defaultValue={existing?.property_type_id ?? ""} required><option value="" disabled>Select a type</option>{workspace.propertyTypes.filter((item) => item.is_active || item.id === existing?.property_type_id).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field><Field label="Location"><textarea name="location" defaultValue={existing?.location} required /></Field><Field label="Status" hint="Occupied status is controlled by an active agreement."><select name="status" defaultValue={existing?.status ?? "vacant"} disabled={existing?.status === "occupied"}><option value="vacant">Vacant</option><option value="maintenance">Maintenance</option>{existing?.status === "occupied" && <option value="occupied">Occupied</option>}</select></Field><Field label="Internal notes"><textarea name="notes" defaultValue={existing?.notes} /></Field><div className="sheet-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit">{existing ? "Save changes" : "Create property"}</button></div></form></Sheet>;
}

function TenantForm({ workspace, service, targetId, onClose, mutate }: { workspace: WorkspaceData; service: RentwiseDataService; targetId: string | null; onClose: () => void; mutate: (operation: () => Promise<unknown>, success: string) => Promise<void> }) {
  const existing = workspace.tenants.find((item) => item.id === targetId);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const element = event.currentTarget; const form = new FormData(element);
    const values: Partial<Tenant> = { name: String(form.get("name") || "").trim(), phone: String(form.get("phone") || "").trim(), email: String(form.get("email") || "").trim() || null, address: String(form.get("address") || "").trim(), nid: String(form.get("nid") || "").trim() || null, notes: String(form.get("notes") || "").trim() };
    await mutate(async () => { const record = existing ? (await service.updateTenant(existing.id, values), existing) : await service.createTenant(workspace.profile.id, values); const files = Array.from((element.elements.namedItem("attachments") as HTMLInputElement)?.files ?? []); for (const file of files) await service.uploadAttachment(workspace.profile.id, "tenant", record.id, file); }, existing ? `${existing.display_id} updated` : "Tenant created with a new ID");
  }
  return <Sheet title={existing ? "Edit tenant" : "Add tenant"} subtitle={existing ? existing.display_id : "A permanent tenant ID is generated automatically."} onClose={onClose}><form onSubmit={submit}><Field label="Full name"><input name="name" defaultValue={existing?.name} required /></Field><div className="field-grid"><Field label="Phone"><input name="phone" type="tel" defaultValue={existing?.phone} required /></Field><Field label="Email (optional)"><input name="email" type="email" defaultValue={existing?.email ?? ""} /></Field></div><Field label="Address"><textarea name="address" defaultValue={existing?.address} /></Field><Field label="NID (optional)" hint="NID is masked in ordinary views."><input name="nid" inputMode="numeric" defaultValue={existing?.nid ?? ""} /></Field><Field label="Attachments" hint="JPG, PNG, WebP or PDF. Maximum 10 MB per file."><input name="attachments" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple /></Field><Field label="Internal notes"><textarea name="notes" defaultValue={existing?.notes} /></Field><div className="sheet-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit">{existing ? "Save changes" : "Create tenant"}</button></div></form></Sheet>;
}

function AgreementForm({ workspace, service, targetId, onClose, mutate }: { workspace: WorkspaceData; service: RentwiseDataService; targetId: string | null; onClose: () => void; mutate: (operation: () => Promise<unknown>, success: string) => Promise<void> }) {
  const existing = workspace.agreements.find((item) => item.id === targetId);
  const propertyTarget = existing ? undefined : workspace.properties.find((item) => item.id === targetId);
  const vacantProperties = workspace.properties.filter((property) => !property.archived_at && (property.status === "vacant" || property.id === existing?.property_id));
  const availableTenants = workspace.tenants.filter((tenant) => !tenant.archived_at && (!activeAgreement(workspace, undefined, tenant.id) || tenant.id === existing?.tenant_id));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const element = event.currentTarget; const form = new FormData(element);
    const values: Partial<Agreement> = { property_id: existing?.property_id ?? String(form.get("property")), tenant_id: existing?.tenant_id ?? String(form.get("tenant")), start_date: String(form.get("startDate")), end_date: String(form.get("endDate")), security_deposit: safeNumber(form.get("deposit")), notice_period_months: safeNumber(form.get("notice")), monthly_base_rent: safeNumber(form.get("rent")), collection_offset: safeNumber(form.get("offset")) as 0 | 1, due_day: safeNumber(form.get("dueDay")), notes: String(form.get("notes") || "").trim() };
    await mutate(async () => { const record = existing ? (await service.updateAgreement(existing.id, values), existing) : await service.createAgreement(workspace.profile.id, values); const files = Array.from((element.elements.namedItem("attachments") as HTMLInputElement)?.files ?? []); for (const file of files) await service.uploadAttachment(workspace.profile.id, "agreement", record.id, file); }, existing ? `${existing.display_id} updated` : "Agreement created with a new ID");
  }
  return <Sheet title={existing ? "Edit agreement" : "Create agreement"} subtitle={existing ? `${existing.display_id} · Tenant and property stay fixed to preserve history.` : "Connect one available tenant to one vacant property."} onClose={onClose} wide><form onSubmit={submit}><div className="inline-alert"><Info size={17} /><span>Overlapping agreements are blocked automatically.</span></div><Field label="Property"><select name="property" defaultValue={existing?.property_id ?? propertyTarget?.id ?? ""} disabled={Boolean(existing)} required><option value="" disabled>Select a property</option>{vacantProperties.map((property) => <option key={property.id} value={property.id}>{property.name} · {property.display_id}</option>)}</select></Field><Field label="Tenant"><select name="tenant" required defaultValue={existing?.tenant_id ?? ""} disabled={Boolean(existing)}><option value="" disabled>Select a tenant</option>{availableTenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name} · {tenant.display_id}</option>)}</select></Field><div className="field-grid"><Field label="Start date"><input name="startDate" type="date" defaultValue={existing?.start_date ?? `${shiftMonth(currentMonth, 1)}-01`} required /></Field><Field label="End date"><input name="endDate" type="date" defaultValue={existing?.end_date ?? `${today.getFullYear() + 1}-${String(today.getMonth() + 1).padStart(2, "0")}-28`} required /></Field></div><div className="field-grid"><Field label="Monthly base rent"><input name="rent" type="number" inputMode="decimal" min="0" defaultValue={existing?.monthly_base_rent} required /></Field><Field label="Security deposit"><input name="deposit" type="number" inputMode="decimal" min="0" defaultValue={existing?.security_deposit ?? 0} /></Field></div><Field label="Collection schedule"><select name="offset" defaultValue={String(existing?.collection_offset ?? 0)}><option value="0">Collect in the same month</option><option value="1">Collect in the following month</option></select></Field><div className="field-grid"><Field label="Expected collection day" hint="Use day 1–28."><input name="dueDay" type="number" min="1" max="28" defaultValue={existing?.due_day ?? 5} required /></Field><Field label="Notice period (months)"><input name="notice" type="number" min="0" defaultValue={existing?.notice_period_months ?? 2} /></Field></div><Field label="Agreement attachments"><input name="attachments" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple /></Field><Field label="Internal notes"><textarea name="notes" defaultValue={existing?.notes} /></Field><div className="sheet-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit">{existing ? "Save changes" : "Create agreement"}</button></div></form></Sheet>;
}

function CollectionForm({ workspace, service, targetId, onClose, mutate }: { workspace: WorkspaceData; service: RentwiseDataService; targetId: string | null; onClose: () => void; mutate: (operation: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [requestKey] = useState(() => crypto.randomUUID());
  const agreements = workspace.agreements.filter((item) => agreementStatus(item, todayISO) === "active");
  const [agreementId, setAgreementId] = useState(targetId && agreements.some((item) => item.id === targetId) ? targetId : agreements[0]?.id ?? "");
  const agreement = agreements.find((item) => item.id === agreementId);
  const defaultRentMonth = agreement ? shiftMonth(currentMonth, -agreement.collection_offset) : currentMonth;
  const [rentMonth, setRentMonth] = useState(defaultRentMonth);
  const [charges, setCharges] = useState<ChargeInput[]>([]);
  const baseRent = agreement ? rentForMonth(agreement, workspace.increments, rentMonth) : 0;
  const normalizedMonth = `${rentMonth}-01`;
  const prior = agreement ? periodBalance(workspace, agreement.id, normalizedMonth) : 0;
  const period = workspace.rentPeriods.find((item) => item.agreement_id === agreementId && item.rent_month === normalizedMonth);
  const existingCharges = workspace.rentCharges.filter((item) => item.rent_period_id === period?.id).reduce((sum, item) => sum + item.amount, 0);
  const existingPayments = workspace.receipts.filter((item) => item.rent_period_id === period?.id && item.status === "valid").reduce((sum, item) => sum + item.amount, 0);
  const newCharges = charges.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expected = Math.max(0, prior + baseRent + existingCharges + newCharges - existingPayments);
  const tenant = workspace.tenants.find((item) => item.id === agreement?.tenant_id);
  const property = workspace.properties.find((item) => item.id === agreement?.property_id);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!agreement) return; const element = event.currentTarget; const form = new FormData(element);
    await mutate(async () => { const receipt = await service.createReceipt(workspace.profile.id, { requestKey, agreementId: agreement.id, rentMonth, baseRent, collectionDate: String(form.get("date")), amount: safeNumber(form.get("amount")), paymentMethodId: String(form.get("method") || "") || null, collectedBy: String(form.get("collectedBy") || "").trim(), notes: String(form.get("notes") || "").trim(), charges: charges.filter((item) => item.reason.trim() && item.amount > 0) }); const files = Array.from((element.elements.namedItem("attachments") as HTMLInputElement)?.files ?? []); for (const file of files) await service.uploadAttachment(workspace.profile.id, "receipt", receipt.id, file); }, "Rent received and receipt generated");
  }
  return <Sheet title="Collect rent" subtitle="Each payment creates a permanent receipt ID." onClose={onClose} wide><form onSubmit={submit}><Field label="Agreement"><select value={agreementId} onChange={(event) => { const next = agreements.find((item) => item.id === event.target.value); setAgreementId(event.target.value); if (next) setRentMonth(shiftMonth(currentMonth, -next.collection_offset)); }} required>{agreements.map((item) => { const rowTenant = workspace.tenants.find((tenantItem) => tenantItem.id === item.tenant_id); const rowProperty = workspace.properties.find((propertyItem) => propertyItem.id === item.property_id); return <option value={item.id} key={item.id}>{rowTenant?.name} · {rowProperty?.name} · {item.display_id}</option>; })}</select></Field>{agreement && <><div className="selection-summary"><div><span>Tenant</span><strong>{tenant?.name}</strong></div><div><span>Property</span><strong>{property?.name}</strong></div><div><span>Schedule</span><strong>{agreement.collection_offset === 0 ? "Same month" : "Following month"}</strong></div></div><div className="field-grid"><Field label="Rent period"><input type="month" value={rentMonth} onChange={(event) => setRentMonth(event.target.value)} required /></Field><Field label="Collection date"><input name="date" type="date" defaultValue={todayISO} required /></Field></div><div className="inline-alert"><CalendarClock size={17} /><span>{monthLabel(normalizedMonth)} rent is expected in {monthLabel(`${shiftMonth(rentMonth, agreement.collection_offset)}-01`)} under this agreement.</span></div><div className="calculation-card"><div><span>Scheduled base rent</span><strong>{formatMoney(baseRent, workspace.settings.currency_symbol)}</strong></div><div><span>Previous due / advance</span><strong className={prior < 0 ? "positive-value" : prior > 0 ? "text-danger" : ""}>{prior < 0 ? `−${formatMoney(Math.abs(prior), workspace.settings.currency_symbol)}` : formatMoney(prior, workspace.settings.currency_symbol)}</strong></div>{existingCharges > 0 && <div><span>Existing charges</span><strong>{formatMoney(existingCharges, workspace.settings.currency_symbol)}</strong></div>}{existingPayments > 0 && <div><span>Already received for this period</span><strong>−{formatMoney(existingPayments, workspace.settings.currency_symbol)}</strong></div>}</div><SectionHeading title="Additional charges" action={<button className="text-button" type="button" onClick={() => setCharges((current) => [...current, { reason: "", amount: 0 }])}><Plus size={15} />Add charge</button>} />{charges.map((charge, index) => <div className="charge-row" key={index}><input aria-label={`Charge ${index + 1} reason`} placeholder="Reason" value={charge.reason} onChange={(event) => setCharges((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, reason: event.target.value } : item))} /><input aria-label={`Charge ${index + 1} amount`} type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="Amount" value={charge.amount || ""} onChange={(event) => setCharges((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount: Number(event.target.value) } : item))} /><button type="button" className="icon-button danger-icon" onClick={() => setCharges((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label="Remove charge"><Trash2 size={17} /></button></div>)}<div className="expected-total"><span>Amount currently payable</span><strong>{formatMoney(expected, workspace.settings.currency_symbol)}</strong></div><Field label="Amount collected" hint="Partial and advance payments are allowed."><input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" defaultValue={expected || ""} key={`${agreementId}-${rentMonth}-${expected}`} required /></Field><Field label="Payment method"><select name="method" required><option value="" disabled>Select a method</option>{workspace.paymentMethods.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Collected by (optional)"><input name="collectedBy" defaultValue={workspace.profile.full_name} /></Field><Field label="Attachment"><input name="attachments" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple /></Field><Field label="Notes"><textarea name="notes" /></Field></>}<div className="sheet-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={!agreement}>Save & generate receipt</button></div></form></Sheet>;
}

function ExpenseForm({ workspace, service, onClose, mutate }: { workspace: WorkspaceData; service: RentwiseDataService; onClose: () => void; mutate: (operation: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [requestKey] = useState(() => crypto.randomUUID());
  const [propertyIds, setPropertyIds] = useState<string[]>([workspace.properties.find((item) => !item.archived_at)?.id ?? ""]);
  const [split, setSplit] = useState<"equal" | "custom">("equal");
  const [amount, setAmount] = useState(0);
  const [customAmounts, setCustomAmounts] = useState<Record<string, number>>({});
  const available = workspace.properties.filter((item) => !item.archived_at);
  const allocations = propertyIds.filter(Boolean).map((propertyId) => ({ property_id: propertyId, allocated_amount: split === "equal" ? amount / Math.max(propertyIds.length, 1) : Number(customAmounts[propertyId] || 0) }));
  const allocationTotal = allocations.reduce((sum, item) => sum + item.allocated_amount, 0);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const element = event.currentTarget; const form = new FormData(element);
    if (Math.abs(allocationTotal - amount) > 0.01) return;
    await mutate(async () => { const expense = await service.createExpense(workspace.profile.id, { description: String(form.get("description") || "").trim(), expense_date: String(form.get("date")), amount, category_id: String(form.get("category") || "") || null, notes: String(form.get("notes") || "").trim() }, allocations, requestKey); const files = Array.from((element.elements.namedItem("attachments") as HTMLInputElement)?.files ?? []); for (const file of files) await service.uploadAttachment(workspace.profile.id, "expense", expense.id, file); }, "Expense saved with a new ID");
  }
  return <Sheet title="Add expense" subtitle="Record one total and allocate it without double-counting." onClose={onClose} wide><form onSubmit={submit}><Field label="Description"><input name="description" required /></Field><div className="field-grid"><Field label="Expense date"><input name="date" type="date" defaultValue={todayISO} required /></Field><Field label="Total amount"><input name="amount" type="number" inputMode="decimal" min="0" value={amount || ""} onChange={(event) => setAmount(Number(event.target.value))} required /></Field></div><Field label="Category"><select name="category" required><option value="" disabled>Select a category</option>{workspace.expenseCategories.filter((item) => item.is_active).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field><SectionHeading title="Property allocation" action={propertyIds.length < available.length ? <button className="text-button" type="button" onClick={() => setPropertyIds((current) => [...current, available.find((property) => !current.includes(property.id))?.id ?? ""])}><Plus size={15} />Add property</button> : undefined} />{propertyIds.map((propertyId, index) => <div className="allocation-row" key={index}><select aria-label={`Allocated property ${index + 1}`} value={propertyId} onChange={(event) => setPropertyIds((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}>{available.filter((property) => property.id === propertyId || !propertyIds.includes(property.id)).map((property) => <option value={property.id} key={property.id}>{property.name}</option>)}</select>{split === "custom" && <input aria-label={`Allocation amount ${index + 1}`} type="number" min="0" value={customAmounts[propertyId] || ""} onChange={(event) => setCustomAmounts((current) => ({ ...current, [propertyId]: Number(event.target.value) }))} />}{propertyIds.length > 1 && <button type="button" className="icon-button danger-icon" onClick={() => setPropertyIds((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={17} /></button>}</div>)}{propertyIds.length > 1 && <div className="segmented allocation-mode"><button type="button" className={split === "equal" ? "is-active" : ""} onClick={() => setSplit("equal")}>Equal split</button><button type="button" className={split === "custom" ? "is-active" : ""} onClick={() => setSplit("custom")}>Custom amounts</button></div>}{split === "custom" && Math.abs(allocationTotal - amount) > 0.01 && <div className="inline-alert inline-alert-danger"><CircleAlert size={17} />Allocated {formatMoney(allocationTotal, workspace.settings.currency_symbol)} of {formatMoney(amount, workspace.settings.currency_symbol)}.</div>}<Field label="Attachment"><input name="attachments" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple /></Field><Field label="Notes"><textarea name="notes" /></Field><div className="sheet-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={Math.abs(allocationTotal - amount) > 0.01}>Save expense</button></div></form></Sheet>;
}

function IncrementForm({ workspace, service, agreementId, onClose, mutate }: { workspace: WorkspaceData; service: RentwiseDataService; agreementId: string; onClose: () => void; mutate: (operation: () => Promise<unknown>, success: string) => Promise<void> }) {
  const agreement = workspace.agreements.find((item) => item.id === agreementId)!;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const start = `${String(form.get("startMonth"))}-01`; const endValue = String(form.get("endMonth") || ""); const end = endValue ? `${endValue}-01` : null;
    const overlaps = workspace.increments.some((item) => item.agreement_id === agreementId && start <= (item.end_month ?? agreement.end_date) && (end ?? agreement.end_date) >= item.start_month);
    await mutate(async () => {
      if (overlaps) throw new Error("This increment overlaps an existing rent period.");
      await service.addIncrement(workspace.profile.id, { agreement_id: agreementId, start_month: start, end_month: end, new_base_rent: safeNumber(form.get("rent")), note: String(form.get("note") || "").trim() });
    }, "Rent increment added");
  }
  return <Sheet title="Add rent increment" subtitle={`${agreement.display_id} · New rent periods cannot overlap.`} onClose={onClose}><form onSubmit={submit}><Field label="Effective start month"><input name="startMonth" type="month" min={agreement.start_date.slice(0, 7)} max={agreement.end_date.slice(0, 7)} required /></Field><Field label="Effective end month (optional)"><input name="endMonth" type="month" min={agreement.start_date.slice(0, 7)} max={agreement.end_date.slice(0, 7)} /></Field><Field label="New monthly base rent"><input name="rent" type="number" inputMode="decimal" min="0" required /></Field><Field label="Note"><textarea name="note" /></Field><div className="sheet-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit">Add increment</button></div></form></Sheet>;
}

function ProfileForm({ workspace, service, onClose, mutate }: { workspace: WorkspaceData; service: RentwiseDataService; onClose: () => void; mutate: (operation: () => Promise<unknown>, success: string) => Promise<void> }) {
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); await mutate(() => service.updateProfile(workspace.profile.id, { full_name: String(form.get("name") || "").trim(), phone: String(form.get("phone") || "").trim(), address: String(form.get("address") || "").trim() }), "Profile updated"); }
  return <Sheet title="Personal information" subtitle="Your email is managed by your sign-in account." onClose={onClose}><form onSubmit={submit}><Field label="Full name"><input name="name" defaultValue={workspace.profile.full_name} required /></Field><Field label="Email"><input value={workspace.profile.email} disabled /></Field><Field label="Phone"><input name="phone" type="tel" defaultValue={workspace.profile.phone} /></Field><Field label="Address"><textarea name="address" defaultValue={workspace.profile.address} /></Field><div className="sheet-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit">Save changes</button></div></form></Sheet>;
}

function ReceiptSettingsForm({ workspace, service, onClose, mutate }: { workspace: WorkspaceData; service: RentwiseDataService; onClose: () => void; mutate: (operation: () => Promise<unknown>, success: string) => Promise<void> }) {
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); await mutate(() => service.updateSettings(workspace.profile.id, { receipt_name: String(form.get("name") || "").trim(), receipt_phone: String(form.get("phone") || "").trim(), receipt_address: String(form.get("address") || "").trim(), currency_code: String(form.get("currencyCode") || "BDT"), currency_symbol: String(form.get("currencySymbol") || "৳"), timezone: String(form.get("timezone") || "Asia/Dhaka") }), "Receipt settings updated"); }
  return <Sheet title="Receipt information" subtitle="These details appear on receipts and printed reports." onClose={onClose}><form onSubmit={submit}><Field label="Receipt name"><input name="name" defaultValue={workspace.settings.receipt_name} required /></Field><Field label="Phone"><input name="phone" type="tel" defaultValue={workspace.settings.receipt_phone} /></Field><Field label="Address"><textarea name="address" defaultValue={workspace.settings.receipt_address} /></Field><div className="field-grid"><Field label="Currency code"><input name="currencyCode" defaultValue={workspace.settings.currency_code} maxLength={3} required /></Field><Field label="Currency symbol"><input name="currencySymbol" defaultValue={workspace.settings.currency_symbol} maxLength={4} required /></Field></div><Field label="Time zone"><input name="timezone" defaultValue={workspace.settings.timezone} required /></Field><div className="sheet-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit">Save settings</button></div></form></Sheet>;
}

function LookupManager({ workspace, service, table, onClose, mutate }: { workspace: WorkspaceData; service: RentwiseDataService; table: "property_types" | "payment_methods" | "expense_categories"; onClose: () => void; mutate: (operation: () => Promise<unknown>, success: string) => Promise<void> }) {
  const list: LookupOption[] = table === "property_types" ? workspace.propertyTypes : table === "payment_methods" ? workspace.paymentMethods : workspace.expenseCategories;
  const title = table === "property_types" ? "Property types" : table === "payment_methods" ? "Payment methods" : "Expense categories";
  async function add(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get("name") || "").trim(); if (!name) return; await mutate(() => service.addLookup(table, workspace.profile.id, name), `${name} added`); }
  return <Sheet title={title} subtitle="Used options are deactivated instead of deleted, preserving history." onClose={onClose}><form className="inline-add" onSubmit={add}><input name="name" placeholder={`Add ${title.toLowerCase().slice(0, -1)}`} required /><button className="button button-primary" type="submit"><Plus size={16} />Add</button></form><div className="lookup-list">{list.map((item) => <div key={item.id}><span>{item.name}</span><button className="button button-small button-secondary" type="button" onClick={() => void mutate(() => service.toggleLookup(table, item.id, !item.is_active), `${item.name} ${item.is_active ? "deactivated" : "activated"}`)}>{item.is_active ? "Deactivate" : "Activate"}</button></div>)}</div></Sheet>;
}

function PasswordForm({ client, onChanged, onClose, notify }: { client: ReturnType<typeof getSupabaseBrowserClient>; onChanged: () => Promise<void>; onClose: () => void; notify: (message: string) => void }) {
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!client) { notify("Password changes require the production authentication service"); onClose(); return; } const form = new FormData(event.currentTarget); const currentPassword = String(form.get("current") || ""); const password = String(form.get("password") || ""); const confirmation = String(form.get("confirmation") || ""); if (password !== confirmation) { setError("The new passwords do not match."); return; } setBusy(true); setError(""); const userResult = await client.auth.getUser(); const email = userResult.data.user?.email; if (!email) { setError("Your session is no longer available."); setBusy(false); return; } const verify = await client.auth.signInWithPassword({ email, password: currentPassword }); if (verify.error) { setError("The current password is incorrect."); setBusy(false); return; } const result = await client.auth.updateUser({ password }); if (!result.error) await client.from("profiles").update({ force_password_change: false }).eq("id", userResult.data.user!.id); if (result.error) { setBusy(false); setError(result.error.message); return; } await onChanged(); setBusy(false); notify("Password updated"); onClose(); }
  return <Sheet title="Change password" subtitle="Enter your current password before choosing a new one." onClose={onClose}><form onSubmit={submit}><Field label="Current password"><input name="current" type="password" autoComplete="current-password" required /></Field><Field label="New password"><input name="password" type="password" minLength={8} autoComplete="new-password" required /></Field><Field label="Confirm new password"><input name="confirmation" type="password" minLength={8} autoComplete="new-password" required /></Field>{error && <div className="inline-alert inline-alert-danger"><CircleAlert size={17} />{error}</div>}<div className="sheet-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy && <LoaderCircle className="spin" size={16} />}Update password</button></div></form></Sheet>;
}
