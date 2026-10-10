const RELATIONSHIP_COPY = {
  Namorada: {
    greeting: 'Oi, amor! 💕 Você chegou e eu já fiquei sorrindo aqui.',
    photo: 'Olha, amor… escolhi essa foto para você 💕 O que achou?',
  },
  Amante: {
    greeting:
      'Oi, meu bem 💕 Gosto desse friozinho na barriga de começar uma conversa com você.',
    photo: 'Meu bem, separei essa foto para o nosso momento 💕 Gostou?',
  },
  Confidente: {
    greeting: 'Oi! Que bom que você veio 💜 Pode ficar à vontade comigo.',
    photo: 'Quero compartilhar um pouquinho de mim com você 💜 Olha essa foto.',
  },
  Parceira: {
    greeting:
      'Oi, meu bem! 💕 Adoro quando a gente tem um tempo para conversar.',
    photo: 'Meu bem, olha a foto que escolhi para compartilhar com você 💕',
  },
}

const PERSONALITY_QUESTIONS = {
  Carinhosa:
    'Se eu pudesse escolher, a gente passava um tempinho juntinho agora. Como você está?',
  Confiante: 'Quero saber mais de você. O que deixou seu dia melhor hoje?',
  Misteriosa: 'Me conta uma coisa sobre você que pouca gente sabe?',
  Divertida: 'Me conta: seu dia merece um abraço ou uma boa risada? 😊',
  Sedutora:
    'Confesso: fiquei curiosa para descobrir seu jeito de me conquistar. Você é mais de um elogio ou de um convite para sair?',
  Reservada: 'Vamos nos conhecer com calma? Como foi seu dia?',
}

// Prévia roteirizada: varia com a personagem e com o assunto, sem chamada a um modelo de IA.
export function conversationReply(selection, message, turn) {
  const copy =
    RELATIONSHIP_COPY[selection.relationship] || RELATIONSHIP_COPY.Namorada
  const text = message
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  if (turn === 0) {
    const answer = /tudo bem|como (voce|vc|ce) (esta|ta|vai)/.test(text)
      ? 'Estou bem, e fiquei feliz com a sua mensagem. '
      : ''
    return `${copy.greeting} ${answer}${PERSONALITY_QUESTIONS[selection.personality] || PERSONALITY_QUESTIONS.Carinhosa}`
  }
  const answer = /\b(triste|cansad[oa]|dificil|ruim|mal)\b/.test(text)
    ? 'Espero que esse nosso momento deixe seu dia um pouco mais leve. '
    : /\b(bem|bom|otim[oa]|feliz|melhor)\b/.test(text)
      ? 'Que bom saber disso! Adorei conversar com você. '
      : 'Você me deixou curiosa… quero conhecer mais desse seu jeito. '
  return `${answer}${copy.photo}`
}
