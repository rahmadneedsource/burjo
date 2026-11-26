import { getRuntimeEnv } from '../../../lib/runtime-env'
import { clearSessionCookie, createSessionCookie, isAdminRequest, verifyPassword } from '../../../lib/admin-auth'
import { clean, confirmMerchantPayment, createOrder, db, findOrder, getShop, isMerchantQris, orderDetails, presentOrder, publicShop, quoteOrder, readyMethods, saveShop, ShopError, signature, syncPayment, validateProduct, validatePromo, validateQrisSettings, validateSettings } from '../../../lib/server-shop'
import type { Order } from '../../../lib/server-shop'

export const dynamic = 'force-dynamic'
const json = (data: unknown, status = 200, headers: Record<string,string> = {}) => Response.json(data, {status, headers:{'Cache-Control':'no-store', ...headers}})
const idFormat = /^bj-[a-f0-9]{16}$/
const imageId = /^[a-f0-9-]{36}$/
const waiting = new Set(['pending','creating'])

async function readBody(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ShopError('Format data tidak didukung.',415)
  const limit = 25_000
  const reader = request.body?.getReader()
  if (!reader) throw new ShopError('Isi permintaan kosong.')
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  try {
    while (true) {
      const {done, value} = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new ShopError('Data terlalu besar.',413)
      }
      text += decoder.decode(value, {stream:true})
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  const value = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ShopError('Format data tidak valid.')
  return value as Record<string,unknown>
}

function isAdmin(request: Request) {
  return isAdminRequest(request)
}

// Per-instance sliding window. Enough to blunt checkout and login bursts on one isolate.
const buckets = new Map<string, { count: number; reset: number }>()
function allow(key: string, max: number, windowMs: number) {
  const now = Date.now()
  const entry = buckets.get(key)
  if (!entry || entry.reset <= now) {
    buckets.set(key, { count: 1, reset: now + windowMs })
    return true
  }
  if (entry.count >= max) return false
  entry.count++
  return true
}
function limited(request: Request, scope: string, max: number, windowMs: number) {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0] || request.headers.get('x-real-ip') || 'local'
  if (!allow(ip.trim() + ':' + scope, max, windowMs)) throw new ShopError('Terlalu banyak permintaan. Coba lagi sebentar.', 429)
}

const steps: Record<string,string[]> = {new:['accepted','canceled'],accepted:['preparing','canceled'],preparing:['ready','canceled'],ready:['done','canceled'],done:[],canceled:[]}

async function adminLogin(request: Request) {
  const env = getRuntimeEnv()
  limited(request, 'admin-login', 8, 15 * 60_000)
  if (!env.ADMIN_PASSWORD_HASH) throw new ShopError('Login admin belum disiapkan.', 503)
  const body = await readBody(request)
  const password = typeof body.password === 'string' ? body.password : ''
  if (!password || password.length > 200 || !(await verifyPassword(password, env.ADMIN_PASSWORD_HASH))) {
    throw new ShopError('Kata sandi salah.', 401)
  }
  const cookie = await createSessionCookie()
  if (!cookie) throw new ShopError('Sesi admin belum disiapkan.', 503)
  return json({ ok: true }, 200, { 'Set-Cookie': cookie })
}

async function adminRoute(request: Request, url: URL, path: string[]) {
  const env = getRuntimeEnv()
  const section = path[1], write = request.method === 'POST'
  if (section === 'login' && write) return adminLogin(request)
  if (section === 'logout' && write) return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() })
  const allowed = await isAdmin(request), access = section === 'access'
  if (access && !write) return json({ allowed })
  if (!allowed) throw new ShopError('Masuk dengan kata sandi admin untuk membuka panel.', 403)
  if (section === 'media' && write) {
    if (!env.BUCKET) throw new ShopError('Penyimpanan foto belum tersedia.',503)
    const limits = Number(request.headers.get('content-length') || 0)
    if (limits > 3_160_000) throw new ShopError('Ukuran foto maksimal 3 MB.',413)
    const form = await request.formData()
    const photo = form.get('photo')
    if (!(photo instanceof File) || photo.size > 3_145_728 || photo.size < 12) throw new ShopError('Pilih foto hingga 3 MB.')
    const bytes = new Uint8Array(await photo.arrayBuffer())
    const start = String.fromCharCode(...bytes.slice(0,12))
    const type = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg'
      : start.startsWith('\x89PNG\r\n\x1a\n') ? 'image/png'
      : start.startsWith('RIFF') && start.endsWith('WEBP') ? 'image/webp' : null
    if (!type) throw new ShopError('Pakai foto JPG, PNG, atau WebP.')
    const id = crypto.randomUUID()
    await env.BUCKET.put(id,bytes,{httpMetadata:{contentType:type,cacheControl:'public, max-age=31536000, immutable'}})
    return json({url:'/api/media/'+id})
  }
  const { shop, revision } = await getShop()
  if (!write && section === 'shop') return json({shop,revision,methods:readyMethods(shop.settings)})
  if (!write && section === 'orders') {
    const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER
    const result = await db().prepare('SELECT * FROM shop_orders WHERE created < ? ORDER BY created DESC LIMIT 51').bind(before).all<Order>()
    const entries = result.results.slice(0,50)
    if (url.searchParams.has('sync')) {
      const targets = entries.filter(order=>order.method==='qris' && waiting.has(order.payment)).slice(0,8)
      const updated = await Promise.all(targets.map(syncPayment))
      for (const order of updated) entries[entries.findIndex(entry=>entry.id===order.id)] = order
    }
    return json({orders:entries.map(order=>({
      ...presentOrder(order, shop.settings.whatsapp), created:order.created, mode:order.mode,
      info:orderDetails(order), paymentReference:order.payment_reference ?? null, next:steps[order.state] || [],
    })), next:result.results.length > 50 ? entries.at(-1)?.created : null})
  }
  if (!write) throw new ShopError('Halaman tidak ditemukan.',404)
  const body = await readBody(request)
  if (section === 'orders') {
    const id = clean(body.id,30), state = clean(body.state,20)
    const order = idFormat.test(id) && await findOrder(id)
    if (!order) throw new ShopError('Pesanan tidak ditemukan.',404)
    if (body.confirmMerchantPayment === true) {
      await confirmMerchantPayment(order, body.reference)
      return json({ok:true})
    }
    if (body.sync === true && order.method === 'qris' && !isMerchantQris(order)) {
      const live = await syncPayment(order)
      return json({payment:live.payment})
    }
    if (order.state === state) return json({ok:true})
    if (!steps[order.state]?.includes(state)) throw new ShopError('Status pesanan sudah berubah. Muat ulang daftar.',409)
    if (order.method === 'qris' && order.payment !== 'paid' && state !== 'canceled') throw new ShopError('Pesanan QRIS harus lunas sebelum diproses.')
    if (order.method === 'qris' && state === 'canceled') {
      if (isMerchantQris(order) && order.payment === 'paid') throw new ShopError('Pesanan QRIS warung yang sudah lunas tidak dapat dibatalkan dari panel.')
      if (!isMerchantQris(order) && (order.payment === 'paid' || waiting.has(order.payment))) throw new ShopError('Batalkan atau kembalikan pembayaran melalui Midtrans terlebih dahulu, lalu cek status pembayaran.')
    }
    const changed = await db().prepare('UPDATE shop_orders SET state=? WHERE id=? AND state=? AND payment=?').bind(state,id,order.state,order.payment).run()
    if (!changed.meta.changes) throw new ShopError('Pesanan baru saja berubah. Muat ulang daftar.',409)
    return json({ok:true})
  }
  if (body.revision !== revision) throw new ShopError('Data sudah berubah. Muat ulang panel lalu coba lagi.',409)
  if (section === 'settings') shop.settings = validateSettings(body,shop.settings)
  else if (section === 'qris') shop.settings = validateQrisSettings(body,shop.settings)
  else if (section === 'products') {
    const id = clean(body.id,50), index = shop.products.findIndex(product=>product.id===id)
    if (id && index < 0) throw new ShopError('Menu tidak ditemukan.',404)
    if (body.remove === true && index >= 0) shop.products = shop.products.filter(p=>p.id!==id)
    else {
      if (shop.products.length >= 500 && index < 0) throw new ShopError('Batas 500 menu tercapai.')
      const product = validateProduct(body,id)
      if (index < 0) shop.products = [...shop.products,product]
      else shop.products = shop.products.map(p=>p.id===id ? product : p)
    }
  } else if (section === 'promos') {
    const prior = clean(body.prior,24)
    if (prior && !shop.promos.some(p=>p.code===prior)) throw new ShopError('Kode promo tidak ditemukan.',404)
    if (body.remove === true) shop.promos = shop.promos.filter(p=>p.code!==prior)
    else {
      const promo = validatePromo(body)
      if (shop.promos.some(p=>p.code!==prior && p.code===promo.code)) throw new ShopError('Kode promo itu sudah dipakai.')
      if (!prior && shop.promos.length >= 100) throw new ShopError('Batas 100 promo tercapai.')
      shop.promos = [...shop.promos.filter(p=>p.code!==prior),promo]
    }
  } else throw new ShopError('Halaman tidak ditemukan.',404)
  return json({shop,revision:await saveShop(shop,revision),methods:readyMethods(shop.settings)})
}

async function midtransNotice(request: Request) {
  const key = getRuntimeEnv().MIDTRANS_SERVER_KEY
  if (!key) throw new ShopError('QRIS belum terhubung.',503)
  const body = await readBody(request), id = clean(body.order_id,30)
  if (!idFormat.test(id)) return json({ok:true})
  const expected = await signature(id + clean(body.status_code,5) + clean(body.gross_amount,35) + key,'SHA-512')
  const provided = clean(body.signature_key,128)
  if (provided.length !== expected.length || provided.split('').reduce((v,c,i)=>v | (c.charCodeAt(0)^expected.charCodeAt(i)),0)) throw new ShopError('Tanda tangan tidak valid.',403)
  const order = await findOrder(id)
  if (order && order.method === 'qris' && !isMerchantQris(order)) {
    const verified = await syncPayment(order)
    if (verified.payment !== order.payment || verified.payment === 'paid' || verified.payment === 'refunded' || ['pending','expire','deny','cancel'].includes(clean(body.transaction_status,20))) return json({ok:true})
    throw new ShopError('Status transaksi belum dapat diverifikasi.',503)
  }
  return json({ok:true})
}

async function handle(request: Request) {
  const url = new URL(request.url), path = url.pathname.split('/').slice(2), section = path[0], write = request.method === 'POST'
  try {
    if (section === 'midtrans' && path[1] === 'notification' && write) return await midtransNotice(request)
    if (write && request.headers.get('origin') !== url.origin) throw new ShopError('Permintaan ditolak.',403)
    if (write && section === 'quote') limited(request,'quote',120,60_000)
    if (write && section === 'checkout') limited(request,'checkout',30,60_000)
    if (section === 'admin') return await adminRoute(request,url,path)
    if (section === 'media' && !write && imageId.test(path[1] || '')) {
      const photo = await getRuntimeEnv().BUCKET?.get(path[1])
      if (!photo) throw new ShopError('Foto tidak ditemukan.',404)
      const headers = new Headers({'X-Content-Type-Options':'nosniff'})
      photo.writeHttpMetadata(headers)
      return new Response(photo.body,{headers})
    }
    const {shop} = await getShop()
    if (section === 'catalog' && !write) return json(publicShop(shop))
    if (section === 'quote' && write) return json(quoteOrder(shop,await readBody(request)))
    if (section === 'checkout' && write) return json(await createOrder(shop,await readBody(request)),201)
    if (section === 'receipt' && write) {
      const body = await readBody(request), id = clean(body.id,30), key = clean(body.key,50)
      const order = idFormat.test(id) && await findOrder(id)
      if (!order || order.lookup !== await signature(key)) throw new ShopError('Pesanan tidak ditemukan.',404)
      const live = order.method === 'qris' && waiting.has(order.payment) ? await syncPayment(order) : order
      return json(presentOrder(live,shop.settings.whatsapp))
    }
    throw new ShopError('Halaman tidak ditemukan.',404)
  } catch (error) {
    if (error instanceof ShopError) return json({error:error.message},error.status)
    if (error instanceof SyntaxError) return json({error:'Format data tidak valid.'},400)
    console.error('BUR JOSS API',section,error instanceof Error ? error.message : 'Unexpected error')
    return json({error:'Layanan sedang bermasalah. Coba lagi sebentar.'},500)
  }
}

export const GET = handle
export const POST = handle
