"""레어 뽑기 세트 → 캐릭 목록 (일정 페이지에서 뽑기 배너의 캐릭을 보여줄 때 씀).

GatyaDataSetR1.csv: 줄 번호 = 이벤트 데이터(gatya.tsv)의 세트 번호, 줄 = 캐릭 ID 목록 (-1 로 끝남).
GatyaData_Option_SetR.tsv 의 CharaID = 배너 대표 캐릭 (콜라보 캐릭은 세트 목록에 없고 여기에만 있기도 하다).
노말·이벤트 뽑기(N1·E1)는 지금 일정에 나오는 세트가 전부 아이템 뽑기라 캐릭이 없어서 안 넣는다.
사용: python tools/build_gatya_sets.py [--version 15.6.0] → docs/data/gatya_sets.json
"""
from __future__ import annotations

import argparse
import json
import os

from build_gamedata import SITE, game_data_dir, read


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default="15.6.0")
    args = ap.parse_args(argv)
    G, _ = game_data_dir(args.version)
    sets = []
    for line in read(os.path.join(G, "DataLocal", "GatyaDataSetR1.csv")):
        ids = []
        for x in line.split(","):
            x = x.strip()
            if not x.lstrip("-").isdigit() or int(x) < 0:
                break
            ids.append(int(x))
        sets.append(ids)
    pick = {}
    rows = read(os.path.join(G, "DataLocal", "GatyaData_Option_SetR.tsv"))
    head = rows[0].split("\t")
    for line in rows[1:]:
        r = dict(zip(head, line.split("\t")))
        if r.get("GatyaSetID", "").isdigit() and int(r.get("CharaID") or -1) >= 0:
            pick[r["GatyaSetID"]] = int(r["CharaID"])
    out = os.path.join(SITE, "data", "gatya_sets.json")
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"sets": sets, "pick": pick}, f, separators=(",", ":"))
    print(f"{out}: 세트 {len(sets)}개, 대표 캐릭 {len(pick)}개")


if __name__ == "__main__":
    main()
