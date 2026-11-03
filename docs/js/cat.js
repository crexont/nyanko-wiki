// 캐릭터 상세 — 진화 단계별 스탯·능력·본능·진화 재료 + 내 보유 상태
import { GD, BYID, FORM, esc, clamp, icon, rarBadge, traitChips, view, store, itemName, itemIcon, have, haveXp, ORB_GRADE, levelCost } from "./common.js";
import { openEdit } from "./edit.js";
import { addToPlan, removeFromPlan, inPlan } from "./plan.js";

let unitsPromise;
export const loadUnits = () => unitsPromise ??= fetch("data/units.json").then(r => {
  if (!r.ok) throw new Error(r.status);
  return r.json();
});

const state = { id: null, form: null, level: null, plus: null, tal: null, orbs: null, to: null };
let dropsPromise;
const loadDrops = () => dropsPromise ??= Promise.all([
  fetch("data/stages/cat_drops.json").then(r => r.json()),
  fetch("data/stages/index.json").then(r => r.json()),
]);

export function renderCat(root, id) {
  const c = BYID.get(id);
  if (!c) { root.innerHTML = `<div class="empty">캐릭터를 찾을 수 없어요. <a href="#/cats">캐릭터 목록으로</a></div>`; return; }
  if (state.id !== id) Object.assign(state, { id, form: null, level: null, plus: null, tal: null, orbs: null, to: null });
  root.innerHTML = `<div class="empty">불러오는 중…</div>`;
  const draw = () => loadUnits().then(units => paint(root, c, units[id]))
    .catch(e => { console.error(e); root.innerHTML = `<div class="empty">캐릭터 데이터를 불러오지 못했어요. 새로고침해 주세요.</div>`; });
  draw();
  return draw;
}

const sec = frames => { const s = (frames / 30).toFixed(2).replace(/\.?0+$/, ""); return `${s}초`; };
const num = n => Math.floor(n).toLocaleString();
const STEP_NAME = { tf: "3진", ff: "4진" };

// 레벨 배율: 레벨이 1 오를 때마다 기본값의 curve[(레벨)/10]% 만큼 오른다 (unitlevel.csv)
// 게임과 같은 반올림·버림 순서를 위해 BCU(util/unit/UnitLevel.getMult, battle/entity/Entity, AtkModelEntity)를
// 그대로 따른다. 레벨 배율은 Java float(32비트)로 계산되므로 Math.fround로 맞춘다.
const f32 = Math.fround;
function levelMult(curve, total) {
  let dec = total, d = f32(1 - f32((curve[0] ?? 0) * f32(0.01)));
  for (const mul of curve) {
    if (dec >= 10) { d = f32(d + f32(mul * f32(0.1))); dec -= 10; }
    else { d = f32(d + f32(mul * dec * f32(0.01))); break; }
  }
  return d;
}
const TREASURE = f32(2.5);  // 보물 최대 (1 + 300×0.005)

// 본능옥 효과 수치 (등급 D~S). BCU util/Data.java 의 ORB_ATK_MULTI 등과 같은 값
const ORB_ATK = [100, 200, 300, 400, 500];      // 데미지 업: 기본 공격력(레벨·보물 전 값)의 n% 추가
const ORB_RES = [4, 8, 12, 16, 20];             // 데미지 경감: 받는 데미지 −n%
const ORB_STR = [0.06, 0.12, 0.18, 0.24, 0.3];  // 엄청 강하다 강화: 배율 +n
const ORB_MAS = [0.1, 0.2, 0.3, 0.4, 0.5];      // 초 데미지 강화: 배율 +n
const ORB_RESIST = [5, 10, 15, 20, 25];         // 맷집이 좋다 강화
const ORB_KINDS = [0, 1, 2, 3, 4];              // 스탯에 영향을 주는 속성 대상 본능옥만 고를 수 있게

// 슬롯 하나: [종류][대상 속성][등급]. 대상 속성 목록은 게임 데이터에 실제로 있는 조합만
function orbSlotHtml(i, cond, sel) {
  const [k, attr, g] = sel || [-1, -1, 0];
  const attrs = k >= 0 ? [...new Set(GD.orbs.list.filter(o => o[0] === k).map(o => o[1]))] : [];
  return `<div class="orb-slot" data-slot="${i}">
    <span class="orb-no">${i + 1}${cond >= 1 ? "<small>Lv60~</small>" : ""}</span>
    <select data-orb="k" aria-label="본능옥 종류"><option value="-1">없음</option>${ORB_KINDS.map(x =>
      `<option value="${x}"${x === k ? " selected" : ""}>${esc(GD.orbs.names[x])}</option>`).join("")}</select>
    <select data-orb="attr" aria-label="대상 속성"${k < 0 ? " disabled" : ""}>${attrs.map(a =>
      `<option value="${a}"${a === attr ? " selected" : ""}>${GD.orbs.traits[a]}</option>`).join("")}</select>
    <select data-orb="g" aria-label="등급"${k < 0 ? " disabled" : ""}>${ORB_GRADE.map((G, x) =>
      `<option value="${x}"${x === g ? " selected" : ""}>${G}</option>`).join("")}</select>
  </div>`;
}
// 체력: trunc( trunc( round(기본×레벨) × 보물 ) × 본능 )
const calcHp = (base, mult, talentPct) => Math.trunc(Math.trunc(f32(Math.round(f32(base * mult)) * TREASURE)) * (1 + talentPct * 0.01));
// 공격력(한 타): trunc( 본능 × trunc( round(기본×레벨) × 보물 ) )
const calcAtk = (base, mult, talentPct) => Math.trunc((1 + talentPct * 0.01) * Math.trunc(f32(Math.round(f32(base * mult)) * TREASURE)));

// 능력 문장. 적 상세(enemy.js)도 같이 쓴다 (적 전용 능력은 아래쪽)
export function abilityText(a, traits) {
  const [k, v, x, y, z] = a, to = traits.length ? `${traits.join("·")}에게 ` : "";
  switch (k) {
    case "strong": return `${to}엄청 강하다`;
    case "resist": return `${to}맷집이 좋다`;
    case "massive": return `${to}초 데미지`;
    case "insane": return `${to}초극 데미지`;
    case "tough": return `${to}초 맷집`;
    case "only": return `공격 타겟 한정 (${traits.join("·") || "지정 속성"}만 공격)`;
    case "kb": return `${to}날려버린다 (${v}%)`;
    case "freeze": return `${to}움직임을 멈춘다 (${v}%, ${sec(x)})`;
    case "slow": return `${to}움직임을 느리게 한다 (${v}%, ${sec(x)})`;
    case "weaken": return `${to}공격력 다운 (${v}%, ${sec(x)}, 공격력 ${y}%로)`;
    case "curse": return `${to}저주 (${v}%, ${sec(x)})`;
    case "dodge": return `${to}공격 무효 (${v}%, ${sec(x)})`;
    case "crit": return `크리티컬 (${v}%)`;
    case "money": return "격파 시 머니 UP";
    case "base": return "성 파괴 특기";
    case "wave": return `파동 공격 (${v}%, Lv${x})`;
    case "miniWave": return `소파동 (${v}%, Lv${x})`;
    case "surge": return `열파 (${v}%, Lv${z})`;
    case "miniSurge": return `소열파 (${v}%, Lv${z})`;
    case "strengthen": return `체력 ${v}% 이하에서 공격력 +${x}%`;
    case "survive": return `살아남는다 (${v}%)`;
    case "metal": return "메탈 (크리티컬 외 데미지 1)";
    case "immWave": return "파동 데미지 무효";
    case "waveBlock": return "파동 스톱퍼 (적의 파동을 없앤다)";
    case "immKb": return "날려버린다 무효";
    case "immFreeze": return "움직임을 멈춘다 무효";
    case "immSlow": return "움직임을 느리게 한다 무효";
    case "immWeaken": return "공격력 다운 무효";
    case "zombie": return "좀비 킬러";
    case "witch": return "마녀 킬러";
    case "barrier": return `베리어 브레이커 (${v}%)`;
    case "shield": return `쉴드 브레이커 (${v}%)`;
    case "savage": return `혼신의 일격 (${v}%, 공격력 +${x}%)`;
    case "colossus": return "초생명체 특효";
    case "behemoth": return "초수 특효";
    case "sage": return "초현자 특효";
    case "metalKiller": return `메탈 킬러 (현재 체력의 ${v}%)`;
    case "explosion": return `폭파 공격 (${v}%)`;
    case "conjure": return "소환";
    case "soul": return "영혼 공격";
    case "counterSurge": return "열파 카운터";
    case "immWarp": return "워프 무효";
    case "immCurse": return "고대의 저주 무효";
    case "immToxic": return "독 데미지 무효";
    case "immSurge": return "열파 데미지 무효";
    case "immBlast": return "폭파 데미지 무효";
    // 적 전용
    case "burrow": return `지하 이동 (${v < 0 ? "무한" : `${v}회`}, 거리 ${x})`;
    case "revive": return `부활 (${v < 0 ? "무한" : `${v}회`}, ${sec(x)} 뒤 체력 ${y}%)`;
    case "warp": return `워프 (${v}%, ${sec(x)}, 거리 ${y}~${z})`;
    case "toxic": return `독 공격 (${v}%, 최대 체력의 ${x}%)`;
    case "barrierHp": return `베리어 (강도 ${num(v)})`;
    case "demonShield": return `쉴드 (강도 ${num(v)}, 히트백 시 ${x}% 재생)`;
    case "deathSurge": return `사망 시 열파 (${v}%, ${x}~${y}, Lv${z})`;
    case "blast": return `폭파 공격 (${v}%, ${x}~${y})`;
    case "delay": return `지연 공격 (${v}%, 세기 ${x})`;
    default:
      if (k.startsWith("res:")) return `${k.slice(4)} 내성 (${v}% 감소)`;
      return k;
  }
}

// ---- 본능 효과 ----
// 계산 방식은 BCU(오픈소스 시뮬레이터)의 PCoin과 같다:
// 레벨 L 값 = (최대-최소)×(L-1)/(최대레벨-1) + 최소 (정수 버림), 최대 레벨이 1 이하면 최대값.
function talentMods(vals, lv) {
  const maxLv = Math.max(vals[0], 1), m = [];
  for (let j = 0; j < 4; j++) {
    const v0 = vals[1 + j * 2], v1 = vals[2 + j * 2];
    m.push(maxLv > 1 ? Math.trunc((v1 - v0) * (lv - 1) / (maxLv - 1)) + v0 : v1);
  }
  return m;
}
const TAL_TRAIT = { 33: "빨강", 34: "떠있음", 35: "검정", 36: "메탈", 37: "천사", 38: "에이리언", 39: "좀비", 40: "고대종", 41: "무속성", 57: "악마" };
const TAL_FLAG = { 4: "only", 5: "strong", 6: "resist", 7: "massive", 12: "base", 14: "zombie", 16: "money", 23: "waveBlock",
                   59: "soul", 63: "colossus", 66: "sage", 68: "counterSurge",
                   44: "immWeaken", 45: "immFreeze", 46: "immSlow", 47: "immKb", 48: "immWave", 49: "immWarp",
                   29: "immCurse", 53: "immToxic", 55: "immSurge", 69: "immBlast" };
const TAL_RES = { 18: "공격력 다운", 19: "움직임을 멈춘다", 20: "움직임을 느리게 한다", 21: "날려버린다", 22: "파동 데미지",
                  24: "워프", 30: "고대의 저주", 52: "독 데미지", 54: "열파 데미지" };
// 확률형 능력: [능력 키, 새로 생길 때의 값]. 원래 있던 능력이면 각 값에 더한다 (열파류는 덮어씀).
const TAL_PROC = {
  1: ["weaken", m => [m[0], m[1], 100 - m[2]]], 2: ["freeze", m => [m[0], m[1]]], 3: ["slow", m => [m[0], m[1]]],
  8: ["kb", m => [m[0]]], 10: ["strengthen", m => [100 - m[0], m[1]]], 11: ["survive", m => [m[0]]],
  13: ["crit", m => [m[0]]], 15: ["barrier", m => [m[0]]], 17: ["wave", m => [m[0], m[1]]],
  50: ["savage", m => [m[0], m[1]]], 51: ["dodge", m => [m[0], m[1]]], 56: ["surge", m => [m[0], 0, 0, m[1]]],
  58: ["shield", m => [m[0]]], 60: ["curse", m => [m[0], m[1]]], 62: ["miniWave", m => [m[0], m[1]]],
  64: ["behemoth", m => [1, m[0], m[1]]], 65: ["miniSurge", m => [m[0], 0, 0, m[1]]], 67: ["explosion", m => [m[0], m[1]]],
};

function applyTalents(c, u, s, levels) {
  const out = { hp: 0, atk: 0, speed: 0, kb: 0, cost: 0, cd: 0, tba: 0, traits: [], ab: s.ab.map(a => [...a]), touched: new Set() };
  for (const t of c.talents) {
    const L = levels[t.id] || 0, vals = u.talentVals?.[t.id];
    if (!L || !vals) continue;
    const m = talentMods(vals, L), id = t.id;
    if (id === 32) out.hp += m[0];
    else if (id === 31) out.atk += m[0];
    else if (id === 27) out.speed += m[0];
    else if (id === 28) out.kb += m[0];
    else if (id === 25) out.cost += m[0];
    else if (id === 26) out.cd += m[0];
    else if (id === 61) out.tba += m[0];
    else if (TAL_TRAIT[id]) out.traits.push(TAL_TRAIT[id]);
    else if (TAL_FLAG[id]) {
      const k = TAL_FLAG[id];
      if (!out.ab.some(a => a[0] === k)) out.ab.push([k, 1]);
      out.touched.add(k);
    } else if (TAL_RES[id]) {
      const k = "res:" + TAL_RES[id];
      out.ab.push([k, m[0]]); out.touched.add(k);
    } else if (TAL_PROC[id]) {
      const [k, make] = TAL_PROC[id], cur = out.ab.find(a => a[0] === k);
      if (!cur) out.ab.push([k, ...make(m)]);
      else if (k === "surge" || k === "miniSurge") { cur[1] = m[0]; cur[4] = m[1]; }
      else if (k === "weaken") { cur[1] += m[0]; cur[2] += m[1]; }
      else m.forEach((x, j) => { if (x > 0 && cur.length > 1 + j) cur[1 + j] += x; });
      out.touched.add(k);
    }
  }
  return out;
}

function paint(root, c, u) {
  if (!u) { root.innerHTML = `<div class="empty">이 캐릭터의 상세 데이터가 없어요.</div>`; return; }
  const v = view(c), o = v.o;
  const fi = state.form ?? (o ? Math.min(o.form, c.forms.length - 1) : c.forms.length - 1);
  const lv = state.level ?? (o ? o.level : Math.min(30, c.maxLevel));
  const plus = state.plus ?? (o ? o.plus : 0);
  const f = c.forms[fi], s = u.forms[fi];

  // 본능: 3진(진화 3단계)부터 적용. 미적용 / 내 본능 / 전부 최대
  const talOk = c.talents.length > 0 && fi >= 2;
  const mode = talOk ? (state.tal ?? (o ? "mine" : "none")) : "none";
  const levels = mode === "max" ? Object.fromEntries(c.talents.map(t => [t.id, t.max]))
    : mode === "mine" && o ? (o.talents || {}) : {};
  const T = applyTalents(c, u, s, levels);

  const mult = levelMult(u.curve, lv + plus);
  const hp = calcHp(s.hp, mult, T.hp);
  const hits = s.atk.map(a => calcAtk(a, mult, T.atk));
  const total = hits.reduce((a, b) => a + b, 0);
  const speed = s.speed + T.speed, kb = s.kb + T.kb, cost = (s.cost - T.cost) * 1.5;
  const respawnF = s.respawn * 2 - T.cd, tbaF = Math.trunc(s.tba * (100 - T.tba) / 100) * 2;
  const ldText = ([a, w]) => `${Math.min(a, a + w)}~${Math.max(a, a + w)}`;
  const ld = s.ld && ldText(s.ld);
  // 공격 주기 (BCU DefaultData.getItv): 마지막 타 선딜 + max(TBA − 1, 모션 길이 − 마지막 타 선딜). 모션 길이 = getAtkLen()
  const longPre = Math.max(...s.pre);
  const cycleF = s.anim ? longPre + Math.max(tbaF - 1, s.anim - longPre) : null;
  const postF = s.anim ? s.anim - longPre : null;
  // 쿨타임: 연구력 Lv20+10 · 보물 최대 기준 (BCU Treasure.getFinRes: 29×6 + 300×0.3 = 264F 단축, 최소 60F)
  const coolF = Math.max(60, respawnF - 264);
  // DPS는 반올림 전 값으로 범위까지 계산하고 표시할 때 반올림 (나무위키 표기와 같음)
  const dpsOf = atk => cycleF ? atk * 30 / cycleF : null;
  const F = f => f == null ? "-" : `${num(f)}<span> (${sec(f)})</span>`;
  const up = (on, why) => on ? ` class="up" title="본능: ${why}"` : "";

  // 스탯 블록: 레벨별 체력·공격력·DPS (+ 엄강·초뎀 등 범위) / 프레임 표 / 타격별 선딜·유효 사거리
  const statBlock = () => {
    const has = k => T.ab.some(a => a[0] === k);
    // 범위 = 보물 없음 ~ 보물 최대 (엄청 강하다 공격 1.5~1.8·받는 데미지 1/2~1/2.5, 초 데미지 3~4, 초극 5~6, 맷집 1/4~1/5, 초맷집 1/6~1/7)
    const hpMods = [has("strong") && ["엄강", 2, 2.5], has("resist") && ["맷집", 4, 5], has("tough") && ["초맷집", 6, 7]].filter(Boolean);
    const atkMods = [has("strong") && ["엄강", 1.5, 1.8], has("massive") && ["초뎀", 3, 4], has("insane") && ["초극뎀", 5, 6]].filter(Boolean);
    const R = v => Math.round(v).toLocaleString();
    const range = (v, mods) => mods.length ? `<small>(${mods.map(([n, a, b]) => `${n}: ${R(v * a)}~${R(v * b)}`).join(" / ")})</small>` : "";
    let lvs = [30, 40, 50, 60].filter(l => l <= c.maxLevel);
    if (lvs.length < 2) lvs = [10, 20, 30, 40, 50].filter(l => l <= c.maxLevel);
    const rows = lvs.map(l => ({ label: `Lv${l}`, t: l }));
    if (!lvs.includes(lv + plus) || plus) rows.unshift({ label: `Lv${lv}${plus ? "+" + plus : ""}`, t: lv + plus, sel: true });
    else rows.find(r => r.t === lv).sel = true;
    for (const r of rows) {
      const m = levelMult(u.curve, r.t);
      r.hp = calcHp(s.hp, m, T.hp);
      r.atk = s.atk.reduce((a, b) => a + calcAtk(b, m, T.atk), 0);
      r.dps = dpsOf(r.atk);
    }
    const list = (key, mods) => rows.map(r => `<div${r.sel ? ' class="sel"' : ""}><span>${r.label}</span> <b>${r[key] == null ? "-" : R(r[key])}</b>${r[key] == null ? "" : range(r[key], mods)}</div>`).join("");
    const tal = (on, why) => on ? `<em class="tal-on" title="본능 적용">${why}</em>` : "";
    const multi = s.atk.length > 1;
    const lds = s.lds || (s.ld ? s.atk.map(() => s.ld) : null);
    return `
      <div class="nm">
        <div class="nm-box"><div class="nm-h">체력${tal(T.hp, ` +${T.hp}%`)}</div><div class="nm-rows">${list("hp", hpMods)}</div></div>
        <div class="nm-box"><div class="nm-h">공격력${multi ? ` (${s.atk.length}회 합계)` : ""}${tal(T.atk, ` +${T.atk}%`)}</div><div class="nm-rows">${list("atk", atkMods)}
          ${multi ? `<div class="sub-hit"><span>타격별 (Lv${lv}${plus ? "+" + plus : ""})</span> ${hits.map(num).join(" + ")}</div>` : ""}</div></div>
        <div class="nm-box${multi ? "" : " wide"}"><div class="nm-h">DPS${tal(T.atk || T.tba, " 본능")}</div><div class="nm-rows">${cycleF ? list("dps", atkMods) : `<div><span>공격 모션 데이터가 없어 계산할 수 없어요</span></div>`}</div></div>
        ${multi ? `<table class="nm-hits"><thead><tr><th>타격</th><th>선딜F</th>${lds ? "<th>유효 사거리</th>" : ""}</tr></thead><tbody>
          ${s.pre.map((p, i) => `<tr><td>${i + 1}타</td><td>${F(p)}</td>${lds ? `<td>${ldText(lds[i])}</td>` : ""}</tr>`).join("")}
        </tbody></table>` : ""}
      </div>
      <div class="nm-grid">
        <div${up(T.kb, `넉백 +${T.kb}회`)}><small>히트백</small><b>${kb}</b></div>
        <div${up(T.speed, `이동 속도 +${T.speed}`)}><small>이동속도</small><b>${speed}</b></div>
        <div><small>사거리</small><b>${s.range}${!multi && ld ? `<span> (유효 ${ld})</span>` : ""}</b></div>
        <div${up(T.cost, `코스트 -${num(T.cost * 1.5)}원`)}><small>코스트</small><b>${num(cost)}</b></div>
        <div${up(T.cd, `재생산 -${T.cd}F`)}><small>쿨타임F</small><b>${F(coolF)}</b></div>
        <div${up(T.tba, `공격 간격 -${T.tba}%`)}><small>공격빈도F</small><b>${F(cycleF)}</b></div>
        <div${up(T.tba, `공격 간격 -${T.tba}%`)}><small>공격간격F</small><b>${F(tbaF)}</b></div>
        ${multi ? `<div><small>공격 횟수</small><b>${s.atk.length}회</b></div>` : `<div><small>선딜F</small><b>${F(s.pre[0])}</b></div>`}
        <div><small>후딜F</small><b>${F(postF)}</b></div>
        <div><small>공격 범위</small><b>${s.area ? "범위" : "단일"}${s.ld ? "<span> · 원거리</span>" : ""}</b></div>
      </div>`;
  };

  const traits = [...new Set([...f.traits, ...T.traits])];

  // 본능옥 (3진부터, 슬롯 있는 캐릭만). 효과 수치는 BCU util/Data.java 상수, 계산은 battle/entity/EUnit 기준
  const slots = GD.orbs?.slots?.[c.id];
  const orbOk = !!slots && fi >= 2;
  const orbs = orbOk ? slots.map((_, i) => (state.orbs ?? store.data?.orbEquip?.[c.id])?.[i] || null) : [];
  const orbFx = { str: {}, mas: {}, lines: [], notes: [] };  // str/mas: 속성별 배율 추가분
  for (const sel of orbs) {
    if (!sel) continue;
    const [k, attr, g] = sel, t = GD.orbs.traits[attr], G = ORB_GRADE[g];
    if (k === 0) orbFx.lines.push([`${t}에게 (본능옥 데미지 업 ${G})`, total + s.atk.reduce((a, raw) => a + Math.trunc(ORB_ATK[g] * raw / 100), 0)]);
    else if (k === 1) orbFx.notes.push(`${t}에게 받는 데미지 −${ORB_RES[g]}% (본능옥 데미지 경감 ${G})`);
    else if (k === 2) orbFx.str[t] = (orbFx.str[t] || 0) + ORB_STR[g];
    else if (k === 3) orbFx.mas[t] = (orbFx.mas[t] || 0) + ORB_MAS[g];
    else if (k === 4) orbFx.notes.push(`${t}에게 맷집이 좋다 효과 강화 +${ORB_RESIST[g]} (본능옥 ${G})`);
  }

  // 상황별 공격력 (본능 반영 후 능력 기준). 배율: 엄청 강하다 ×1.8 · 초 데미지 ×4 (보물 최대), 크리티컬 ×2
  const abOf = k => T.ab.find(a => a[0] === k);
  const toT = traits.length ? traits.join("·") : "대상 속성";
  // 엄청 강하다·초 데미지: 본능옥으로 강화된 속성은 따로 한 줄
  const multLines = (key, label, base, add) => {
    if (!abOf(key)) return [];
    const boosted = traits.filter(t => add[t]);
    const rest = traits.filter(t => !add[t]);
    return [
      (rest.length || !boosted.length) && [`${rest.length ? rest.join("·") : toT}에게 (${label}, ×${base})`, base],
      ...boosted.map(t => [`${t}에게 (${label} + 본능옥, ×${+(base + add[t]).toFixed(2)})`, base + add[t]]),
    ].filter(Boolean);
  };
  const cond = [
    abOf("strengthen") && [`공격력 업 (체력 ${abOf("strengthen")[1]}% 이하, +${abOf("strengthen")[2]}%)`, 1 + abOf("strengthen")[2] / 100],
    ...multLines("strong", "엄청 강하다", 1.8, orbFx.str),
    ...multLines("massive", "초 데미지", 4, orbFx.mas),
    abOf("savage") && [`혼신의 일격 발동 (${abOf("savage")[1]}%, +${abOf("savage")[2]}%)`, 1 + abOf("savage")[2] / 100],
    abOf("crit") && [`크리티컬 발동 (${abOf("crit")[1]}%, ×2)`, 2],
    ...orbFx.lines.map(([label, v]) => [label, null, v]),  // 값이 정해진 줄 (배율 대신)
  ].filter(Boolean);
  const abil = T.ab.map(a => `<li${T.touched.has(a[0]) ? ` class="tal-ab"` : ""}>${esc(abilityText(a, traits))}${T.touched.has(a[0]) ? "<em>본능</em>" : ""}</li>`);
  if (s.area) abil.unshift("<li>범위 공격</li>");
  if (ld) abil.unshift(`<li>원거리 공격 (${ld})</li>`);
  if (s.atk.length > 1) abil.push(`<li>${s.atk.length}회 연속 공격</li>`);

  // 진화 재료 + 내 보유량(재화 정보가 있으면) + 육성 계획 담기
  const known = !!store.data?.inv;
  const owns = (n, h) => known ? ` <span class="${h >= n ? "own-ok" : "own-lack"}">(보유 ${h.toLocaleString()}${h < n ? ` · ${(n - h).toLocaleString()} 부족` : ""})</span>` : "";
  // 이미 그 단계까지 진화한 보유 캐릭: 완료 표시만, 쓴 재료는 접어 둔다
  const evoDone = (title, e, step) => `<div class="panel"><h2>${title}</h2>
      <p class="evo-done">✓ ${STEP_NAME[step]} 완료</p>
      ${e?.items?.length || e?.xp ? `<details class="calc-note"><summary>진화 재료</summary><dl class="kv">
        ${e.xp ? `<dt>경험치</dt><dd>${num(e.xp)} XP</dd>` : ""}
        ${e.items.length ? `<dt>재료</dt><dd>${e.items.map(([id, k]) => `<span class="item-line">${itemIcon(id)}${esc(itemName(id))} ×${k}</span>`).join("")}</dd>` : ""}
      </dl></details>` : ""}</div>`;
  const evo = (title, e, need, step) => o && o.form >= (step === "tf" ? 2 : 3) ? evoDone(title, e, step)
    : e || need != null ? `<div class="panel"><h2>${title}</h2><dl class="kv">
      ${need != null ? `<dt>필요 레벨</dt><dd>${need > 0 ? `Lv ${need}` : "특정 스테이지 클리어"}${o && need > 0 ? owns(need, o.level).replace("보유", "현재") : ""}</dd>` : ""}
      ${e?.xp ? `<dt>경험치</dt><dd>${num(e.xp)} XP${owns(e.xp, haveXp())}</dd>` : ""}
      ${e?.items?.length ? `<dt>재료</dt><dd>${e.items.map(([id, k]) => `<span class="item-line">${itemIcon(id)}${esc(itemName(id))} ×${k}${owns(k, have(id))}</span>`).join("")}</dd>` : ""}
    </dl>${e ? `<div style="margin-top:12px"><button class="btn" data-plan="${step}">${inPlan(c.id, step) ? "육성 계획에서 빼기" : "육성 계획에 담기"}</button></div>` : ""}</div>` : "";

  const mine = o ? `<dl class="kv">
        <dt>진화</dt><dd>${FORM[o.form]} · ${esc(c.forms[Math.min(o.form, c.forms.length - 1)].name)}</dd>
        <dt>레벨</dt><dd>Lv ${o.level}${o.plus ? ` +${o.plus}` : ""} <span class="lvmax">/ ${c.maxLevel}${c.maxPlus ? "+" + c.maxPlus : ""}</span></dd>
        ${c.talents.length ? `<dt>본능</dt><dd>${v.talents.map(t => `${esc(t.name)} ${t.lv}/${t.max}`).join("<br>")}</dd>` : ""}
      </dl><div><button class="btn" data-edit>수정</button></div>`
    : `<p class="note" style="margin:0 0 10px">아직 내 도감에 없는 캐릭터예요.</p><div><button class="btn primary" data-edit>보유로 추가</button></div>`;

  root.innerHTML = `
    <p class="crumb"><a href="#/">냥코위키</a><i>/</i><a href="#/cats">캐릭터</a><i>/</i><span>${esc(c.forms[c.forms.length - 1].name)}</span></p>
    <section class="detail-head">
      ${icon(c, fi)}
      <div>
        <div class="badges">${rarBadge(c)}<span class="cid">#${c.id}</span>${o ? `<span class="tag own">보유 · ${FORM[o.form]}</span>` : ""}</div>
        <h1>${esc(f.name)}</h1>
        <div class="sub">${c.forms.map((x, i) => i === fi ? `<b>${esc(x.name)}</b>` : esc(x.name)).join(" → ")}</div>
        ${u.desc[fi] ? `<p class="desc">${esc(u.desc[fi])}</p>` : ""}
      </div>
    </section>
    <div class="formtabs" role="group" aria-label="진화 단계">${c.forms.map((x, i) =>
      `<button data-form="${i}" aria-pressed="${i === fi}">${icon(c, i)}${FORM[i]}</button>`).join("")}</div>
    <div class="cols">
      <div>
        <div class="panel">
          <h2>스탯 <span class="ctl">Lv <input type="number" id="sLv" min="1" max="${c.maxLevel}" value="${lv}">
            ${c.maxPlus ? `+ <input type="number" id="sPlus" min="0" max="${c.maxPlus}" value="${plus}">` : ""}</span></h2>
          ${c.talents.length ? (talOk ? `<div class="seg" role="group" aria-label="본능 적용">${[["none", "본능 미적용"], ...(o ? [["mine", "내 본능"]] : []), ["max", "본능 전부 최대"]]
              .map(([k, l]) => `<button data-tal="${k}" aria-pressed="${mode === k}">${l}</button>`).join("")}</div>`
            : `<p class="note" style="margin:0 0 10px">본능은 3진부터 적용돼요.</p>`) : ""}
          ${statBlock()}
          ${cond.length ? `<div class="cond"><small>상황별 공격력${hits.length > 1 ? " (합계)" : ""}</small>${cond.map(([label, x, v]) =>
            `<div><span>${esc(label)}</span><b>${num(v ?? total * x)}</b></div>`).join("")}</div>` : ""}
          ${orbFx.notes.length ? `<div class="cond"><small>본능옥 효과</small>${orbFx.notes.map(n => `<div><span>${esc(n)}</span></div>`).join("")}</div>` : ""}
          <details class="calc-note"><summary>계산 기준</summary><p class="note">체력·공격력은 보물 최대 기준, 괄호 안 엄강·초뎀 등은 보물 없음~최대 범위예요. 쿨타임은 연구력 Lv20+10·보물 최대 기준이고, F는 프레임(30F = 1초)이에요. 공격빈도 = 마지막 타 선딜 + max(공격간격 − 1, 후딜). DPS = 공격력 ÷ 공격빈도. ${talOk && mode !== "none" ? "주황색 칸은 본능으로 바뀐 값이에요." : ""}</p></details>
        </div>
        ${slots ? `<div class="panel"><h2>본능옥 <span class="ctl">슬롯 ${slots.length}개</span></h2>${orbOk
          ? `<div class="orb-slots">${slots.map((cond, i) => orbSlotHtml(i, cond, orbs[i])).join("")}</div>
             <p class="note">장착한 본능옥은 세이브에서 읽을 수 없어서 직접 골라요. 효과는 위 상황별 공격력·본능옥 효과에 반영돼요.</p>`
          : `<p class="note" style="margin:0">본능옥은 3진부터 장착할 수 있어요.</p>`}</div>` : ""}
        <div class="panel">
          <h2>타겟 속성 · 능력</h2>
          ${traits.length ? traitChips(traits) : `<p class="note" style="margin:0">타겟 속성 없음</p>`}
          <ul class="ab-list" style="margin-top:10px">${abil.length ? abil.join("") : `<li class="none">특수 능력 없음</li>`}</ul>
        </div>
        ${c.talents.length ? `<div class="panel"><h2>본능</h2><div class="tal-list">${c.talents.map(t =>
          `<div class="tal${t.ultra ? " u" : ""}"><b>${esc(t.name)}</b><small>${t.ultra ? "초본능 · " : ""}최대 Lv${t.max}</small>
            ${u.talentDesc[t.id] ? `<p>${esc(u.talentDesc[t.id])}</p>` : ""}</div>`).join("")}</div></div>` : ""}
      </div>
      <div>
        <div class="panel mine"><h2>내 보유 상태</h2>${mine}</div>
        ${c.forms.length >= 3 ? evo("3진 진화", u.tf, c.tfLevel, "tf") : ""}
        ${c.forms.length >= 4 ? evo("4진 진화", u.ff, c.ffLevel, "ff") : ""}
        ${levelPanel(c, o)}
        <div class="panel" id="getPanel"><h2>얻는 방법</h2><p class="note" style="margin:0">불러오는 중…</p></div>
        <div class="panel"><h2>기본 정보</h2><dl class="kv">
          <dt>레어도</dt><dd>${rarBadge(c)}</dd>
          <dt>최대 레벨</dt><dd>${c.maxLevel}${c.maxPlus ? ` + ${c.maxPlus}` : ""}</dd>
          <dt>진화 단계</dt><dd>${c.forms.length}단계</dd>
        </dl>
        <!-- 냥코DB(battlecats-db.com) 캐릭 번호 = ID + 1 -->
        <p style="margin:12px 0 0"><a class="btn" href="https://battlecats-db.com/unit/${String(c.id + 1).padStart(3, "0")}.html" target="_blank" rel="noopener">냥코DB에서 보기 ↗</a></p></div>
      </div>
    </div>`;

  document.title = `${f.name} - 냥코위키`;
  root.querySelectorAll("[data-form]").forEach(b => b.onclick = () => { state.form = +b.dataset.form; paint(root, c, u); });
  root.querySelectorAll("[data-tal]").forEach(b => b.onclick = () => { state.tal = b.dataset.tal; paint(root, c, u); });
  // 본능옥 선택: 화면 상태에 두고, 내 도감 데이터가 있으면 캐릭별로 저장 (다음에 열어도 유지)
  root.querySelectorAll(".orb-slot select").forEach(sel => sel.onchange = () => {
    const slot = sel.closest(".orb-slot"), i = +slot.dataset.slot;
    const k = +slot.querySelector('[data-orb="k"]').value;
    let attr = +slot.querySelector('[data-orb="attr"]').value, g = +slot.querySelector('[data-orb="g"]').value;
    if (k >= 0 && !GD.orbs.list.some(o => o[0] === k && o[1] === attr)) attr = GD.orbs.list.find(o => o[0] === k)[1];
    state.orbs = orbs.slice();
    state.orbs[i] = k < 0 ? null : [k, attr, Number.isFinite(g) ? g : 0];
    if (store.data) { store.data.orbEquip ??= {}; store.data.orbEquip[c.id] = state.orbs; store.persist(true); }
    paint(root, c, u);
  });
  root.querySelectorAll("[data-plan]").forEach(b => b.onclick = () =>
    inPlan(c.id, b.dataset.plan) ? removeFromPlan(c.id, b.dataset.plan) : addToPlan(c.id, b.dataset.plan));
  const onLv = () => {
    state.level = clamp(parseInt(root.querySelector("#sLv").value) || 1, 1, c.maxLevel);
    state.plus = c.maxPlus ? clamp(parseInt(root.querySelector("#sPlus").value) || 0, 0, c.maxPlus) : 0;
    paint(root, c, u);
    root.querySelector("#sLv").focus();
  };
  root.querySelector("#sLv").onchange = onLv;
  root.querySelector("#sPlus")?.addEventListener("change", onLv);
  root.querySelector("[data-edit]").onclick = () => openEdit(c.id);
  const toInp = root.querySelector("#lvTo");
  if (toInp) {
    toInp.onchange = () => { state.to = clamp(parseInt(toInp.value) || 1, 1, c.maxLevel); paint(root, c, u); root.querySelector("#lvTo").focus(); };
    root.querySelector("[data-lvplan]")?.addEventListener("click", () => addToPlan(c.id, "lv", state.to ?? +toInp.value));
  }
  paintGet(root, c);
}

// 레벨업 비용: 지금 레벨(미보유면 1)에서 목표 레벨까지 경험치·캣츠아이
function levelPanel(c, o) {
  if (!GD.xpCurves) return "";
  const from = o ? o.level : 1;
  const to = clamp(state.to ?? Math.min(Math.max(from + 1, 30), c.maxLevel), 1, c.maxLevel);
  const cost = levelCost(c, from, Math.max(from, to));
  return `<div class="panel"><h2>레벨업 비용 <span class="ctl">Lv${from} → <input type="number" id="lvTo" min="1" max="${c.maxLevel}" value="${to}"></span></h2>
    ${from >= c.maxLevel ? `<p class="note" style="margin:0">이미 최대 레벨(Lv${c.maxLevel})이에요.</p>`
      : to <= from ? `<p class="note" style="margin:0">목표 레벨을 Lv${from}보다 높게 입력하세요.</p>` : `<dl class="kv">
      <dt>경험치</dt><dd>${num(cost.xp)} XP${store.data?.inv ? ` <span class="${haveXp() >= cost.xp ? "own-ok" : "own-lack"}">(보유 ${num(haveXp())})</span>` : ""}${cost.est ? ` <span class="est" title="51레벨 이상 경험치는 공개 자료로 확인하지 못한 추정값">추정</span>` : ""}</dd>
      ${cost.items.length ? `<dt>캣츠아이</dt><dd>${cost.items.map(([id, n]) => `<span class="item-line">${itemIcon(id)}${esc(itemName(id))} ×${n}${store.data?.inv ? ` <span class="${have(id) >= n ? "own-ok" : "own-lack"}">(보유 ${have(id)})</span>` : ""}</span>`).join("")}</dd>` : ""}
    </dl><div style="margin-top:12px"><button class="btn" data-lvplan>육성 계획에 담기</button></div>`}
    ${o ? "" : `<p class="note">미보유라 1레벨부터 계산했어요.</p>`}</div>`;
}

// 얻는 방법: 기본 캐릭 해금·뽑기·스테이지 드롭 (게임 데이터에 있는 것만)
function paintGet(root, c) {
  const g = c.get || {}, lines = [];
  if (g.unlock) lines.push(c.id === 0 ? "처음부터 보유" : `세계편 1장 「${esc(g.unlock[0] ?? "?")}」 클리어 후 ${g.unlock[1] ? `경험치 ${num(g.unlock[1])}로 구매` : "무료로 얻음"}`);
  if (g.src === 1) lines.push("냥코 뽑기");
  if (g.src === 2) lines.push(g.rare ? `레어 뽑기${c.rarity === 5 ? " (레전드레어)" : ""}` : "뽑기 (이벤트·콜라보 뽑기 등)");
  loadDrops().then(([drops, idx]) => {
    const box = root.querySelector("#getPanel"); if (!box) return;
    const names = new Map(idx.categories.flatMap(cat => cat.maps.map(([mid, n]) => [mid, n])));
    const list = (drops[c.id] || []).filter(([mid]) => names.has(mid));
    box.innerHTML = `<h2>얻는 방법</h2>
      ${lines.length ? `<ul class="get-list">${lines.map(l => `<li>${l}</li>`).join("")}</ul>` : ""}
      ${list.length ? `<h3 class="sum-title">스테이지 드롭</h3><ul class="get-list drops">${list.map(([mid, si, ch, all, sname]) =>
        `<li><a href="#/stage/${mid}/${si}">${esc(names.get(mid))} · ${esc(sname)}</a><b>${all ? "확정" : ch != null ? `${ch}%` : ""}</b></li>`).join("")}</ul>` : ""}
      ${!lines.length && !list.length ? `<p class="note" style="margin:0">이벤트·미션·콜라보 보상 등으로 얻는 캐릭이에요. 구체적인 입수처는 게임 데이터에 없어요.</p>`
        : g.src ? `<p class="note">뽑기 이름(배너)은 서버에서 그때그때 받는 정보라 게임 데이터에 없어요.</p>` : ""}`;
  }).catch(() => {});
}
