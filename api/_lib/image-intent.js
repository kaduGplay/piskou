const normalize = (value) => String(value || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const mediaSubject = /\b(?:imagem|imagens|foto|fotos|fotinhas?|fotinhos?|selfies?|fotografia|desenho|pintura|ilustracao|retrato|paisagem|anime|video|videos)\b/

// A provider's media flag is only a proposal: the current user must request it.
export function allowMediaRequest(history, message) {
  const text = normalize(message)
  const lastCharacter = history.filter((m) => m.role === 'character' && !m.deleted && !m.contextInvalidated).at(-1)
  if (/\b(?:nao|pare de|para de|sem)\b.{0,40}\b(?:mand|envi|ger|cri|mostr|imagem|imagens|foto|fotos|fotinh|selfie|video|videos)/.test(text)) return false
  const request = /\b(?:manda|mande|mandar|envia|envie|enviar|mostra|mostre|mostrar|gera|gere|gerar|cria|crie|criar|faz|faca|fazer|desenha|desenhe|desenhar|quero|gostaria|trocar|troca|troque|trocamos|trocarmos)\b/
  if (/^(?:(?:uma?|umas?)\s+)?(?:fotos?|fotinhas?|fotinhos?|selfies?)\s+(?:sua|suas|de voce|de vc)\b/.test(text)) return true
  if (request.test(text) && mediaSubject.test(text) &&
      !/\b(?:falar|conversar|comentar|saber|entender)\b.{0,25}\b(?:sobre|das|dos|de)\b/.test(text)) return true
  if (/\b(?:quero|posso|deixa|gostaria de) (?:te ver|ver voce)\b/.test(text)) return true
  if (/\b(?:desenha|desenhe)\b/.test(text)) return true
  const priorMedia = lastCharacter?.media?.src || lastCharacter?.mediaRequest
  if (priorMedia && /^(?:me )?(?:manda|mande|envia|envie|gera|gere|faz|faca)\b.{0,25}\b(?:outra|outro|mais uma|mais um|novamente|de novo)\b/.test(text)) return true
  // "sim" accepts only the immediately preceding, still unfulfilled media offer.
  return !priorMedia && /^(?:sim|quero|pode|pode mandar|manda|claro|ok)[!.\s]*$/.test(text) &&
    (/(?:quer|posso|gostaria).{0,60}(?:imagem|foto|desenho|pintura|ilustra|video)/.test(normalize(lastCharacter?.text)) ||
      /\b(?:prato|comida|receita|desenho|pintura|paisagem)\b/.test(normalize(lastCharacter?.text)) && /(?:quer|gostaria).{0,20}ver/.test(normalize(lastCharacter?.text)))
}

export const allowImageGeneration = allowMediaRequest

export const requestsExplicitMedia = (message) => /\b(?:nudes?|pelad[ao]s?|nua?s?|sem roupa|sem calcinha|sem sutia)\b/.test(normalize(message))

// Generic requests in a character chat refer to the character. Explicit
// subjects and accepted offers (food, landscapes, drawings) remain images.
export function requestedMedia(history, message) {
  const text = normalize(message)
  const last = history.filter((m) => m.role === 'character' && !m.deleted && !m.contextInvalidated).at(-1)
  if (/\b(?:nao|sem|pare de|para de)\b.{0,40}(?:foto|fotinh|selfie|imagem|video|audio|voz|nude|pelad|mand[ae]|envi[ae])/.test(text)) return null
  if (/\b(?:falar|conversar|comentar|saber|entender)\b.{0,25}\b(?:sobre|das|dos|de)\b/.test(text)) return null
  const request = /\b(?:manda|mande|mandar|envia|envie|enviar|mostra|mostre|mostrar|gera|gere|gerar|cria|crie|criar|faz|faca|fazer|quero|gostaria|posso|desenha|desenhe|trocar|troca|troque|trocamos|trocarmos)\b/.test(text)
  const audio = request && /\b(?:audio|audios|voz)\b/.test(text)
  if (request && requestsExplicitMedia(message) && !audio) return /\bvideos?\b/.test(text) ? 'video' : 'photo'
  if (!audio && !allowMediaRequest(history, message)) return null
  if (audio) return 'audio'
  if (/\bvideos?\b/.test(text)) return 'video'
  if (mediaSubject.test(text) && /\b(?:sensua(?:l|is)|intimas?|provocantes?|trocar|troca|troque|trocamos|trocarmos)\b/.test(text)) return 'photo'
  const acceptance = /^(?:sim|quero|pode|pode mandar|manda|claro|ok)[!.\s]*$/.test(text)
  const subject = acceptance ? normalize(last?.text) : text
  if (/\b(?:de voce|de vc|de ti|fotos? suas?|fotinhas? suas?|fotinhos? suas?|imagens? suas?|sua foto|sua imagem|te ver|selfies?)\b/.test(subject)) return 'photo'
  // Time, pose and appearance describe the character's photo; they are not
  // another image subject ("foto de agora" must never become an image prompt).
  if (/\b(?:foto|imagem|retrato|fotografia)s?\s+(?:(?:atual|recente|nova)\s+)?(?:de|do|da|desse|deste)\s+(?:agora|agorinha|agr|hoje|hj|ontem|amanha|momento|dia|frente|perfil|costas|corpo(?: inteiro)?|rosto|cara|boca|olhos|cabelo|roupa|vestido|biquini|lingerie|pijama|casa|quarto|cama|verdade|como (?:voce|vc)|onde (?:voce|vc)|que (?:voce|vc))\b/.test(subject)) return 'photo'
  if (!acceptance && last && !last.media && !last.mediaRequest && /^(?:quero|manda|mande|envia|envie)\s+(?:uma\s+)?(?:imagem|foto)[!.\s🔥❤️💕]*$/u.test(text) && /\b(?:prato|comida|receita|paisagem|desenho|pintura)\b/.test(normalize(last.text)) && /(?:quer|gostaria).{0,20}ver/.test(normalize(last.text))) return 'image'
  if (/\b(?:sua|suas|seu|seus|voce|te ver|selfie)\b/.test(subject) && !/\b(?:prato|comida|receita|desenho|pintura|paisagem|cachorro|gato)\b/.test(subject)) return 'photo'
  if (/\b(?:desenha|desenhe|desenho|pintura|paisagem|prato|comida|receita|animal|cachorro|gato|montanha|flores)\b/.test(subject) || /\b(?:imagem|foto|retrato|ilustracao)\b.{0,20}\b(?:de|do|da|dos|das)\s+(?!voce\b|ti\b|si\b|sua\b|seu\b)\S+/.test(subject)) return 'image'
  if (last && !last.media && !last.mediaRequest && !acceptance && /^(?:quero|manda|mande|envia|envie)\s+(?:uma\s+)?(?:imagem|foto)[!.\s🔥❤️💕]*$/u.test(text) && /(?:quer|posso|gostaria).{0,60}(?:imagem|foto|desenho|pintura)/.test(normalize(last.text))) return requestedMedia([], 'quero ' + last.text)
  return 'photo'
}
