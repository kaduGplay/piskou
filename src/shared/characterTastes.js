// Curated character configuration, never inferred from the visitor's tastes or appearance.
export const CHARACTER_TASTES = {
  musicTaste: {
    title: 'Gosto musical dela',
    options: [
      'Pelo perfil',
      'Rock',
      'Pop',
      'MPB',
      'Sertanejo',
      'Jazz',
      'Acústico',
    ],
  },
  filmTaste: {
    title: 'Cinema e histórias',
    options: [
      'Pelo perfil',
      'Mistério',
      'Comédia',
      'Drama',
      'Aventura',
      'Romance',
    ],
  },
  leisureTaste: {
    title: 'Interesse favorito',
    options: [
      'Pelo perfil',
      'Leitura',
      'Culinária',
      'Natureza',
      'Fotografia',
      'Jogos',
      'Dança',
    ],
  },
}
export function normalizeTasteSelection(selection) {
  return Object.fromEntries(
    Object.entries(CHARACTER_TASTES).flatMap(([key, setting]) =>
      setting.options.includes(selection[key]) &&
      selection[key] !== 'Pelo perfil'
        ? [[key, selection[key]]]
        : [],
    ),
  )
}
