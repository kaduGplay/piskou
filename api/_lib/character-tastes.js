import { normalizeTasteSelection } from '../../src/shared/characterTastes.js'
const MUSIC = {
  Rock: {
    artist: 'Pitty',
    reasons: ['guitarras marcantes', 'letras com personalidade'],
    nuance: 'Repetição sem variação costuma me prender menos.',
  },
  Pop: {
    artist: 'Dua Lipa',
    reasons: ['melodias claras', 'produção dançante'],
    nuance:
      'Um refrão forte não resolve sozinho uma letra sem desenvolvimento.',
  },
  MPB: {
    artist: 'Marisa Monte',
    reasons: ['letras expressivas', 'arranjos com detalhes'],
    nuance: 'Prefiro emoção construída a exagero só para impressionar.',
  },
  Sertanejo: {
    artist: 'Marília Mendonça',
    reasons: ['histórias nas letras', 'melodias fáceis de acompanhar'],
    nuance: 'Nem toda história romântica me toca do mesmo jeito.',
  },
  Jazz: {
    artist: 'Esperanza Spalding',
    reasons: ['variações de ritmo', 'arranjos que surpreendem'],
    nuance: 'Complexidade sem expressão não me prende tanto.',
  },
  Acústico: {
    artist: 'ANAVITÓRIA',
    reasons: ['arranjos suaves', 'voz e letra em destaque'],
    nuance: 'Uma música calma também precisa ter algo que me marque.',
  },
}
const DEFAULTS = {
  Brava: ['Rock', 'Mistério', 'Jogos'],
  Confiante: ['Rock', 'Drama', 'Fotografia'],
  Tímida: ['Acústico', 'Drama', 'Leitura'],
  Reservada: ['Jazz', 'Mistério', 'Leitura'],
  Tranquila: ['Acústico', 'Drama', 'Natureza'],
  Romântica: ['MPB', 'Romance', 'Culinária'],
  Divertida: ['Pop', 'Comédia', 'Jogos'],
  Brincalhona: ['Pop', 'Comédia', 'Dança'],
  Aventureira: ['Rock', 'Aventura', 'Natureza'],
  Intelectual: ['Jazz', 'Mistério', 'Leitura'],
  Amigável: ['MPB', 'Comédia', 'Culinária'],
}
export function preferenceConfiguration(selection) {
  return {
    personality: selection.personality,
    secondaryPersonality: selection.secondaryPersonality || 'Nenhum',
    ...normalizeTasteSelection(selection),
  }
}
export function buildCharacterPreferences(selection) {
  const explicit = normalizeTasteSelection(selection)
  const defaults = DEFAULTS[selection.personality] || [
    'MPB',
    'Drama',
    'Fotografia',
  ]
  const genre = explicit.musicTaste || defaults[0]
  return {
    version: 1,
    fictional: true,
    music: {
      preferred: genre,
      referenceArtist: MUSIC[genre].artist,
      reasons: MUSIC[genre].reasons,
      nuance: MUSIC[genre].nuance,
    },
    cinema: {
      preferred: explicit.filmTaste || defaults[1],
      reason:
        'Gosta de histórias com personagens e escolhas que sustentam a proposta, sem precisar gostar de toda obra do gênero.',
    },
    leisure: { preferred: explicit.leisureTaste || defaults[2] },
    provenance: Object.fromEntries(
      ['musicTaste', 'filmTaste', 'leisureTaste'].map((key) => [
        key,
        explicit[key] ? 'creator_selection' : 'character_profile_default',
      ]),
    ),
    unknownTopics:
      'Sem opinião estabelecida até haver informação suficiente. Artista de referência não implica conhecer todas as suas obras.',
  }
}
