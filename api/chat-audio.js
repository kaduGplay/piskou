import { randomUUID } from 'node:crypto'
import {
  chatDatabase,
  chatSession,
  chatSelection,
  sameChatSelection,
} from './_lib/chat.js'
import { sameOrigin, UUID } from './_lib/analytics.js'
import {
  audioStorage,
  audioObjectPath,
  audioURL,
  eraseAudio,
} from './_lib/chat-storage.js'
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (!['GET', 'POST'].includes(req.method))
    return res.status(405).json({ error: 'Método inválido' })
  if (req.method === 'POST' && !sameOrigin(req))
    return res.status(403).json({ error: 'Origem inválida' })
  const session = chatSession(req, res)
  if (!session)
    return res.status(401).json({ error: 'Abra sua conversa primeiro.' })
  const messageId = req.query?.messageId || req.body?.messageId
  if (!UUID.test(messageId || ''))
    return res.status(400).json({ error: 'Mensagem inválida' })
  let lease, objectKey
  try {
    const rows = await chatDatabase(
      `piskou_chat_sessions?id=eq.${session}&select=messages,selection`,
    )
    const chat = rows[0]
    const message = chat?.messages.find((m) => m.id === messageId)
    if (!chat || message?.deleted)
      return res.status(404).json({ error: 'Áudio indisponível.' })
    if (req.method === 'GET') {
      if (!message)
        return res.status(404).json({ error: 'Áudio indisponível.' })
      const audio = (
        await chatDatabase(
          `piskou_chat_audio?chat_id=eq.${session}&message_id=eq.${messageId}&ready=eq.true&select=object_key,transcript`,
        )
      )[0]
      if (!audio) return res.status(404).json({ error: 'Áudio indisponível.' })
      return res
        .status(200)
        .json({
          url: await audioURL(audio.object_key),
          transcript: audio.transcript,
        })
    }
    const selection = chatSelection(req.body.selection)
    if (!selection || !sameChatSelection(selection, chat.selection))
      return res.status(409).json({ error: 'Conversa alterada.' })
    const speech = req.body.action === 'speech'
    if (!speech && req.body.action !== 'upload')
      return res.status(400).json({ error: 'Operação inválida.' })
    if (speech && (message?.role !== 'character' || !message.text))
      return res.status(400).json({ error: 'Resposta indisponível.' })
    const mime = speech
      ? 'audio/mpeg'
      : String(req.body.mime || '').split(';')[0]
    const extensions = {
      'audio/webm': 'webm',
      'audio/mp4': 'mp4',
      'audio/ogg': 'ogg',
      'audio/mpeg': 'mp3',
    }
    const base64 = req.body.base64
    if (
      !extensions[mime] ||
      (!speech &&
        (typeof base64 !== 'string' ||
          base64.length > 2800000 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)))
    )
      return res.status(400).json({ error: 'Grave um áudio de até 2 MB.' })
    // Limit speech/transcription separately: retries never consume chat credits.
    const allowed = await chatDatabase('rpc/piskou_analytics_limit', {
      p_key: `audio:${session}`,
      p_max: 40,
    })
    if (!allowed)
      return res
        .status(429)
        .json({ error: 'Aguarde antes de gerar outro áudio.' })
    objectKey = `${session}/${messageId}.${extensions[mime]}`
    lease = randomUUID()
    const reserved = await chatDatabase('rpc/piskou_audio_reserve', {
      p_id: session,
      p_selection: selection,
      p_message: messageId,
      p_key: objectKey,
      p_mime: mime,
      p_lease: lease,
    })
    if (reserved.error)
      return res
        .status(409)
        .json({ error: 'O áudio ainda está sendo preparado ou foi apagado.' })
    if (reserved.ready) {
      lease = null
      return res.status(200).json({ text: reserved.transcript, ready: true })
    }
    let bytes, transcript
    const headers = { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    if (speech) {
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.OPENAI_SPEECH_MODEL || 'gpt-4o-mini-tts',
          voice: 'coral',
          input: message.text,
          response_format: 'mp3',
          instructions:
            'Leia em português brasileiro, com tom claro e natural. Voz sintetizada de uma personagem de IA.',
        }),
        signal: AbortSignal.timeout(30000),
      })
      if (!response.ok) throw new Error('Speech unavailable')
      bytes = new Uint8Array(await response.arrayBuffer())
      transcript = message.text
    } else {
      bytes = Buffer.from(base64, 'base64')
      if (!bytes.length || bytes.length > 2097152)
        return res.status(400).json({ error: 'Áudio muito grande.' })
      const form = new FormData()
      form.append(
        'file',
        new Blob([bytes], { type: mime }),
        `audio.${extensions[mime]}`,
      )
      form.append(
        'model',
        process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe',
      )
      form.append('language', 'pt')
      const response = await fetch(
        'https://api.openai.com/v1/audio/transcriptions',
        {
          method: 'POST',
          headers,
          body: form,
          signal: AbortSignal.timeout(30000),
        },
      )
      if (!response.ok) throw new Error('Transcription unavailable')
      transcript = String((await response.json()).text || '').trim()
      if (!transcript || transcript.length > 500)
        throw new Error(
          'Use um áudio mais curto, com até 500 caracteres transcritos.',
        )
    }
    if (bytes.length > 2097152) throw new Error('Áudio muito grande')
    // Revalidate immediately before writing; the completion RPC checks again under lock.
    const current = (
      await chatDatabase('rpc/piskou_chat_snapshot', { p_id: session })
    ).messages.find((m) => m.id === messageId)
    if (current?.deleted) throw new Error('Mensagem apagada')
    await audioStorage(audioObjectPath(objectKey), {
      method: 'POST',
      body: bytes,
      contentType: mime,
    })
    const completed = await chatDatabase('rpc/piskou_audio_complete', {
      p_id: session,
      p_message: messageId,
      p_lease: lease,
      p_transcript: transcript,
    })
    if (!completed) {
      await eraseAudio(objectKey).catch(() => {})
      throw new Error('Mensagem apagada')
    }
    lease = null
    return res.status(200).json({ ready: true, text: transcript })
  } catch (error) {
    console.error('chat: audio unavailable', error.message)
    return res
      .status(502)
      .json({ error: 'Não foi possível preparar o áudio. Tente novamente.' })
  } finally {
    if (lease)
      await chatDatabase('rpc/piskou_audio_fail', {
        p_id: session,
        p_message: messageId,
        p_lease: lease,
      }).catch(() => {})
  }
}
