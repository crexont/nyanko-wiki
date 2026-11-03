"""블루스택 5 Data.vhdx 에서 냥코(한국판) 세이브와 아이콘 팩만 읽기 전용으로 꺼낸다.

- 블루스택이 실행 중이면 중단 (vhdx 가 잠겨 있고, 쓰는 도중이라 데이터가 어긋날 수 있음)
- 인스턴스 폴더(Pie64, Rvc64 ...)를 자동으로 찾고, 여러 개면 세이브가 가장 최근인 것을 고른다
- 7-Zip(7z.exe) 필요

사용: python tools/extract_vhdx.py [--instance Pie64] [-o device] [--with-packs]
  --with-packs: 사이트 데이터를 다시 만들 때 필요한 *UnitServer 팩과 APK의 UnitLocal·DataLocal·resLocal 팩도 꺼낸다
"""
from __future__ import annotations

import argparse
import glob
import os
import re
import shutil
import subprocess
import sys
import tempfile

from common import ROOT

DEFAULT_OUT = os.path.join(ROOT, "device")
GAME_DIR = "data/jp.co.ponos.battlecatskr/files"
APP_DIR = "app/jp.co.ponos.battlecatskr*"  # 설치 폴더 이름 뒤에 임의 문자열이 붙는다
WANTED = ["SAVE_DATA"]
# 사이트 데이터 빌드용: 아이콘(UnitServer) + 공격 모션(ImageDataServer, DPS 계산) + 아이템 아이콘(ImageServer)
PACKS = ["*UnitServer.list", "*UnitServer.pack", "*ImageDataServer.list", "*ImageDataServer.pack",
         "*ImageServer.list", "*ImageServer.pack"]
BLUESTACKS_PROCS = ["HD-Player.exe"]


def reg_value(key: str, name: str) -> str | None:
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, key) as k:
            return winreg.QueryValueEx(k, name)[0]
    except OSError:
        return None


def find_7z() -> str:
    # 배포판은 exe 옆 7z/ 폴더에 동봉
    candidates = [os.path.join(ROOT, "7z", "7z.exe"), shutil.which("7z")]
    for key in (r"SOFTWARE\7-Zip", r"SOFTWARE\WOW6432Node\7-Zip"):
        d = reg_value(key, "Path64") or reg_value(key, "Path")
        if d:
            candidates.append(os.path.join(d, "7z.exe"))
    for pf in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")):
        if pf:
            candidates.append(os.path.join(pf, "7-Zip", "7z.exe"))
    for c in candidates:
        if c and os.path.isfile(c):
            return c
    sys.exit("7-Zip(7z.exe)을 찾지 못했습니다. https://www.7-zip.org 에서 설치해 주세요.")


def engine_dirs() -> list[str]:
    dirs = [reg_value(r"SOFTWARE\BlueStacks_nxt", "DataDir"),
            os.path.join(os.environ.get("ProgramData", r"C:\ProgramData"), "BlueStacks_nxt", "Engine")]
    seen, out = set(), []
    for d in dirs:
        if d and os.path.isdir(d) and os.path.normcase(os.path.abspath(d)) not in seen:
            seen.add(os.path.normcase(os.path.abspath(d)))
            out.append(d)
    return out


def running_bluestacks() -> list[str]:
    try:
        out = subprocess.run(["tasklist", "/FO", "CSV", "/NH"], capture_output=True,
                             text=True, errors="replace").stdout
    except OSError:
        return []
    names = {line.split('","')[0].strip('"').lower() for line in out.splitlines() if line}
    return [p for p in BLUESTACKS_PROCS if p.lower() in names]


def save_mtime(sz: str, vhdx: str) -> str | None:
    """vhdx 안 SAVE_DATA 의 수정 시각 (없으면 None)."""
    r = subprocess.run([sz, "l", "-slt", vhdx, f"{GAME_DIR}/SAVE_DATA"],
                       capture_output=True, text=True, errors="replace")
    # 앞부분은 vhdx/파티션 정보이고, 파일 항목은 마지막 "----------" 구분선 뒤에 나온다
    m = re.search(r"^Modified = (.+)$", r.stdout.split("----------")[-1], re.M)
    return m[1].strip()[:19] if r.returncode == 0 and m else None


def extract_apk_icons(sz: str, vhdx: str, out: str) -> None:
    """설치 APK(split_InstallPack.apk)의 assets/UnitLocal.*(기본 캐릭 아이콘), ImageDataLocal.*(기본 캐릭 공격 모션),
    ImageLocal.*(기본 아이템 아이콘)."""
    with tempfile.TemporaryDirectory() as tmp:
        r = subprocess.run([sz, "e", vhdx, f"-o{tmp}", "-y", "-r", f"{APP_DIR}/split_InstallPack.apk"],
                           capture_output=True, text=True, errors="replace")
        apk = os.path.join(tmp, "split_InstallPack.apk")
        if r.returncode != 0 or not os.path.exists(apk):
            print("  (APK 아이콘 팩을 찾지 못했습니다. 업데이트 팩 아이콘만 씁니다)")
            return
        subprocess.run([sz, "e", apk, f"-o{out}", "-y", "assets/UnitLocal.list", "assets/UnitLocal.pack",
                        "assets/ImageDataLocal.list", "assets/ImageDataLocal.pack",
                        "assets/ImageLocal.list", "assets/ImageLocal.pack",
                        # 게임 데이터 CSV (unpack_gamedata.py 가 bcsfe 게임 데이터 폴더로 푼다)
                        "assets/DataLocal.list", "assets/DataLocal.pack",
                        "assets/resLocal.list", "assets/resLocal.pack"],
                       capture_output=True, check=True)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--instance", help="인스턴스 폴더 이름 (예: Pie64). 생략하면 자동 선택")
    ap.add_argument("-o", "--out", default=DEFAULT_OUT)
    ap.add_argument("--with-packs", action="store_true", help="아이콘 팩도 추출 (사이트 데이터 빌드용)")
    args = ap.parse_args(argv)

    running = running_bluestacks()
    if running:
        sys.exit("블루스택이 실행 중입니다 (" + ", ".join(running) + ").\n"
                 "블루스택을 완전히 종료한 뒤 다시 실행해 주세요. (트레이 아이콘까지 종료)")

    sz = find_7z()
    vhdxs = [v for d in engine_dirs() for v in sorted(glob.glob(os.path.join(d, "*", "Data.vhdx")))]
    if args.instance:
        vhdxs = [v for v in vhdxs if os.path.basename(os.path.dirname(v)).lower() == args.instance.lower()]
    if not vhdxs:
        sys.exit("블루스택 5 인스턴스(Data.vhdx)를 찾지 못했습니다.")

    found = []
    for v in vhdxs:
        mtime = save_mtime(sz, v)
        print(f"  {os.path.basename(os.path.dirname(v))}: " + (f"세이브 있음 ({mtime})" if mtime else "냥코 세이브 없음"))
        if mtime:
            found.append((mtime, v))
    if not found:
        sys.exit("냥코대전쟁(한국판) 세이브가 있는 인스턴스가 없습니다.\n"
                 "블루스택에서 게임을 한 번 실행해 데이터를 받은 뒤 종료하고 다시 시도해 주세요.")
    mtime, vhdx = max(found)
    print(f"→ {os.path.basename(os.path.dirname(vhdx))} 사용 (세이브 {mtime})")

    os.makedirs(args.out, exist_ok=True)
    r = subprocess.run([sz, "e", vhdx, f"-o{args.out}", "-y", *[f"{GAME_DIR}/{w}" for w in WANTED + (PACKS if args.with_packs else [])]],
                       capture_output=True, text=True, errors="replace")
    if r.returncode != 0:
        sys.exit("추출 실패:\n" + (r.stderr or r.stdout)[-800:])
    if args.with_packs:
        extract_apk_icons(sz, vhdx, args.out)
    n = len(os.listdir(args.out))
    print(f"추출 완료: {args.out} ({n}개 파일)")


if __name__ == "__main__":
    main()
