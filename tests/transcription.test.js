import test from 'node:test'
import assert from 'node:assert/strict'
import { transcribeAudio } from '../api/_lib/transcription.js'
const response = (status, body) => new Response(JSON.stringify(body), { status })
test('transcription retries transient provider failure with intact audio and JSON format', async () => {
  let calls=0
  const text=await transcribeAudio(new Uint8Array([1,2,3]),'audio/webm','webm', async (_url, options)=>{
    assert.equal(options.body.get('response_format'),'json')
    assert.equal(options.body.get('file').size,3)
    return ++calls===1 ? response(503,{ error:{code:'unavailable'} }) : response(200,{text:'Olá, tudo bem?'})
  })
  assert.equal(calls,2);assert.equal(text,'Olá, tudo bem?')
})
test('invalid recording and empty speech fail clearly without repeatedly sending invalid media', async () => {
  let calls=0
  await assert.rejects(transcribeAudio(new Uint8Array([1]),'audio/mp4','mp4',async()=>{calls++;return response(400,{error:{code:'invalid_audio'}})}), /ler esta gravação/)
  assert.equal(calls,1)
  await assert.rejects(transcribeAudio(new Uint8Array([1]),'audio/mp4','mp4',async()=>response(200,{text:''})), /ouvir a fala/)
})
