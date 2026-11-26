'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Check, CheckCircle2, ChevronDown, CircleHelp, Clock3, CookingPot, CupSoda, MapPin, MessageCircle, Minus, Plus, QrCode, Search, ShoppingBag, Soup, Tag, Utensils, X } from 'lucide-react'
import { categories, defaultProducts, defaultSettings, fulfillmentNames, orderStates, paymentStates, priceOf, rupiah } from '../lib/shop'
import type { Catalog, Product, Quote, Receipt } from '../lib/shop'
import { errorText, request } from '../lib/http'
import deliveryStyles from './delivery-fields.module.css'
import layout from './market.module.css'
import DeliveryFields from './delivery-fields'
import MerchantQr from './merchant-qr'

const filterNames = ['Semua Menu',...categories] as const
const icons = { 'Semua Menu':Utensils, Nasi:CookingPot, Indomie:Soup, Minuman:CupSoda, Topping:Plus }
const fallback: Catalog = {products:defaultProducts,settings:defaultSettings,offers:[],methods:{whatsapp:false,qris:false,sandbox:true,qrisProvider:'midtrans'}}
const pageSize = 12
type Mode = keyof typeof fulfillmentNames
type Cart = Record<string,number>
type Ticket = {id:string;key:string}
const storage = {
  get<T>(key:string):T|undefined { try { return JSON.parse(localStorage.getItem(key) || 'null') || undefined } catch { return undefined } },
  set(key:string,data:object) { try { localStorage.setItem(key,JSON.stringify(data)) } catch { /* Storage may be disabled. */ } },
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return <a className="brand" href="/" aria-label="BUR JO’SS beranda"><span className="brand-mark" aria-hidden="true"><Soup size={22} strokeWidth={1.8} /></span><span><strong>BUR JO’SS</strong>{!compact && <small>WARUNG MAKAN</small>}</span></a>
}
export function Modal({ children, onClose, title, className = '' }: {children:ReactNode;onClose:()=>void;title:string;className?:string}) {
  const el = useRef<HTMLDialogElement>(null)
  useEffect(()=>{
    const dialog = el.current
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog?.showModal()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return ()=>{
      dialog?.close()
      document.body.style.overflow = prev
      opener?.focus()
    }
  },[])
  return <dialog className={'dialog '+className} ref={el} aria-label={title} onCancel={event=>{event.preventDefault();onClose()}} onClick={event=>{if(event.target===el.current)onClose()}}><div className="dialog-inner"><header className="dialog-head"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Tutup" onClick={onClose}><X size={21} aria-hidden="true"/></button></header>{children}</div></dialog>
}
export function ProductPhoto({product}: {product:Product}) {
  const [failed,setFailed] = useState('')
  const Icon = icons[product.category] || Utensils
  return product.image && failed !== product.image
    ? <img src={product.image} width={400} height={260} alt={product.name} loading="lazy" onError={()=>setFailed(product.image)} referrerPolicy="no-referrer"/>
    : <div className={'fallback-photo '+product.category.toLowerCase()} aria-hidden="true"><Icon size={38} strokeWidth={1.3}/></div>
}
function Quantity({ name, value, change }: {name:string;value:number;change:(n:number)=>void}) {
  return <div className="quantity"><button type="button" aria-label={'Kurangi '+name} onClick={()=>change(-1)}><Minus size={16} aria-hidden="true"/></button><span>{value}</span><button type="button" aria-label={'Tambah '+name} disabled={value>=25} onClick={()=>change(1)}><Plus size={16} aria-hidden="true"/></button></div>
}
function Card({ product, quantity, change, open, showCategory }: {product:Product;quantity:number;change:(n:number)=>void;open:boolean;showCategory:boolean}) {
  return <article className="product"><div className="product-photo"><ProductPhoto product={product}/>{!product.available && <span className="photo-pill">Habis</span>}{product.available && product.sale > 0 && <span className="photo-pill sale">Hemat {Math.round(100*(product.price-product.sale)/product.price)}%</span>}</div><div className="product-content">{showCategory && <span className="product-category">{product.category}</span>}<h3>{product.name}</h3>{product.description && <p>{product.description}</p>}<div className="product-bottom"><div className="product-price">{product.sale>0 && <del>{rupiah(product.price)}</del>}<strong>{rupiah(priceOf(product))}</strong></div>{product.available && open && (quantity > 0 ? <Quantity name={product.name} value={quantity} change={change}/> : <button type="button" className="add-button" aria-label={'Tambah '+product.name} onClick={()=>change(1)}><Plus size={20} aria-hidden="true"/></button>)}</div></div></article>
}
function MenuRow({ product, quantity, change, open, showCategory }: {product:Product;quantity:number;change:(n:number)=>void;open:boolean;showCategory:boolean}) {
  return <article className="menu-row"><div className="menu-row-info"><div className="menu-row-top"><h3>{product.name}</h3>{showCategory && <span className="menu-row-tag">{product.category}</span>}{!product.available && <span className="menu-row-tag out">Habis</span>}{product.available && product.sale > 0 && <span className="menu-row-tag sale">Hemat {Math.round(100*(product.price-product.sale)/product.price)}%</span>}</div>{product.description && <p>{product.description}</p>}</div><div className="menu-row-right"><div className="product-price">{product.sale>0 && <del>{rupiah(product.price)}</del>}<strong>{rupiah(priceOf(product))}</strong></div>{product.available && open && (quantity > 0 ? <Quantity name={product.name} value={quantity} change={change}/> : <button type="button" className="add-button" aria-label={'Tambah '+product.name} onClick={()=>change(1)}><Plus size={20} aria-hidden="true"/></button>)}</div></article>
}

export default function Store() {
  const [catalog,setCatalog] = useState<Catalog>(fallback)
  const [catalogLoading,setCatalogLoading] = useState(true)
  const [catalogError,setCatalogError] = useState('')
  const [cart,setCart] = useState<Cart>({})
  const [initialized,setInitialized] = useState(false)
  const [category,setCategory] = useState<typeof filterNames[number]>('Semua Menu')
  const [search,setSearch] = useState('')
  const [visible,setVisible] = useState(pageSize)
  const [panel,setPanel] = useState<'cart'|'checkout'|'receipt'|'offers'|null>(null)
  const [section,setSection] = useState<'beranda'|'menu'>('beranda')
  const [ticket,setTicket] = useState<Ticket|null>(null)
  const [receipt,setReceipt] = useState<Receipt|null>(null)
  const [receiptError,setReceiptError] = useState('')
  const [selectedPromo,setSelectedPromo] = useState('')
  const [toast,setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout>|undefined>(undefined)

  useEffect(()=>{
    const saved = storage.get<Cart>('burjoss-cart') || {}
    setCart(Object.fromEntries(Object.entries(saved).filter(([id,count])=>/^[\w-]{1,50}$/.test(id)&&Number.isInteger(count)&&count>0&&count<=25)))
    setTicket(storage.get<Ticket>('burjoss-ticket') || null)
    setInitialized(true)
    request<Catalog>('catalog')
      .then(setCatalog)
      .catch(()=>setCatalogError('Gagal memuat harga terbaru. Muat ulang sebelum memesan.'))
      .finally(()=>setCatalogLoading(false))
    return ()=>clearTimeout(toastTimer.current)
  },[])
  useEffect(()=>{if(initialized)storage.set('burjoss-cart',cart)},[cart,initialized])

  function change(product:Product,delta:number) {
    setCart(old=>{
      const next = {...old}, count = Math.max(0,Math.min(25,(next[product.id] || 0)+delta))
      if(count) next[product.id] = count
      else delete next[product.id]
      return next
    })
    if(delta === 1 && !panel) {
      setToast(product.name+' ditambahkan')
      clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(()=>setToast(''),1800)
    }
  }

  const products = catalog.products
  const query = search.trim().toLocaleLowerCase('id')
  const results = [...products].sort((a,b)=>Number(!!b.image)-Number(!!a.image)).filter(p=>(category==='Semua Menu'||p.category===category)&&(!query||[p.name,p.description,p.category].some(field=>field.toLocaleLowerCase('id').includes(query))))
  const shown = results.slice(0,visible)
  const featured = shown.filter(p=>Boolean(p.image))
  const board = shown.filter(p=>!p.image)
  const showCategoryTag = category==='Semua Menu'
  const cartRows = useMemo(()=>products.filter(p=>cart[p.id]).map(product=>({product,quantity:cart[product.id]})),[products,cart])
  const count = cartRows.reduce((sum,p)=>sum+p.quantity,0)
  const subtotal = cartRows.reduce((sum,row)=>sum+priceOf(row.product)*row.quantity,0)
  const units = useMemo(()=>cartRows.map(row=>({id:row.product.id,quantity:row.quantity})),[cartRows])
  const open = catalog.settings.open
  const canCheckout = open && count > 0 && !catalogError && cartRows.every(row=>row.product.available)
  const emptyModes = !catalog.settings.pickup && !catalog.settings.delivery

  useEffect(()=>{
    if (panel!=='receipt' || !ticket) return
    let canceled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      try {
        const data = await request<Receipt>('receipt',ticket)
        if(canceled)return
        setReceipt(data);setReceiptError('')
        if(!['done','canceled'].includes(data.state))timer=setTimeout(refresh,data.method==='qris'&&['creating','pending','merchant_pending'].includes(data.payment)?6500:16000)
      } catch(error) { if(!canceled){setReceiptError(errorText(error));timer=setTimeout(refresh,14000)} }
    }
    void refresh()
    return ()=>{canceled=true;clearTimeout(timer)}
  },[panel,ticket])

  function finish(result:Receipt,key:string) {
    const next = {id:result.id,key}
    setTicket(next);storage.set('burjoss-ticket',next)
    setReceipt(result);setReceiptError('');setCart({});setSelectedPromo('');setPanel('receipt')
  }

  function repeat(items: Receipt['items']) {
    const next: Cart = {}
    for (const item of items) {
      const product = catalog.products.find(p=>p.id===item.id)
      if (product?.available) next[item.id] = Math.min(25, item.quantity)
    }
    if (!Object.keys(next).length) { setToast('Menu pesanan ini sudah tidak tersedia'); return }
    setCart(next);setSelectedPromo('');setPanel('cart')
  }

  return <>
    <div className={layout.market} id="beranda">
      <aside className={layout.side}><Brand/><nav aria-label="Navigasi warung">
        <a href="#beranda" data-active={!panel && section==='beranda'} onClick={()=>setSection('beranda')}><Soup aria-hidden="true"/> Beranda</a>
        <a href="#menu" data-active={!panel && section==='menu'} onClick={()=>setSection('menu')}><Utensils aria-hidden="true"/> Daftar menu</a>
        <button type="button" data-active={panel==='offers'} onClick={()=>setPanel('offers')}><Tag aria-hidden="true"/> Promo</button>
        <button type="button" data-active={panel==='cart'||panel==='checkout'} onClick={()=>setPanel('cart')}><ShoppingBag aria-hidden="true"/> Keranjang {count>0&&`(${count})`}</button>
        {ticket&&<button type="button" data-active={panel==='receipt'} onClick={()=>setPanel('receipt')}><Clock3 aria-hidden="true"/> Pesanan saya</button>}
      </nav><a className={layout.admin} href="/admin">Panel admin</a></aside>
      <div className={layout.workspace}><header className={layout.toolbar}><span className={layout.mobileBrand}><Brand/></span><span className={layout.place}><MapPin size={16} aria-hidden="true"/> Gondang Raya</span><div className="search" role="search"><Search size={19} aria-hidden="true"/><input type="search" value={search} placeholder="Cari menu..." aria-label="Cari menu" onChange={e=>{setSearch(e.target.value);setVisible(pageSize)}}/>{search&&<button type="button" aria-label="Hapus pencarian" onClick={()=>{setSearch('');setVisible(pageSize)}}><X size={16} aria-hidden="true"/></button>}</div><button type="button" className={layout.bag} aria-label={`Keranjang, ${count} item`} onClick={()=>setPanel('cart')}><ShoppingBag size={20} aria-hidden="true"/><b>{count}</b></button></header>
      <main className={layout.content}>
      <section className={layout.banner} aria-labelledby="hero-title"><div className={layout.copy}>
        <span className={layout.open}><Clock3 size={15} aria-hidden="true"/>{open?'Warung buka':'Warung tutup'}{catalog.settings.hours&&' · '+catalog.settings.hours}</span>
        <h1 id="hero-title">Nasi hangat &amp; Indomie,<br/><em>langsung dari wajan.</em></h1>
        <p>Pesan antar atau ambil sendiri di warung Gondang Raya, tanpa antre.</p>
        <a href="#menu">Lihat daftar menu</a></div>
        <figure className={layout.dishFrame}><img className={layout.dish} src="/food/nasi-goreng-spesial.webp" width={560} height={420} alt="Nasi goreng spesial dengan telur dan sosis" fetchPriority="high"/></figure>
      </section>
      <section id="menu" className="menu-section" aria-labelledby="menu-title">
        <h2 id="menu-title">Kategori</h2>
        <div className={layout.categories} aria-label="Kategori menu">{filterNames.map(name=>{const Icon=icons[name];return <button type="button" key={name} aria-pressed={category===name} onClick={()=>{setCategory(name);setVisible(pageSize)}}><span aria-hidden="true"><Icon size={18} strokeWidth={1.8}/></span><strong>{name}</strong><small>{name==='Semua Menu'?products.length:products.filter(p=>p.category===name).length}</small></button>})}</div>
        {catalogLoading && <p role="status" className="notice">Memuat harga dan status warung terbaru…</p>}
        {catalogError && <p role="status" className="notice warning">{catalogError}</p>}
        <div className="grid-title"><h3>{category==='Semua Menu' ? (query?'Hasil Pencarian':'Semua Menu') : category}</h3><span>{results.length} menu</span></div>
        {results.length ? <>
          {featured.length > 0 && <div className="product-grid">{featured.map(product=><Card key={product.id} product={product} quantity={cart[product.id] || 0} open={open} showCategory={showCategoryTag} change={n=>change(product,n)}/>)}</div>}
          {board.length > 0 && <div className="board-wrap">
            {featured.length > 0 && <div className="board-head"><h4>Daftar Menu Warung</h4><span>{board.length} ditampilkan</span></div>}
            <div className="menu-board">{board.map(product=><MenuRow key={product.id} product={product} quantity={cart[product.id] || 0} open={open} showCategory={showCategoryTag} change={n=>change(product,n)}/>)}</div>
          </div>}
        </> : <div className="empty"><Search aria-hidden="true"/><h3>Menu tidak ditemukan</h3><p>Coba kata kunci atau kategori lain.</p><button type="button" className="button outline" onClick={()=>{setSearch('');setCategory('Semua Menu')}}>Lihat semua menu</button></div>}
        {results.length>visible && <div className="more"><button type="button" className="button outline" onClick={()=>setVisible(v=>v+pageSize)}>Lihat menu lainnya <ChevronDown size={18} aria-hidden="true"/></button></div>}
      </section>
    </main>
    <footer className="footer"><div className="shell footer-inner"><Brand compact/><span>© BUR JO’SS</span><a href="/admin">Panel admin</a></div></footer></div>
    <nav className={layout.mobileNav} aria-label="Navigasi seluler"><a href="#beranda"><Soup aria-hidden="true"/>Beranda</a><a href="#menu"><Utensils aria-hidden="true"/>Menu</a><button type="button" onClick={()=>setPanel('offers')}><Tag aria-hidden="true"/>Promo</button>{ticket&&<button type="button" onClick={()=>setPanel('receipt')}><Clock3 aria-hidden="true"/>Pesanan</button>}</nav></div>
    {count>0 && !panel && <button type="button" className="phone-cart" onClick={()=>setPanel('cart')}><ShoppingBag size={20} aria-hidden="true"/><span>Lihat keranjang <small>· {count} item</small></span><strong>{rupiah(subtotal)}</strong></button>}
    {!!toast && <div className="toast" role="status"><CheckCircle2 size={19} aria-hidden="true"/>{toast}</div>}
    {panel==='cart' && <Modal title="Keranjang" onClose={()=>setPanel(null)} className="drawer">
      {cartRows.length ? <><div className="cart-list">{cartRows.map(({product,quantity})=><div className="cart-row" key={product.id}><div className="cart-thumb"><ProductPhoto product={product}/></div><div><strong>{product.name}</strong><small>{product.available?rupiah(priceOf(product)*quantity):'Menu sudah habis'}</small></div><Quantity name={product.name} value={quantity} change={n=>change(product,n)}/></div>)}</div><div className="cart-footer"><div><span>Subtotal</span><strong>{rupiah(subtotal)}</strong></div>{!open && <p className="notice warning">Warung sedang tutup.</p>}{emptyModes && <p className="notice warning">Pengambilan dan pengantaran belum tersedia.</p>}<button type="button" className="button dark wide" disabled={!canCheckout||emptyModes} onClick={()=>setPanel('checkout')}>Lanjut ke Checkout</button></div></> : <div className="empty"><ShoppingBag size={35} aria-hidden="true"/><h3>Keranjang masih kosong</h3><p>Tambahkan menu favoritmu dulu.</p><button type="button" className="button dark" onClick={()=>setPanel(null)}>Pilih menu</button></div>}
    </Modal>}
    {panel==='checkout' && <Checkout catalog={catalog} rows={cartRows} units={units} defaultPromo={selectedPromo} close={()=>setPanel('cart')} finish={finish}/>}
    {panel==='receipt' && <Modal title="Status Pesanan" onClose={()=>setPanel(null)}>
      {receiptError && <p className="notice warning" role="alert">{receiptError}</p>}
      {receipt ? <div className="receipt"><div className="receipt-mark" aria-hidden="true">{receipt.payment==='paid'?<Check size={27}/>:receipt.method==='qris'?<QrCode size={27}/>:<MessageCircle size={27}/>}</div><h3>{paymentStates[receipt.payment]}</h3><p>#{receipt.id.toUpperCase()} · {orderStates[receipt.state]}</p><strong className="receipt-total">{rupiah(receipt.total)}</strong>
      {receipt.sandbox && <p className="notice warning">QRIS mode uji coba. Gunakan simulator Midtrans.</p>}
      {receipt.qr && <><img className="payment-qr" src={receipt.qr} width={240} height={240} alt="Kode QRIS untuk pesanan ini" referrerPolicy="no-referrer"/><p>Pindai dengan aplikasi bank atau dompet digital. Status diperbarui otomatis.</p></>}
      {receipt.items.length>0 && <ul className="receipt-items">{receipt.items.map(i=><li key={i.id}><span>{i.quantity}× {i.name}</span><span>{rupiah(i.price*i.quantity)}</span></li>)}</ul>}
      {receipt.qrisPayload && <MerchantQr key={receipt.id} payload={receipt.qrisPayload} orderId={receipt.id} merchantName={receipt.merchantName}/>}
      {receipt.payment==='merchant_pending' && receipt.state==='canceled' && <p>Pesanan ini sudah dibatalkan. Hubungi warung jika pembayaran sudah dikirim.</p>}
      {receipt.payment==='manual' && <p>Buka WhatsApp lalu kirim rincian yang sudah disiapkan untuk konfirmasi ke warung.</p>}
      {receipt.whatsapp && (receipt.method==='whatsapp'||['paid','failed','expired','merchant_pending'].includes(receipt.payment)) && <a className="button dark wide" href={receipt.whatsapp} target="_blank" rel="noreferrer"><MessageCircle size={18} aria-hidden="true"/> {receipt.method==='whatsapp'?'Buka WhatsApp':receipt.payment==='merchant_pending'&&receipt.state!=='canceled'?'Konfirmasi via WhatsApp':'Hubungi Warung'}</a>}
      {['done','canceled'].includes(receipt.state) && <button type="button" className="button outline wide" onClick={()=>repeat(receipt.items)}>Pesan lagi</button>}</div> : <p className="muted">Memuat pesanan…</p>}
    </Modal>}
    {panel==='offers' && <Modal title="Promo" onClose={()=>setPanel(null)}>{catalog.offers.length?<div className="offer-list">{catalog.offers.map(p=><div className="offer" key={p.code}><Tag size={22} aria-hidden="true"/><div><strong>{p.code}</strong><small>Potongan {p.kind==='fixed'?rupiah(p.value):p.value+'%'}{p.min>0?' · Min. '+rupiah(p.min):''}</small></div><button type="button" className="button outline" onClick={()=>{setSelectedPromo(p.code);setPanel('cart')}}>Pakai</button></div>)}</div>:<div className="empty"><Tag size={35} aria-hidden="true"/><h3>Belum ada promo aktif</h3><button type="button" className="button outline" onClick={()=>setPanel(null)}>Kembali ke menu</button></div>}</Modal>}
  </>
}

function Checkout({catalog,rows,units,defaultPromo,close,finish}: {catalog:Catalog;rows:{product:Product;quantity:number}[];units:{id:string;quantity:number}[];defaultPromo:string;close:()=>void;finish:(receipt:Receipt,key:string)=>void}) {
  const [mode,setMode] = useState<Mode>(catalog.settings.pickup?'pickup':'delivery')
  const [method,setMethod] = useState<'whatsapp'|'qris'>(catalog.methods.whatsapp?'whatsapp':'qris')
  const [promo,setPromo] = useState(defaultPromo)
  const [applied,setApplied] = useState(defaultPromo)
  const [quote,setQuote] = useState<Quote|null>(null)
  const [quoteErr,setQuoteErr] = useState('')
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  const [reprice,incReprice] = useState(0)
  const [deliveryMounted,setDeliveryMounted] = useState(mode==='delivery')
  const key = useRef('')
  const requestLocked = useRef(false)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const count = rows.reduce((sum,row)=>sum+row.quantity,0)
  const promoInvalid = Boolean(applied && quoteErr && /promo/i.test(quoteErr))

  // A fresh idempotency key once the basket changes, so a stale key cannot return an old order.
  useEffect(()=>{key.current = crypto.randomUUID()},[units])
  useEffect(()=>{if(error)errorRef.current?.focus()},[error])

  useEffect(()=>{
    if(!units.length)return
    const ctrl = new AbortController()
    const timer = setTimeout(()=>{
      setQuote(null);setQuoteErr('')
      request<Quote>('quote',{mode,promo:applied,items:units},ctrl.signal)
        .then(value=>{if(!ctrl.signal.aborted)setQuote(value)})
        .catch(err=>{if(!ctrl.signal.aborted)setQuoteErr(errorText(err))})
    },140)
    return()=>{clearTimeout(timer);ctrl.abort()}
  },[mode,applied,reprice,units])

  function usePromo() {
    const next = promo.trim().toUpperCase()
    setQuoteErr('')
    if(!next) { setApplied('');setPromo('');return }
    if(next===applied) incReprice(n=>n+1)
    else { setPromo(next);setApplied(next) }
  }

  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if(!catalog.methods[method]||!quote||requestLocked.current||promoInvalid)return
    const fields = Object.fromEntries(new FormData(e.currentTarget))
    const orderKey = key.current || (key.current = crypto.randomUUID())
    requestLocked.current=true;setBusy(true);setError('')
    try {
      const result = await request<Receipt>('checkout',{...fields,key:orderKey,mode,method,qrisProvider:catalog.methods.qrisProvider,qrisSandbox:catalog.methods.sandbox,promo:applied,items:units,expected:quote.total})
      if(result.method==='whatsapp' && result.whatsapp) window.location.assign(result.whatsapp)
      finish(result,orderKey)
    } catch(err) {
      const message=errorText(err)
      setError(message)
      if(message.startsWith('Harga berubah'))incReprice(n=>n+1)
    } finally { requestLocked.current=false;setBusy(false) }
  }

  return <Modal title="Checkout" onClose={()=>{if(!busy)close()}} className="drawer"><form className="checkout-form" onSubmit={submit}>
    <fieldset disabled={busy}><legend>Pesananmu · {count} item</legend><ul className="checkout-lines">{rows.map(({product,quantity})=><li key={product.id}><span>{quantity}× {product.name}</span><strong>{rupiah(priceOf(product)*quantity)}</strong></li>)}</ul><button type="button" className="checkout-back" onClick={close}>Ubah keranjang</button></fieldset>
    <fieldset disabled={busy}><legend>Cara menerima pesanan</legend><div className={deliveryStyles.modes}>{(['pickup','delivery'] as const).filter(m=>catalog.settings[m]).map(m=><label className={deliveryStyles.mode} key={m}><input type="radio" name="mode" value={m} checked={mode===m} onChange={()=>{setMode(m);if(m==='delivery')setDeliveryMounted(true)}}/>{m==='pickup'?<ShoppingBag size={22} aria-hidden="true"/>:<MapPin size={22} aria-hidden="true"/>}<strong>{fulfillmentNames[m]}</strong><small>{m==='pickup'?'Jemput di warung':catalog.settings.deliveryFee?'Ongkir '+rupiah(catalog.settings.deliveryFee):'Gratis ongkir'}</small></label>)}</div>{mode==='pickup'&&catalog.settings.address&&<p className="muted">{catalog.settings.address}</p>}</fieldset>
    {deliveryMounted&&<div hidden={mode!=='delivery'}><DeliveryFields required={mode==='delivery'}/></div>}
    <fieldset disabled={busy}><legend>Data pemesan</legend><div className="form-grid"><label>Nama<input name="name" required maxLength={80} autoComplete="name" placeholder="Nama kamu"/></label><label>Nomor WhatsApp<input name="phone" type="tel" inputMode="tel" required maxLength={25} autoComplete="tel" placeholder="08xxxxxxxxxx" pattern="[0-9+()\s-]{8,25}" title="Nomor HP 8–16 digit, contoh 08123456789"/></label></div><label>Catatan <span>(opsional)</span><textarea name="notes" maxLength={300} placeholder="Contoh: sambal dipisah"/></label></fieldset>
    <fieldset disabled={busy}><legend>Kode promo</legend><div className="inline"><input aria-label="Kode promo" aria-invalid={promoInvalid||undefined} maxLength={24} value={promo} onChange={e=>setPromo(e.target.value.toUpperCase())} placeholder="Masukkan kode" autoComplete="off"/><button type="button" className="button outline" onClick={usePromo}>Pakai</button>{applied&&<button type="button" className="icon-button" aria-label="Hapus promo" onClick={()=>{setApplied('');setPromo('');setQuoteErr('')}}><X size={18} aria-hidden="true"/></button>}</div>{applied&&quote&&!promoInvalid&&<small className="success">Promo {applied} diterapkan.</small>}{promoInvalid&&<small role="alert" className="promo-error">{quoteErr}</small>}</fieldset>
    <fieldset disabled={busy}><legend>Metode checkout</legend><div className="split-options">
      <label className={'pick '+(method==='whatsapp'&&catalog.methods.whatsapp?'chosen':'')}><input type="radio" name="method" disabled={!catalog.methods.whatsapp} checked={method==='whatsapp'&&catalog.methods.whatsapp} onChange={()=>setMethod('whatsapp')}/><MessageCircle size={17} aria-hidden="true"/> WhatsApp</label>
      <label className={'pick '+(method==='qris'&&catalog.methods.qris?'chosen':'')}><input type="radio" name="method" disabled={!catalog.methods.qris} checked={method==='qris'&&catalog.methods.qris} onChange={()=>setMethod('qris')}/><QrCode size={17} aria-hidden="true"/> QRIS {catalog.methods.qris ? (catalog.methods.qrisProvider==='merchant'?'warung':catalog.methods.sandbox?'(uji coba)':'') : ''}</label>
    </div>{!catalog.methods.whatsapp&&!catalog.methods.qris&&<p className="notice warning"><CircleHelp size={17} aria-hidden="true"/> Metode checkout belum diaktifkan oleh warung.</p>}</fieldset>
    {error && <p role="alert" tabIndex={-1} ref={errorRef} className="notice warning">{error}</p>}
    <div className="checkout-bar">
      {quoteErr&&!promoInvalid&&<p role="alert" className="notice warning">{quoteErr}</p>}
      <div className="order-totals" aria-live="polite"><div><span>Subtotal</span><span>{quote?rupiah(quote.subtotal):'Menghitung…'}</span></div>{mode==='delivery'&&quote&&<div><span>Ongkir</span><span>{quote.deliveryFee?rupiah(quote.deliveryFee):'Gratis'}</span></div>}{!!quote?.discount&&<div><span>Diskon</span><span>−{rupiah(quote.discount)}</span></div>}<div><strong>Total</strong><strong>{quote?rupiah(quote.total):'Menghitung…'}</strong></div></div>
      <button className="button dark wide" type="submit" aria-busy={busy||undefined} disabled={busy||!quote||!!quoteErr||!catalog.methods[method]}>{busy?'Memproses…':method==='whatsapp'?'Pesan lewat WhatsApp':catalog.methods.qris?'Buat QRIS':'Checkout belum aktif'}</button>
    </div>
  </form></Modal>
}
