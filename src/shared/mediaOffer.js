export function mediaOfferMessage(selection, kind, preferences = {}) {
  const affectionate =
    preferences.nicknames === true &&
    preferences.flirt !== false &&
    selection.relationship !== 'Confidente' &&
    selection.affection !== 'Discreta'
  const address = affectionate ? ', amor' : ''
  const resource =
    kind === 'video'
      ? 'Os vídeos ficam no plano Luxo'
      : 'As fotos ficam nos planos Premium e Luxo'
  if (selection.speechStyle === 'Direta' || selection.humor === 'Mais séria')
    return `Esse recurso é exclusivo para quem tem o plano${address}. ${resource}. Você pode conferir as opções abaixo.`
  if (
    preferences.humor !== false &&
    (selection.personality === 'Divertida' ||
      selection.speechStyle === 'Bem-humorada')
  )
    return `Bateu a curiosidade${address}? Esse recurso é exclusivo para quem tem o plano. ${resource}. Dá uma olhada nos planos abaixo${preferences.emojis === false || preferences.flirt === false ? '' : ' 💕'}`
  if (
    selection.personality === 'Reservada' ||
    selection.speechStyle === 'Delicada'
  )
    return `Esse recurso é reservado para quem tem o plano${address}. ${resource}. Se quiser, veja os planos aqui embaixo.`
  return `Para acessar esse recurso, você precisa de um plano${address}. ${resource}. Veja abaixo qual combina com você${preferences.emojis === false || preferences.flirt === false ? '' : ' 💕'}`
}
