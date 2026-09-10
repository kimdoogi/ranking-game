# ranking-game

브라우저에서 바로 즐기는 HTML 미니게임 모음. 각 파일을 브라우저로 열면 실행됩니다.

## 게임 목록

| 파일 | 게임 |
| --- | --- |
| [monster-chase.html](monster-chase.html) | 먹보 괴물 대탈주 👾 |
| [obstacle-run.html](obstacle-run.html) | 장애물 대탈주 300 🏁 |
| [push-royale.html](push-royale.html) | 밀어내기 배틀 로얄 🏆 |

## 실행 방법

별도 설치 없이 HTML 파일을 더블클릭하거나 브라우저에서 열면 됩니다.

## 밀어내기 배틀 로얄 검증

`node check-push-royale.cjs`로 게이지, 필살기 4종의 판정, 재시작, 우승 연출과 인원·화면 크기별 경기 완료를 확인합니다.
화면 문구·구조는 `build-pages.py`에서 수정한 뒤 `python3 build-pages.py`로 생성하고, `python3 check-i18n.py`로 4개 언어를 확인합니다. JS·CSS 수정 후에도 생성기를 실행해 캐시 버전을 갱신합니다.
