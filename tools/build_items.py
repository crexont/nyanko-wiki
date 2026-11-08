"""아이템 페이지용 데이터를 빌드한다 (개발용, build_stages.py 다음에 실행).

스테이지 데이터(docs/data/stages/*.json)의 드롭을 아이템별로 모아, 반복 클리어 1번에 얻는
개수 기대값과 첫 클리어 1회 한정 보상을 따로 계산한다 (반복 계산은 build_np.repeat_drops 와 같다).

출력: docs/data/items.json
  {"names": {아이템: 이름}, "noIcon": [아이콘 그림이 없는 아이템],
   "drops": {아이템: [[맵, 스테이지, 반복 기대 개수, 첫 클리어 개수, 통솔력 칸 값, 스테이지 이름], ...]}}
  통솔력 칸 값: 개다래 스테이지(B)는 고양이 드링크(종류×1000 + 개수), 100000 이상은 아이템 입장(아이템×1000 + 개수)
사용: python tools/build_items.py
"""
from __future__ import annotations

import json
import os

from build_gamedata import SITE
from build_np import repeat_drops, stage_files

STAGES = os.path.join(SITE, "data", "stages")
MAX_ITEM = 1000  # 1000 이상은 캐릭 드롭, 30000 이상은 본능옥


def main(argv: list[str] | None = None) -> None:
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
    icons = {int(f[:-4]) for f in os.listdir(os.path.join(SITE, "icons", "items")) if f[:-4].isdigit()}
    out = {"names": {i: names.get(i) or f"아이템 {i}" for i in sorted(drops)},
           "noIcon": [i for i in sorted(drops) if i not in icons],
           "drops": {i: drops[i] for i in sorted(drops)}}
    path = os.path.join(SITE, "data", "items.json")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{path}: 아이템 {len(drops)}종, 드롭 {sum(map(len, drops.values()))}줄")


if __name__ == "__main__":
    main()
