import type { StockItem } from './model'

function normalize(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

const aliases: Record<string, string> = {
  'bubuk macchiato': 'maciato machiato',
  'sealer cup silen cup': 'silen seal',
  'yakult': 'yakul',
  'sp cream': 'sp crim sp krim',
}

function distance(a: string, b: string) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i])
  rows[0] = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1)
      }
    }
  }
  return rows[a.length][b.length]
}

function wordScore(term: string, word: string) {
  if (term === word) return 12
  if (word.startsWith(term)) return 9
  if (term.length > 2 && word.includes(term)) return 7
  const tolerance = term.length >= 7 ? 2 : term.length >= 3 ? 1 : 0
  if (!tolerance || Math.abs(term.length - word.length) > tolerance) return 0
  const edits = distance(term, word)
  return edits <= tolerance ? 5 - edits : 0
}

export function searchStock(items: StockItem[], input: string) {
  const query = normalize(input)
  if (!query) return []
  const terms = query.split(' ')
  return items.flatMap(item => {
    const name = normalize(item.name)
    const words = (name + ' ' + (aliases[name] ?? '')).trim().split(' ')
    const category = normalize(item.category_name).split(' ')
    const scores = terms.map(term => Math.max(
      ...words.map(word => wordScore(term, word)),
      ...category.map(word => Math.max(0, wordScore(term, word) - 2)),
    ))
    if (scores.some(score => score === 0)) return []
    const phraseBonus = name === query ? 50 : name.includes(query) ? 20 : 0
    return [{ item, score: phraseBonus + scores.reduce((sum, score) => sum + score, 0) }]
  }).sort((a, b) => b.score - a.score).map(result => result.item)
}
