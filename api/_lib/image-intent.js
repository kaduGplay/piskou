const normalize = (value) => String(value || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const mediaSubject = /\b(?:imagem|imagens|foto|fotos|fotografia|desenho|pintura|ilustracao|retrato|paisagem|anime|video|videos)\b/

// A provider's media flag is only a proposal: the current user must request it.
export function allowMediaRequest(history, message) {
  const text = normalize(message)
  const lastCharacter = history.filter((m) => m.role === 'character' && !m.deleted && !m.contextInvalidated).at(-1)
  if (/\b(?:nao|pare de|para de|sem)\b.{0,40}\b(?:mand|envi|ger|cri|mostr|imagem|imagens|foto|fotos|video|videos)/.test(text)) return false
  const request = /\b(?:manda|mande|mandar|envia|envie|enviar|mostra|mostre|mostrar|gera|gere|gerar|cria|crie|criar|faz|faca|fazer|desenha|desenhe|desenhar|quero|gostaria)\b/
  if (request.test(text) && mediaSubject.test(text) &&
      !/\b(?:falar|conversar|comentar|saber|entender)\b.{0,25}\b(?:sobre|das|dos|de)\b/.test(text)) return true
  if (/\b(?:quero|posso|deixa|gostaria de) (?:te ver|ver voce)\b/.test(text)) return true
  if (/\b(?:desenha|desenhe)\b/.test(text)) return true
  const priorMedia = lastCharacter?.media?.src || lastCharacter?.mediaRequest
  if (priorMedia && /^(?:me )?(?:manda|mande|envia|envie|gera|gere|faz|faca)\b.{0,25}\b(?:outra|outro|mais uma|mais um|novamente|de novo)\b/.test(text)) return true
  // "sim" accepts only the immediately preceding, still unfulfilled media offer.
  return !priorMedia && /^(?:sim|quero|pode|pode mandar|manda|claro|ok)[!.\s]*$/.test(text) &&
    /(?:quer|posso|gostaria).{0,60}(?:imagem|foto|desenho|pintura|ilustra|video)/.test(normalize(lastCharacter?.text))
}

export const allowImageGeneration = allowMediaRequest
