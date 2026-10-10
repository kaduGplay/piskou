import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { voidpayGateway } from '../api/_lib/voidpay.js'
import { store, chargeKey } from '../api/_lib/store.js'
process.env.VOIDPAY_PUBLIC_KEY = 'test-public'
process.env.VOIDPAY_SECRET_KEY = 'test-secret'
process.env.VOIDPAY_CALLBACK_ANCHOR = 'piskou_fixed'
process.env.VOIDPAY_FIXED_PHONE = '11999999999'
const signature = order => createHmac('sha256', 'test-secret').update(`callback:${order}`).digest('hex')
const order = id => ({id,amountCents:2385,plan:{id:'premium-access',name:'Premium'},customer:{name:'Test',email:'test@example.com'},siteUrl:'https://example.com',metadata:{tracking:{}}})
test('different orders reuse exactly the same signed callback',async()=>{
 const original=globalThis.fetch, urls=[]
 globalThis.fetch=async(url,options)=>{urls.push(JSON.parse(options.body).callbackUrl);return Response.json({transactionId:'tx',status:'PENDING',pix:{code:'test-code'}})}
 try {await voidpayGateway.createPixCharge(order('piskou_one'));await voidpayGateway.createPixCharge(order('piskou_two'));assert.equal(urls[0],urls[1]);assert.equal(new URL(urls[0]).searchParams.get('order'),'piskou_fixed')} finally {globalThis.fetch=original}
})
test('shared callback resolves actual order from stored transaction',async()=>{
 await store.set(chargeKey('tx-stored'),{orderId:'piskou_actual',status:'pending'})
 const original=globalThis.fetch
 globalThis.fetch=async()=>Response.json({clientIdentifier:'piskou_actual',status:'COMPLETED'})
 try {const event=await voidpayGateway.handleWebhook({query:{order:'piskou_fixed',sig:signature('piskou_fixed')},body:{transactionId:'tx-stored',status:'COMPLETED'}});assert.equal(event.orderId,'piskou_actual');assert.equal(event.status,'paid');assert.equal(event.verified,true)} finally{globalThis.fetch=original}
})
test('rejects unknown transactions and invalid signatures',async()=>{
 await assert.rejects(voidpayGateway.handleWebhook({query:{order:'piskou_fixed',sig:signature('piskou_fixed')},body:{transactionId:'unknown'}}),/não encontrada/)
 await assert.rejects(voidpayGateway.handleWebhook({query:{order:'piskou_fixed',sig:'invalid'},body:{transactionId:'tx-stored'}}),/Assinatura/)
})
test('rejects mismatched order returned by gateway',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({clientIdentifier:'piskou_other',status:'COMPLETED'})
 try{await assert.rejects(voidpayGateway.handleWebhook({query:{order:'piskou_fixed',sig:signature('piskou_fixed')},body:{transactionId:'tx-stored'}}),/não pertence/)}finally{globalThis.fetch=original}
})
test('legacy per-order callback still validates',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({clientIdentifier:'piskou_legacy',status:'COMPLETED'})
 try{const e=await voidpayGateway.handleWebhook({query:{order:'piskou_legacy',sig:signature('piskou_legacy')},body:{transactionId:'tx-legacy'}});assert.equal(e.orderId,'piskou_legacy');assert.equal(e.status,'paid')}finally{globalThis.fetch=original}
})
