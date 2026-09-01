const API_URL = String(import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/api\/?$/, '').replace(/\/+$/, '');
const SESSION_KEY = 'crm-dc-auth-session';

type QueryResult = { data: any; error: any; count?: number | null };
type Filter = { column: string; operator: string; value: unknown };
type AuthCallback = (event: string, session: any) => void;

const authCallbacks = new Set<AuthCallback>();

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}

function storeSession(session: any) {
  if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else sessionStorage.removeItem(SESSION_KEY);
  authCallbacks.forEach((callback) => callback(session ? 'SIGNED_IN' : 'SIGNED_OUT', session));
}

async function apiFetch(path: string, init: RequestInit = {}) {
  const session = readSession();
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (session?.access_token) headers.set('authorization', `Bearer ${session.access_token}`);
  const response = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !path.includes('/api/auth/')) storeSession(null);
    const error: any = new Error(json.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = json.code;
    error.context = { json: async () => json };
    throw error;
  }
  return json;
}

class QueryBuilder implements PromiseLike<QueryResult> {
  private action: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private payload: unknown;
  private filters: Filter[] = [];
  private orders: { column: string; ascending?: boolean }[] = [];
  private selected = '*';
  private resultCount?: 'exact';
  private head = false;
  private take?: number;
  private offset?: number;
  private one = false;
  private maybeOne = false;
  private conflict?: string;

  constructor(private resource: string) {}

  select(columns = '*', options?: { count?: 'exact'; head?: boolean }) { this.selected = columns; this.resultCount = options?.count; this.head = Boolean(options?.head); return this; }
  insert(data: unknown) { this.action = 'insert'; this.payload = data; return this; }
  update(data: unknown) { this.action = 'update'; this.payload = data; return this; }
  upsert(data: unknown, options?: { onConflict?: string }) { this.action = 'upsert'; this.payload = data; this.conflict = options?.onConflict; return this; }
  delete() { this.action = 'delete'; return this; }
  eq(column: string, value: unknown) { return this.filter(column, 'eq', value); }
  neq(column: string, value: unknown) { return this.filter(column, 'neq', value); }
  gt(column: string, value: unknown) { return this.filter(column, 'gt', value); }
  gte(column: string, value: unknown) { return this.filter(column, 'gte', value); }
  lt(column: string, value: unknown) { return this.filter(column, 'lt', value); }
  lte(column: string, value: unknown) { return this.filter(column, 'lte', value); }
  is(column: string, value: unknown) { return this.filter(column, 'is', value); }
  in(column: string, value: unknown[]) { return this.filter(column, 'in', value); }
  contains(column: string, value: unknown) { return this.filter(column, 'contains', value); }
  like(column: string, value: string) { return this.filter(column, 'like', value); }
  ilike(column: string, value: string) { return this.filter(column, 'ilike', value); }
  not(column: string, operator: string, value: unknown) { return this.filter(column, operator === 'eq' ? 'neq' : 'not', value); }
  or(expression: string) {
    // Supabase's textual OR syntax is retained as metadata. Complex OR groups
    // are evaluated by purpose-built API endpoints as they are migrated.
    return this.filter('__or', 'or', expression);
  }
  order(column: string, options?: { ascending?: boolean }) { this.orders.push({ column, ascending: options?.ascending }); return this; }
  limit(value: number) { this.take = value; return this; }
  range(from: number, to: number) { this.offset = from; this.take = to - from + 1; return this; }
  single() { this.one = true; return this; }
  maybeSingle() { this.maybeOne = true; return this; }

  private filter(column: string, operator: string, value: unknown) { this.filters.push({ column, operator, value }); return this; }

  private async execute(): Promise<QueryResult> {
    try {
      const result = await apiFetch(`/api/data/${encodeURIComponent(this.resource)}/query`, {
        method: 'POST',
        body: JSON.stringify({ action: this.action, data: this.payload, filters: this.filters, order: this.orders, select: this.selected, count: this.resultCount, head: this.head, limit: this.take, offset: this.offset, single: this.one, maybeSingle: this.maybeOne, onConflict: this.conflict }),
      });
      return { data: result.data ?? null, count: result.count, error: null };
    } catch (error) { return { data: null, count: null, error }; }
  }

  then<TResult1 = QueryResult, TResult2 = never>(onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

function userFromSession(session: any) {
  if (!session?.user) return null;
  return { ...session.user, user_metadata: { full_name: session.user.full_name }, app_metadata: { role: session.user.role }, aud: 'authenticated', created_at: session.user.created_at || new Date().toISOString() };
}

export const hasSupabaseConfig = true;
export const supabaseConfigError = '';
export const supabaseProjectUrl = API_URL;

export const supabase: any = {
  from: (resource: string) => new QueryBuilder(resource),
  rpc: async (name: string, body: unknown = {}) => {
    try { return await apiFetch(`/api/rpc/${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(body) }); }
    catch (error) { return { data: null, error }; }
  },
  functions: {
    invoke: async (name: string, options?: { body?: unknown }) => {
      try { return { data: await apiFetch(`/api/functions/${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(options?.body ?? {}) }), error: null }; }
      catch (error) { return { data: null, error }; }
    },
  },
  auth: {
    requestOtp: async ({ email }: { email: string }) => {
      try { return { data: await apiFetch('/api/auth/request-otp', { method: 'POST', body: JSON.stringify({ email }) }), error: null }; }
      catch (error) { return { data: null, error }; }
    },
    verifyOtp: async ({ email, token }: { email: string; token: string; type?: string }) => {
      try {
        const value = await apiFetch('/api/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email, code: token }) });
        const session = { access_token: value.token, token_type: 'bearer', expires_in: value.expiresIn, expires_at: Math.floor(Date.now() / 1000) + value.expiresIn, user: userFromSession({ user: value.user }) };
        storeSession(session);
        return { data: { session, user: session.user }, error: null };
      } catch (error) { return { data: { session: null, user: null }, error }; }
    },
    signInWithOtp: async ({ email }: { email: string }) => supabase.auth.requestOtp({ email }),
    signInWithPassword: async () => ({ data: { session: null, user: null }, error: new Error('Password login is disabled. Use the email verification code.') }),
    getSession: async () => ({ data: { session: readSession() }, error: null }),
    getUser: async () => ({ data: { user: userFromSession(readSession()) }, error: null }),
    refreshSession: async () => ({ data: { session: readSession(), user: userFromSession(readSession()) }, error: null }),
    signOut: async () => { storeSession(null); return { error: null }; },
    onAuthStateChange: (callback: AuthCallback) => {
      authCallbacks.add(callback);
      queueMicrotask(() => callback('INITIAL_SESSION', readSession()));
      return { data: { subscription: { unsubscribe: () => authCallbacks.delete(callback) } } };
    },
  },
  channel: () => {
    const channel: any = { on: () => channel, subscribe: () => channel, unsubscribe: () => undefined };
    return channel;
  },
  removeChannel: () => undefined,
};
