"""아이템 페이지용 데이터를 빌드한다 (개발용, build_stages.py 다음에 실행).

스테이지 데이터(docs/data/stages/*.json)의 드롭을 아이템별로 모아, 반복 클리어 1번에 얻는
개수 기대값과 1회 한정 보상을 따로 계산한다 (반복 계산은 build_np.repeat_drops 와 같다).
1회 한정이 다시 받아지는지는 맵 옵션으로 나눈다 (DataLocal/Map_option.csv):
  報酬リセットType (BCU MapColc resetMode): 0 초기화 없음, 1 열릴 때마다 보상 초기화,
    2 열릴 때마다 클리어 기록 초기화, 3 열릴 때마다 도전 횟수 초기화.
  1度きり表示: 0이 아니면 스테이지 자체를 (초기화 전까지) 한 번만 깰 수 있다
    (강습 Lv 단계, 역습의 대갈이군·대역습의 메타쿠마, 고전장 지도 등. 사이트 items.js 가 분류한다).

출력: docs/data/items.json
  {"names": {아이템: 이름}, "noIcon": [아이콘 그림이 없는 아이템],
   "maps": {맵: [보상 초기화 종류, 1회 표시] (둘 다 0인 맵은 뺀다)},
   "drops": {아이템: [[맵, 스테이지, 반복 기대 개수, 1회 한정 개수, 통솔력 칸 값, 스테이지 이름], ...]}}
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


def built_for() -> str:
    with open(os.path.join(SITE, "gamedata.js"), encoding="utf-8") as f:
        m = re.search(r'"builtFor":"([\d.]+)"', f.read())
    return m.group(1) if m else "15.6.0"


def map_options(version: str) -> dict[int, list[int]]:
    """맵 번호 → [보상 초기화 종류, 1회 표시] (Map_option.csv "報酬リセットType", "1度きり表示")."""
    G, _ = game_data_dir(version)
    lines = read(os.path.join(G, "DataLocal", "Map_option.csv"))
    head = lines[0].split(",")
    cols = [head.index("報酬リセットType"), head.index("1度きり表示")]
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
    for _code, maps in stage_files(STAGES):
        for mid, m in maps.items():
            for st in m["stages"]:
                d = st.get("drop") or []
                if not d:
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
                for i in set(per) | set(once):
                    if 0 <= i < MAX_ITEM:
                        drops.setdefault(i, []).append(
                            [int(mid), st["i"], round(per.get(i, 0), 4), once.get(i, 0), st.get("energy"), st["n"]])
    used = {r[0] for rows in drops.values() for r in rows}
    icons = {int(f[:-4]) for f in os.listdir(os.path.join(SITE, "icons", "items")) if f[:-4].isdigit()}
    out = {"names": {i: names.get(i) or f"아이템 {i}" for i in sorted(drops)},
           "noIcon": [i for i in sorted(drops) if i not in icons],
           "maps": {m: opts[m] for m in sorted(used) if any(opts.get(m, []))},
           "drops": {i: drops[i] for i in sorted(drops)}}
    path = os.path.join(SITE, "data", "items.json")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{path}: 아이템 {len(drops)}종, 드롭 {sum(map(len, drops.values()))}줄, 옵션 있는 맵 {len(out['maps'])}개")


if __name__ == "__main__":
    main()
