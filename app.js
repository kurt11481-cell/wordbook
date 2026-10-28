// 영어 단어장
// - 영어 정보: Free Dictionary API (무료, 가입 없음)
// - 한국어 뜻: 위키낱말사전(Wiktionary) 번역표. 없으면 MyMemory 자동 번역으로 대신한다.
// - 단어장은 이 기기의 브라우저(localStorage)에만 저장된다.

const DICT_URL = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const WIKI_URL = "https://en.wiktionary.org/w/api.php";
const TRANSLATE_URL = "https://api.mymemory.translated.net/get";
const STORAGE_KEY = "wordbook.v1";

// 화면에 보여 줄 품사 이름
const POS_KO = {
  noun: "명사",
  verb: "동사",
  adjective: "형용사",
  adverb: "부사",
  pronoun: "대명사",
  preposition: "전치사",
  conjunction: "접속사",
  interjection: "감탄사",
};

const form = document.getElementById("search-form");
const input = document.getElementById("word-input");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const listEl = document.getElementById("word-list");
const countEl = document.getElementById("word-count");

let current = null; // 지금 화면에 보이는 단어 정보

// ---------- 저장 ----------

function loadWords() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveWords(words) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(words));
  } catch {
    statusEl.textContent = "이 브라우저에서는 단어장을 저장할 수 없어요.";
  }
}

// 우선순위: 체크(외웠어요) 횟수가 적은 단어가 위로.
// 횟수가 같으면 오래전에 체크한(또는 체크한 적 없는) 단어가 위로.
function sortWords(words) {
  return words.sort(
    (a, b) => a.checks - b.checks || (a.lastChecked || 0) - (b.lastChecked || 0) || b.addedAt - a.addedAt
  );
}

// ---------- 사전 조회 ----------

// 무료 사전 서버가 가끔 실패해서, 연결 오류나 서버 오류(5xx)면 두 번까지 다시 시도한다.
async function fetchWithRetry(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url);
      if (res.status < 500 || i >= tries) return res;
    } catch (err) {
      if (i >= tries) throw err;
    }
    await new Promise((r) => setTimeout(r, 800 * i));
  }
}

async function fetchDictionary(word) {
  const res = await fetchWithRetry(DICT_URL + encodeURIComponent(word));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("사전 서버 오류 (" + res.status + ")");
  const entries = await res.json();

  // 여러 항목을 품사별로 합친다.
  const byPos = new Map();
  let phonetic = "";
  let audio = "";

  for (const entry of entries) {
    if (!phonetic) phonetic = entry.phonetic || "";
    for (const p of entry.phonetics || []) {
      if (!phonetic && p.text) phonetic = p.text;
      if (!audio && p.audio) audio = p.audio;
    }
    for (const m of entry.meanings || []) {
      const pos = byPos.get(m.partOfSpeech) || { name: m.partOfSpeech, defs: [], synonyms: new Set(), antonyms: new Set() };
      for (const d of m.definitions || []) {
        pos.defs.push({ text: d.definition, example: d.example || "" });
        (d.synonyms || []).forEach((s) => pos.synonyms.add(s));
        (d.antonyms || []).forEach((s) => pos.antonyms.add(s));
      }
      (m.synonyms || []).forEach((s) => pos.synonyms.add(s));
      (m.antonyms || []).forEach((s) => pos.antonyms.add(s));
      byPos.set(m.partOfSpeech, pos);
    }
  }

  const meanings = [...byPos.values()].map((p) => ({
    name: p.name,
    defs: p.defs.slice(0, 4),
    synonyms: [...p.synonyms].slice(0, 10),
    antonyms: [...p.antonyms].slice(0, 10),
  }));

  return { word: entries[0].word || word, phonetic, audio, meanings };
}

// 한국어 뜻 결과: { summary: "달리다, 뛰다, …", byPos: { verb: [{ gloss, words }] }, auto: 자동번역 여부 }
async function fetchKorean(word) {
  try {
    const [main, sub] = await Promise.all([fetchWikitext(word), fetchWikitext(word + "/translations")]);
    const rows = parseKoreanTranslations(main + "\n" + sub);
    if (rows.length) {
      const byPos = {};
      for (const r of rows) {
        const list = (byPos[r.pos] = byPos[r.pos] || []);
        // 같은 한국어 뜻이 여러 번 나오면 한 줄로 합친다 (예: quick → 빠르다 ×3)
        const same = list.find((x) => x.words.join() === r.words.join());
        if (same) same.gloss = [same.gloss, r.gloss].filter(Boolean).join("; ");
        else list.push({ gloss: r.gloss, words: r.words });
      }
      const summary = [...new Set(rows.flatMap((r) => r.words))].slice(0, 5).join(", ");
      return { summary, byPos, auto: false };
    }
  } catch {
    // 위키낱말사전이 안 되면 아래 자동 번역으로 넘어간다.
  }
  return { summary: await fetchMachineTranslation(word), byPos: {}, auto: true };
}

async function fetchWikitext(page) {
  const url = WIKI_URL + "?action=parse&prop=wikitext&format=json&formatversion=2&origin=*&page=" + encodeURIComponent(page);
  const res = await fetch(url);
  if (!res.ok) return "";
  const data = await res.json();
  return (data.parse && data.parse.wikitext) || ""; // 없는 문서면 빈 값
}

// 위키 문서의 English 부분에서 품사별 번역표의 "* Korean: {{t+|ko|단어}}" 줄을 찾는다.
function parseKoreanTranslations(text) {
  const rows = [];
  let inEnglish = false;
  let pos = "";
  let gloss = "";
  for (const line of text.split("\n")) {
    const lang = line.match(/^==\s*([^=]+?)\s*==\s*$/);
    if (lang) {
      inEnglish = lang[1] === "English";
      continue;
    }
    if (!inEnglish) continue;

    const heading = line.match(/^={3,5}\s*([A-Za-z ]+?)\s*={3,5}/);
    if (heading && POS_KO[heading[1].toLowerCase()]) {
      pos = heading[1].toLowerCase();
      continue;
    }

    // {{trans-top|뜻 설명}}: 이어지는 번역이 어떤 뜻인지
    const top = line.match(/\{\{trans-top(-see)?\|([^}]*)\}\}/);
    if (top) {
      gloss = top[1] ? "" : top[2].split("|").filter((p) => !p.includes("=")).pop() || "";
      continue;
    }

    if (pos && /^\*\s*Korean:/.test(line)) {
      const words = [...line.matchAll(/\{\{tt?\+?\|ko\|([^|}]+)/g)].map((m) => cleanKorean(m[1])).filter(Boolean);
      if (words.length) rows.push({ pos, gloss, words: [...new Set(words)] });
    }
  }
  return rows;
}

// "[[불]][[켜다]]" → "불켜다", "문제(問題)" → "문제"
function cleanKorean(s) {
  return s
    .replace(/\]\]\[\[-?/g, "")
    .replace(/\[\[|\]\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .trim();
}

async function fetchMachineTranslation(word) {
  try {
    const url = TRANSLATE_URL + "?q=" + encodeURIComponent(word) + "&langpair=en|ko";
    const res = await fetch(url);
    if (!res.ok) return "";
    const data = await res.json();
    return (data.responseData && data.responseData.translatedText) || "";
  } catch {
    return ""; // 번역이 실패해도 영어 정보는 보여 준다.
  }
}

// ---------- 발음 ----------

function speak(word, audioUrl) {
  if (audioUrl) {
    new Audio(audioUrl).play().catch(() => speakWithBrowser(word));
  } else {
    speakWithBrowser(word);
  }
}

// 사전에 녹음 파일이 없으면 브라우저 음성으로 읽는다.
function speakWithBrowser(word) {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(word);
  u.lang = "en-US";
  speechSynthesis.speak(u);
}

// ---------- 화면 그리기 ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(c));
  }
  return node;
}

function chips(label, items, anti) {
  if (!items.length) return null;
  return el(
    "div",
    { class: "chips" },
    el("span", { class: "label" }, label),
    ...items.map((s) => el("span", { class: anti ? "chip anti" : "chip" }, s))
  );
}

// 품사별 한국어 뜻 (뜻이 여러 개면 영어 설명을 옆에 작게 붙인다)
function koreanRows(rows) {
  if (!rows || !rows.length) return null;
  return el(
    "ul",
    { class: "ko-list" },
    ...rows.slice(0, 5).map((r) =>
      el("li", {}, r.words.join(", "), r.gloss ? el("span", { class: "muted small" }, "  " + r.gloss) : null)
    )
  );
}

function renderResult(info) {
  const saved = loadWords().some((w) => w.word === info.word);

  const card = el(
    "div",
    { class: "card" },
    el(
      "div",
      { class: "word-head" },
      el("span", { class: "word" }, info.word),
      info.phonetic ? el("span", { class: "phonetic" }, info.phonetic) : null,
      el("button", { class: "ghost", type: "button", onclick: () => speak(info.word, info.audio) }, "🔊 발음 듣기")
    ),
    info.korean
      ? el(
          "p",
          { class: "korean" },
          "한국어: " + info.korean,
          info.koreanAuto ? el("span", { class: "muted small" }, " (자동 번역, 부정확할 수 있어요)") : null
        )
      : null,
    ...info.meanings.map((m) =>
      el(
        "div",
        { class: "pos" },
        el("span", { class: "pos-name" }, (POS_KO[m.name] || m.name) + " (" + m.name + ")"),
        koreanRows((info.koreanByPos || {})[m.name]),
        el(
          "ol",
          {},
          ...m.defs.map((d) =>
            el("li", {}, d.text, d.example ? el("div", { class: "example" }, "예) " + d.example) : null)
          )
        ),
        chips("동의어", m.synonyms, false),
        chips("반의어", m.antonyms, true)
      )
    ),
    el(
      "div",
      { class: "actions" },
      saved
        ? el("span", { class: "muted" }, "이미 단어장에 있어요.")
        : el("button", { type: "button", onclick: () => addWord(info) }, "＋ 단어장에 저장")
    )
  );

  resultEl.replaceChildren(card);
  resultEl.hidden = false;
}

function renderList() {
  const words = sortWords(loadWords());
  countEl.textContent = words.length ? "(" + words.length + "개)" : "";

  if (!words.length) {
    listEl.replaceChildren(el("li", { class: "muted" }, "아직 저장한 단어가 없어요."));
    return;
  }

  listEl.replaceChildren(
    ...words.map((w) =>
      el(
        "li",
        {},
        el(
          "div",
          { class: "info", title: "눌러서 자세히 보기", onclick: () => showSaved(w) },
          el("div", { class: "w" }, w.word + (w.phonetic ? "  " + w.phonetic : "")),
          el("div", { class: "k" }, w.korean || ""),
          w.checks ? el("div", { class: "count" }, "외웠어요 " + w.checks + "번") : null
        ),
        el("button", { class: "ghost", type: "button", onclick: () => speak(w.word, w.audio) }, "🔊"),
        el("button", { type: "button", onclick: () => checkWord(w.word) }, "✔ 외웠어요"),
        el("button", { class: "ghost", type: "button", onclick: () => removeWord(w.word) }, "삭제")
      )
    )
  );
}

// ---------- 동작 ----------

async function search(word) {
  word = word.trim().toLowerCase();
  if (!word) return;

  statusEl.textContent = "찾는 중…";
  resultEl.hidden = true;

  try {
    const [found, korean] = await Promise.all([fetchDictionary(word), fetchKorean(word)]);
    let info = found;
    // 영어 사전에 없어도 위키낱말사전에 한국어 뜻이 있으면 그것만이라도 보여 준다.
    if (!info && korean.summary && !korean.auto) {
      info = { word, phonetic: "", audio: "", meanings: [] };
      statusEl.textContent = "영어 사전에는 없어서 한국어 뜻만 보여 드려요.";
    }
    if (!info) {
      statusEl.textContent = "'" + word + "'을(를) 사전에서 찾지 못했어요. 철자를 확인해 주세요.";
      return;
    }
    info.korean = korean.summary;
    info.koreanByPos = korean.byPos;
    info.koreanAuto = korean.auto;
    current = info;
    if (found) statusEl.textContent = "";
    renderResult(info);
  } catch (err) {
    statusEl.textContent = "인터넷 연결 또는 사전 서버 문제로 찾지 못했어요. (" + err.message + ")";
  }
}

function addWord(info) {
  const words = loadWords();
  if (!words.some((w) => w.word === info.word)) {
    words.push({ ...info, checks: 0, lastChecked: 0, addedAt: Date.now() });
    saveWords(words);
  }
  renderResult(info);
  renderList();
}

function checkWord(word) {
  const words = loadWords();
  const w = words.find((x) => x.word === word);
  if (!w) return;
  w.checks += 1;
  w.lastChecked = Date.now();
  saveWords(words);
  renderList();
}

function removeWord(word) {
  if (!confirm("'" + word + "'을(를) 단어장에서 지울까요?")) return;
  saveWords(loadWords().filter((w) => w.word !== word));
  renderList();
  if (current && current.word === word) renderResult(current);
}

// 저장된 단어는 인터넷 없이도 바로 보여 준다.
function showSaved(w) {
  current = w;
  statusEl.textContent = "";
  renderResult(w);
  resultEl.scrollIntoView({ behavior: "smooth" });
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  search(input.value);
});

renderList();
