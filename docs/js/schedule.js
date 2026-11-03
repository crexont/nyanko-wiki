// 일정 — 게임 서버 이벤트 데이터(스테이지·뽑기·아이템). tools/schedule.py 가 만든 JSON을
// GitHub Actions가 schedule-data 브랜치에 올리고, 사이트는 그걸 읽는다 (로컬 미리보기는 data/schedule.json).
import { GD, BYID, esc, icon } from "./common.js";
import { loadIndex } from "./stage.js";

const LOCAL = /^(localhost|127\.|\[::1\])/.test(location.hostname);
const SRC = LOCAL ? "data/schedule.json" : "https://raw.githubusercontent.com/crexont/nyanko-wiki/schedule-data/schedule.json";
let dataPromise, setsPromise;
const loadSchedule = () => dataPromise ??= fetch(SRC, { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
const loadSets = () => setsPromise ??= fetch("data/gatya_sets.json").then(r => r.json());

const DAY = 864e5;
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];  // 요일 비트: 1 = 일요일 … 64 = 토요일
const KST = 9 * 36e5;
const kst = t => new Date(t + KST);  // UTC 함수로 읽으면 한국 시각
const hm = n => `${String(Math.floor(n / 100)).padStart(2, "0")}:${String(n % 100).padStart(2, "0")}`;
function fmt(iso) {
  if (!iso) return "";
  const d = kst(Date.parse(iso));
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEK[d.getUTCDay()]}) ${hm(d.getUTCHours() * 100 + d.getUTCMinutes())}`;
}
const period = e => `${fmt(e.start)} ~ ${e.end ? fmt(e.end) : "계속"}`;
const gameVer = v => { const [a, b, c] = v.split(".").map(Number); return a * 10000 + b * 100 + c; };

// 기간이 1년 넘게 열려 있으면 상시 (요일 스테이지·로그인 보너스 등)
const regular = e => !e.end || Date.parse(e.end) - Date.parse(e.start || "2000-01-01") >= 365 * DAY;

// 요일·날짜·시간 조건을 글로
function ruleText(r) {
  const out = [];
  if (r.date) {
    const [sd, st, ed, et] = r.date;
    out.push(`${Math.floor(sd / 100)}/${sd % 100} ${hm(st)} ~ ${Math.floor(ed / 100)}/${ed % 100} ${hm(et)}`);
  }
  if (r.days) out.push(`매월 ${r.days.join("·")}일`);
  if (r.week) out.push(`매주 ${WEEK.filter((_, i) => r.week & (1 << i)).join("·")}`);
  if (r.times && !(r.times.length === 1 && r.times[0][0] === 0 && r.times[0][1] >= 2400))
    out.push(r.times.map(([a, b]) => `${hm(a)}~${hm(b)}`).join(", "));
  return out.join(" ");
}

// 지금 열려 있는지 (기간 + 조건 중 하나라도 맞으면)
function openNow(e, now) {
  if (e.start && now < Date.parse(e.start)) return false;
  if (e.end && now >= Date.parse(e.end)) return false;
  if (!e.rules) return true;
  const d = kst(now), md = (d.getUTCMonth() + 1) * 100 + d.getUTCDate(), t = d.getUTCHours() * 100 + d.getUTCMinutes();
  return e.rules.some(r => {
    if (r.date) {
      const [sd, st, ed, et] = r.date, a = sd * 1e4 + st, b = ed * 1e4 + et, x = md * 1e4 + t;
      if (a <= b ? x < a || x >= b : x < a && x >= b) return false;
    }
    if (r.days && !r.days.includes(d.getUTCDate())) return false;
    if (r.week && !(r.week & (1 << d.getUTCDay()))) return false;
    if (r.times && !r.times.some(([a, b]) => a <= t && t < b)) return false;
    return true;
  });
}

const ui = { show: "now", regular: false };

export function renderSchedule(root) {
  root.innerHTML = `
    <p class="crumb"><a href="#/">냥코위키</a><i>/</i><span>일정</span></p>
    <div class="page-head"><div><h1>일정</h1><p>게임 서버의 이벤트 데이터로 만든 스테이지·뽑기·이벤트 일정이에요. 시각은 한국 시간.</p></div></div>
    <div class="filters"><div class="row" id="scTabs"></div></div>
    <p class="meta" id="scMeta"></p>
    <div id="scBody"><div class="empty">불러오는 중…</div></div>`;
  Promise.all([loadSchedule(), loadIndex(), loadSets().catch(() => ({ sets: [], pick: {} }))]).then(([data, idx, sets]) => {
    const maps = new Map(idx.categories.flatMap(c => c.maps.map(([mid, name]) => [mid, { name, cat: c.name }])));
    const fetched = Date.parse(data.fetchedAt);
    const mins = Math.max(0, Math.round((Date.now() - fetched) / 6e4));
    root.querySelector("#scMeta").textContent = `${mins < 60 ? `${mins}분` : `${Math.round(mins / 60)}시간`} 전 갱신 · 서버 게임 버전 ${data.gameVersion}`;
    const draw = () => {
      const now = Date.now();
      const tabs = [["now", "진행 중"], ["soon", "예정"], ["all", "전부"]];
      root.querySelector("#scTabs").innerHTML = tabs.map(([k, l]) => `<button class="chip" data-show="${k}" aria-pressed="${ui.show === k}">${l}</button>`).join("")
        + `<button class="chip" data-reg aria-pressed="${ui.regular}">상시 이벤트 포함</button>`;
      const pick = e => (ui.regular || !regular(e)) && (ui.show === "all"
        || (ui.show === "now" ? !e.start || Date.parse(e.start) <= now : Date.parse(e.start) > now));
      const body = [gatyaPanel(data.gatya.filter(pick), sets, data), stagePanel(data.sale.filter(pick), maps, now), itemPanel(data.item.filter(pick))].join("");
      root.querySelector("#scBody").innerHTML = body || `<div class="empty">해당하는 일정이 없어요.</div>`;
      root.querySelectorAll("[data-show]").forEach(b => b.onclick = () => { ui.show = b.dataset.show; draw(); });
      root.querySelector("[data-reg]").onclick = () => { ui.regular = !ui.regular; draw(); };
    };
    draw();
  }).catch(() => { root.querySelector("#scBody").innerHTML = `<div class="empty">일정 데이터를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.</div>`; });
  return null;
}

// ---- 뽑기 ----
const GATYA_KIND = { rare: "레어 뽑기", normal: "노말 뽑기", collab: "이벤트 뽑기" };
// 배너 문구 앞의 "★확률, 상세 내용은 배너를 클릭!★" 같은 안내는 뺀다
const cleanMsg = m => m.replace(/^★확률[^★]*★/, "").replace(/★/g, " ★ ").replace(/\s+/g, " ").trim();

function gatyaPanel(list, sets, data) {
  // 같은 세트가 여러 줄(배너 칸)에 나오면 하나로 합치고 기간은 가장 이른 시작 ~ 가장 늦은 끝
  const by = new Map();
  for (const e of list) for (const s of e.sets) {
    if (s.id < 0 || (!s.msg && e.kind !== "rare")) continue;
    const key = `${e.kind}:${s.id}`, cur = by.get(key);
    if (!cur) by.set(key, { ...e, set: s });
    else {
      if (e.start < cur.start) cur.start = e.start;
      if (!e.end || (cur.end && e.end > cur.end)) cur.end = e.end;
    }
  }
  const rows = [...by.values()].sort((a, b) => (a.end || "9") < (b.end || "9") ? -1 : 1);
  if (!rows.length) return "";
  const builtFor = gameVer(GD.builtFor || GD.version);
  return `<div class="panel"><h2>뽑기 <span class="ctl">${rows.length}개</span></h2><div class="sc-list">${rows.map(e => {
    // 레어 뽑기 세트의 캐릭: 우리 데이터보다 새 버전 이벤트면 세트 내용이 아직 비어 있을 수 있어서 안 보여준다
    // 대표 캐릭(배너 옵션의 CharaID)을 맨 앞에. 콜라보 캐릭은 세트 목록에 없고 대표 캐릭으로만 나오기도 한다
    const ok = e.kind === "rare" && e.minVer <= builtFor;
    const feat = ok ? BYID.get(sets.pick[e.set.id]) : null;
    const cats = (ok ? sets.sets[e.set.id] || [] : []).map(id => BYID.get(id)).filter(c => c && c !== feat);
    const top = cats.filter(c => c.rarity >= 4);
    const pool = [...(feat ? [feat] : []), ...(top.length ? top : cats)];
    const show = pool.slice(0, 14);
    const more = pool.length - show.length;
    return `<div class="sc-item">
      <div class="sc-when">${period(e)}</div>
      <div class="sc-main"><b>${GATYA_KIND[e.kind] || "뽑기"}</b> <small>세트 ${e.set.id}</small>
        ${e.set.msg ? `<p>${esc(cleanMsg(e.set.msg))}</p>` : ""}
        ${show.length ? `<div class="sc-cats">${show.map(c => `<a href="#/cat/${c.id}" title="${esc(c.forms[0].name)}"${c === feat ? ' class="feat"' : ""}>${icon(c, 0)}</a>`).join("")}${more > 0 ? `<span>외 ${more}</span>` : ""}</div>` : ""}
        ${e.kind === "rare" && e.minVer > builtFor ? `<small class="sc-note">게임 v${Math.floor(e.minVer / 10000)}.${Math.floor(e.minVer / 100) % 100} 새 뽑기라 캐릭 목록은 사이트 데이터 업데이트 뒤에 보여요.</small>` : ""}
      </div></div>`;
  }).join("")}</div></div>`;
}

// ---- 스테이지 ----
function stagePanel(list, maps, now) {
  if (!list.length) return "";
  const rows = list.map(e => {
    const known = e.maps.filter(m => maps.has(m));
    return { e, known, other: e.maps.length - known.length, open: openNow(e, now) };
  }).filter(r => r.known.length)
    .sort((a, b) => (b.open - a.open) || ((a.e.start || "") < (b.e.start || "") ? -1 : 1));
  if (!rows.length) return "";
  return `<div class="panel"><h2>스테이지 <span class="ctl">${rows.length}개</span></h2><div class="sc-list">${rows.map(({ e, known, other, open }) => `
    <div class="sc-item${open ? " open" : ""}">
      <div class="sc-when">${period(e)}${open ? `<span class="sc-open">지금 열림</span>` : ""}</div>
      <div class="sc-main">
        <div class="sc-maps">${known.map(m => `<a href="#/stage/${m}">${esc(maps.get(m).name)}<small>${esc(maps.get(m).cat)}</small></a>`).join("")}${other ? `<span class="sc-more">그 외 ${other}개</span>` : ""}</div>
        ${e.rules ? `<p class="sc-rule">${e.rules.map(ruleText).filter(Boolean).map(esc).join(" / ")}</p>` : ""}
      </div></div>`).join("")}</div></div>`;
}

// ---- 이벤트·로그인 보상 (제목 있는 것만) ----
function itemPanel(list) {
  const seen = new Set();
  const rows = list.filter(e => e.title && !seen.has(e.title + e.start) && seen.add(e.title + e.start))
    .sort((a, b) => (a.start || "") < (b.start || "") ? -1 : 1);
  if (!rows.length) return "";
  return `<div class="panel"><h2>이벤트·보상 <span class="ctl">${rows.length}개</span></h2><div class="sc-list">${rows.map(e => `
    <div class="sc-item"><div class="sc-when">${period(e)}</div>
      <div class="sc-main"><b>${esc(e.title)}</b>${e.rules ? `<p class="sc-rule">${e.rules.map(ruleText).filter(Boolean).map(esc).join(" / ")}</p>` : ""}</div></div>`).join("")}</div></div>`;
}
