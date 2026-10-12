export async function transcribeAudio(bytes, mime, extension, fetcher = fetch) {
  const model = process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe'
  for (let attempt = 0; attempt < 2; attempt++) {
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: mime }), `audio.${extension}`)
    form.append('model', model)
    form.append('language', 'pt')
    form.append('response_format', 'json')
    const response = await fetcher('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form, signal: AbortSignal.timeout(25000),
    })
    if (response.ok) {
      const text = String((await response.json()).text || '').trim()
      if (!text) throw new Error('Não consegui ouvir a fala. Grave novamente, mais perto do microfone.')
      if (text.length > 500) throw new Error('Use um áudio mais curto, com até 500 caracteres transcritos.')
      return text
    }
    const detail = await response.json().catch(() => ({}))
    const code = String(detail.error?.code || detail.error?.type || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '').slice(0,80)
    console.error('chat: transcription rejected', response.status, code)
    if (attempt === 0 && (response.status === 429 || response.status >= 500)) continue
    const error = new Error(response.status === 400
      ? 'Não foi possível ler esta gravação. Grave novamente e aguarde um instante antes de enviar.'
      : response.status === 429 || response.status >= 500
        ? 'A transcrição está ocupada. Toque em tentar enviar novamente; sua gravação foi mantida.'
        : 'A transcrição está temporariamente indisponível. Sua gravação foi mantida para tentar novamente.')
    throw error
  }
}
