// NP효율 — NP를 얻는 방법(뽑기·강습·지도·티켓 스테이지)마다 통솔력·리더쉽·통조림 하나당 NP를 비교한다.
// 게임 데이터 값은 tools/build_np.py 가 만든 data/np.json, 뽑기 확률은 일정 데이터(서버 이벤트)에서.
import { esc } from "./common.js";
import { loadSchedule, openNow } from "./schedule.js";

let npPromise;
const loadNp = () => npPromise ??= fetch("data/np.json").then(r => r.json());

// 환산 기준 (이 브라우저에 저장)
const KEY = "nyanko-wiki.np";
const DEF = { maxEnergy: 1200, leaderCans: 30, rareCans: 150, rareBase: "auto", catPlus: true, drink: false, lv: 19, group: "all" };
// 레어 뽑기 종류별 확률 % [레어, 슈레, 울슈레, 레전드]. 축제는 열려 있을 때만 서버 데이터에 나와서 커뮤니티 정리 값을 쓴다
const RARE_KINDS = [
  ["reg", "정규 레어 뽑기", [69.7, 25, 5, 0.3]],
  ["nolg", "레전드 없는 뽑기", [70, 25, 5, 0]],
  ["uberfest", "울하고축", [64.7, 25, 10, 0.3]],
  ["fest", "울고축·하고축", [64.7, 26, 9, 0.3]],
  ["king", "국왕 축제", [67.7, 25, 7, 0.3]],
  ["queen", "여왕 축제", [69.4, 25, 5, 0.6]],
  ["double", "울슈레·레전드 확률 2배", [64.4, 25, 10, 0.6]],
];
const kindRates = r => [[0, 0], ...r.map(p => [p * 100, 0])];
// 냥코 뽑기(냥코 티켓): 기본 캐릭 아니면 파란구슬. 파란구슬 5개 = 레어 티켓 1장.
// 뽑기 칸 구성(기본 캐릭 9 + 파란구슬 9, 우주편 3장 뒤 "냥코 뽑기+"는 고양이 초인이 더해져 10 + 9)과
// 냥코 뽑기+ 기본 캐릭 2NP는 게임 데이터에 없어서 커뮤니티 정리 값을 쓴다.
const CAT_GATYA = { false: { orb: 9 / 18, cat: 1 }, true: { orb: 9 / 19, cat: 2 } };
const ORBS_PER_RARE = 5;
const catTicketNp = rareNp => { const g = CAT_GATYA[opt.catPlus]; return g.orb * rareNp / ORBS_PER_RARE + (1 - g.orb) * g.cat; };
const opt = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { return { ...DEF }; } })();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(opt)); } catch {} };

const RATE_RARITY = [0, 2, 3, 4, 5];  // 뽑기 확률 순서 [노멀, 레어, 슈레, 울슈레, 레전드] → 레어도 (np.json dupe 순서)
const BASE_RATES = [[0, 0], [7000, 0], [2500, 0], [500, 0], [0, 0]];  // 일정 데이터가 없을 때 레어 티켓 기준
const TIERS = ["기원", "정점", "비경"];
const GROUPS = { gatya: "뽑기", beh: "강습", map: "지도·보물섬", ticket: "티켓 스테이지" };

const pullNp = (rates, dupe) => rates.reduce((s, [p], i) => s + p / 1e4 * dupe[RATE_RARITY[i]], 0);
const n2 = x => x.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = x => `${+x.toFixed(2)}%`;
const bannerName = m => m.replace(/^★확률[^★]*★/, "").replace(/[☆★【】]|기간 한정/g, " ").replace(/\s+/g, " ").trim().slice(0, 34) || "레어 뽑기";

export function renderNp(root) {
  root.innerHTML = `
    <p class="crumb"><a href="#/">냥코위키</a><i>/</i><span>NP효율</span></p>
    <div class="page-head"><div><h1>NP효율</h1><p>NP를 얻는 방법마다 통솔력·리더쉽·통조림 하나에 NP를 얼마나 얻는지 기대값으로 비교해요.</p></div></div>
    <div class="filters" id="npOpt"></div>
    <div id="npBody"><div class="empty">불러오는 중…</div></div>`;
  Promise.all([loadNp(), loadSchedule().catch(() => null)]).then(([d, sc]) => {
    const now = Date.now();
    const banners = gatyaBanners(sc, d.dupe, now);
    const draw = () => {
      // 레어 티켓: 고른 뽑기 종류, "자동"이면 지금 열린 150통조림 레어 뽑기 중 가장 좋은 배너에 쓴다고 본다
      const kind = RARE_KINDS.find(([k]) => k === opt.rareBase);
      const rareNp = kind ? pullNp(kindRates(kind[2]), d.dupe)
        : Math.max(pullNp(BASE_RATES, d.dupe), ...banners.filter(b => b.open && b.price === 150).map(b => b.np));
      const rows = [...gatyaRows(banners, rareNp, d.dupe), ...behRows(d), ...mapRows(d), ...ticketRows(d, sc, now, rareNp)];
      paintOpt(root, d, rareNp, draw);
      paintBody(root, rows, d);
    };
    draw();
  }).catch(() => { root.querySelector("#npBody").innerHTML = `<div class="empty">데이터를 불러오지 못했어요. 새로고침해 주세요.</div>`; });
  return null;
}

// ---- 환산 기준 ----
function paintOpt(root, d, rareNp, draw) {
  const box = root.querySelector("#npOpt");
  const beh = d.behemoth[0]?.stages || [];
  const num = (k, label, step = 1) => `<label class="np-in"><span>${label}</span><input type="number" min="1" step="${step}" data-k="${k}" value="${opt[k]}"></label>`;
  box.innerHTML = `
    <div class="row np-opts">
      ${num("maxEnergy", "최대 통솔력")}
      ${num("leaderCans", "리더쉽 1개 = 통조림")}
      ${num("rareCans", "레어 티켓 1장 = 통조림")}
      <label class="np-in"><span>레어 티켓 쓰는 뽑기</span><select data-k="rareBase"><option value="auto">자동 (지금 열린 배너 중 최고)</option>${RARE_KINDS.map(([k, name, r]) =>
        `<option value="${k}"${k === opt.rareBase ? " selected" : ""}>${name}  (${r.join(" / ")})</option>`).join("")}</select></label>
      <label class="np-in"><span>냥코 뽑기</span><select data-k="catPlus"><option value="0"${opt.catPlus ? "" : " selected"}>기본</option><option value="1"${opt.catPlus ? " selected" : ""}>냥코 뽑기+ (우주편 3장 뒤)</option></select></label>
      <label class="np-in"><span>강습 레벨</span><select data-k="lv">${beh.map(s =>
        `<option value="${s.i}"${s.i === opt.lv ? " selected" : ""}>${s.i === beh.length - 1 ? "Lv.MAX" : `Lv.${s.i + 1}`}</option>`).join("")}</select></label>
    </div>
    <div class="row">
      ${[["all", "전부"], ...Object.entries(GROUPS)].map(([k, l]) => `<button class="chip" data-g="${k}" aria-pressed="${opt.group === k}">${l}</button>`).join("")}
      <span class="sc-sep"></span>
      <button class="chip" data-drink aria-pressed="${opt.drink}" title="강습은 30분에 한 번. 바로 다시 하려면 고양이 드링크 A(통조림 ${d.drinkA}개)">강습에 드링크 A 쓰기</button>
    </div>
    <p class="np-note">리더쉽 1개는 통솔력을 최대치만큼 채운다고 보고 환산해요 (통솔력 ${opt.maxEnergy} = 통조림 ${opt.leaderCans}).
      레어 티켓 1장 = NP ${n2(rareNp)} (${RARE_KINDS.find(([k]) => k === opt.rareBase)?.[1] ?? "지금 열린 레어 뽑기 중 가장 좋은 배너"} 기준).
      냥코 티켓 1장 = NP ${n2(catTicketNp(rareNp))}: 파란구슬 ${pct(CAT_GATYA[opt.catPlus].orb * 100)} (${ORBS_PER_RARE}개 = 레어 티켓 1장), 기본 캐릭 중복 ${CAT_GATYA[opt.catPlus].cat}NP.</p>`;
  box.querySelectorAll("[data-k]").forEach(el => el.onchange = () => {
    const k = el.dataset.k, v = +el.value;
    if (k === "catPlus") opt.catPlus = v === 1;
    else if (k === "rareBase") opt.rareBase = el.value;
    else if (v > 0 || (k === "lv" && v >= 0)) opt[k] = v;
    save();
    draw();
  });
  box.querySelectorAll("[data-g]").forEach(b => b.onclick = () => { opt.group = b.dataset.g; save(); draw(); });
  box.querySelector("[data-drink]").onclick = () => { opt.drink = !opt.drink; save(); draw(); };
}

// ---- 표 ----
// 행 = { group, name, sub, href, np(1회), energy(통솔력), cans(통조림), open }
function paintBody(root, rows, d) {
  const cpe = opt.leaderCans / opt.maxEnergy;  // 통솔력 1 = 통조림
  const calc = r => {
    const cans = (r.energy || 0) * cpe + (r.cans || 0), energy = (r.energy || 0) + (r.cans || 0) / cpe;
    return { ...r, c100: r.np / cans * 100, e100: r.np / energy * 100, lead: r.np / energy * opt.maxEnergy };
  };
  const list = rows.filter(r => opt.group === "all" || r.group === opt.group).map(calc).sort((a, b) => b.c100 - a.c100);
  const cost = r => [r.energy && `통솔력 ${r.energy}`, r.cans && `통조림 ${+r.cans.toFixed(1)}`].filter(Boolean).join(" + ");
  root.querySelector("#npBody").innerHTML = `
    <div class="panel"><h2>NP효율 순위 <span class="ctl">${list.length}개 · 100통조림당 순</span></h2>
      <div class="table-wrap"><table class="en-table np-table"><thead><tr><th>방법</th><th>1회 NP</th><th>비용</th><th>100통솔력당</th><th>리더쉽당</th><th>100통조림당</th></tr></thead><tbody>
      ${list.map(r => `<tr${r.open ? ` class="boss"` : ""}>
        <td class="en-name"><small class="np-g">${GROUPS[r.group]}</small> ${r.href ? `<a href="${r.href}">${esc(r.name)}</a>` : esc(r.name)}${r.open ? ` <span class="sc-open">지금 열림</span>` : ""}${r.sub ? `<br><small>${esc(r.sub)}</small>` : ""}</td>
        <td data-l="1회 NP">${n2(r.np)}</td><td data-l="비용">${cost(r)}</td>
        <td data-l="100통솔력당">${n2(r.e100)}</td><td data-l="리더쉽당">${n2(r.lead)}</td><td data-l="100통조림당"><b>${n2(r.c100)}</b></td></tr>`).join("")}
      </tbody></table></div></div>
    <div class="panel"><h2>계산 방법</h2><ul class="np-how">
      <li>중복 캐릭을 NP로 바꾸면 레어 ${d.dupe[2]}, 슈퍼레어 ${d.dupe[3]}, 울트라슈퍼레어 ${d.dupe[4]}, 레전드레어 ${d.dupe[5]} NP. 뽑기는 뽑은 캐릭이 전부 중복이라고 보고 서버 확률로 계산해요.</li>
      <li>본능옥을 NP로 바꾸면 D ${d.gradeNp[0]}, C ${d.gradeNp[1]}, B ${d.gradeNp[2]}, A ${d.gradeNp[3]}, S ${d.gradeNp[4]} NP. 합성하지 않고 바로 바꾼다고 봐요.</li>
      <li>강습은 클리어하면 EX 스테이지(기원·정점·비경)가 나올 수 있고, EX에서 본능옥이 나와요. EX 1회 NP 기대값: 기원 ${n2(d.exNp[0])}, 정점 ${n2(d.exNp[1])}, 비경 ${n2(d.exNp[2])}. EX 스테이지 통솔력은 넣지 않았어요.</li>
      <li>지도·보물이 잠든 섬·재회의 지도 스테이지는 지도 아이템이나 이벤트가 있을 때만 할 수 있어요.</li>
    </ul></div>`;
}

// ---- 뽑기 ----
function gatyaBanners(sc, dupe, now) {
  if (!sc) return [];
  const seen = new Map();
  for (const e of sc.gatya) {
    if (e.kind !== "rare" || (e.end && Date.parse(e.end) <= now)) continue;
    for (const s of e.sets) {
      if (s.id < 0 || !s.price || !s.msg) continue;  // 배너 문구 없는 세트(상시 기본 세트 등)는 실제로 고를 수 있는 뽑기가 아니다
      const key = `${s.id}|${s.price}|${JSON.stringify(s.rates)}`;
      const open = Date.parse(e.start || 0) <= now;
      const cur = seen.get(key);
      if (cur) { cur.open ||= open; continue; }
      const np = pullNp(s.rates, dupe);
      const sure = s.rates[3]?.[1] === 1;  // 11연 마지막 1회 울트라슈퍼레어 확정
      seen.set(key, { id: s.id, price: s.price, rates: s.rates, np, sure, open, start: e.start, end: e.end,
        name: bannerName(s.msg), np11: sure ? (10 * np + dupe[4]) / 11 : null });
    }
  }
  return [...seen.values()];
}
function gatyaRows(banners, rareNp, dupe) {
  const rows = banners.map(b => {
    const r = b.rates.map(([p]) => p / 100);
    const sub = `레어 ${r[1]}% · 슈레 ${r[2]}% · 울슈레 ${r[3]}%${r[4] ? ` · 레전드 ${r[4]}%` : ""}`
      + (b.sure ? " · 11연 울슈레 확정 (11회 평균)" : "") + (b.open ? "" : ` · ${b.start.slice(5, 10).replace("-", "/")} 시작`);
    // 11연 확정이 있으면 11연 기준이 더 좋다 (통조림 1500 = 11회)
    return { group: "gatya", name: b.name, sub, np: b.sure ? b.np11 : b.np, cans: b.price, open: b.open };
  });
  // 축제 등 뽑기 종류별 기준 확률 (지금 안 열려 있어도 비교할 수 있게)
  for (const [, name, r] of RARE_KINDS)
    rows.push({ group: "gatya", name: `${name} (기준 확률)`, sub: `레어 ${r[0]}% · 슈레 ${r[1]}% · 울슈레 ${r[2]}%${r[3] ? ` · 레전드 ${r[3]}%` : ""}`,
      np: pullNp(kindRates(r), dupe), cans: 150 });
  rows.push({ group: "gatya", name: "레어 티켓 1장", sub: `통조림 ${opt.rareCans}개 가치로 환산`, np: rareNp, cans: opt.rareCans });
  return rows;
}

// ---- 강습 → EX ----
function behRows(d) {
  const by = new Map();
  for (const b of d.behemoth) {
    const s = b.stages.find(x => x.i === opt.lv) || b.stages.at(-1);
    const key = `${s.energy}|${s.ex.join(",")}`;
    if (!by.has(key)) by.set(key, { s, maps: [] });
    by.get(key).maps.push(b);
  }
  return [...by.values()].map(({ s, maps }) => ({
    group: "beh", name: `강습 ${s.i === d.behemoth[0].stages.length - 1 ? "Lv.MAX" : `Lv.${s.i + 1}`}${maps.length > 1 ? ` (${maps.length}종)` : ""}`,
    href: maps.length === 1 ? `#/stage/${maps[0].map}/${s.i}` : null,
    sub: `EX ${TIERS.map((t, k) => s.ex[k] ? `${t} ${pct(s.ex[k])}` : "").filter(Boolean).join(" · ")}${opt.drink ? " · 드링크 A 포함" : ""} — ${maps.map(m => m.name.replace(/ 강습$/, "")).join(", ")}`,
    np: s.ex.reduce((a, p, k) => a + p / 100 * d.exNp[k], 0), energy: s.energy, cans: opt.drink ? d.drinkA : 0,
  }));
}

// ---- 지도·보물섬 (본능옥) : 같은 단계·같은 NP는 한 줄로 ----
function mapRows(d) {
  const by = new Map();
  for (const o of d.orbMaps) {
    const island = o.name.includes("보물");
    const title = island ? o.stage : o.name;
    const tier = TIERS.find(t => title.includes(t)) || "";
    const attr = title.split(" 본능")[0];
    const key = `${island}|${tier}|${o.np}|${o.energy}`;
    if (!by.has(key)) by.set(key, { o, island, tier, attrs: [] });
    by.get(key).attrs.push(attr);
  }
  return [...by.values()].map(({ o, island, tier, attrs }) => {
    const g = o.grades.map((p, k) => p ? `${"DCBAS"[k]} ${p}%` : "").filter(Boolean).join(" · ");
    return { group: "map", name: `${island ? "보물이 잠든 섬" : "지도"} 본능의 ${tier}`, href: `#/stage/${o.map}/${o.i}`,
      sub: `${attrs.join("·")} — ${g}`, np: o.np, energy: o.energy };
  });
}

// ---- 냥코 티켓·레어 티켓 스테이지 ----
function ticketRows(d, sc, now, rareNp) {
  const openMaps = new Set((sc?.sale || []).filter(e => openNow(e, now)).flatMap(e => e.maps));
  return d.tickets.map(t => ({
    group: "ticket", name: t.name, href: `#/stage/${t.map}/${t.i}`, open: openMaps.has(t.map),
    sub: `${t.stage} — ${[t.cat && `냥코 티켓 ${+t.cat.toFixed(2)}장`, t.rare && `레어 티켓 ${+t.rare.toFixed(2)}장`].filter(Boolean).join(" + ")}${t.map >= 25000 ? " (지도)" : ""}`,
    np: t.cat * catTicketNp(rareNp) + t.rare * rareNp, energy: t.energy,
  }));
}
