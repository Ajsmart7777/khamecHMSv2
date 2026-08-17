// CockroachDB REST & RPC Client Adapter for Khamec HMS
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

  async then(resolve: (res: { data: any; error: any }) => void, reject: (err: any) => void) {
    try {
      const res = await fetch('/.netlify/functions/db-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'select',
          table: this.table,
          select: this._select,
          filters: this._filters,
          order: this._order,
          limit: this._limit,
          offset: this._offset
        })
      });
      const json = await res.json();
      if (json.error) {
        resolve({ data: null, error: { message: json.error } });
      } else {
        const data = this._single ? (json.data?.[0] || null) : json.data;
        resolve({ data, error: null });
      }
    } catch (err: any) {
      resolve({ data: null, error: { message: err.message || 'Network error' } });
    }
  }

  async insert(values: any) {
    try {
      const res = await fetch('/.netlify/functions/db-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'insert',
          table: this.table,
          values
        })
      });
      const json = await res.json();
      return { data: json.data, error: json.error ? { message: json.error } : null };
    } catch (err: any) {
      return { data: null, error: { message: err.message } };
    }
  }

  async update(values: any) {
    try {
      const res = await fetch('/.netlify/functions/db-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          table: this.table,
          values,
          filters: this._filters
        })
      });
      const json = await res.json();
      return { data: json.data, error: json.error ? { message: json.error } : null };
    } catch (err: any) {
      return { data: null, error: { message: err.message } };
    }
  }

  async delete() {
    try {
      const res = await fetch('/.netlify/functions/db-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          table: this.table,
          filters: this._filters
        })
      });
      const json = await res.json();
      return { data: json.data, error: json.error ? { message: json.error } : null };
    } catch (err: any) {
      return { data: null, error: { message: err.message } };
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
            body: JSON.stringify({ action: 'rpc', rpc: fnName, args })
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
    getSession: async () => ({ data: { session: { user: { id: localStorage.getItem('hms_user_id') || '00000000-0000-0000-0000-000000000001' } } }, error: null }),
    getUser: async () => ({ data: { user: { id: localStorage.getItem('hms_user_id') || '00000000-0000-0000-0000-000000000001' } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
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
        }
        return json;
      } catch (err: any) {
        return { data: null, error: { message: err.message } };
      }
    },
    signOut: async () => {
      localStorage.removeItem('hms_user_id');
      return { error: null };
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
