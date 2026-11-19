// Stands in for "jsr:@supabase/supabase-js@2" when the payment functions (supabase/functions/) run inside the tests:
// the same calls the functions make, answered by a real Postgres (PGlite) with supabase/schema.sql, as the server.
type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

let db: Db | null = null;
let tokens: Record<string, string> = {};

/** The database the functions talk to, and which login tokens belong to which user ids. */
export function useTestDb(d: Db, t: Record<string, string>) { db = d; tokens = t; }

const failed = (e: unknown) => ({ data: null, error: { message: e instanceof Error ? e.message : String(e) } });

export function createClient(_url: string, _key: string, _opts?: unknown) {
  if (!db) throw new Error('useTestDb() first');
  const d = db;
  return {
    async rpc(fn: string, args: Record<string, unknown>) {
      const keys = Object.keys(args);
      try {
        const r = await d.query(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, keys.map((k) => args[k]));
        return { data: r.rows[0]?.r ?? null, error: null };
      } catch (e) { return failed(e); }
    },
    from(table: string) {
      const where: [string, unknown][] = [];
      let cols = '*';
      const q = {
        select(c: string) { cols = c; return q; },
        eq(c: string, v: unknown) { where.push([c, v]); return q; },
        async maybeSingle() {
          try {
            const w = where.length ? ' where ' + where.map(([c], i) => `${c} = $${i + 1}`).join(' and ') : '';
            const r = await d.query(`select ${cols} from public.${table}${w} limit 1`, where.map(([, v]) => v));
            return { data: r.rows[0] ?? null, error: null };
          } catch (e) { return failed(e); }
        },
      };
      return q;
    },
    auth: {
      async getUser(token: string) {
        const id = tokens[token];
        return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } };
      },
    },
  };
}

export type SupabaseClient = ReturnType<typeof createClient>;
