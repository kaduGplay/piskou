export async function generateChatImage(prompt, fetcher = fetch) {
  if (!prompt?.trim()) throw new Error('Missing image subject')
  const response = await fetcher(
    'https://api.openai.com/v1/images/generations',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-image-1-mini',
        prompt: `Create a safe, nonsexual illustration for a virtual character chat. No nudity, erotic content, minors or likeness of real people. Depict the requested subject only: ${prompt}`,
        n: 1,
        size: '1024x1024',
        quality: 'low',
        output_format: 'jpeg',
        output_compression: 65,
      }),
      signal: AbortSignal.timeout(35000),
    },
  )
  if (!response.ok) throw new Error(`Image HTTP ${response.status}`)
  const data = await response.json()
  const encoded = data.data?.[0]?.b64_json
  if (
    !encoded ||
    encoded.length > 1500000 ||
    !/^[A-Za-z0-9+/=]+$/.test(encoded)
  )
    throw new Error('Invalid image output')
  return { src: `data:image/jpeg;base64,${encoded}` }
}
