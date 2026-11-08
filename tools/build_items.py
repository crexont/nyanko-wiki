"""아이템 페이지용 데이터를 빌드한다 (개발용, build_stages.py 다음에 실행).

스테이지 데이터(docs/data/stages/*.json)의 드롭을 아이템별로 모아, 반복 클리어 1번에 얻는
개수 기대값과 1회 한정 보상을 따로 계산한다 (반복 계산은 build_np.repeat_drops 와 같다).
1회 한정이 다시 받아지는지는 맵 옵션으로 나눈다 (DataLocal/Map_option.csv):
  報酬リセットType (BCU MapColc resetMode): 0 초기화 없음, 1 열릴 때마다 보상 초기화,
    2 열릴 때마다 클리어 기록 초기화, 3 열릴 때마다 도전 횟수 초기화.
  1度きり表示 + インターバル(분): 사이트 items.js 가 분류한다.
    3 = 강습처럼 단계를 차례로 깨는 맵 (마지막 단계만 インターバル 분마다 반복),
    1·2·5 = 스테이지를 한 번 깨면 끝 (インターバル 가 있으면 그 시간 뒤 다시 도전 가능).

출력: docs/data/items.json
  {"names": {아이템: 이름}, "noIcon": [아이콘 그림이 없는 아이템],
   "maps": {맵: [보상 초기화 종류, 1회 표시, 다시 도전까지 분, 광고 XP 2배, 스테이지 수] (앞의 넷이 다 0인 맵은 뺀다)},
   "drops": {아이템: [[맵, 스테이지, 반복 기대 개수, 1회 한정 개수, 통솔력 칸 값, 스테이지 이름, (레이더 확정 개수), (XP만: 클리어 XP)], ...]}}
  레이더 확정 개수: 트레저 레이더를 쓰면 확정되는 개수 (기대값보다 클 때만, 없으면 0 또는 생략)
  통솔력 칸 값: 고양이 드링크 스테이지(14000번대)는 드링크(종류×1000 + 개수), 100000 이상은 아이템 입장(아이템×1000 + 개수)
사용: python tools/build_items.py [--version 15.7.0]
"""
from __future__ import annotations

import argparse
import json
import os
import re

from build_gamedata import SITE, game_data_dir, read
from build_np import repeat_drops, stage_files

STAGES = os.path.join(SITE, "data", "stages")
MAX_ITEM = 1000  # 1000 이상은 캐릭 드롭, 30000 이상은 본능옥
XP_DROP = 6      # 아이템 6 = XP (개수 = XP 양)
XP_ONLY = 300    # 드롭 없이 클리어 XP만 주는 스테이지는 효율 좋은 것만 넣는다
ITEM_COST = 100000


def built_for() -> str:
    with open(os.path.join(SITE, "gamedata.js"), encoding="utf-8") as f:
        m = re.search(r'"builtFor":"([\d.]+)"', f.read())
    return m.group(1) if m else "15.6.0"


def map_options(version: str) -> dict[int, list[int]]:
    """맵 번호 → [보상 초기화 종류, 1회 표시, 다시 도전까지 분, 광고 XP 2배]
    (Map_option.csv "報酬リセットType", "1度きり表示", "インターバル", "XP2倍広告")."""
    G, _ = game_data_dir(version)
    lines = read(os.path.join(G, "DataLocal", "Map_option.csv"))
    head = lines[0].split(",")
    cols = [head.index("報酬リセットType"), head.index("1度きり表示"), head.index("インターバル"), head.index("XP2倍広告")]
    out = {}
    for l in lines[1:]:
        r = l.split(",")
        if len(r) > max(cols) and r[0].strip().isdigit():
            out[int(r[0])] = [int(r[c]) for c in cols]
    return out


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default=None, help="게임 버전 (기본: gamedata.js builtFor)")
    args = ap.parse_args(argv)
    opts = map_options(args.version or built_for())

    idx = json.load(open(os.path.join(STAGES, "index.json"), encoding="utf-8"))
    names = {int(k): v for k, v in idx["items"].items()}
    drops: dict[int, list] = {}
    xp_only: list = []  # 드롭은 없고 클리어 XP만 있는 스테이지 (XP 페이지용, 아래에서 효율 좋은 것만)
    n_stages: dict[int, int] = {}
    for _code, maps in stage_files(STAGES):
        for mid, m in maps.items():
            n_stages[int(mid)] = max((st["i"] for st in m["stages"]), default=-1) + 1
            for st in m["stages"]:
                d = st.get("drop") or []
                if not d:
                    if st.get("xp") and 0 < (st.get("energy") or 0) < ITEM_COST:
                        xp_only.append([int(mid), st["i"], 0, 0, st.get("energy"), st["n"], 0, st["xp"]])
                    continue
                rep = repeat_drops(st)
                if not rep and st.get("dropAll"):
                    rep = [[i, n, 100] for i, n, _p in (d[1:] if st.get("dropOnce") else d)]
                per: dict[int, float] = {}
                for i, n, p in rep:
                    per[i] = per.get(i, 0) + n * p / 100
                once: dict[int, int] = {}
                if st.get("dropOnce") and d[0][2] != 0:
                    once[d[0][0]] = d[0][1]
                # 트레저 레이더를 쓰면 드롭 중 개수가 가장 많은 칸이 확정 (확률로 나오는 아이템만, build_np 와 같다)
                top: dict[int, int] = {}
                for i, n, p in rep:
                    if p < 100:
                        top[i] = max(top.get(i, 0), n)
                if st.get("xp") and XP_DROP not in per and XP_DROP not in once and 0 < (st.get("energy") or 0) < ITEM_COST:
                    xp_only.append([int(mid), st["i"], 0, 0, st.get("energy"), st["n"], 0, st["xp"]])
                for i in set(per) | set(once):
                    if 0 <= i < MAX_ITEM:
                        row = [int(mid), st["i"], round(per.get(i, 0), 4), once.get(i, 0), st.get("energy"), st["n"]]
                        t = top.get(i, 0) if top.get(i, 0) > per.get(i, 0) + 1e-6 else 0
                        if i == XP_DROP:
                            row += [t, st.get("xp") or 0]
                        elif t:
                            row.append(t)
                        drops.setdefault(i, []).append(row)
    # XP: 드롭 없는 스테이지는 클리어 XP ÷ 통솔력 상위 XP_ONLY 개만 (옛 버전 맵 제외)
    old = {m[0] for c in idx["categories"] for m in c["maps"] if "(옛 버전)" in m[1]}
    xp_only = sorted((r for r in xp_only if r[0] not in old), key=lambda r: -r[7] / r[4])[:XP_ONLY]
    drops.setdefault(XP_DROP, []).extend(xp_only)
    used = {r[0] for rows in drops.values() for r in rows}
    icons = {int(f[:-4]) for f in os.listdir(os.path.join(SITE, "icons", "items")) if f[:-4].isdigit()}
    out = {"names": {i: names.get(i) or f"아이템 {i}" for i in sorted(drops)},
           "noIcon": [i for i in sorted(drops) if i not in icons],
           "maps": {m: opts[m] + [n_stages.get(m, 0)] for m in sorted(used) if any(opts.get(m, []))},
           "drops": {i: drops[i] for i in sorted(drops)}}
    path = os.path.join(SITE, "data", "items.json")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{path}: 아이템 {len(drops)}종, 드롭 {sum(map(len, drops.values()))}줄, 옵션 있는 맵 {len(out['maps'])}개")


if __name__ == "__main__":
    main()
