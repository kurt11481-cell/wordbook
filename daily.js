// 오늘의 회화 표현: 날짜마다 EXPRESSIONS(expressions.js)에서 하나씩 보여 준다.
// - 같은 날이면 누구에게나 같은 표현이 나온다.
// - 한국어 해석은 가려 두고, 눌러야 보인다.
// - ◀ ▶ 로 지난 표현·다음 표현도 볼 수 있다.

const DAILY_START = new Date(2026, 9, 28); // 2026-10-28 = 1번째 표현
const dailyEl = document.getElementById("daily");

let dailyOffset = 0; // 0 = 오늘, -1 = 어제 ...
let dailyRevealed = false;

function dayNumber(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((d - DAILY_START) / 86400000);
}

function expressionFor(offset) {
  const n = dayNumber(new Date()) + offset;
  const len = EXPRESSIONS.length;
  return EXPRESSIONS[((n % len) + len) % len];
}

function dailyLabel(offset) {
  if (offset === 0) return "오늘의 회화 표현";
  if (offset === -1) return "어제의 표현";
  if (offset === 1) return "내일의 표현";
  return (offset < 0 ? -offset + "일 전" : offset + "일 후") + " 표현";
}

function moveDaily(step) {
  dailyOffset += step;
  dailyRevealed = false;
  renderDaily();
}

function renderDaily() {
  const e = expressionFor(dailyOffset);

  dailyEl.replaceChildren(
    el(
      "div",
      { class: "daily-head" },
      el("button", { class: "ghost nav", type: "button", title: "이전 표현", onclick: () => moveDaily(-1) }, "◀"),
      el(
        "span",
        { class: "daily-label" },
        dailyLabel(dailyOffset),
        dailyOffset !== 0
          ? el("button", { class: "link", type: "button", onclick: () => moveDaily(-dailyOffset) }, " 오늘로")
          : null
      ),
      el("button", { class: "ghost nav", type: "button", title: "다음 표현", onclick: () => moveDaily(1) }, "▶")
    ),
    el(
      "div",
      { class: "daily-en" },
      e.en,
      " ",
      el("button", { class: "ghost", type: "button", onclick: () => speakWithBrowser(e.en) }, "🔊")
    ),
    el(
      "div",
      { class: "dialogue" },
      ...e.ex.map((line, i) =>
        el(
          "div",
          { class: "line" },
          el("span", {}, line, " "),
          el("button", { class: "ghost tiny", type: "button", title: "듣기", onclick: () => speakWithBrowser(line.replace(/^[AB]:\s*/, "")) }, "🔊"),
          dailyRevealed ? el("div", { class: "muted small" }, e.exKo[i]) : null
        )
      )
    ),
    dailyRevealed ? el("div", { class: "daily-ko" }, "뜻: " + e.ko) : null,
    el(
      "button",
      { type: "button", class: dailyRevealed ? "reveal ghost" : "reveal", onclick: () => ((dailyRevealed = !dailyRevealed), renderDaily()) },
      dailyRevealed ? "해석 접기 👆" : "해석 보기 👆"
    )
  );
}

renderDaily();
