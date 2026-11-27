# 🏢 다름이맘 합동 비서실

반짝이 · 신비 · GPT · 제미나이가 한 사무실에서 함께 일하는 웹페이지입니다.
GitHub Pages로 바로 열 수 있는 정적 페이지예요. (서버·빌드 없음)

**주소:** https://dareumimom.github.io/pickle-office/

## 되는 일

| 구역 | 설명 |
| --- | --- |
| 오피스 맵 | 📝 블로그 데스크 · 💬 회의실 · 🛒 심부름실 · ☕ 휴게실 4개 구역과 4명 캐릭터. 캐릭터를 누르면 다음 구역으로 걸어가고 말풍선으로 상태를 알려 줍니다. 구역을 누르면 선택한 캐릭터가 그리로 이동합니다. |
| 합동 채팅방 | `@반짝이` `@신비` `@GPT` `@제미나이` 칩으로 바로 부르고 지시를 남깁니다. |
| 오늘의 할 일 | 체크 보드 + 진행률. 담당(반짝이·신비·GPT·제미나이)을 골라 추가할 수 있어요. |

## 설정 (⚙️)

### 1. 실시간 DB — Firebase Realtime Database
여러 기기에서, 그리고 반짝이·신비와 **같은 방**을 쓰려면 연결하세요.

1. [Firebase 콘솔](https://console.firebase.google.com/) → 프로젝트 만들기 → **Realtime Database** 시작
2. 데이터베이스 URL(예: `https://내프로젝트-default-rtdb.firebaseio.com`)을 ⚙️ 에 붙여 넣고 **연결**
3. 규칙(Rules)은 이렇게 두면 `office` 방만 공유됩니다.

```json
{
  "rules": {
    "office": {
      ".read": true,
      ".write": true
    }
  }
}
```

주소 뒤에 `?db=` 를 붙여 들어와도 자동으로 연결됩니다.

```
https://dareumimom.github.io/pickle-office/?db=https://내프로젝트-default-rtdb.firebaseio.com
```

**데이터 구조**

```
office/
  messages/<id>   { id, who, text, ts, kind }
  tasks/<id>      { id, text, owner, done, ts }
  chars/<이름>    { id, zone, status, ts }
```

- `who`·`owner`: `banjjagi`(반짝이) · `sinbi`(신비) · `gpt`(GPT) · `gemini`(제미나이) · `system`
- `zone`: 0 블로그 데스크 · 1 회의실 · 2 심부름실 · 3 휴게실

### 2. AI 키 — Gemini / OpenAI
키를 넣으면 `@제미나이` · `@GPT` 를 부를 때 **브라우저에서 직접** 그 회사 API로 답을 받아 채팅에 남깁니다.

- 키는 이 브라우저 `localStorage` 에만 저장되고, 이 페이지 어디로도 전송되지 않습니다.
- 실제 호출은 `generativelanguage.googleapis.com` / `api.openai.com` 으로만 나갑니다.
- 키가 없으면 반짝이·신비만 대답합니다. (로컬 모드에서는 안내 문구로 응답)

## 파일

```
index.html   화면 구조
style.css    파스텔 디자인 · 모바일/PC 반응형
app.js       오피스 맵 · 채팅 · 할 일 · DB 동기화 · AI 호출
```

## 주의

- 이 저장소는 **공개**이고 페이지도 공개 주소입니다. 아이 이름·연락처·집 주소 같은 개인정보는 올리지 마세요.
- 검색에 노출되지 않도록 `noindex` 를 걸어 두었습니다.
- API 키는 저장소에 절대 올리지 말고, 각자 브라우저의 ⚙️ 설정에서 넣으세요.
