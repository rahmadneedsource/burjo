import menu from './menu.json'

export const categories = ['Nasi', 'Indomie', 'Minuman', 'Topping'] as const
export type Category = typeof categories[number]
export type Product = { id: string; name: string; price: number; sale: number; category: Category; image: string; description: string; available: boolean }
export type Promo = { code: string; kind: 'percent' | 'fixed'; value: number; min: number; active: boolean }
export type QrisProvider = 'midtrans' | 'merchant'
export type Settings = { qrisProvider: QrisProvider; merchantQris: string; whatsapp: string; open: boolean; pickup: boolean; delivery: boolean; deliveryFee: number; address: string; hours: string }
export const defaultSettings: Settings = { qrisProvider: 'midtrans', merchantQris: '', whatsapp: '', open: true, pickup: true, delivery: true, deliveryFee: 0, address: '', hours: '' }
export const defaultProducts: Product[] = menu.map(([name, price, category, image, description], index) => ({
  id: `menu-${index+1}`, name: String(name), price: Number(price), sale: 0, category: category as Category,
  image: image ? `/food/${image}.webp` : '', description: String(description || ''), available: true
}))
export type Line = {id: string; name: string; quantity: number; price: number}
export type Quote = {items: Line[]; subtotal: number; deliveryFee: number; discount: number; total: number}
export const rupiah = (n: number) => `Rp${n.toLocaleString('id-ID')}`
export const priceOf = (p: Product) => p.sale || p.price
export const fulfillmentNames = { pickup: 'Ambil sendiri', delivery: 'Antar ke rumah' }
export const orderStates = { new: 'Baru', accepted: 'Diterima', preparing: 'Disiapkan', ready: 'Siap / diantar', done: 'Selesai', canceled: 'Dibatalkan' }
export const paymentStates = { creating: 'Menyiapkan QRIS', pending: 'Menunggu pembayaran', merchant_pending: 'Menunggu verifikasi QRIS', paid: 'Lunas', failed: 'Pembayaran gagal', expired: 'Kedaluwarsa', refunded: 'Dikembalikan', manual: 'Konfirmasi di WhatsApp' }
export type Methods = { whatsapp: boolean; qris: boolean; sandbox: boolean; qrisProvider: QrisProvider }
export type Receipt = { id:string; state:keyof typeof orderStates; payment:keyof typeof paymentStates; method:'whatsapp'|'qris'; total:number; qr:string|null; qrisProvider:QrisProvider|null; qrisPayload:string|null; merchantName:string|null; sandbox:boolean; whatsapp:string|null; items:{id:string;name:string;price:number;quantity:number}[] }
export type Catalog = { products: Product[]; settings: Omit<Settings,'whatsapp'|'qrisProvider'|'merchantQris'>; offers: Promo[]; methods: Methods }
