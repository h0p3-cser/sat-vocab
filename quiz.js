export const INDEX_MAX = 1107
export const REMOVAL_CORRECTS = 4
const BUCKET = 50

export function buckets() {
  const ranges = []
  let start = 1
  while (start <= INDEX_MAX) {
    let end = Math.min(start + BUCKET - 1, INDEX_MAX)
    const remainder = INDEX_MAX - end
    if (remainder > 0 && remainder < BUCKET) end = INDEX_MAX
    ranges.push([start, end])
    start = end + 1
  }
  return ranges
}

export function rangeTitle(start, end) {
  return `${start}–${end}`
}

export function reshuffle(words) {
  const copy = words.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function sample(words, start, end, count) {
  const pool = words.filter((word) => word.id >= start && word.id <= end)
  const take = Math.min(Math.max(count, 0), pool.length)
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return reshuffle(pool.slice(0, take))
}

export function optionsFor(word, bank) {
  const others = bank.filter((item) => item.id !== word.id && item.zh !== word.zh)
  const same = reshuffle(others.filter((item) => word.pos && item.pos === word.pos))
  const rest = reshuffle(others.filter((item) => !word.pos || item.pos !== word.pos))
  const picks = []
  const seen = new Set([word.zh])
  take(same, word.zh.length, picks, seen)
  if (picks.length < 4) take(rest, word.zh.length, picks, seen)
  const choices = picks.map((item) => ({ text: item.zh, correct: false }))
  choices.push({ text: word.zh, correct: true })
  return reshuffle(choices).map((choice, index) => ({ ...choice, id: index }))
}

function take(candidates, length, picks, seen) {
  const window = candidates.slice(0, 12)
  const ranked = window.slice().sort((a, b) => Math.abs(a.zh.length - length) - Math.abs(b.zh.length - length))
  for (const candidate of ranked.concat(candidates.slice(window.length))) {
    if (picks.length >= 4) return
    if (seen.has(candidate.zh)) continue
    seen.add(candidate.zh)
    picks.push(candidate)
  }
}

export function emptyProgress() {
  return { version: 1, totalAnswered: 0, totalCorrect: 0, words: {} }
}

export function record(progress, wordID, correct) {
  const next = {
    version: 1,
    totalAnswered: progress.totalAnswered + 1,
    totalCorrect: progress.totalCorrect + (correct ? 1 : 0),
    words: { ...progress.words },
  }
  const stat = {
    wrongCount: 0,
    correctSinceEntry: 0,
    inBook: false,
    ...(next.words[wordID] || {}),
  }
  if (correct) {
    if (stat.inBook) {
      stat.correctSinceEntry += 1
      if (stat.correctSinceEntry >= REMOVAL_CORRECTS) {
        stat.inBook = false
        stat.correctSinceEntry = 0
      }
    }
  } else {
    stat.wrongCount += 1
    if (!stat.inBook) {
      stat.inBook = true
      stat.correctSinceEntry = 0
    }
  }
  next.words[wordID] = stat
  return next
}

export function wrongGroups(progress) {
  return buckets()
    .map(([start, end]) => {
      const ids = Object.keys(progress.words)
        .map(Number)
        .filter((id) => {
          const stat = progress.words[id]
          return stat && stat.inBook && id >= start && id <= end
        })
        .sort((a, b) => a - b)
      return { start, end, ids }
    })
    .filter((group) => group.ids.length > 0)
}

export function accuracy(progress) {
  if (!progress.totalAnswered) return "还没有作答"
  const percent = Math.round((progress.totalCorrect / progress.totalAnswered) * 100)
  return `正确率 ${percent}%`
}
