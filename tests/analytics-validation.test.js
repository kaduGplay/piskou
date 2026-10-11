import test from 'node:test'
import assert from 'node:assert/strict'
import analytics from '../api/analytics.js'
import admin from '../api/admin.js'
process.env.ADMIN_PASSWORD='test-admin-password'
process.env.CHAT_SESSION_SECRET='test-secret'
const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(data){this.body=data;return this}})
test('analytics refuses external origins and forged payment approvals before database access',async()=>{
 let r=res();await analytics({method:'POST',headers:{host:'localhost:5173',origin:'https://other.test'},body:{}},r);assert.equal(r.code,403)
 r=res();await analytics({method:'POST',headers:{host:'localhost:5173',origin:'http://localhost:5173'},body:{session:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',visitor:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',page:'/checkout',event:'payment_paid'}},r);assert.equal(r.code,400)
})
test('dashboard denies access without signed cookie',async()=>{
 const r=res();await admin({method:'GET',headers:{},query:{}},r);assert.equal(r.code,401);assert.equal(r.headers['Cache-Control'],'no-store')
})
