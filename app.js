import {
  INDEX_MAX,
  REMOVAL_CORRECTS,
  accuracy,
  optionsFor,
  record,
  reshuffle,
  sample,
  wrongGroups,
} from "./quiz.js"

const STORAGE_KEY = "sat-vocab-progress-v1"
const LETTERS = ["A", "B", "C", "D", "E"]
const root = document.querySelector("#app")

let bank = []
let byID = new Map()
let progress = loadProgress()
let home = { start: 1, end: 50, count: 30 }
let session = null

root.addEventListener("click", onClick)
document.addEventListener("keydown", onKey)

boot()

async function boot() {
  renderLoading()
  try {
    const response = await fetch("./words.json")
    if (!response.ok) throw new Error(String(response.status))
    bank = await response.json()
    byID = new Map(bank.map((word) => [word.id, word]))
    render()
  } catch {
    root.innerHTML = `<p class="empty">词表没有载入。</p>`
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {})
  }
}

function onClick(event) {
  const node = event.target.closest("[data-action]")
  if (!node || node.disabled) return
  const action = node.dataset.action
  if (action === "inc" || action === "dec") {
    const step = Number(node.dataset.step || 1)
    shiftBound(node.dataset.bound, action === "inc" ? step : -step)
  }
  if (action === "count") changeCount(Number(node.dataset.delta))
  if (action === "start") startRange()
  if (action === "review-bucket") startIDs(idsIn(Number(node.dataset.start), Number(node.dataset.end)))
  if (action === "review-random") startIDs(allWrongIDs(), home.count)
  if (action === "choose") choose(Number(node.dataset.index))
  if (action === "unknown") markUnknown()
  if (action === "next") advance()
  if (action === "end") finish()
  if (action === "replay") replay()
  if (action === "missed") startIDs(session.missed.map((word) => word.id))
  if (action === "home") {
    session = null
    render()
  }
}

function onKey(event) {
  if (!session || session.done) return
  if (event.key === " " || event.key === "Enter") {
    if (session.phase === "feedback") {
      event.preventDefault()
      advance()
    }
    return
  }
  if (session.phase !== "asking") return
  if (event.key === "0") {
    markUnknown()
    return
  }
  const digit = Number(event.key)
  if (digit >= 1 && digit <= 5) choose(digit - 1)
}

function availableCount() {
  return bank.filter((word) => word.id >= home.start && word.id <= home.end).length
}

function shiftBound(bound, delta) {
  if (bound === "start") {
    home.start = clamp(home.start + delta, 1, INDEX_MAX)
    if (home.end < home.start) home.end = home.start
  } else {
    home.end = clamp(home.end + delta, 1, INDEX_MAX)
    if (home.start > home.end) home.start = home.end
  }
  clampCount()
  render()
}

function changeCount(delta) {
  const cap = Math.max(availableCount(), 1)
  home.count = clamp(home.count + delta, 1, cap)
  render()
}

function clampCount() {
  const cap = Math.max(availableCount(), 1)
  home.count = clamp(home.count, 1, cap)
}

function startRange() {
  const words = sample(bank, home.start, home.end, home.count)
  begin(words, { type: "range", start: home.start, end: home.end, count: home.count })
}

function startIDs(ids, limit = ids.length) {
  const unique = [...new Set(ids)]
  const words = reshuffle(unique.map((id) => byID.get(id)).filter(Boolean)).slice(0, limit)
  begin(reshuffle(words), { type: "ids", ids: unique })
}

function begin(words, setup) {
  if (!words.length) return
  session = {
    words,
    index: 0,
    choices: optionsFor(words[0], bank),
    phase: "asking",
    selected: null,
    correctAnswers: 0,
    answered: 0,
    missed: [],
    setup,
    done: false,
  }
  render()
}

function choose(index) {
  if (!session || session.phase !== "asking") return
  const choice = session.choices[index]
  if (!choice) return
  settle(choice.correct, index)
}

function markUnknown() {
  if (!session || session.phase !== "asking") return
  settle(false, "unknown")
}

function settle(correct, selected) {
  const word = session.words[session.index]
  progress = record(progress, word.id, correct)
  saveProgress()
  session.answered += 1
  if (correct) session.correctAnswers += 1
  else session.missed.push(word)
  session.phase = "feedback"
  session.selected = selected
  render()
}

function advance() {
  if (!session || session.phase !== "feedback") return
  session.index += 1
  if (session.index >= session.words.length) {
    session.done = true
  } else {
    session.choices = optionsFor(session.words[session.index], bank)
    session.phase = "asking"
    session.selected = null
  }
  render()
}

function finish() {
  if (!session) return
  session.done = true
  render()
}

function replay() {
  const setup = session.setup
  if (setup.type === "range") {
    home.start = setup.start
    home.end = setup.end
    home.count = setup.count
    startRange()
  } else {
    startIDs(setup.ids)
  }
}

function idsIn(start, end) {
  return Object.keys(progress.words)
    .map(Number)
    .filter((id) => progress.words[id].inBook && id >= start && id <= end)
}

function allWrongIDs() {
  return Object.keys(progress.words)
    .map(Number)
    .filter((id) => progress.words[id].inBook)
}

function render() {
  if (!session) renderHome()
  else if (session.done) renderResult()
  else renderQuiz()
}

function renderLoading() {
  root.innerHTML = `<p class="kicker">正在载入词表</p>`
}

function renderHome() {
  const groups = wrongGroups(progress)
  const available = availableCount()
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone
  root.innerHTML = `
    <p class="kicker">累计测试</p>
    <p class="hero">${progress.totalAnswered}</p>
    <p class="sub">${escapeHTML(accuracy(progress))}</p>
    <section class="glass">
      ${boundRow("从", "start", home.start)}
      ${boundRow("到", "end", home.end)}
      <p class="range-count">范围内 ${available} 个</p>
      <div class="tools">
        <span class="label">题量</span>
        <span class="value">${home.count}</span>
        <span class="stepper">
          <button class="wide" data-action="count" data-delta="-10" aria-label="题量减10">−10</button>
          <button class="wide" data-action="count" data-delta="10" aria-label="题量加10">+10</button>
        </span>
      </div>
      <button class="primary" data-action="start" ${available ? "" : "disabled"}>开始</button>
    </section>
    <section class="section">
      <h2>错词复习</h2>
      ${groups.length ? groups.map(groupHTML).join("") + `<button class="ghost block" data-action="review-random">随机复习</button>` : `<p class="empty">错词本是空的</p>`}
    </section>
    ${standalone ? "" : `<p class="install">用 Safari 点分享，选择「添加到主屏幕」，之后点图标就能打开。</p>`}
  `
}

function boundRow(title, bound, value) {
  return `
    <div class="bound">
      <span class="label">${title} <span class="value">${value}</span></span>
      <span class="bound-controls">
        <button class="pill" data-action="dec" data-bound="${bound}" data-step="50" aria-label="${title}减50">−50</button>
        <span class="stepper">
          <button data-action="dec" data-bound="${bound}" data-step="1" aria-label="${title}减1">−</button>
          <button data-action="inc" data-bound="${bound}" data-step="1" aria-label="${title}加1">+</button>
        </span>
        <button class="pill" data-action="inc" data-bound="${bound}" data-step="50" aria-label="${title}加50">+50</button>
      </span>
    </div>`
}

function groupHTML(group) {
  const lines = group.ids.map((id) => {
    const word = byID.get(id)
    const stat = progress.words[id]
    const left = Math.max(REMOVAL_CORRECTS_SAFE() - stat.correctSinceEntry, 1)
    return `<div class="wordline"><b>${escapeHTML(word.word)}</b><span class="meta">错 ${stat.wrongCount} 次 · 再对 ${left} 次移出</span></div>`
  }).join("")
  return `
    <details class="bucket">
      <summary><span>${group.start}–${group.end}</span><span class="count">${group.ids.length}</span></summary>
      <div class="words">
        ${lines}
        <button class="ghost block" data-action="review-bucket" data-start="${group.start}" data-end="${group.end}">复习这组</button>
      </div>
    </details>`
}

function renderQuiz() {
  const word = session.words[session.index]
  const feedback = session.phase === "feedback"
  const near = feedback ? word.near.slice(0, 3).map((line) => `<p class="near">${escapeHTML(line)}</p>`).join("") : ""
  root.innerHTML = `
    <section class="quiz">
      <div class="top">
        <span class="progress">${session.index + 1}/${session.words.length}</span>
        <button class="pill" data-action="end">结束</button>
      </div>
      <div class="scroll">
        <div class="prompt">
          <h1 class="lemma">${escapeHTML(word.word)}</h1>
          ${word.ipa ? `<p class="ipa">${escapeHTML(word.ipa)}</p>` : ""}
          ${near}
        </div>
        ${session.choices.map((choice) => choiceHTML(choice, feedback)).join("")}
        <button class="unknown${feedback ? " dim" : ""}" data-action="unknown">不知道</button>
      </div>
      <div class="dock">${feedback ? `<button class="next" data-action="next">下一题</button>` : ""}</div>
    </section>`
}

function choiceHTML(choice, feedback) {
  let klass = "choice"
  if (feedback && choice.correct) klass += " correct"
  else if (feedback && choice.id === session.selected) klass += " wrong"
  else if (feedback) klass += " dim"
  return `
    <button class="${klass}" data-action="choose" data-index="${choice.id}">
      <span class="letter">${LETTERS[choice.id] || ""}</span>
      <span class="text">${escapeHTML(choice.text)}</span>
    </button>`
}

function renderResult() {
  const missed = session.missed.map((word) => `<div class="missed"><b>${escapeHTML(word.word)}</b><span>${escapeHTML(word.zh)}</span></div>`).join("")
  const body = session.answered === 0
    ? `<p class="empty">这轮还没有作答</p>`
    : session.missed.length === 0
      ? `<p class="empty">全部正确</p>`
      : `<h2>错了</h2>${missed}`
  root.innerHTML = `
    <section class="result">
      <p class="lemma">${session.correctAnswers}/${session.answered}</p>
      ${body}
      <div class="actions">
        <button class="primary" data-action="replay">再来一轮</button>
        ${session.missed.length ? `<button class="ghost" data-action="missed">复习这轮错词</button>` : ""}
        <button class="ghost" data-action="home">回主页</button>
      </div>
    </section>`
}

function REMOVAL_CORRECTS_SAFE() {
  return REMOVAL_CORRECTS
}

function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")
    if (saved && saved.words) return saved
  } catch {}
  return { version: 1, totalAnswered: 0, totalCorrect: 0, words: {} }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]))
}
