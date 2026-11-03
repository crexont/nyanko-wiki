"""추출 도구 배포용 zip 만들기: PyInstaller(onedir) + 7-Zip 동봉. (도감 웹페이지는 docs/ → GitHub Pages)

사용: python tools/package.py [--version v0.1.0] [--7zip "C:\\Program Files\\7-Zip"]
결과: build/NyankoWiki-<version>-win64.zip
  NyankoWiki/
    NyankoWiki.exe, _internal/   (Python + bcsfe 포함)
    7z/7z.exe, 7z.dll, License.txt
    사용법.txt, LICENSE.txt
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
NAME = "NyankoWiki"

HOWTO = """냥코위키 추출 도구 (비공식, 세이브는 고치지 않음)

냥코위키: https://crexont.github.io/nyanko-wiki/

NyankoWiki.exe 를 더블클릭하면 방법을 고릅니다.

[1번] 블루스택에서 불러오기
  1. 블루스택 5에서 냥코대전쟁(한국판)에 계정을 옮기고 게임을 한 번 실행합니다.
  2. 블루스택을 완전히 종료합니다 (트레이 아이콘까지).
  3. NyankoWiki.exe → 1번
[2번] 이어하기 코드로 불러오기 (폰 계정 그대로)
  * 이어하기 코드를 프로그램에 넣는 게 찜찜하다면 1번(블루스택)을 쓰세요. 1번은 게임 서버와 통신하지 않습니다.
  1. 폰의 냥코에서 기종변경(이어하기) 코드를 발급합니다.
  2. NyankoWiki.exe → 2번 → 이어하기 코드·인증번호 입력
  3. 화면에 나오는 "새 이어하기 코드"를 폰 냥코 첫 화면 → 이어하기에 입력합니다.
     (창을 닫아도 이 폴더의 이어하기_코드.txt 에 남아 있어요. 남에게 보여주지 마세요.)
     (코드는 한 번 쓰면 사라져서, 받은 세이브를 그대로 다시 올려 새 코드를 드립니다.
      받은 세이브는 build/transfer 폴더에 백업되고, 실패하면 화면에 나온 --retry 명령으로 다시 시도합니다.)

→ 이 폴더에 "냥코_세이브.json"이 만들어지고, 냥코위키가 열립니다.
냥코위키 [내 도감]에서 [세이브 불러오기]로 냥코_세이브.json 을 열거나 끌어다 놓습니다.

처음 실행할 때 "Windows의 PC 보호" 창이 뜨면 [추가 정보] → [실행]을 누르세요.
게임을 더 진행했으면 같은 방법으로 다시 하면 됩니다. 사이트에서 직접 고친 내용은 브라우저에 저장됩니다.

자세한 설명·소스 코드: https://github.com/{repo}
라이선스: GPL-3.0 (LICENSE.txt). 동봉된 7-Zip은 7z/License.txt 를 따릅니다.
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default="dev")
    ap.add_argument("--7zip", dest="sevenzip", default=os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "7-Zip"))
    ap.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", "<owner>/<repo>"))
    args = ap.parse_args()

    for f in ("7z.exe", "7z.dll", "License.txt"):
        if not os.path.isfile(os.path.join(args.sevenzip, f)):
            sys.exit(f"7-Zip 파일 없음: {os.path.join(args.sevenzip, f)}")

    shutil.rmtree(BUILD, ignore_errors=True)
    subprocess.run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--onedir", "--console",
                    "--name", NAME, "--collect-all", "bcsfe",
                    "--paths", os.path.join(ROOT, "tools"),
                    "--distpath", os.path.join(BUILD, "dist"), "--workpath", os.path.join(BUILD, "work"),
                    "--specpath", BUILD, os.path.join(ROOT, "tools", "update.py")], check=True)

    out = os.path.join(BUILD, "dist", NAME)
    os.makedirs(os.path.join(out, "7z"))
    for f in ("7z.exe", "7z.dll", "License.txt"):
        shutil.copy2(os.path.join(args.sevenzip, f), os.path.join(out, "7z", f))
    shutil.copy2(os.path.join(ROOT, "LICENSE"), os.path.join(out, "LICENSE.txt"))
    with open(os.path.join(out, "사용법.txt"), "w", encoding="utf-8-sig") as f:
        f.write(HOWTO.format(repo=args.repo))

    zip_base = os.path.join(BUILD, f"{NAME}-{args.version}-win64")
    shutil.make_archive(zip_base, "zip", os.path.join(BUILD, "dist"), NAME)
    print(f"완료: {zip_base}.zip ({os.path.getsize(zip_base + '.zip') // 1024 // 1024} MB)")


if __name__ == "__main__":
    main()
