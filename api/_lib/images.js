export async function generateChatImage(prompt, fetcher = fetch, selection = {}) {
  if (!prompt?.trim()) throw new Error('Missing image subject')
  const visualStyle = selection.style === 'anime'
    ? 'Use Japanese anime style, expressive linework and anime shading by default.'
    : 'Use maximum photorealism by default: a convincing real photograph, natural lighting, lifelike textures, fine detail, realistic anatomy, depth of field and camera optics. Avoid illustration, cartoon, anime, CGI, 3D render, plastic skin and artificial smoothing.'
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
        prompt: `Create a safe, nonsexual image for a virtual character chat. No nudity, erotic content, minors or likeness of real people. ${visualStyle} If the requested subject explicitly calls for a drawing, painting or another artistic medium, respect that requested medium. Depict only the requested subject and scene; the chat character is not automatically the subject. Subject and scene: ${prompt}`,
        n: 1,
        size: '1024x1024',
        quality: 'high',
        output_format: 'jpeg',
        output_compression: 85,
      }),
      signal: AbortSignal.timeout(35000),
    },
  )
  if (!response.ok) throw new Error(`Image HTTP ${response.status}`)
  const data = await response.json()
  const encoded = data.data?.[0]?.b64_json
  if (
    !encoded ||
    encoded.length > 6000000 ||
    !/^[A-Za-z0-9+/=]+$/.test(encoded)
  )
    throw new Error('Invalid image output')
  return { src: `data:image/jpeg;base64,${encoded}` }
}
