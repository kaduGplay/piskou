export function mediaOfferMessage(selection, kind) {
  const affectionate =
    selection.relationship !== 'Confidente' &&
    selection.affection !== 'Discreta'
  const address = affectionate ? ', amor' : ''
  const resource =
    kind === 'video'
      ? 'Os vídeos ficam no plano Luxo'
      : 'As fotos ficam nos planos Premium e Luxo'
  if (selection.speechStyle === 'Direta' || selection.humor === 'Mais séria')
    return `Esse recurso é exclusivo para assinantes${address}. ${resource}. Você pode conferir as opções abaixo.`
  if (
    selection.personality === 'Divertida' ||
    selection.speechStyle === 'Bem-humorada'
  )
    return `Bateu a curiosidade${address}? Esse recurso é exclusivo para assinantes. ${resource}. Dá uma olhada nos planos abaixo 💕`
  if (
    selection.personality === 'Reservada' ||
    selection.speechStyle === 'Delicada'
  )
    return `Esse recurso é reservado para assinantes${address}. ${resource}. Se quiser, veja os planos aqui embaixo.`
  return `Para acessar esse recurso, você precisa de uma assinatura${address}. ${resource}. Veja abaixo qual combina com você 💕`
}
