"""빌드한 데이터가 손으로 확인한 값과 맞는지 검사한다 (update_gamedata 마지막 단계, 따로 실행해도 됨).
게임 업데이트로 값이 진짜 바뀌었으면 여기 숫자를 고친다. 캐릭 스탯(cat.js)은 node 가 있으면 check_stats.mjs 로 같이 본다.

사용: python tools/check_values.py
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess

from common import ROOT

DATA = os.path.join(ROOT, "docs", "data")


def load(name: str):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        return json.load(f)


def main() -> None:
    np_, items = load("np.json"), load("items.json")
    bad = []

    def check(what, got, want):
        if got != want:
            bad.append(f"{what}: {got!r} (확인한 값 {want!r})")

    check("중복 NP (unitbuy 58열)", np_["dupe"], [1, 1, 5, 15, 50, 150])
    check("본능옥 분해 NP", np_["gradeNp"], [1, 1, 2, 7, 25])
    tickets = {(t["map"], t["i"]): t for t in np_["tickets"]}
    hippo = tickets.get((1007, 0), {})
    check("역습의 하마양 통솔력·냥코 티켓", (hippo.get("energy"), hippo.get("cat")), (400, 1.0))
    check("수수께끼의 택배 처음 깰 때 (-3 하나만 1회)", tickets.get((1116, 0), {}).get("f"), [0.25, 0])
    q1 = next((g for g in np_["gachaStages"] if (g["map"], g["i"]) == (1282, 1)), {})
    check("물음표 박스 Q1 처음 깰 때", q1.get("f"), {"163": 1})
    # 마왕의 유혹: 클리어 XP × 4.7(보너스) × 1.5(고양이 박사) × 2(광고) + 레이더 확정 = 5,993,600 (사용자 실측과 일치)
    row = next((r for r in items["drops"]["6"] if r[:2] == [1319, 2]), None)
    check("마왕의 유혹 XP (레이더·박사·광고)", row and int(row[7] * 4.7 * 1.5 * 2) + row[9], 5_993_600)

    node = shutil.which("node")
    if node:
        r = subprocess.run([node, os.path.join(ROOT, "tools", "check_stats.mjs")], capture_output=True, text=True, encoding="utf-8")
        if r.returncode:
            bad.append("캐릭 스탯: " + (r.stderr or r.stdout).strip())
    else:
        print("node 가 없어서 캐릭 스탯 검사(check_stats.mjs)는 건너뜀")

    if bad:
        raise SystemExit("확인한 값과 다름:\n  " + "\n  ".join(bad))
    print("확인 값 검사 통과")


if __name__ == "__main__":
    main()
