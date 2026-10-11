import test from 'node:test'
import assert from 'node:assert/strict'
import { adminToken, authorized, equalSecret } from '../api/_lib/admin.js'
process.env.ADMIN_PASSWORD='test-admin-password'
process.env.CHAT_SESSION_SECRET='test-signing-secret'
const req=token=>({headers:{cookie:`piskou_admin=${token}`}})
test('admin cookie is signed, expires and is invalidated after password change',()=>{
 const now=Date.now(),token=adminToken(now)
 assert.equal(authorized(req(token),now),true)
 assert.equal(authorized(req(token+'tampered'),now),false)
 assert.equal(authorized(req(token),now+8*60*60_000+1),false)
 process.env.ADMIN_PASSWORD='changed-password'
 assert.equal(authorized(req(token),now),false)
 process.env.ADMIN_PASSWORD='test-admin-password'
})
test('missing cookie and unsigned tokens cannot access dashboard',()=>{
 assert.equal(authorized({headers:{}}),false)
 assert.equal(authorized(req(`${Date.now()+10000}.anything`)),false)
 assert.equal(equalSecret('abc','abcd'),false)
 assert.equal(equalSecret('abc','abc'),true)
})
