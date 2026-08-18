// CockroachDB REST & RPC Client Adapter for Khamec HMS
function requestContext() {
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('hms_user_id') : null;
  const userRole = typeof localStorage !== 'undefined' ? localStorage.getItem('hms_user_role') : null;
  return { user_id: userId, user_role: userRole };
}

class CockroachQueryBuilder {
  constructor(private table: string) {}

  select(columns = '*') {
    this._select = columns;
    return this;
  }
  eq(column: string, value: any) {
    this._filters = this._filters || {};
    this._filters[column] = value;
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this._order = { column, ascending: options?.ascending ?? true };
    return this;
  }
  limit(val: number) {
    this._limit = val;
    return this;
  }
  range(from: number, to: number) {
    this._offset = from;
    this._limit = to - from + 1;
    return this;
  }
  single() {
    this._single = true;
    return this;
  }

  private _select = '*';
  private _filters: Record<string, any> = {};
  private _order?: { column: string; ascending: boolean };
  private _limit?: number;
  private _offset?: number;
  private _single = false;
  private _action: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private _values: any = null;

  insert(values: any, _options?: any) {
    this._action = 'insert';
    this._values = values;
    return this;
  }

  update(values: any) {
    this._action = 'update';
    this._values = values;
    return this;
  }

  delete() {
    this._action = 'delete';
    return this;
  }

  async then(resolve: (res: { data: any; error: any }) => void, reject?: (err: any) => void) {
    try {
      const res = await fetch('/.netlify/functions/db-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: this._action,
          ...requestContext(),
          table: this.table,
          select: this._select,
          filters: this._filters,
          order: this._order,
          limit: this._limit,
          offset: this._offset,
          values: this._values
        })
      });
      const json = await res.json();
      if (json.error) {
        resolve({ data: null, error: { message: json.error } });
      } else {
        const rows = json.data ?? [];
        const data = this._single ? (rows[0] || null) : rows;
        resolve({ data, error: null });
      }
    } catch (err: any) {
      const result = { data: null, error: { message: err.message || 'Network error' } };
      if (reject) reject(err);
      else resolve(result);
    }
  }
}

export function createRealtimeChannel(_topic: string) {
  return {
    on: function() { return this; },
    subscribe: function() { return this; },
    unsubscribe: function() {}
  };
}

export const supabase = {
  from(table: string) {
    return new CockroachQueryBuilder(table);
  },
  rpc(fnName: string, args?: Record<string, any>) {
    return {
      async then(resolve: (res: { data: any; error: any }) => void) {
        try {
          const res = await fetch('/.netlify/functions/db-query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'rpc', ...requestContext(), rpc: fnName, args })
          });
          const json = await res.json();
          resolve({ data: json.data, error: json.error ? { message: json.error } : null });
        } catch (err: any) {
          resolve({ data: null, error: { message: err.message } });
        }
      }
    };
  },
  auth: {
    getSession: async () => {
      const userId = localStorage.getItem('hms_user_id');
      if (!userId) return { data: { session: null }, error: null };
      return { data: { session: { user: { id: userId }, expires_at: Math.floor(Date.now() / 1000) + 3600 } }, error: null };
    },
    getUser: async () => {
      const userId = localStorage.getItem('hms_user_id');
      if (!userId) return { data: { user: null }, error: null };
      return { data: { user: { id: userId } }, error: null };
    },
    onAuthStateChange: (callback: any) => {
      const userId = localStorage.getItem('hms_user_id');
      if (userId && callback) {
        callback('SIGNED_IN', { user: { id: userId } });
      } else if (callback) {
        callback('SIGNED_OUT', null);
      }
      return { data: { subscription: { unsubscribe: () => {} } } };
    },
    signInWithPassword: async ({ email, password }: any) => {
      try {
        const res = await fetch('/.netlify/functions/auth-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const json = await res.json();
        if (json.data?.user?.id) {
          localStorage.setItem('hms_user_id', json.data.user.id);
          if (json.data.user.role) localStorage.setItem('hms_user_role', json.data.user.role);
        }
        return json;
      } catch (err: any) {
        return { data: null, error: { message: err.message } };
      }
    },
    signOut: async () => {
      localStorage.removeItem('hms_user_id');
      localStorage.removeItem('hms_user_role');
      return { error: null };
    },
    refreshSession: async () => {
      const userId = localStorage.getItem('hms_user_id');
      if (!userId) return { data: { session: null, user: null }, error: null };
      return { data: { session: { user: { id: userId }, expires_at: Math.floor(Date.now() / 1000) + 3600 }, user: { id: userId } }, error: null };
    }
  },
  functions: {
    invoke: async (name: string, options: any) => {
      const res = await fetch(`/.netlify/functions/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options?.body || {})
      });
      const data = await res.json();
      return { data, error: null };
    }
  },
  storage: {
    from: (bucket: string) => ({
      createSignedUrl: async (path: string) => ({
        data: { signedUrl: `https://pub-r2.khamec.com/${bucket}/${path}` },
        error: null
      })
    })
  },
  channel: () => ({
    on: function() { return this; },
    subscribe: function() { return this; },
    unsubscribe: function() {}
  }),
  removeChannel: () => {}
};
