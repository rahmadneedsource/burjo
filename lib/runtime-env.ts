import { createClient, type Client, type InValue } from '@libsql/client/web'

export type SqlStatement = {
  bind: (...args: unknown[]) => SqlStatement
  first: <T = Record<string, unknown>>(column?: string) => Promise<T | null>
  run: () => Promise<{ meta: { changes: number } }>
  all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>
}

export type SqlDatabase = {
  prepare: (sql: string) => SqlStatement
}

export type MediaBucket = {
  put: (key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }) => Promise<void>
  get: (key: string) => Promise<{ body: BodyInit; writeHttpMetadata: (headers: Headers) => void } | null>
}

export type RuntimeEnv = {
  DB?: SqlDatabase
  BUCKET?: MediaBucket
  LOCAL_ADMIN?: string
  ADMIN_PASSWORD_HASH?: string
  ADMIN_SESSION_SECRET?: string
  MIDTRANS_SERVER_KEY?: string
  MIDTRANS_MODE?: string
}

let cachedClient: Client | null = null
let schemaReady: Promise<void> | null = null

function getLibsqlClient(): Client | null {
  const url = process.env.TURSO_DATABASE_URL?.trim()
  if (!url) return null
  if (!cachedClient) {
    cachedClient = createClient({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
    })
  }
  return cachedClient
}

async function ensureSchema(client: Client) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await client.execute(`CREATE TABLE IF NOT EXISTS shop_config (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        revision INTEGER DEFAULT 1 NOT NULL
      )`)
      await client.execute(`CREATE TABLE IF NOT EXISTS shop_orders (
        id TEXT PRIMARY KEY NOT NULL,
        lookup TEXT NOT NULL,
        created INTEGER NOT NULL,
        method TEXT NOT NULL,
        state TEXT NOT NULL,
        payment TEXT NOT NULL,
        mode TEXT NOT NULL,
        total INTEGER NOT NULL,
        details TEXT NOT NULL,
        qr TEXT,
        payment_reference TEXT
      )`)
      await client.execute('CREATE INDEX IF NOT EXISTS shop_orders_created_idx ON shop_orders (created)')
      await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS shop_orders_payment_reference_idx ON shop_orders (payment_reference)')
      await client.execute(`CREATE TABLE IF NOT EXISTS shop_media (
        id TEXT PRIMARY KEY NOT NULL,
        content_type TEXT NOT NULL,
        data BLOB NOT NULL
      )`)
    })().catch(error => {
      schemaReady = null
      throw error
    })
  }
  await schemaReady
}

function createLibsqlDatabase(client: Client): SqlDatabase {
  const makeStatement = (sql: string, args: unknown[] = []): SqlStatement => ({
    bind: (...nextArgs: unknown[]) => makeStatement(sql, nextArgs),
    first: async <T = Record<string, unknown>>(column?: string): Promise<T | null> => {
      await ensureSchema(client)
      const res = await client.execute({ sql, args: args as InValue[] })
      const row = res.rows[0] as Record<string, unknown> | undefined
      if (!row) return null
      if (column) return ((row[column] ?? null) as T | null)
      return row as T
    },
    run: async () => {
      await ensureSchema(client)
      const res = await client.execute({ sql, args: args as InValue[] })
      return { meta: { changes: res.rowsAffected } }
    },
    all: async <T = Record<string, unknown>>() => {
      await ensureSchema(client)
      const res = await client.execute({ sql, args: args as InValue[] })
      return { results: res.rows as T[] }
    },
  })

  return {
    prepare: (sql: string) => makeStatement(sql),
  }
}

function createTursoBucket(database: SqlDatabase): MediaBucket {
  return {
    put: async (key, value, options) => {
      const contentType = options?.httpMetadata?.contentType || 'application/octet-stream'
      await database
        .prepare('INSERT INTO shop_media (id, content_type, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET content_type = excluded.content_type, data = excluded.data')
        .bind(key, contentType, value)
        .run()
    },
    get: async (key) => {
      const row = await database
        .prepare('SELECT content_type, data FROM shop_media WHERE id = ?')
        .bind(key)
        .first<{ content_type: string; data: ArrayBuffer | Uint8Array }>()
      if (!row) return null
      const bytes = row.data instanceof Uint8Array ? row.data : new Uint8Array(row.data)
      return {
        body: new Blob([bytes as BlobPart], { type: row.content_type }),
        writeHttpMetadata: (headers: Headers) => {
          headers.set('Content-Type', row.content_type)
          headers.set('Cache-Control', 'public, max-age=31536000, immutable')
        },
      }
    },
  }
}

export function getRuntimeEnv(): RuntimeEnv {
  const testEnv = (globalThis as { qrisTestEnv?: RuntimeEnv }).qrisTestEnv
  if (testEnv) return testEnv

  const client = getLibsqlClient()
  const database = client ? createLibsqlDatabase(client) : undefined
  return {
    DB: database,
    BUCKET: database ? createTursoBucket(database) : undefined,
    LOCAL_ADMIN: process.env.LOCAL_ADMIN,
    ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
    ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET,
    MIDTRANS_SERVER_KEY: process.env.MIDTRANS_SERVER_KEY,
    MIDTRANS_MODE: process.env.MIDTRANS_MODE,
  }
}
