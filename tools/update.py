"""추출 도구(NyankoWiki.exe)의 진입점. 실행하면 불러오는 방법을 고른다.
  1. 블루스택: Data.vhdx 추출 → 냥코_세이브.json
  2. 이어하기 코드 (폰도 가능): 코드로 세이브 받기 → 냥코_세이브.json → 그대로 다시 올려 새 코드 발급 (transfer.py)
끝나면 도감 사이트 열기 + 파일 위치 보여주기

사용: python tools/update.py [--instance Pie64] [--no-extract] [--no-open] [--code 코드 --pin 인증번호]
"""
import argparse
import os
import subprocess
import sys

import export_save
import extract_vhdx
import transfer
from common import FROZEN, ROOT, use_local_bcsfe_dir

SITE_URL = "https://crexont.github.io/nyanko-wiki/#/dex"  # 내 도감 페이지로 바로
OUT = os.path.join(ROOT, "냥코_세이브.json")


def log(msg: str) -> None:
    print(msg, flush=True)


def choose_mode() -> str:
    log("냥코위키 세이브 불러오기\n")
    log("  1. 블루스택에서 불러오기 (블루스택을 완전히 종료한 뒤)")
    log("  2. 이어하기 코드로 불러오기 (폰도 가능. 다 끝나면 새 이어하기 코드를 드려요)\n")
    while True:
        try:
            c = input("번호를 고르세요 (1/2): ").strip()
        except EOFError:  # 입력이 없는 환경(NUL 등)은 예전처럼 블루스택
            return "1"
        if c in ("1", "2"):
            return c


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--instance")
    ap.add_argument("--no-extract", action="store_true", help="device/ 에 이미 있는 파일 사용")
    ap.add_argument("--no-open", action="store_true")
    ap.add_argument("--code", help="이어하기 코드 (주면 2번 방법)")
    ap.add_argument("--pin", help="인증번호")
    ap.add_argument("--retry", help="이어하기 코드 방법에서 다시 올리기가 실패했을 때: 백업 .sav 로 새 코드만 받기")
    args = ap.parse_args()
    use_local_bcsfe_dir()  # 무엇보다 먼저: 문서\bcsfe 대신 exe 폴더\bcsfe_data

    if args.retry:
        transfer.main(["--retry", args.retry])
        if FROZEN:
            input("새 이어하기 코드를 확인했으면 엔터를 누르세요 (이어하기_코드.txt 에도 있어요)...")
        return
    if args.code:
        mode = "2"
    elif args.no_extract or args.instance or not sys.stdin.isatty():
        mode = "1"
    else:
        mode = choose_mode()
    if mode == "2":
        code = args.code or input("이어하기 코드: ").strip()
        pin = args.pin or input("인증번호: ").strip()
        transfer.main([code, pin])  # 냥코_세이브.json 을 만들고 새 코드를 보여준다
        if FROZEN:
            input("새 이어하기 코드를 확인했으면 엔터를 누르세요 (이어하기_코드.txt 에도 있어요)...")
    else:
        if not args.no_extract:
            log("[1/2] 블루스택에서 세이브 추출")
            extract_vhdx.main(["--instance", args.instance] if args.instance else [])
        log("[2/2] 세이브 → 냥코_세이브.json")
        export_save.main(["-o", OUT])

    log("\n완료! 냥코위키 내 도감에서 [세이브 불러오기]로 이 파일을 열거나 끌어다 놓으세요:")
    log(f"  {OUT}")
    if not args.no_open:
        os.startfile(SITE_URL)  # https 주소라 .html 연결 프로그램과 상관없이 기본 브라우저로 열린다
        subprocess.Popen(["explorer", "/select,", OUT])  # 파일을 바로 끌어다 놓을 수 있게 탐색기에서 표시


def run() -> int:
    # 콘솔이 cp949 여도 한글·기호 출력에서 죽지 않게
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    code = 0
    try:
        main()
    except SystemExit as e:
        if e.code not in (0, None):
            if isinstance(e.code, str):
                print(f"\n오류: {e.code}", file=sys.stderr)
            code = 1
    except Exception as e:  # exe 창이 바로 닫히지 않게 내용을 보여준다
        import traceback
        traceback.print_exc()
        print(f"\n예상치 못한 오류: {e}", file=sys.stderr)
        code = 1
    if FROZEN and code:
        try:
            input("\n엔터를 누르면 창이 닫힙니다...")
        except EOFError:
            pass
    return code


if __name__ == "__main__":
    sys.exit(run())
