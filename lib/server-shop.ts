import { mapLink, validPoint, type DeliveryPoint } from './delivery'
import { getRuntimeEnv } from './runtime-env'
import { generateMerchantQris, inspectMerchantQris } from './merchant-qris'
import { categories, defaultProducts, defaultSettings, fulfillmentNames, priceOf, rupiah } from './shop'
import type { Product, Promo, Settings, Quote, Line, Category, QrisProvider } from './shop'

export class ShopError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

export type Shop = { products: Product[]; promos: Promo[]; settings: Settings }
export const defaults: Shop = { products: defaultProducts, promos: [], settings: defaultSettings }
export const clean = (v: unknown, length: number) => typeof v === 'string' ? v.trim().slice(0, length) : ''
export const money = (v: unknown, max = 5_000_000) => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > max) throw new ShopError('Periksa nilai harga atau jumlah.')
  return v
}
export const db = () => {
  const database = getRuntimeEnv().DB
  if (!database) throw new ShopError('Penyimpanan sementara tidak tersedia.', 503)
  return database
}
export async function getShop() {
  const row = await db().prepare("SELECT value, revision FROM shop_config WHERE key = 'store'").first<{value: string; revision: number}>()
  const stored = row ? JSON.parse(row.value) as Shop & { deliverySettingsVersion?: number } : null
  const shop = stored ?? structuredClone(defaults)
  shop.settings = {...defaultSettings, ...shop.settings}
  // Existing warung records predate the launch of home delivery. Later admin choices take precedence.
  if (stored && !stored.deliverySettingsVersion) shop.settings.delivery = true
  return { shop, revision: row?.revision ?? 0 }
}
export async function saveShop(shop: Shop, revision: number) {
  const value = JSON.stringify({...shop, deliverySettingsVersion: 1})
  const sql = revision === 0
    ? db().prepare("INSERT INTO shop_config (key,value,revision) VALUES ('store',?,1) ON CONFLICT(key) DO NOTHING").bind(value)
    : db().prepare("UPDATE shop_config SET value = ?, revision = revision + 1 WHERE key = 'store' AND revision = ?").bind(value, revision)
  const result = await sql.run()
  if (!result.meta.changes) throw new ShopError('Data sudah diperbarui dari tempat lain. Muat ulang panel lalu coba lagi.', 409)
  return revision+1
}
export function readyMethods(settings: Settings) {
  const env = getRuntimeEnv()
  const qrisProvider = settings.qrisProvider
  return {
    whatsapp: /^62[1-9]\d{7,13}$/.test(settings.whatsapp), qrisProvider,
    qris: Boolean(qrisProvider === 'merchant' ? settings.merchantQris : env.MIDTRANS_SERVER_KEY),
    sandbox: qrisProvider === 'midtrans' && env.MIDTRANS_MODE !== 'production',
  }
}
export function publicShop(shop: Shop) {
  const { whatsapp, qrisProvider, merchantQris, ...settings } = shop.settings
  return { products: shop.products, settings, methods: readyMethods(shop.settings), offers: shop.promos.filter(p=>p.active) }
}

export function validateProduct(v: Record<string, unknown>, previousId?: string): Product {
  const name = clean(v.name, 85), category = clean(v.category, 16) as Category
  const price = money(v.price), sale = money(v.sale)
  const image = clean(v.image, 700)
  if (!name || !categories.includes(category) || !price) throw new ShopError('Isi nama, kategori, dan harga menu.')
  if (sale && sale >= price) throw new ShopError('Harga diskon harus di bawah harga normal.')
  if (image && !/^\/(?:food\/[a-z-]+\.webp|api\/media\/[a-f0-9-]{36})$/.test(image) && !/^https:\/\/[^\s]+$/.test(image)) throw new ShopError('Pakai foto unggahan atau tautan HTTPS.')
  return { id: previousId || crypto.randomUUID(), name, category, price, sale, image, description: clean(v.description, 300), available: v.available === true }
}
export function validatePromo(v: Record<string, unknown>): Promo {
  const code = clean(v.code, 24).toUpperCase(), kind = v.kind
  if (!/^[A-Z0-9][A-Z0-9-]{1,23}$/.test(code) || (kind !== 'percent' && kind !== 'fixed')) throw new ShopError('Gunakan kode promo 2–24 huruf, angka, atau tanda hubung.')
  const value = money(v.value, kind === 'percent' ? 100 : 5_000_000)
  if (!value) throw new ShopError('Isi nilai potongan.')
  return { code, kind, value, min: money(v.min), active: v.active === true }
}
export function validateSettings(v: Record<string, unknown>, previous: Settings): Settings {
  const whatsapp = clean(v.whatsapp, 30).replace(/[\s()+-]/g, '').replace(/^0/, '62')
  if (whatsapp && !/^62[1-9]\d{7,13}$/.test(whatsapp)) throw new ShopError('Masukkan nomor WhatsApp Indonesia yang valid, misalnya dengan awalan 08 atau 62.')
  return { qrisProvider: previous.qrisProvider, merchantQris: previous.merchantQris, whatsapp, open: v.open === true, pickup: v.pickup === true, delivery: v.delivery === true, deliveryFee: money(v.deliveryFee), address: clean(v.address, 250), hours: clean(v.hours, 150) }
}

export function validateQrisSettings(v: Record<string, unknown>, previous: Settings): Settings {
  if (v.qrisProvider !== 'midtrans' && v.qrisProvider !== 'merchant') throw new ShopError('Pilih sumber QRIS.')
  const merchantQris = typeof v.merchantQris === 'string' ? v.merchantQris.trim() : ''
  if (merchantQris || v.qrisProvider === 'merchant') {
    try { inspectMerchantQris(merchantQris) }
    catch (error) { throw new ShopError(error instanceof Error ? error.message : 'QRIS statis tidak valid.') }
  }
  return {...previous, qrisProvider:v.qrisProvider, merchantQris}
}

export function quoteOrder(shop: Shop, body: Record<string, unknown>): Quote {
  const { settings } = shop
  const mode = clean(body.mode, 10)
  if ((mode !== 'pickup' && mode !== 'delivery') || !settings[mode]) throw new ShopError('Cara menerima pesanan ini sedang tidak tersedia.')
  const list = body.items
  if (!Array.isArray(list) || !list.length || list.length > 60) throw new ShopError('Tambahkan setidaknya satu menu.')
  const seen = new Set()
  const items: Line[] = list.map(entry => {
    if (!entry || typeof entry !== 'object') throw new ShopError('Periksa isi keranjang.')
    const id = clean(entry.id, 50)
    if (seen.has(id)) throw new ShopError('Periksa isi keranjang.')
    seen.add(id)
    const product = shop.products.find(p => p.id === id && p.available)
    if (!product) throw new ShopError('Ada menu di keranjang yang sudah tidak tersedia. Muat ulang lalu periksa keranjang.')
    const quantity = money(entry.quantity, 25)
    if (!quantity) throw new ShopError('Jumlah menu minimal 1.')
    return { id, name: product.name, price: priceOf(product), quantity }
  })
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const deliveryFee = mode === 'delivery' ? settings.deliveryFee : 0
  const code = clean(body.promo, 24).toUpperCase()
  const promo = shop.promos.find(p => p.code === code && p.active)
  if (code && !promo) throw new ShopError('Kode promo tidak aktif atau tidak ditemukan.')
  if (promo && subtotal < promo.min) throw new ShopError(`Minimal belanja untuk promo ini ${rupiah(promo.min)}.`)
  const discount = !promo ? 0 : Math.min(subtotal, promo.kind === 'fixed' ? promo.value : Math.floor(subtotal * promo.value / 100))
  return { items, subtotal, deliveryFee, discount, total: subtotal + deliveryFee - discount }
}

export type Order = {
  id: string; lookup: string; created: number; method: 'whatsapp' | 'qris'; state: string;
  payment: string; mode: string; total: number; details: string; qr: string | null; payment_reference?: string | null;
}
type Details = Quote & { point?: DeliveryPoint; name: string; phone: string; address: string; notes: string; promo: string; sandbox: boolean; qrisProvider?: QrisProvider; merchantName?: string }
export const findOrder = (id: string) => db().prepare('SELECT * FROM shop_orders WHERE id = ?').bind(id).first<Order>()
export function orderDetails(order: Order) { return JSON.parse(order.details) as Details }
export const isMerchantQris = (order: Order) => order.method === 'qris' && orderDetails(order).qrisProvider === 'merchant'

export async function confirmMerchantPayment(order: Order, suppliedReference: unknown) {
  const reference = clean(suppliedReference, 80).toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9 ._/-]{2,78}[A-Z0-9]$/.test(reference)) {
    throw new ShopError('Masukkan nomor referensi transaksi dari aplikasi merchant.')
  }
  if (!isMerchantQris(order) || order.state === 'canceled' || !['merchant_pending','paid'].includes(order.payment)) {
    throw new ShopError('Pesanan ini tidak menunggu verifikasi QRIS warung.',409)
  }
  const normalized = reference.replace(/[^A-Z0-9]/g,'')
  if (normalized.length < 4) throw new ShopError('Nomor referensi transaksi minimal empat huruf atau angka.')
  if (order.payment === 'paid' && order.payment_reference === normalized) return
  const result = await db().prepare(`
    UPDATE shop_orders SET payment = 'paid', payment_reference = ?
    WHERE id = ? AND payment = 'merchant_pending' AND state <> 'canceled'
    AND NOT EXISTS (SELECT 1 FROM shop_orders WHERE payment_reference = ?)
  `).bind(normalized, order.id, normalized).run()
  if (!result.meta.changes) {
    const latest = await findOrder(order.id)
    if (latest?.payment === 'paid' && latest.payment_reference === normalized) return
    throw new ShopError('Referensi sudah dipakai atau status pesanan sudah berubah.',409)
  }
}

export const signature = async (text: string, algorithm = 'SHA-256') =>
  Array.from(new Uint8Array(await crypto.subtle.digest(algorithm, new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('')

export function presentOrder(order: Order, whatsapp: string) {
  const info = orderDetails(order)
  const qrisProvider = order.method === 'qris' ? info.qrisProvider ?? 'midtrans' : null
  const code = order.id.toUpperCase()
  const mode = order.mode === 'pickup' ? fulfillmentNames.pickup : fulfillmentNames.delivery
  const lines = [`Halo BUR JO’SS, saya mau pesan #${code}.`, '', `Nama: ${info.name}`, `HP: ${info.phone}`, `Pesanan: ${mode}`]
  if (order.mode === 'delivery' && validPoint(info.point)) lines.push('Titik antar: '+mapLink(info.point))
  if (info.address) lines.push(`Alamat: ${info.address}`)
  lines.push('', ...info.items.map(i => `${i.quantity}× ${i.name} — ${rupiah(i.price*i.quantity)}`))
  if (info.discount) lines.push(`Diskon${info.promo ? ' '+info.promo : ''}: -${rupiah(info.discount)}`)
  if (info.deliveryFee) lines.push(`Ongkir: ${rupiah(info.deliveryFee)}`)
  lines.push(`Total: ${rupiah(order.total)}`)
  if (info.notes) lines.push(`Catatan: ${info.notes}`)
  if (order.method === 'qris') lines.push(`Pembayaran: ${info.sandbox ? 'QRIS uji coba' : 'QRIS'}${order.payment === 'paid' ? ' (lunas)' : order.payment === 'failed' ? ' (gagal)' : order.payment === 'expired' ? ' (kedaluwarsa)' : ''}`)
  if (order.payment === 'merchant_pending') lines.push('Mohon cek pembayaran QRIS untuk pesanan ini.')
  return {
    id: order.id, state: order.state, payment: order.payment, method: order.method, total: order.total,
    qr: qrisProvider === 'midtrans' && order.payment === 'pending' ? order.qr : null,
    qrisPayload: qrisProvider === 'merchant' && order.payment === 'merchant_pending' && order.state !== 'canceled' ? order.qr : null,
    qrisProvider, merchantName: info.merchantName ?? null, sandbox: info.sandbox,
    items: info.items,
    whatsapp: whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(lines.join('\n'))}` : null,
  }
}

type Gateway = {status_code?: string; order_id?: string; transaction_id?: string; transaction_status?: string; gross_amount?: string; currency?: string; payment_type?: string; actions?: {name: string;url: string}[]}
const gatewayBase = (sandbox: boolean) => sandbox ? 'https://api.sandbox.midtrans.com' : 'https://api.midtrans.com'
async function gateway(path: string, sandbox: boolean, payload?: object) {
  const env = getRuntimeEnv()
  const key = env.MIDTRANS_SERVER_KEY
  if (!key || sandbox !== (env.MIDTRANS_MODE !== 'production')) return null
  const response = await fetch(gatewayBase(sandbox)+path, {
    method: payload ? 'POST' : 'GET',
    headers: { Authorization: `Basic ${btoa(key+':')}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined, redirect: 'error', signal: AbortSignal.timeout(8000)
  })
  return { data: await response.json() as Gateway, status: response.status }
}
const gatewayStates: Record<string,string> = { pending:'pending', settlement:'paid', expire:'expired', deny:'failed', cancel:'failed', refund:'refunded', chargeback:'refunded' }
async function reconcile(order: Order, result: Gateway) {
  if (result.order_id !== order.id || result.payment_type !== 'qris' || Number(result.gross_amount) !== order.total || (result.currency && result.currency !== 'IDR')) return order
  let next = gatewayStates[result.transaction_status || '']
  if (!next) return order
  if (next === 'pending' && !['creating','pending'].includes(order.payment)) return order
  if (order.payment === 'paid' && next !== 'refunded' || order.payment === 'refunded') return order
  const base = gatewayBase(orderDetails(order).sandbox)
  const url = result.actions?.find(a=>a.name === 'generate-qr-code')?.url
  const qr = url?.startsWith(base+'/v2/qris/') ? url :
    /^[\da-f-]{36}$/i.test(result.transaction_id || '') ? `${base}/v2/qris/${result.transaction_id}/qr-code` : order.qr
  if (next === 'pending' && !qr) next = 'creating'
  await db().prepare('UPDATE shop_orders SET payment = ?, qr = ? WHERE id = ? AND payment = ?').bind(next, qr, order.id, order.payment).run()
  return (await findOrder(order.id)) || order
}
export async function syncPayment(order: Order) {
  if (order.method !== 'qris' || isMerchantQris(order)) return order
  try {
    const result = await gateway(`/v2/${order.id}/status`, orderDetails(order).sandbox)
    if (!result) return order
    if (String(result.data.status_code) === '404' && order.payment === 'creating' && Date.now()-order.created > 90_000) {
      await db().prepare("UPDATE shop_orders SET payment = 'failed' WHERE id = ? AND payment = 'creating'").bind(order.id).run()
      return (await findOrder(order.id)) || order
    }
    return await reconcile(order, result.data)
  } catch { return order }
}
export async function createOrder(shop: Shop, body: Record<string, unknown>) {
  const key = clean(body.key, 50), method = clean(body.method, 10), mode = clean(body.mode, 10)
  if (!/^[0-9a-f-]{36}$/.test(key)) throw new ShopError('Muat ulang checkout dan coba lagi.')
  const lookup = await signature(key)
  const id = 'bj-'+lookup.slice(0, 16)
  const current = await findOrder(id)
  if (current && current.lookup === lookup) return presentOrder(current,shop.settings.whatsapp)
  if (!shop.settings.open) throw new ShopError('Toko sedang tutup.')
  const methods = readyMethods(shop.settings)
  if ((method !== 'whatsapp' && method !== 'qris') || !methods[method]) throw new ShopError('Metode checkout ini belum tersedia.')
  if (method === 'qris' && (
    (body.qrisProvider ?? 'midtrans') !== methods.qrisProvider ||
    (typeof body.qrisSandbox === 'boolean' && body.qrisSandbox !== methods.sandbox)
  )) throw new ShopError('Metode QRIS telah berubah. Muat ulang halaman sebelum melanjutkan.',409)
  const quote = quoteOrder(shop,body)
  if (quote.total !== body.expected) throw new ShopError('Harga berubah. Periksa ulang total pesanan.',409)
  const name = clean(body.name,80), phone = clean(body.phone,25).replace(/[\s()+-]/g,'')
  const address = mode === 'delivery' ? clean(body.address,300) : ''
  let point: DeliveryPoint | undefined
  if (mode === 'delivery' && (body.latitude !== undefined || body.longitude !== undefined)) {
    const lat = body.latitude, lng = body.longitude
    if (typeof lat !== 'string' || !lat.trim() || typeof lng !== 'string' || !lng.trim()) throw new ShopError('Titik antar tidak valid.')
    point = {latitude:Number(lat), longitude:Number(lng)}
    if (!validPoint(point)) throw new ShopError('Titik antar di luar jangkauan koordinat.')
  }
  if (!name || !/^\d{8,16}$/.test(phone) || (mode === 'delivery' && !address && !point)) throw new ShopError('Lengkapi nama, nomor HP, dan alamat pengantaran jika perlu.')
  if (method === 'qris' && quote.total < 1) throw new ShopError('Untuk total Rp0, lanjutkan lewat WhatsApp.')
  const provider = method === 'qris' ? methods.qrisProvider : undefined
  let generated: ReturnType<typeof generateMerchantQris> | undefined
  if (provider === 'merchant') {
    try { generated = generateMerchantQris(shop.settings.merchantQris, quote.total) }
    catch (error) { throw new ShopError(error instanceof Error ? error.message : 'QRIS warung tidak dapat dibuat.') }
  }
  const details: Details = {
    ...quote, name, phone, address, point, notes:clean(body.notes,300), promo:clean(body.promo,24).toUpperCase(),
    sandbox:provider === 'midtrans' && methods.sandbox, qrisProvider:provider, merchantName:generated?.name,
  }
  const payment = generated ? 'merchant_pending' : method === 'qris' ? 'creating' : 'manual'
  const order: Order = {
    id, lookup, created:Date.now(), method, state:'new', payment, mode,
    total:quote.total, details:JSON.stringify(details), qr:generated?.payload ?? null,
  }
  const result = await db().prepare('INSERT INTO shop_orders (id,lookup,created,method,state,payment,mode,total,details,qr) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
    .bind(order.id,order.lookup,order.created,order.method,order.state,order.payment,order.mode,order.total,order.details,order.qr).run()
  if (!result.meta.changes) {
    const existing = await findOrder(id)
    if (!existing || existing.lookup !== lookup) throw new ShopError('Coba ulang checkout.',409)
    return presentOrder(existing,shop.settings.whatsapp)
  }
  if (provider !== 'midtrans') return presentOrder(order,shop.settings.whatsapp)
  try {
    const charge = await gateway('/v2/charge', details.sandbox, {
      payment_type: 'qris', qris: { acquirer: 'gopay' },
      transaction_details: { order_id: id, gross_amount: order.total },
    })
    if (charge && String(charge.data.status_code || charge.status) === '201') {
      return presentOrder(await reconcile(order,charge.data),shop.settings.whatsapp)
    }
    const status = Number(charge?.data.status_code || charge?.status)
    if ([400,401,402,403,404,405,422].includes(status)) {
      await db().prepare("UPDATE shop_orders SET payment = 'failed' WHERE id = ? AND payment = 'creating'").bind(id).run()
      return presentOrder((await findOrder(id)) || order,shop.settings.whatsapp)
    }
  } catch { /* A timeout can still mean the provider created a charge. The status API resolves it. */ }
  return presentOrder(order,shop.settings.whatsapp)
}
