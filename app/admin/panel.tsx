'use client'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { CheckCircle2, ChefHat, ClipboardList, ImagePlus, LogOut, Pencil, Plus, RefreshCw, Search, Settings2, ShoppingBag, Soup, Tag, Trash2 } from 'lucide-react'
import { Brand, Modal, ProductPhoto } from '../store'
import { mapLink, validPoint, type DeliveryPoint } from '../../lib/delivery'
import { categories, fulfillmentNames, orderStates, paymentStates, priceOf, rupiah } from '../../lib/shop'
import type { Category, Methods, Product, Promo, Quote, Receipt, Settings } from '../../lib/shop'
import { errorText, read, request } from '../../lib/http'
import QrisSettings from './qris-settings'

type AdminShop = { shop:{products:Product[];promos:Promo[];settings:Settings};revision:number;methods:Methods }
type AdminOrder = Receipt & {paymentReference:string|null;created:number;mode:keyof typeof fulfillmentNames;info:Quote & {point?:DeliveryPoint;name:string;phone:string;address:string;notes:string;promo:string};next:(keyof typeof orderStates)[]}
type Orders = { orders:AdminOrder[];next:number|null }
type Screen = 'Pesanan' | 'Menu' | 'Promo' | 'Pengaturan'
const screens = [{name:'Pesanan',icon:ClipboardList},{name:'Menu',icon:Soup},{name:'Promo',icon:Tag},{name:'Pengaturan',icon:Settings2}] as const
const blankProduct: Product = {id:'',name:'',category:'Nasi',price:0,sale:0,image:'',description:'',available:true}
const blankPromo: Promo = {code:'',kind:'percent',value:0,min:0,active:true}
const stockPhotos = ['ayam-sambal','ayam-geprek','ayam-ss','mie-rebus','bubur','nasi-goreng-spesial','nasi-goreng-telur','nasi-goreng-sosis']
const dateFormat = new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'})

function formValues(e:FormEvent<HTMLFormElement>) {
  e.preventDefault()
  return Object.fromEntries(new FormData(e.currentTarget))
}

export default function Admin() {
  const [access,setAccess] = useState<{allowed:boolean}|null>(null)
  const [data,setData] = useState<AdminShop|null>(null)
  const [screen,setScreen] = useState<Screen>('Pesanan')
  const [orders,setOrders] = useState<AdminOrder[]>([])
  const [next,setNext] = useState<number|null>(null)
  const [orderFilter,setOrderFilter] = useState('all')
  const [search,setSearch] = useState('')
  const [category,setCategory] = useState('')
  const [product,setProduct] = useState<Product|null>(null)
  const [promo,setPromo] = useState<Promo|null>(null)
  const [confirm,setConfirm] = useState<{label:string;run:()=>Promise<void>}|null>(null)
  const [paymentReview,setPaymentReview] = useState<AdminOrder|null>(null)
  const [busy,setBusy] = useState(false)
  const [uploading,setUploading] = useState(false)
  const [loadingOrders,setLoadingOrders] = useState(false)
  const [error,setError] = useState('')
  const [note,setNote] = useState('')
  const [formError,setFormError] = useState('')
  const [password,setPassword] = useState('')
  const [loginBusy,setLoginBusy] = useState(false)

  async function loadAccess() {
    setError('')
    try {
      const result = await request<{allowed:boolean}>('admin/access')
      if(result.allowed) setData(await request<AdminShop>('admin/shop'))
      else setData(null)
      setAccess(result)
    } catch(err) {setError(errorText(err))}
  }
  useEffect(()=>{void loadAccess()},[])
  async function login(e:FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if(loginBusy)return
    setLoginBusy(true);setError('')
    try {
      await request('admin/login',{password})
      setPassword('')
      await loadAccess()
    } catch(err) {setError(errorText(err))}
    finally {setLoginBusy(false)}
  }
  async function logout() {
    try { await request('admin/logout',{}) } catch { /* The cookie is cleared locally anyway. */ }
    setAccess(null);setData(null);setPassword('');setError('')
  }
  async function loadOrders(sync=false,before?:number) {
    setLoadingOrders(true);setError('')
    try {
      const params = new URLSearchParams()
      if (before) params.set('before',String(before))
      if (sync) params.set('sync','1')
      const result = await request<Orders>('admin/orders?'+params.toString())
      setOrders(old=>before?[...old,...result.orders]:result.orders);setNext(result.next)
    } catch(err) {setError(errorText(err))}
    finally {setLoadingOrders(false)}
  }
  useEffect(()=>{if (access?.allowed && screen==='Pesanan')void loadOrders()},[access?.allowed,screen])

  function navigate(nextScreen:Screen) {
    setScreen(nextScreen);setError('');setNote('')
  }
  async function save(section:string,values:object,inDialog=false) {
    if(!data)return
    setBusy(true);setError('');setFormError('');setNote('')
    try {
      const saved = await request<AdminShop>('admin/'+section,{...values,revision:data.revision})
      setData(saved);setNote('Perubahan tersimpan.');setProduct(null);setPromo(null);setConfirm(null)
    } catch(err) { (inDialog?setFormError:setError)(errorText(err)) }
    finally{setBusy(false)}
  }
  async function changeOrder(id:string,state:string) {
    setBusy(true);setError('');setFormError('');setNote('')
    try {await request('admin/orders',{id,state});setConfirm(null);await loadOrders();setNote('Status pesanan diperbarui.')}
    catch(err){(confirm?setFormError:setError)(errorText(err))}
    finally{setBusy(false)}
  }
  async function checkPayment(id:string) {
    setBusy(true);setError('')
    try {await request('admin/orders',{id,sync:true});await loadOrders()}
    catch(err){setError(errorText(err))}
    finally{setBusy(false)}
  }
  async function verifyMerchantPayment(e:FormEvent<HTMLFormElement>) {
    const fields = formValues(e)
    if (!paymentReview) return
    setBusy(true);setFormError('');setNote('')
    try {
      await request('admin/orders',{id:paymentReview.id,confirmMerchantPayment:true,reference:fields.reference})
      setPaymentReview(null);await loadOrders();setNote('Pembayaran QRIS tercatat lunas.')
    } catch (err) {setFormError(errorText(err))}
    finally {setBusy(false)}
  }
  async function upload(file?:File) {
    if(!file)return
    setUploading(true);setFormError('')
    try {
      const form = new FormData()
      form.set('photo',file)
      const result = await read<{url:string}>(await fetch('/api/admin/media',{method:'POST',body:form}))
      setProduct(previous=>previous&&({...previous,image:result.url}))
    } catch(err){setFormError(errorText(err))}
    finally{setUploading(false)}
  }

  if(!access?.allowed || !data) return <div className="access-page"><Brand/><div className="access-card"><span className="strip-icon" aria-hidden="true"><ChefHat size={20}/></span><h1>Panel Admin</h1>{error&&<p role="alert" className="notice warning">{error}</p>}{access===null&&!error?<p>Memeriksa sesi…</p>:<form className="login-form" onSubmit={login}><label>Kata sandi admin<input type="password" name="password" autoComplete="current-password" required maxLength={200} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Kata sandi panel" autoFocus/></label><button className="button dark wide" disabled={loginBusy}>{loginBusy?'Masuk…':'Masuk'}</button></form>}</div></div>

  const shownOrders = orders.filter(o=>orderFilter==='all'||o.state===orderFilter)
  const shownProducts = data.shop.products.filter(p=>(!category||p.category===category)&&p.name.toLowerCase().includes(search.trim().toLowerCase()))
  const {settings} = data.shop

  return <div className="panel">
    <aside className="panel-side"><Brand/><p className="panel-caption">PANEL ADMIN</p><nav aria-label="Navigasi admin">{screens.map(({name,icon:Icon})=><button type="button" className={name===screen?'on':''} key={name} aria-current={name===screen?'page':undefined} onClick={()=>navigate(name)}><Icon size={18} aria-hidden="true"/>{name}</button>)}</nav><a href="/"><ShoppingBag size={17} aria-hidden="true"/> Lihat Toko</a><button type="button" className="panel-logout" onClick={()=>void logout()}><LogOut size={17} aria-hidden="true"/> Keluar</button></aside>
    <main className="panel-main"><header className="panel-header"><div><h1>{screen}</h1><p>{{Pesanan:'Kelola pesanan dan pantau pembayaran.',Menu:'Kelola menu, harga, foto, dan ketersediaan.',Promo:'Atur kode diskon untuk pelanggan.',Pengaturan:'Atur kontak, jam buka, dan cara menerima pesanan.'}[screen]}</p></div>
      {screen==='Menu'&&<button type="button" className="button dark" onClick={()=>{setFormError('');setProduct(blankProduct)}}><Plus size={17} aria-hidden="true"/> Tambah Menu</button>}
      {screen==='Promo'&&<button type="button" className="button dark" onClick={()=>{setFormError('');setPromo(blankPromo)}}><Plus size={17} aria-hidden="true"/> Tambah Promo</button>}
      {screen==='Pesanan'&&<button type="button" className="button outline" disabled={loadingOrders} onClick={()=>void loadOrders(true)}><RefreshCw size={17} aria-hidden="true"/> {loadingOrders?'Memuat…':'Muat Ulang'}</button>}
    </header>
    {error&&<div className="notice warning panel-alert" role="alert">{error}<button type="button" className="button outline" onClick={()=>void loadAccess()}>Muat data toko</button></div>}
    {note&&<p className="notice panel-alert" role="status"><CheckCircle2 size={16} aria-hidden="true"/>{note}</p>}

    {screen==='Pesanan'&&<>
      <div className="stat-grid"><div><span>Ditampilkan</span><strong>{orders.length}</strong></div><div><span>Pesanan baru</span><strong>{orders.filter(o=>o.state==='new').length}</strong></div><div><span>QRIS lunas</span><strong>{orders.filter(o=>o.payment==='paid'&&!o.sandbox).length}</strong></div></div>
      <div className="panel-tools"><label>Status pesanan<select value={orderFilter} onChange={e=>setOrderFilter(e.target.value)}><option value="all">Semua status</option>{Object.entries(orderStates).map(([s,label])=><option value={s} key={s}>{label}</option>)}</select></label></div>
      <div className="order-list">{!shownOrders.length&&<div className="empty"><ClipboardList size={30} aria-hidden="true"/><h3>{loadingOrders?'Memuat pesanan…':'Belum ada pesanan untuk ditampilkan'}</h3></div>}
        {shownOrders.map(o=><details className="admin-order" key={o.id}><summary><span><strong>#{o.id.toUpperCase()}</strong><small>{o.info.name} · {dateFormat.format(o.created)}</small></span><span className="order-summary"><span className="badge">{orderStates[o.state]}</span><strong>{rupiah(o.total)}</strong></span></summary><div className="admin-order-body">
        <div className="order-cols"><div><strong>{fulfillmentNames[o.mode]}</strong><p>{o.info.phone}</p>{o.info.address&&<p>{o.info.address}</p>}{o.mode==='delivery'&&validPoint(o.info.point)&&<p><a href={mapLink(o.info.point)} target="_blank" rel="noreferrer">Buka titik antar di peta</a></p>}{o.info.notes&&<p>Catatan: {o.info.notes}</p>}</div><div><strong>{o.qrisProvider==='merchant'?'QRIS warung':o.method==='qris'?'QRIS Midtrans':'WhatsApp'}{o.sandbox?' (uji coba)':''}</strong><p>{paymentStates[o.payment]}</p>{o.paymentReference&&<p>Referensi transaksi: {o.paymentReference}</p>}{o.info.promo&&<p>Kode promo: {o.info.promo}</p>}</div></div>
        <ul className="order-item-list">{o.info.items.map(i=><li key={i.id}>{i.quantity} × {i.name}<span>{rupiah(i.price*i.quantity)}</span></li>)}{o.info.discount>0&&<li>Diskon<span>−{rupiah(o.info.discount)}</span></li>}{o.info.deliveryFee>0&&<li>Ongkir<span>{rupiah(o.info.deliveryFee)}</span></li>}</ul>
        <div className="panel-actions">
          {o.qrisProvider==='midtrans'&&<button type="button" className="button outline" disabled={busy} onClick={()=>void checkPayment(o.id)}>Cek Pembayaran</button>}
          {o.payment==='merchant_pending'&&o.state!=='canceled'&&<button type="button" className="button dark" disabled={busy} onClick={()=>{setFormError('');setPaymentReview(o)}}>Verifikasi Pembayaran</button>}
          {o.next.filter(state=>state!=='canceled' ? o.method==='whatsapp'||o.payment==='paid'
            : o.method==='whatsapp'||['failed','expired','refunded','merchant_pending'].includes(o.payment)).map(state=><button type="button" className={'button '+(state==='canceled'?'danger':'dark')} disabled={busy} key={state} onClick={()=>{if(state==='canceled'){setFormError('');setConfirm({label:'Batalkan pesanan ini?',run:()=>changeOrder(o.id,state)})}else void changeOrder(o.id,state)}}>{orderStates[state]}</button>)}
        </div>
        </div></details>)}</div>
      {next&&<div className="more"><button type="button" className="button outline" disabled={loadingOrders} onClick={()=>void loadOrders(false,next)}>Muat pesanan sebelumnya</button></div>}
    </>}

    {screen==='Menu'&&<><div className="panel-tools"><div className="search" role="search"><Search size={18} aria-hidden="true"/><input type="search" aria-label="Cari menu admin" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari menu..."/></div><select aria-label="Filter kategori" value={category} onChange={e=>setCategory(e.target.value)}><option value="">Semua kategori</option>{categories.map(c=><option key={c}>{c}</option>)}</select></div>
      <div className="data-table"><table><thead><tr><th>Menu</th><th>Kategori</th><th>Harga jual</th><th>Stok</th><th>Aksi</th></tr></thead><tbody>{shownProducts.map(p=><tr key={p.id}><td><div className="table-name"><span className="tiny-img"><ProductPhoto product={p}/></span><strong>{p.name}</strong></div></td><td>{p.category}</td><td><strong>{rupiah(priceOf(p))}</strong>{p.sale>0&&<del>{rupiah(p.price)}</del>}</td><td><span className={'badge '+(!p.available?'neutral':'')}>{p.available?'Tersedia':'Habis'}</span></td><td><div className="table-actions"><button type="button" className="icon-button" aria-label={'Edit '+p.name} onClick={()=>{setFormError('');setProduct(p)}}><Pencil size={16} aria-hidden="true"/></button><button type="button" className="icon-button" aria-label={'Hapus '+p.name} onClick={()=>{setFormError('');setConfirm({label:'Hapus '+p.name+'?',run:()=>save('products',{id:p.id,remove:true},true)})}}><Trash2 size={16} aria-hidden="true"/></button></div></td></tr>)}</tbody></table>{!shownProducts.length&&<div className="empty"><h3>Menu tidak ditemukan</h3></div>}</div>
    </>}

    {screen==='Promo'&&<div className="data-table"><table><thead><tr><th>Kode</th><th>Potongan</th><th>Min. belanja</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{data.shop.promos.map(p=><tr key={p.code}><td><strong>{p.code}</strong></td><td>{p.kind==='percent'?p.value+'%':rupiah(p.value)}</td><td>{rupiah(p.min)}</td><td><span className={'badge '+(!p.active?'neutral':'')}>{p.active?'Aktif':'Nonaktif'}</span></td><td><div className="table-actions"><button type="button" className="icon-button" aria-label={'Edit '+p.code} onClick={()=>{setFormError('');setPromo(p)}}><Pencil size={16} aria-hidden="true"/></button><button type="button" className="icon-button" aria-label={'Hapus '+p.code} onClick={()=>{setFormError('');setConfirm({label:'Hapus promo '+p.code+'?',run:()=>save('promos',{prior:p.code,remove:true},true)})}}><Trash2 size={16} aria-hidden="true"/></button></div></td></tr>)}</tbody></table>{!data.shop.promos.length&&<div className="empty"><Tag size={28} aria-hidden="true"/><h3>Belum ada promo</h3></div>}</div>}

    {screen==='Pengaturan'&&<div className="panel-settings">
      <form className="panel-form settings-card" key={data.revision} onSubmit={e=>{const f=formValues(e);void save('settings',{...f,deliveryFee:Number(f.deliveryFee),open:f.open==='on',pickup:f.pickup==='on',delivery:f.delivery==='on'})}}>
        <h2>Warung &amp; pemesanan</h2><label>Nomor WhatsApp warung<input name="whatsapp" defaultValue={settings.whatsapp} type="tel" placeholder="08xxxxxxxxxx"/></label><label>Alamat warung<textarea name="address" defaultValue={settings.address} maxLength={250} placeholder="Alamat untuk pengambilan pesanan"/></label><label>Jam buka <span>(ditampilkan ke pelanggan)</span><input name="hours" defaultValue={settings.hours} maxLength={150} placeholder="Contoh: Senin–Sabtu, 08.00–21.00"/></label>
        <label className="toggle"><input name="open" type="checkbox" defaultChecked={settings.open}/> Terima pesanan</label><label className="toggle"><input name="pickup" type="checkbox" defaultChecked={settings.pickup}/> Izinkan ambil sendiri</label><label className="toggle"><input name="delivery" type="checkbox" defaultChecked={settings.delivery}/> Izinkan pengantaran</label><label>Ongkir tetap (Rp)<input type="number" min="0" max="5000000" name="deliveryFee" defaultValue={settings.deliveryFee} required/></label><button className="button dark" disabled={busy}>Simpan Pengaturan</button>
      </form>
      <QrisSettings key={settings.qrisProvider+':'+settings.merchantQris} settings={settings} methods={data.methods} busy={busy} save={value=>void save('qris',value)}/>
    </div>}

    {product&&<Modal title={product.id?'Edit Menu':'Tambah Menu'} onClose={()=>{if(!busy&&!uploading)setProduct(null)}}><form className="panel-form" onSubmit={e=>{e.preventDefault();void save('products',product,true)}}>
      <label>Nama menu<input value={product.name} onChange={e=>setProduct({...product,name:e.target.value})} required maxLength={85}/></label>
      <label>Kategori<select value={product.category} onChange={e=>setProduct({...product,category:e.target.value as Category})}>{categories.map(c=><option key={c}>{c}</option>)}</select></label>
      <div className="form-grid"><label>Harga normal (Rp)<input type="number" min="1" max="5000000" value={product.price||''} onChange={e=>setProduct({...product,price:Number(e.target.value)})} required/></label><label>Harga diskon (Rp)<input type="number" min="0" max="5000000" placeholder="Opsional" value={product.sale||''} onChange={e=>setProduct({...product,sale:Number(e.target.value)})}/></label></div>
      <label>Deskripsi<textarea value={product.description} maxLength={300} onChange={e=>setProduct({...product,description:e.target.value})}/></label>
      <div className="photo-controls"><div className="tiny-img"><ProductPhoto product={product}/></div><label className="button outline upload-button"><ImagePlus size={16} aria-hidden="true"/> {uploading?'Mengunggah…':'Unggah Foto'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={e=>void upload(e.target.files?.[0])}/></label></div>
      <label>Atau pilih foto yang sudah ada<select value={stockPhotos.some(p=>product.image==='/food/'+p+'.webp')?product.image:''} onChange={e=>setProduct({...product,image:e.target.value})}><option value="">Pilih foto</option>{stockPhotos.map(name=><option value={'/food/'+name+'.webp'} key={name}>{name.replaceAll('-',' ')}</option>)}</select></label>
      <label>Tautan atau lokasi foto<input value={product.image} maxLength={700} onChange={e=>setProduct({...product,image:e.target.value})} placeholder="https://…"/></label>
      <label className="toggle"><input type="checkbox" checked={product.available} onChange={e=>setProduct({...product,available:e.target.checked})}/> Menu tersedia</label>
      {formError&&<p className="notice warning" role="alert">{formError}</p>}<button className="button dark wide" disabled={busy||uploading}>Simpan Menu</button>
    </form></Modal>}

    {promo&&<Modal title={promo.code?'Edit Promo':'Tambah Promo'} onClose={()=>{if(!busy)setPromo(null)}}><form className="panel-form" onSubmit={e=>{const f=formValues(e);void save('promos',{...f,prior:promo.code,value:Number(f.value),min:Number(f.min),active:f.active==='on'},true)}}>
      <label>Kode promo<input name="code" required pattern="[A-Za-z0-9][A-Za-z0-9\-]{1,23}" defaultValue={promo.code} maxLength={24} placeholder="Contoh: BURJOSS10"/></label><label>Jenis potongan<select name="kind" defaultValue={promo.kind}><option value="percent">Persentase (%)</option><option value="fixed">Nominal (Rp)</option></select></label><label>Nilai potongan<input name="value" type="number" min="1" required defaultValue={promo.value||''}/></label><label>Minimum belanja (Rp)<input name="min" type="number" min="0" required defaultValue={promo.min}/></label><label className="toggle"><input name="active" type="checkbox" defaultChecked={promo.active}/> Promo aktif</label>
      {formError&&<p className="notice warning" role="alert">{formError}</p>}<button className="button dark wide" disabled={busy}>Simpan Promo</button>
    </form></Modal>}

    {paymentReview&&<Modal title="Verifikasi QRIS Warung" onClose={()=>{if(!busy)setPaymentReview(null)}}>
      <form className="panel-form" onSubmit={verifyMerchantPayment}>
        <p className="muted">Cocokkan transaksi yang masuk di aplikasi merchant dengan pesanan <strong>{paymentReview.id.toUpperCase()}</strong> senilai <strong>{rupiah(paymentReview.total)}</strong>.</p>
        <label>Nomor referensi transaksi<input name="reference" minLength={4} maxLength={80} required placeholder="Dari riwayat transaksi merchant"/></label>
        {formError&&<p className="notice warning" role="alert">{formError}</p>}
        <button className="button dark wide" disabled={busy}>Tandai Lunas</button>
      </form>
    </Modal>}
    {confirm&&<Modal title={confirm.label} onClose={()=>{if(!busy)setConfirm(null)}}>{formError&&<p className="notice warning" role="alert">{formError}</p>}<div className="panel-actions"><button type="button" className="button outline" disabled={busy} onClick={()=>setConfirm(null)}>Kembali</button><button type="button" className="button danger" disabled={busy} onClick={()=>void confirm.run()}>Ya, lanjutkan</button></div></Modal>}
    </main>
  </div>
}
