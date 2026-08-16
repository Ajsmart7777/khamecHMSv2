import { createClient, SupabaseAuthAdapter } from '@neondatabase/neon-js';
import type { Database } from './types';

type ErrorLike = Error | null;

type FunctionInvokeOptions = {
  body?: unknown;
  headers?: Record<string, string>;
};

type RealtimePayload = {
  event: string;
  schema: string;
  table: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
};

type RealtimeCallback = (payload: RealtimePayload) => void;

type PollingRealtimeChannel = {
  on: (event: string, filter: Record<string, string>, callback: RealtimeCallback) => PollingRealtimeChannel;
  subscribe: (callback?: (status: string) => void) => PollingRealtimeChannel;
  unsubscribe: () => void;
};

const NEON_AUTH_URL = import.meta.env.VITE_NEON_AUTH_URL;
const NEON_DATA_API_URL = import.meta.env.VITE_NEON_DATA_API_URL;
const R2_PUBLIC_URL = String(import.meta.env.VITE_R2_PUBLIC_URL ?? '').replace(/\/$/, '');
const REALTIME_POLL_MS = Number(import.meta.env.VITE_REALTIME_POLL_MS ?? 5000);

if (!NEON_AUTH_URL || !NEON_DATA_API_URL) {
  throw new Error('Missing VITE_NEON_AUTH_URL or VITE_NEON_DATA_API_URL configuration.');
}

const neonClient = createClient<Database>({
  auth: {
    adapter: SupabaseAuthAdapter(),
    url: NEON_AUTH_URL,
  },
  dataApi: {
    url: NEON_DATA_API_URL,
  },
});

async function invokeNetlifyFunction(functionName: string, options: FunctionInvokeOptions = {}) {
  const { data: sessionData } = await neonClient.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  try {
    const response = await fetch(`/.netlify/functions/${functionName}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(options.body ?? {}),
    });
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!response.ok) {
      const message = typeof data === 'object' && data && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Function ${functionName} failed with HTTP ${response.status}`;
      return { data: null, error: new Error(message) };
    }
    return { data, error: null as ErrorLike };
  } catch (error) {
    return { data: null, error: error as Error };
  }
}

function createR2StorageFallback() {
  return {
    from: (bucket: string) => ({
      createSignedUrl: async (path: string) => ({
        data: { signedUrl: `${R2_PUBLIC_URL}/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}` },
        error: null as ErrorLike,
      }),
      remove: async () => ({ data: null, error: new Error('Direct storage removal is not supported; use the R2 delete function.') }),
    }),
  };
}

const functionClient = {
  invoke: invokeNetlifyFunction,
};

const compatibleClient = neonClient as typeof neonClient & {
  functions: typeof functionClient;
  storage: ReturnType<typeof createR2StorageFallback>;
  removeChannel: (channel: PollingRealtimeChannel) => void;
};

compatibleClient.functions = functionClient;
compatibleClient.storage = createR2StorageFallback();

let realtimeChannelSequence = 0;

/**
 * Neon Data API does not provide Supabase Realtime channels. This compatibility
 * channel preserves the existing subscription contract and polls each mounted
 * listener. Screen callbacks refetch their authoritative rows from Neon, so no
 * clinical data is synthesized or written by the fallback.
 */
export function createRealtimeChannel(_topic: string): PollingRealtimeChannel {
  realtimeChannelSequence += 1;
  const callbacks: Array<{ filter: Record<string, string>; callback: RealtimeCallback }> = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const channel: PollingRealtimeChannel = {
    on(event, filter, callback) {
      if (event === 'postgres_changes') callbacks.push({ filter, callback });
      return channel;
    },
    subscribe(statusCallback) {
      if (timer || stopped) return channel;
      timer = setInterval(() => {
        if (stopped) return;
        for (const { filter, callback } of callbacks) {
          callback({
            event: filter.event ?? '*',
            schema: filter.schema ?? 'public',
            table: filter.table ?? '',
            new: {},
            old: {},
          });
        }
      }, REALTIME_POLL_MS);
      statusCallback?.('SUBSCRIBED');
      return channel;
    },
    unsubscribe() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };

  return channel;
}

compatibleClient.removeChannel = (channel) => {
  channel.unsubscribe();
};

export const supabase = compatibleClient;
