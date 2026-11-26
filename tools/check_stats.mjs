// 사이트 캐릭 스탯 계산(docs/js/cat.js)이 확인한 값과 맞는지 검사한다. check_values.py 가 node 로 부른다.
// 사용: node tools/check_stats.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const docs = fileURLToPath(new URL("../docs/", import.meta.url));
globalThis.window = {};
vm.runInThisContext(readFileSync(docs + "gamedata.js", "utf8"));  // window.GAMEDATA
globalThis.localStorage = { getItem: () => null, setItem() {} };
const { levelMult, calcHp, calcAtk } = await import(pathToFileURL(docs + "js/cat.js"));
const units = JSON.parse(readFileSync(docs + "data/units.json", "utf8"));

// [캐릭 ID, 진화 단계, 레벨+플러스, 체력, 공격력(합)] — 고양이 Lv20+90 = battlecats-db 값
const CASES = [[0, 0, 110, 4450, 355]];
let bad = 0;
for (const [id, fi, lv, hp, atk] of CASES) {
  const u = units[id], s = u.forms[fi], m = levelMult(u.curve, lv);
  const got = [calcHp(s.hp, m, 0), s.atk.reduce((a, x) => a + calcAtk(x, m, 0), 0)];
  if (got[0] !== hp || got[1] !== atk) { bad++; console.error(`#${id} ${fi + 1}진 Lv${lv}: ${got} (확인한 값 ${hp},${atk})`); }
}
if (bad) process.exit(1);
console.log("스탯 검사 통과");
