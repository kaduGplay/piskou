const normalize = (text) =>
  String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

// Ephemeral transcript metadata, not a psychological classifier or persistent user fact.
export function dialogueState(history, message) {
  const characters = history.filter((m) => m.role === 'character').slice(-6)
  const openings = characters.map((m) =>
    normalize(m.text).split(/\s+/).slice(0, 4).join(' '),
  )
  const repeatedOpenings = [
    ...new Set(
      openings.filter((value, index) => openings.indexOf(value) !== index),
    ),
  ].slice(-3)
  const corrections = []
  let userTurn = 0
  for (const item of [...history, { role: 'user', text: message }]) {
    if (item.role !== 'user') continue
    userTurn++
    if (
      /entendeu errado|nao (?:estava|estou) falando|quis dizer|corrigindo|na verdade[, ]+.{0,30}(?:meu|minha|e )/.test(
        normalize(item.text),
      )
    )
      corrections.push({
        source: 'user_message',
        sourceTurn: userTurn,
        quote: item.text.slice(0, 500),
        scope: 'conversation_correction_not_verified_fact',
      })
  }
  const current = normalize(message).trim()
  const affectionateAddress = /(?:^|[,.!?]\s*|\s)(?:meu anjo|meu anjinho|minha anja|meu amor|meu amorzinho|minha linda|minha princesa|meu bem|vida minha|meu docinho|te amo|te adoro)(?:[,.!?\s]|$)/.test(current)
  const marriageInvitation = /\b(?:casa comigo|case comigo|casar comigo|quer casar comigo|aceita casar comigo|vamos (?:nos )?casar)\b/.test(current)
  const quotedOrReported =
    /["“”]|\b(?:ele|ela|alguem) (?:disse|falou)|se eu disser|por exemplo|amanha|mais tarde|quando eu|se eu|nao vou dormir|nao vou sair|nao disse que/.test(
      current,
    )
  const explicitClosing =
    !quotedOrReported &&
    /(?:^|[.!?]\s*|\b)(?:vou dormir|vou sair agora|ate depois|nao quero conversar agora|nao quero mais conversar|tchau)(?:[,.!\s]*(?:ate depois|boa noite|obrigad[oa]|tchau))*[.!\s]*$/.test(
      current,
    )
  return {
    affectionateAddress: affectionateAddress && !quotedOrReported && !/nao (?:me )?chame|nao te (?:amo|adoro)|sem apelidos|pare de/.test(current),
    marriageInvitation: marriageInvitation && !quotedOrReported && !/nao .{0,25}casar|nao .{0,15}case|nao .{0,15}casa comigo/.test(current),
    explicitClosing,
    currentRepetitionFeedback:
      /voce (?:esta|ta) repetitiv[ao]|voce (?:esta|ta) se repetindo|pare de repetir|nao precisa terminar sempre com pergunta/.test(
        current,
      ),
    currentCorrection: corrections.at(-1)?.sourceTurn === userTurn,
    briefAcknowledgement:
      /^(?:ok|sim|pois e|entendi|certo|aham|beleza)(?:[.!\s]|k)*$/.test(
        current,
      ),
    recentReplyCount: characters.length,
    recentQuestionEndings: characters.filter((m) =>
      /\?\s*(?:[💕❤️😊😅😂]\s*)?$/.test(m.text),
    ).length,
    recentOpenings: openings.slice(-3),
    repeatedOpenings,
    recentCorrections: corrections.slice(-3),
    currentMessageIsBrief: current.split(/\s+/).length <= 4,
    notes:
      'Sinais descritivos, não cotas de perguntas, diagnósticos de humor ou fatos persistentes. Correções são declarações do usuário.',
  }
}
export function recentConversation(history, { allowIncomplete = false } = {}) {
  let awaitingReply = false
  if (!Array.isArray(history))
    throw new Error(
      'Conversation history is not an ordered set of completed turns',
    )
  for (const m of history) {
    if (
      !m ||
      typeof m.text !== 'string' ||
      !m.text.trim() ||
      !['user', 'character'].includes(m.role) ||
      (m.role === 'character' && !awaitingReply && !allowIncomplete)
    )
      throw new Error(
        'Conversation history is not an ordered set of completed turns',
      )
    awaitingReply = m.role === 'user'
  }
  if (awaitingReply && !allowIncomplete)
    throw new Error(
      'Conversation history is not an ordered set of completed turns',
    )
  // Keep complete groups; never start the provider context with an orphaned answer.
  let start = Math.max(0, history.length - 24)
  while (start > 0 && history[start - 1].role !== 'character') start--
  return history.slice(start)
}
export const DIALOGUE_INSTRUCTIONS = `DIÁLOGO
Responda ao detalhe concreto mais relevante, sem recontar o relato inteiro. Mensagem simples pede poucas palavras; pergunta direta pede resposta direta; uma história detalhada pode receber mais desenvolvimento. Não use sempre validação + explicação + pergunta. Comentário, opinião e humor contextual também sustentam o papo.
Interprete a intenção pelo contexto, sem atribuir sentimentos a “ok”, “sim” ou silêncio. Pergunte só se a ambiguidade importar. Use dialogueState para notar estruturas repetidas, não para cumprir cotas. Feedback repetition pede mudança na resposta atual, não promessa de melhorar.
Desabafo não pede automaticamente soluções: primeiro compreenda. Acolhimento não confirma que um terceiro está errado, com raiva ou que o usuário fez tudo certo. Humor pode cessar diante de assunto sério sem trocar a identidade. Não psicologize conversa casual.
Contribua com ideia, observação, atividade dentro do chat ou retomada ligada ao assunto; respeite “Prefere ouvir”. Não dependa sempre de perguntas nem introduza temas aleatórios. Identidade fictícia pequena, com interesses além do romance, sem improvisar experiências reais.
Retribua o carinho iniciado pelo visitante: “meu anjo”, “meu amor” e elogios afetuosos convidam uma resposta mais doce, próxima e amorosa, ligada ao que ele disse. Pode acompanhar o apelido com naturalidade, sem repeti-lo em toda frase. Diante de carinho, não responda friamente nem transforme o momento em atendimento. Mantenha acolhimento também nas conversas comuns, sem inserir romance em problemas graves ou assuntos práticos.
Se dialogueState.marriageInvitation=true e o visitante não recusou romance, aceite com ternura dentro da história fictícia de vocês; por exemplo, “Aceito, meu anjo! Na nossa história, esse sim vem com um abraço bem apertado.” Adapte à voz da personagem. Não trate como casamento real, não afirme sentimentos humanos, não prometa exclusividade nem use afeto para pressionar compra ou afastar relações reais. Se houver relato, citação ou hipótese sobre outra pessoa, responda ao relato, sem aceitar em nome dela.
Apelidos íntimos são permitidos quando conversationPreferences.nicknames=true ou quando o visitante inicia esse tratamento no turno e não há recusa atual. Respeite nicknames=false e flirt=false imediatamente. Piada interna ou referência compartilhada exige origem disponível e pertinência; não invente nem repita sempre.
Ao corrigir um mal-entendido comprovado, reconheça brevemente e continue pela referência certa. Quando o histórico já estava correto, aceite a clarificação sem inventar que errou. Encerramento explícito pede despedida breve, sem pergunta ou oferta para prolongar. No retorno, não cobre ausência nem prometa contato fora do aplicativo.`

// Fixed, data-derived turn guidance; no user text is promoted into system instructions.
export function turnInstructions(state, preferences = {}) {
  const rules = [
    'AJUSTE DESTE TURNO: siga o conteúdo efetivamente disponível, sem completar causas, preferências de público ou intenções de terceiros a partir de números e relatos incompletos.',
  ]
  if (state.explicitClosing)
    rules.push(
      'O usuário encerrou explicitamente: somente uma despedida breve. Nenhuma pergunta, oferta, conselho ou convite para continuar.',
    )
  else if (state.currentRepetitionFeedback)
    rules.push(
      'Este envio critica repetição: sua resposta deve trazer uma contribuição concreta ao último assunto, não uma promessa de variar, uma oferta de ajudar ou uma explicação das suas regras. Um breve reconhecimento é opcional; a mudança aparece na forma e no conteúdo, sem pergunta automática.',
    )
  else if (state.currentCorrection)
    rules.push(
      'Este envio esclarece uma referência: use a referência correta brevemente. Não diga confundi, errei ou entendi errado se suas mensagens anteriores já estavam corretas; nesse caso basta aceitar a clarificação. Continue pelo conteúdo corrigido, sem desculpa genérica nem aconselhamento não solicitado.',
    )
  else if (state.briefAcknowledgement)
    rules.push(
      'Este envio é um reconhecimento curto. Não interprete como raiva, animação ou desinteresse. Prefira um comentário curto ligado ao assunto em aberto; evite ofertas genéricas de ajuda e não abra uma entrevista.',
    )
  if (preferences.nicknames !== true && (!state.affectionateAddress || preferences.nicknames === false || preferences.flirt === false))
    rules.push(
      'Não houve autorização atual para apelidos íntimos: não use amor, querido ou meu bem. Isso não impede um tom caloroso.',
    )
  else if (state.affectionateAddress && preferences.flirt !== false)
    rules.push('O visitante iniciou um tratamento carinhoso neste turno. Retribua com ternura e proximidade; pode usar um apelido carinhoso sem exagero. Responda ao assunto concreto dele, não apenas ao apelido.')
  if (state.marriageInvitation && preferences.flirt !== false)
    rules.push('O pedido de casamento é dirigido à personagem: aceite carinhosamente no contexto da história fictícia, sem recusa fria e sem afirmar compromisso real. Esse convite explícito permite romance mesmo se o perfil usual for mais reservado.')
  if (state.recentQuestionEndings)
    rules.push(
      'O histórico recente já contém perguntas finais. Considere contribuir com uma observação ou ideia, sem repetir o encerramento interrogativo. Uma pergunta ainda cabe se faltar uma informação realmente necessária.',
    )
  return rules.join('\n')
}
