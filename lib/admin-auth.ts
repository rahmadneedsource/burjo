import { getRuntimeEnv } from './runtime-env'

// PBKDF2-SHA-256 password hashes, issued as `pbkdf2$sha256$<rounds>$<salt>$<hash>`.
const ROUNDS = 210_000
const COOKIE = 'burjoss_admin'
const TTL_MS = 7 * 24 * 60 * 60 * 1000
const encoder = new TextEncoder()

const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const decode = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0))

function equal(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index++) diff |= left[index] ^ right[index]
  return diff === 0
}

async function derive(password: string, salt: Uint8Array, rounds: number) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations: rounds }, key, 256))
}

export async function hashPassword(password: string, rounds = ROUNDS) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(password, salt, rounds)
  return `pbkdf2$sha256$${rounds}$${encode(salt)}$${encode(hash)}`
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, digest, roundsText, salt, hash] = stored.trim().split('$')
  if (scheme !== 'pbkdf2' || digest !== 'sha256' || !salt || !hash) return false
  const rounds = Number(roundsText)
  if (!Number.isSafeInteger(rounds) || rounds < 1000 || rounds > 4_000_000) return false
  try {
    return equal(await derive(password, decode(salt), rounds), decode(hash))
  } catch {
    return false
  }
}

function secret() {
  const env = getRuntimeEnv()
  const configured = env.ADMIN_SESSION_SECRET?.trim()
  if (configured) return configured
  // Rotating the password invalidates every session when no separate secret is set.
  return env.ADMIN_PASSWORD_HASH ? 'password:' + env.ADMIN_PASSWORD_HASH : ''
}

async function sign(value: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
}

const attributes = () => `Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`

export async function createSessionCookie() {
  if (!secret()) return null
  const payload = `v1.${Date.now() + TTL_MS}`
  return `${COOKIE}=${payload}.${encode(await sign(payload))}; ${attributes()}; Max-Age=${TTL_MS / 1000}`
}

export const clearSessionCookie = () => `${COOKIE}=; ${attributes()}; Max-Age=0`

export async function hasSession(cookie: string | null) {
  if (!secret() || !cookie) return false
  const raw = cookie.split(';').map(part => part.trim()).find(part => part.startsWith(COOKIE + '='))
  if (!raw) return false
  const [version, expiresText, signature] = raw.slice(COOKIE.length + 1).split('.')
  if (version !== 'v1' || !expiresText || !signature) return false
  const expires = Number(expiresText)
  if (!Number.isSafeInteger(expires) || expires < Date.now()) return false
  try {
    return equal(await sign(`${version}.${expiresText}`), decode(signature))
  } catch {
    return false
  }
}

export async function isAdminRequest(request: Request) {
  const env = getRuntimeEnv()
  if (process.env.NODE_ENV !== 'production' && env.LOCAL_ADMIN === 'yes' && ['terminal.local', '127.0.0.1', 'localhost'].includes(new URL(request.url).hostname)) return true
  return hasSession(request.headers.get('cookie'))
}

export const SESSION_COOKIE = COOKIE
