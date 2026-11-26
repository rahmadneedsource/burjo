import {createRequire} from 'node:module'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {createHash,pbkdf2Sync,randomBytes,randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url)
const {build}=require('esbuild'), qr=require('qrcode'), jsQR=require('jsqr'), {PNG}=require('pngjs')
const sql=new DatabaseSync(':memory:')
sql.exec(readFileSync('drizzle/0000_bur_joss.sql','utf8'))
const baseShop={settings:{whatsapp:'6281234567890',open:true,pickup:true,delivery:true,deliveryFee:5000,address:'Uji',hours:''},
 products:[{id:'test-1',name:'Menu uji',price:15000,sale:0,category:'Nasi',available:true,image:'',description:''}],
 promos:[{code:'UJI10',kind:'percent',value:10,min:0,active:true}]}
sql.prepare("INSERT INTO shop_config(key,value,revision) VALUES('store',?,1)").run(JSON.stringify(baseShop))
const legacyId='bj-0123456789abcdef', legacyKey=randomUUID()
sql.prepare('INSERT INTO shop_orders VALUES(?,?,?,?,?,?,?,?,?,?)')
 .run(legacyId, createHash('sha256').update(legacyKey).digest('hex'), Date.now(), 'qris','new','pending','pickup',15000,JSON.stringify({sandbox:true,name:'Uji',phone:'08111111111',items:[]}),null)
sql.exec(readFileSync('drizzle/0001_merchant_qris.sql','utf8'))
const statement=(q,args=[])=>({
 bind:(...a)=>statement(q,a),
 first:async c=>{const row=sql.prepare(q).get(...args);return c?row?.[c]??null:row??null},
 run:async()=>({meta:sql.prepare(q).run(...args)}),
 all:async()=>({results:sql.prepare(q).all(...args)}),
})
const adminPassword='rahasia'
const adminSalt=randomBytes(16)
globalThis.qrisTestEnv={DB:{prepare:statement},ADMIN_PASSWORD_HASH:`pbkdf2$sha256$1000$${adminSalt.toString('base64url')}$${pbkdf2Sync(adminPassword,adminSalt,1000,32,'sha256').toString('base64url')}`,ADMIN_SESSION_SECRET:'test-session-secret',MIDTRANS_SERVER_KEY:'test-key'}
const definition={write:false,bundle:true,format:'esm',platform:'node',define:{'import.meta.env.DEV':'false'}}
const envPlugin={name:'env',setup(b){b.onResolve({filter:/^(cloudflare:workers|@libsql\/client.*)$/},args=>({path:args.path,namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},args=>({contents:args.path.startsWith('@libsql')?'export function createClient(){return null}':'export const env=globalThis.qrisTestEnv'}))}}
async function module(path,plugins=[]){
 const bundle=await build({...definition,entryPoints:[path],plugins})
 return import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].contents).toString('base64'))
}
const converter=await module('lib/merchant-qris.ts')
const api=await module('app/api/[...path]/route.ts',[envPlugin])
function check(data){
 let c=0xffff
 for(const n of Buffer.from(data))for(let bit=7;bit>=0;bit--){
  const top=(c>>>15)^((n>>>bit)&1)
  c=(c<<1)&0xffff
  if(top)c^=0x1021
 }
 return c.toString(16).padStart(4,'0').toUpperCase()
}
assert.equal(check('123456789'),'29B1')
const field=(tag,val)=>tag+String(Array.from(val).length).padStart(2,'0')+val
const withCrc=(value)=>value+'6304'+check(value+'6304')
const mockAccount=field('26',field('00','TEST.INVALID')+field('01','TEST000000'))
const fixture=(point='11',extra='')=>withCrc('000201'+(point?field('01',point):'')+mockAccount+'520458125303360'+extra+'5802ID'+field('59','TOKO UJI')+field('60','SEMARANG')+field('64',field('01','Kafé')))
const testPayload=fixture()
assert.deepEqual(converter.inspectMerchantQris(testPayload),{name:'TOKO UJI',city:'SEMARANG'})
assert.throws(()=>converter.inspectMerchantQris(testPayload.replace('SEMARANG','SEMARANX')),/Checksum/)
assert.throws(()=>converter.inspectMerchantQris(fixture('12')),/statis/)
assert.throws(()=>converter.inspectMerchantQris(fixture('11','5303360')),/tidak valid/)
assert.throws(()=>converter.inspectMerchantQris(fixture('11','550201')),/biaya tambahan/)
assert.throws(()=>converter.generateMerchantQris(testPayload,10_000_001),/Nominal/)
for(const source of [testPayload,fixture('')]){
 const {payload}=converter.generateMerchantQris(source,18500)
 assert.match(payload,/^000201010212/)
 assert.ok(payload.includes(mockAccount))
 assert.ok(payload.includes('5405185005802ID'))
 assert.equal(payload.slice(-4),check(payload.slice(0,-4)))
 const png=PNG.sync.read(await qr.toBuffer(payload,{type:'png',width:512,margin:4,errorCorrectionLevel:'M'}))
 assert.equal(jsQR(new Uint8ClampedArray(png.data),png.width,png.height).data,payload)
}

const origin='https://shop.example.test'
let cookie=''
async function call(path,body,admin=true){
 const method=body===undefined?'GET':'POST'
 const headers=admin&&cookie?{cookie}:{}
 if(method==='POST'){headers.origin=origin;headers['content-type']='application/json'}
 const response=await api[method](new Request(origin+'/api/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}))
 const setCookie=response.headers.get('set-cookie')
 if(setCookie)cookie=setCookie.split(';')[0]
 return {status:response.status,data:await response.json()}
}
assert.equal((await call('admin/shop')).status,403)
assert.equal((await call('admin/access')).data.allowed,false)
assert.equal((await call('admin/login',{password:'salah'})).status,401)
assert.equal((await call('admin/login',{password:adminPassword})).status,200)
assert.equal((await call('admin/access')).data.allowed,true)
assert.ok(cookie.startsWith('burjoss_admin='))
assert.deepEqual((await call('catalog')).data.methods,{whatsapp:true,qris:true,qrisProvider:'midtrans',sandbox:true})
assert.equal((await call('admin/qris',{revision:1,qrisProvider:'merchant',merchantQris:testPayload},false)).status,403)
assert.equal((await call('admin/qris',{revision:1,qrisProvider:'merchant',merchantQris:testPayload.slice(0,-1)},true)).status,400)
assert.equal((await call('admin/qris',{revision:1,qrisProvider:'merchant',merchantQris:testPayload},true)).data.revision,2)
const catalog=(await call('catalog')).data
assert.equal(catalog.settings.merchantQris,undefined)
assert.equal(catalog.methods.qrisProvider,'merchant')
assert.equal(catalog.methods.qris,true)
assert.equal(catalog.methods.sandbox,false)
const purchase={mode:'delivery',method:'qris',qrisProvider:'merchant',qrisSandbox:false,promo:'UJI10',items:[{id:'test-1',quantity:1}],name:'Uji',phone:'08111111111',address:'Uji',expected:18500}
const first={...purchase,key:randomUUID()}, second={...purchase,key:randomUUID()}
assert.equal((await call('checkout',{...first,qrisProvider:'midtrans'})).status,409)
assert.equal((await call('checkout',{...first,expected:18000})).status,409)
globalThis.fetch=async()=>assert.fail('Merchant QRIS used a gateway')
const a=(await call('checkout',first)).data,b=(await call('checkout',second)).data
assert.equal(a.qrisPayload,converter.generateMerchantQris(testPayload,18500).payload)
assert.equal(a.payment,'merchant_pending')
assert.equal((await call('checkout',first)).data.id,a.id)
assert.equal((await call('receipt',{id:a.id,key:second.key})).status,404)
const verify={id:a.id,confirmMerchantPayment:true,reference:'MOCK-001'}
assert.equal((await call('admin/orders',verify,false)).status,403)
assert.equal((await call('admin/orders',{id:a.id,state:'accepted'},true)).status,400)
assert.equal((await call('admin/orders',verify,true)).status,200)
assert.equal((await call('admin/orders',verify,true)).status,200)
assert.equal((await call('admin/orders',{...verify,id:b.id,reference:'mock001'},true)).status,409)
const paid=(await call('receipt',{id:a.id,key:first.key})).data
assert.equal(paid.payment,'paid')
assert.equal(paid.qrisPayload,null)
assert.equal((await call('admin/orders',{id:a.id,state:'accepted'},true)).status,200)
assert.equal((await call('admin/orders',{id:b.id,state:'canceled'},true)).status,200)
assert.equal((await call('receipt',{id:b.id,key:second.key})).data.qrisPayload,null)
assert.equal((await call('admin/orders',{...verify,id:b.id,reference:'MOCK-002'},true)).status,409)

const legacyPayload={status_code:'200',order_id:legacyId,payment_type:'qris',gross_amount:'15000.00',currency:'IDR',transaction_status:'settlement'}
globalThis.fetch=async (url)=>{assert.equal(url,'https://api.sandbox.midtrans.com/v2/'+legacyId+'/status');return Response.json(legacyPayload)}
const legacy=(await call('receipt',{id:legacyId,key:legacyKey})).data
assert.equal(legacy.qrisProvider,'midtrans')
assert.equal(legacy.payment,'paid')
assert.equal((await call('admin/orders',{...verify,id:legacyId},true)).status,409)
assert.equal((await call('admin/qris',{revision:2,qrisProvider:'midtrans',merchantQris:testPayload},true)).data.methods.qrisProvider,'midtrans')
assert.equal((await call('admin/orders',{id:a.id,state:'accepted'},false)).status,403)
assert.equal((await call('admin/logout',{})).status,200)
assert.equal((await call('admin/access')).data.allowed,false)
assert.equal((await call('admin/login',{password:'typeof'})).status,401)
assert.equal((await call('admin/login',{password:adminPassword})).status,200)
assert.equal((await call('admin/access')).data.allowed,true)
const loginCookie=cookie
const tampered='burjoss_admin='+loginCookie.split('=')[1].slice(0,-2)+'aa'
cookie=tampered
assert.equal((await call('admin/access')).data.allowed,false)
cookie=loginCookie
const wa = await call('checkout',{...purchase,method:'whatsapp',address:'',latitude:'-7.05',longitude:'110.43',key:randomUUID()})
assert.equal(wa.status,201)
assert.match(new URL(wa.data.whatsapp).searchParams.get('text'),/maps.*-7.05,110.43/)
assert.equal((await call('checkout',{...purchase,method:'whatsapp',address:'',key:randomUUID()})).status,400)
assert.equal((await call('checkout',{...purchase,method:'whatsapp',latitude:'91',longitude:'110',key:randomUUID()})).status,400)
console.log('Passed: uploaded QR round trip, CRC and format, merchant fields, promotion and delivery amount, config validation, receipt privacy, authorized and idempotent verification, duplicate reference, cancellation, and pre-migration Midtrans orders.')
