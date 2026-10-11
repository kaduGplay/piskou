import test from 'node:test'
import assert from 'node:assert/strict'
import { chatDatabase } from '../api/_lib/chat.js'
test('database RPC accepts a successful empty response',async()=>{
 const previous=globalThis.fetch
 process.env.SUPABASE_SECRET_KEY='sb_secret_test'
 process.env.SUPABASE_URL='https://example.test'
 globalThis.fetch=async()=>new Response(null,{status:204})
 try{assert.equal(await chatDatabase('rpc/test',{}),null)}finally{globalThis.fetch=previous}
})
