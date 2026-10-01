import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';

// Return NUMERIC as JS numbers; quantities and prices fit comfortably.
pg.types.setTypeParser(1700, v => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, v => (v === null ? null : Number(v)));

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

export const q = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0];
export const all = async (text, params) => (await pool.query(text, params)).rows;

export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

// Apply pending .sql files in order, each in its own transaction.
export async function migrate() {
  await q('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const dir = path.join(import.meta.dirname, 'migrations');
  const done = new Set((await all('SELECT name FROM schema_migrations')).map(r => r.name));
  for (const f of (await fs.readdir(dir)).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const sql = await fs.readFile(path.join(dir, f), 'utf8');
    await tx(async c => {
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
    });
    console.log(`migrated ${f}`);
  }
}
