"""NP효율 페이지용 데이터를 빌드한다 (개발용, build_stages.py 다음에 실행).

- 중복 캐릭 NP: unitbuy.csv 58열 (레어도 13열별로 모은다)
- 본능옥 분해 NP: equipmentgrade.csv 2열 (D C B A S), 본능옥 등급: equipmentlist.json "ID"[번호].gradeID
- 본능옥 드롭: 스테이지 보상 아이템 30000 + 본능옥 번호 (docs/data/stages/*.json)
- 강습 → EX 스테이지: EX_group.csv `100, 강습 맵, 스테이지, (EX 번호, %)…`
  쌍을 앞에서부터 남은 확률에 차례로 굴린다 (마지막은 100 = 나머지 전부). EX 번호가 큰 쪽이 비경 → 정점 → 기원.
- 고양이 드링크 A 값: itemShopData.tsv (가격 ÷ 개수)

출력: docs/data/np.json
사용: python tools/build_np.py [--version 15.6.0]
"""
from __future__ import annotations

import argparse
import collections
import json
import os

from build_gamedata import SITE, game_data_dir, read
from build_stages import SKIP_FILES

ORB = 30000          # 보상 아이템 번호 - ORB = 본능옥 번호
CAT_TICKET, RARE_TICKET = 20, 21
DRINK_A = 55
# 강습 EX 스테이지 (기원·정점·비경 × 6속성). 같은 이름의 지도 스테이지(25009~)와 드롭이 달라서 번호로 고른다.
EX_MAPS = range(25033, 25051)


def stage_files(out_dir: str):
    for f in sorted(os.listdir(out_dir)):
        if f.endswith(".json") and f not in SKIP_FILES:
            yield f[:-5], json.load(open(os.path.join(out_dir, f), encoding="utf-8"))


def repeat_drops(st: dict) -> list:
    """반복 클리어로 얻는 드롭 [아이템, 개수, 확률%] (확률 없는 것·1회 한정 첫 보상은 뺀다)."""
    d = st.get("drop") or []
    if st.get("dropOnce"):
        d = d[1:]
    return [x for x in d if x[2]]


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default="15.6.0")
    args = ap.parse_args(argv)
    G, _ = game_data_dir(args.version)
    D = os.path.join(G, "DataLocal")

    # 중복 NP: 레어도마다 가장 흔한 값 (기본·EX·레어·슈레·울슈레·레전드)
    by = collections.defaultdict(collections.Counter)
    for l in read(os.path.join(D, "unitbuy.csv")):
        r = l.split(",")
        if len(r) > 58 and r[13].strip().isdigit() and r[58].strip().isdigit():
            by[int(r[13])][int(r[58])] += 1
    dupe = [by[i].most_common(1)[0][0] for i in range(6)]

    grade_np = [int(l.split(",")[1]) for l in read(os.path.join(D, "equipmentgrade.csv"))
                if l.strip() and not l.startswith("//")]
    orbs = json.load(open(os.path.join(D, "equipmentlist.json"), encoding="utf-8"))["ID"]

    def orb_np(drop: list) -> tuple[float, list[float]]:
        """한 번 클리어할 때 본능옥 NP 기대값과 등급별 확률(%)."""
        ev, grades = 0.0, [0.0] * len(grade_np)
        for item, n, p in drop:
            if item >= ORB and item - ORB < len(orbs):
                g = orbs[item - ORB]["gradeID"]
                ev += p / 100 * n * grade_np[g]
                grades[g] += p
        return round(ev, 4), [round(x, 2) for x in grades]

    out_dir = os.path.join(SITE, "data", "stages")
    stages = dict(stage_files(out_dir))
    maps = {int(mid): (code, m) for code, ms in stages.items() for mid, m in ms.items()}

    # 본능옥 스테이지 (지도·EX)
    orb_maps, ex_tier = [], {}
    for mid, (code, m) in sorted(maps.items()):
        for st in m["stages"]:
            ev, grades = orb_np(repeat_drops(st))
            if not ev:
                continue
            if mid in EX_MAPS:
                tier = next(i for i, w in enumerate(("기원", "정점", "비경")) if w in m["n"])
                ex_tier.setdefault(tier, set()).add(ev)
            else:
                orb_maps.append({"map": mid, "i": st["i"], "name": m["n"], "stage": st["n"], "energy": st.get("energy"),
                                 "np": ev, "grades": grades})
    # EX 스테이지 NP는 속성과 상관없이 단계마다 같다 (다르면 빌드를 멈춘다)
    assert all(len(v) == 1 for v in ex_tier.values()), ex_tier
    ex_np = [ex_tier[i].pop() for i in range(3)]

    # 강습 스테이지별 EX 확률 [기원, 정점, 비경] (%)
    behemoth = {}
    for l in read(os.path.join(D, "EX_group.csv")):
        r = [int(x) for x in l.split("//")[0].split(",") if x.strip().lstrip("-").isdigit()]
        if len(r) < 5 or r[1] not in maps or maps[r[1]][0] != "A":
            continue
        mid, si, pairs = r[1], r[2], list(zip(r[3::2], r[4::2]))
        if mid not in behemoth:
            behemoth[mid] = {"exIds": set(), "stages": {}}
        rest, probs = 100.0, {}
        for ex, p in pairs:
            probs[ex] = rest * p / 100
            rest -= probs[ex]
            behemoth[mid]["exIds"].add(ex)
        behemoth[mid]["stages"][si] = probs
    beh_out = []
    for mid, b in sorted(behemoth.items()):
        ids = sorted(b["exIds"])  # 작은 번호부터 기원 · 정점 · 비경
        if len(ids) != 3:
            continue
        m = maps[mid][1]
        rows = []
        for st in m["stages"]:
            pr = b["stages"].get(st["i"])
            if pr:
                rows.append({"i": st["i"], "name": st["n"], "energy": st.get("energy"),
                             "ex": [round(pr.get(x, 0), 2) for x in ids]})
        beh_out.append({"map": mid, "name": m["n"], "stages": rows})

    # 냥코 티켓·레어 티켓을 반복해서 얻는 스테이지 (고양이 드링크 스테이지 B는 통솔력이 아니라서 뺀다)
    tickets = []
    for mid, (code, m) in sorted(maps.items()):
        if code == "B":
            continue
        for st in m["stages"]:
            d = repeat_drops(st)
            cat = sum(n * p / 100 for item, n, p in d if item == CAT_TICKET)
            rare = sum(n * p / 100 for item, n, p in d if item == RARE_TICKET)
            if cat or rare:
                tickets.append({"map": mid, "i": st["i"], "name": m["n"], "stage": st["n"], "energy": st.get("energy"),
                                "cat": round(cat, 3), "rare": round(rare, 3)})

    drink = None
    rows = read(os.path.join(D, "itemShopData.tsv"))
    head = rows[0].split("\t")
    for line in rows[1:]:
        r = dict(zip(head, line.split("\t")))
        if r.get("gatyaItemID") == str(DRINK_A):
            drink = int(r["ItemPrice"]) / int(r["ItemValue"])

    data = {"dupe": dupe, "gradeNp": grade_np, "exNp": ex_np, "drinkA": drink,
            "behemoth": beh_out, "orbMaps": orb_maps, "tickets": tickets}
    out = os.path.join(SITE, "data", "np.json")
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{out}: 중복 NP {dupe}, 본능옥 NP {grade_np}, EX {ex_np}, 강습 {len(beh_out)}개, "
          f"본능옥 스테이지 {len(orb_maps)}개, 티켓 스테이지 {len(tickets)}개, 드링크 A {drink}통조림")


if __name__ == "__main__":
    main()
