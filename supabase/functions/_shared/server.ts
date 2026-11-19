// Server-side helpers for the payment functions (Deno on Supabase Edge Functions).
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, publicMessage } from './billing.ts';

export const env = (name: string): string => {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing secret ${name}`);
  return v;
};

/**
 * The server's own key (may call the billing functions; never sent to a browser): Supabase's new secret key when
 * the project has one (SUPABASE_SECRET_KEYS, a JSON list), otherwise the older service_role key.
 */
export function serverKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}') as Record<string, string>;
    const k = keys.default || Object.values(keys)[0];
    if (k) return k;
  } catch { /* not set or not JSON: use the older key */ }
  return env('SUPABASE_SERVICE_ROLE_KEY');
}

/** The database as the server. */
export const admin = (): SupabaseClient => createClient(env('SUPABASE_URL'), serverKey(), { auth: { persistSession: false } });

/**
 * The signed-in person who called, or null. Supabase Auth itself checks the login token (so this works with the
 * old and the new signing keys); the functions are deployed with --no-verify-jwt and rely on this check.
 */
export async function caller(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await admin().auth.getUser(token);
  return error || !data?.user ? null : data.user.id;
}

/** Wraps a handler with CORS, POST-only and JSON replies. Errors become a short message (details only in the logs). */
export function serve(handler: (req: Request) => Promise<unknown>) {
  Deno.serve(async (req) => {
    const cors = corsHeaders(req.headers.get('Origin'), Deno.env.get('ALLOWED_ORIGINS') || '');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method !== 'POST') return json({ error: 'Not found' }, 404);
    try {
      return json(await handler(req));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 400;
      console.error(e);
      return json({ error: e instanceof HttpError ? e.message : publicMessage(e) }, status);
    }
  });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
