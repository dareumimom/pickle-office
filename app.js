/* =========================================================
   🏢 다름이맘 합동 비서실 — app.js
   로컬 모드(localStorage) ↔ 실시간 DB(Firebase RTDB REST/SSE)
   ========================================================= */
(() => {
  'use strict';

  /* ---------------------------------------------------------
     기본 정의
     --------------------------------------------------------- */
  const ZONES = ['블로그 데스크', '회의실', '심부름실', '휴게실'];

  const CHARS = {
    banjjagi: {
      name: '반짝이', glyph: 'ㅂ', zone: 0,
      status: '미경 님 심부름 대기 중!',
      idle: [
        '오늘 할 일 정리하고 있어요 ✏️',
        '심부름 접수 대기 중이에요!',
        '보고서 마무리하는 중 📋',
        '잠깐 커피 한 모금 ☕'
      ]
    },
    sinbi: {
      name: '신비', glyph: '🌙', zone: 0,
      status: '블로그 글 발행 준비 중',
      idle: [
        '블로그 글 예약 발행 준비 중 🖋️',
        '이웃 답방 다녀오는 길이에요 💬',
        '썸네일 고르는 중 🎨',
        '댓글 확인하고 있어요 🌸'
      ]
    },
    gpt: {
      name: 'GPT', glyph: 'AI', zone: 1,
      status: '아이디어 회의 중',
      idle: [
        '학습지 아이디어 구상 중 💡',
        '제목 후보 뽑고 있어요 🔎',
        '회의 자료 정리 중 ✏️',
        '부르면 바로 갈게요 🤖'
      ]
    },
    gemini: {
      name: '제미나이', glyph: '✦', zone: 1,
      status: '자료 조사 중',
      idle: [
        '자료 조사하는 중 🔭',
        'PDF 목록 정리하고 있어요 📚',
        '일정 짜는 중 🗓️',
        '별빛 충전 중 ✨'
      ]
    }
  };
  const CHAR_KEYS = Object.keys(CHARS);
  // 존 안에서 캐릭터가 서는 자리 (같은 존에 여러 명이 와도 겹치지 않게)
  const SLOTS = [
    [0.25, 0.62], [0.75, 0.60], [0.30, 0.82], [0.72, 0.82]
  ];

  const LS = {
    db: 'pko.dbUrl',
    gk: 'pko.geminiKey',
    gm: 'pko.geminiModel',
    ok: 'pko.openaiKey',
    om: 'pko.openaiModel',
    state: 'pko.state'
  };

  /* ---------------------------------------------------------
     유틸
     --------------------------------------------------------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now = () => Date.now();

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const hhmm = (ts) => {
    const d = new Date(ts || now());
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  };

  const store = {
    get(k, d = '') { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 불가 */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* 무시 */ } }
  };

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  /* ---------------------------------------------------------
     상태
     --------------------------------------------------------- */
  let state = { messages: {}, tasks: {}, chars: {} };
  let mode = 'local';          // 'local' | 'live'
  let dbUrl = '';              // 정규화된 베이스 URL
  let sse = null;
  let sseRetry = 0;
  let pendingWrites = 0;

  function normalizeDb(raw) {
    if (!raw) return '';
    let u = String(raw).trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    u = u.replace(/\/+$/, '');
    u = u.replace(/\.json$/i, '');
    u = u.replace(/\/office$/i, '');
    return u;
  }

  function loadLocalState() {
    const raw = store.get(LS.state, '');
    if (!raw) return null;
    try {
      const o = JSON.parse(raw);
      if (o && o.messages) return o;
    } catch { /* 깨진 값 무시 */ }
    return null;
  }

  function saveLocalState() {
    if (mode !== 'local') return;
    store.set(LS.state, JSON.stringify({
      messages: state.messages, tasks: state.tasks, chars: state.chars
    }));
  }

  /* ---------------------------------------------------------
     시드 (처음 방문 · 데모)
     --------------------------------------------------------- */
  function seed() {
    const t = now();
    const m = (who, text, off, kind) => ({
      id: uid(), who, text, ts: t - off, kind: kind || 'msg'
    });
    const list = [
      m('system', '🏢 합동 비서실 문을 열었어요. 아래 @이름 칩으로 업무를 지시해 보세요.', 600000, 'sys'),
      m('banjjagi', '오늘 할 일 여섯 개 접수했어요! 하나씩 체크해 볼까요? ✏️', 540000),
      m('sinbi', '블로그 글 3편 예약 발행 대기 중이에요. 썸네일은 새 양식으로 맞췄어요 🎨', 480000),
      m('gpt', '이번 주 학습지 주제 아이디어 다섯 개 준비해 뒀어요. 필요하면 불러 주세요!', 420000),
      m('gemini', '정리한 자료 목록은 제가 맡을게요. @제미나이 로 불러 주세요 ✨', 360000),
      m('system', '🔌 설정(⚙️)에서 실시간 DB를 연결하면 반짝이·신비와 같은 방을 함께 씁니다.', 300000, 'warn')
    ];
    const msgs = {};
    list.forEach(x => { msgs[x.id] = x; });

    const tasks = {};
    [
      ['오늘 블로그 글 3편 발행 확인', 'banjjagi', false],
      ['이웃 새 글 답방 20곳', 'sinbi', false],
      ['구매후기 10건 작성', 'banjjagi', false],
      ['썸네일 새 양식으로 맞추기', 'sinbi', true],
      ['체험단 신청 결과 확인', 'banjjagi', false],
      ['다음 주 학습지 주제 정리', 'gemini', true]
    ].forEach(([text, owner, done], i) => {
      const id = uid();
      tasks[id] = { id, text, owner, done, ts: t - 400000 + i * 1000 };
    });

    const chars = {};
    CHAR_KEYS.forEach(k => {
      chars[k] = { id: k, zone: CHARS[k].zone, status: CHARS[k].status, ts: t };
    });

    state = { messages: msgs, tasks, chars };
  }

  /* ---------------------------------------------------------
     Firebase REST
     --------------------------------------------------------- */
  const node = (path) => `${dbUrl}/${String(path).replace(/^\/+/, '')}.json`;

  async function dbFetch(path, opts = {}) {
    const res = await fetch(node(path), {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      cache: 'no-store'
    });
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      if (res.status === 401 || res.status === 403) msg = '권한이 없어요 (보안 규칙 확인)';
      throw new Error(msg);
    }
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  }

  async function dbPatch(path, value) {
    if (mode !== 'live') return;
    pendingWrites++;
    setBadge();
    try {
      await dbFetch(path, { method: 'PATCH', body: JSON.stringify(value) });
    } catch (e) {
      toast('DB 저장 실패: ' + e.message);
    } finally {
      pendingWrites--;
      setBadge();
    }
  }

  async function dbDelete(path) {
    if (mode !== 'live') return;
    try {
      await dbFetch(path, { method: 'DELETE' });
    } catch (e) {
      toast('DB 삭제 실패: ' + e.message);
    }
  }

  function applyPut(path, data) {
    const parts = String(path || '/').split('/').filter(Boolean);
    if (parts.length === 0) {
      const o = data || {};
      state = { messages: o.messages || {}, tasks: o.tasks || {}, chars: o.chars || {} };
      return;
    }
    let root = state;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!root[p] || typeof root[p] !== 'object') root[p] = {};
      root = root[p];
    }
    const key = parts[parts.length - 1];
    if (data === null || data === undefined) delete root[key];
    else {
      if (typeof data === 'object' && !Array.isArray(data)) {
        // 하위 데이터를 합쳐야 하는 경로(office 전체 등)는 그대로 교체
        root[key] = data;
      } else {
        root[key] = data;
      }
    }
  }

  function connectDb(url, { silent = false } = {}) {
    const norm = normalizeDb(url);
    if (!norm) { disconnectDb(true); return; }
    disconnectDb(true);
    dbUrl = norm;
    mode = 'live';
    sseRetry = 0;
    dbSeeded = false;
    setBadge();
    render();

    const es = new EventSource(`${dbUrl}/office.json`);
    sse = es;

    es.addEventListener('open', () => {
      sseRetry = 0;
      setBadge('live');
    });
    es.addEventListener('put', (ev) => {
      let payload;
      try { payload = JSON.parse(ev.data); } catch { return; }
      if (!payload.path || payload.path === '/') seedDbIfEmpty(payload.data);
      applyPut(payload.path, payload.data);
      render();
      setBadge('live');
    });
    es.addEventListener('patch', (ev) => {
      let payload;
      try { payload = JSON.parse(ev.data); } catch { return; }
      const base = payload.path && payload.path !== '/' ? payload.path : '';
      Object.keys(payload.data || {}).forEach(k => {
        applyPut((base ? base : '') + '/' + k, payload.data[k]);
      });
      render();
      setBadge('live');
    });
    es.addEventListener('error', () => {
      // EventSource는 자동 재연결합니다. 상태만 표시.
      if (sse !== es) return;
      sseRetry++;
      setBadge('wait');
    });
    es.addEventListener('auth_revoked', () => {
      setBadge('wait');
      toast('DB 연결이 끊겼어요. 설정에서 확인해 주세요.');
    });

    if (!silent) toast('실시간 DB에 연결했어요!');
  }

  function disconnectDb(quiet) {
    if (sse) { try { sse.close(); } catch { /* 무시 */ } sse = null; }
    mode = 'local';
    dbUrl = '';
    dbSeeded = false;
    setBadge();
    if (!quiet) { render(); toast('로컬 모드로 돌아왔어요.'); }
  }

  /* 처음 연결한 빈 방이면 할 일 보드 기본값만 채워 둡니다 */
  let dbSeeded = false;
  function seedDbIfEmpty(data) {
    if (dbSeeded || mode !== 'live') return;
    dbSeeded = true;
    if (data) return;
    const t = now();
    const tasks = {};
    [
      ['오늘 블로그 글 발행 확인', 'banjjagi', false],
      ['이웃 새 글 답방 20곳', 'sinbi', false],
      ['구매후기 10건 작성', 'banjjagi', false],
      ['썸네일 새 양식으로 맞추기', 'sinbi', true],
      ['체험단 신청 결과 확인', 'banjjagi', false],
      ['다음 주 학습지 주제 정리', 'gemini', true]
    ].forEach(([text, owner, done], i) => {
      const id = uid();
      tasks[id] = { id, text, owner, done, ts: t - 400000 + i * 1000 };
    });
    const msgId = uid();
    const messages = {
      [msgId]: {
        id: msgId, who: 'system', ts: t,
        text: '🏢 합동 비서실이 실시간 DB에 연결됐어요. 반짝이·신비도 같은 방을 봅니다. @이름으로 업무를 지시해 보세요.',
        kind: 'sys'
      }
    };
    dbFetch('/office', { method: 'PATCH', body: JSON.stringify({ tasks, messages }) })
      .catch(() => { /* 실패해도 화면은 로컬처럼 동작 */ });
  }

  function setBadge(s) {
    const el = $('#connBadge');
    const label = el.querySelector('.badge-label');
    el.classList.remove('is-live', 'is-wait');
    if (mode === 'live') {
      if (s === 'wait' || pendingWrites > 0) {
        el.classList.add('is-wait');
        label.textContent = pendingWrites > 0 ? '저장 중…' : '연결 확인 중';
        el.title = '실시간 DB 저장 중';
      } else {
        el.classList.add('is-live');
        label.textContent = '실시간 DB 연결됨';
        el.title = '실시간 DB 연결됨';
      }
    } else {
      label.textContent = '로컬 모드';
      el.title = '로컬 모드 — 이 브라우저에만 저장';
    }
    const ft = $('#footText');
    const fd = $('.foot-dot');
    if (ft) ft.textContent = mode === 'live'
      ? '실시간 DB 연결됨 — 반짝이·신비와 같은 방을 씁니다.'
      : '로컬 모드 — 이 브라우저에만 기록됩니다.';
    if (fd) fd.classList.toggle('live', mode === 'live');
    const sh = $('#syncHint');
    if (sh) sh.textContent = mode === 'live' ? '실시간 동기화 중' : '이 브라우저에만 저장 중';
  }

  /* ---------------------------------------------------------
     액션
     --------------------------------------------------------- */
  function addMessage(who, text, kind) {
    const id = uid();
    const msg = { id, who, text, ts: now(), kind: kind || 'msg' };
    state.messages[id] = msg;
    if (mode === 'live') dbPatch('/office/messages/' + id, msg);
    else saveLocalState();
    renderChat(true);
    return msg;
  }

  function addSystem(text, kind) { return addMessage('system', text, kind || 'sys'); }

  function addTask(text, owner) {
    const id = uid();
    const t = { id, text, owner, done: false, ts: now() };
    state.tasks[id] = t;
    if (mode === 'live') dbPatch('/office/tasks/' + id, t);
    else saveLocalState();
    renderTasks();
  }

  function toggleTask(id) {
    const t = state.tasks[id];
    if (!t) return;
    t.done = !t.done;
    if (mode === 'live') dbPatch('/office/tasks/' + id, { done: t.done });
    else saveLocalState();
    renderTasks();
  }

  function removeTask(id) {
    delete state.tasks[id];
    if (mode === 'live') dbDelete('/office/tasks/' + id);
    else saveLocalState();
    renderTasks();
  }

  function moveChar(key, zone) {
    const c = state.chars[key] || (state.chars[key] = { id: key, zone: CHARS[key].zone });
    const idle = CHARS[key].idle;
    c.zone = zone;
    c.status = idle[Math.floor(Math.random() * idle.length)];
    c.ts = now();
    if (mode === 'live') dbPatch('/office/chars/' + key, { zone: c.zone, status: c.status, ts: c.ts });
    else saveLocalState();
    renderMap();
    showBubble(key, c.status);
  }

  /* ---------------------------------------------------------
     렌더 — 맵
     --------------------------------------------------------- */
  let charNodes = {};

  function buildMap() {
    const map = $('#map');
    CHAR_KEYS.forEach((k) => {
      const c = CHARS[k];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'char char--init';
      btn.dataset.char = k;
      btn.setAttribute('aria-label', `${c.name} — ${ZONES[CHARS[k].zone]}`);
      btn.innerHTML =
        `<span class="char-bubble"></span>` +
        `<span class="char-body" aria-hidden="true">${esc(c.glyph)}</span>` +
        `<span class="char-tag">${esc(c.name)}</span>`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectChar(k);
        const cur = (state.chars[k] && typeof state.chars[k].zone === 'number')
          ? state.chars[k].zone : CHARS[k].zone;
        const next = (cur + 1) % ZONES.length;
        moveChar(k, next);
      });
      map.appendChild(btn);
      charNodes[k] = btn;
    });

    $$('.zone', map).forEach(z => {
      z.addEventListener('click', () => {
        const zone = Number(z.dataset.zone);
        const target = selected && CHAR_KEYS.includes(selected) ? selected : 'banjjagi';
        selectChar(target);
        moveChar(target, zone);
      });
    });

    window.addEventListener('resize', () => positionChars());
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => positionChars());
      ro.observe(map);
    }
  }

  function positionChars() {
    const map = $('#map');
    if (!map) return;
    const mRect = map.getBoundingClientRect();
    const zones = $$('.zone', map);
    // 같은 존에 있는 순서대로 자리를 배정
    const used = {};
    const slotOf = {};
    CHAR_KEYS.forEach((k) => {
      const st = state.chars[k] || {};
      let zi = typeof st.zone === 'number' ? st.zone : CHARS[k].zone;
      zi = Math.max(0, Math.min(ZONES.length - 1, zi));
      used[zi] = used[zi] || 0;
      slotOf[k] = used[zi] % SLOTS.length;
      used[zi]++;
    });

    CHAR_KEYS.forEach((k) => {
      const el = charNodes[k];
      if (!el) return;
      const st = state.chars[k] || {};
      let zi = typeof st.zone === 'number' ? st.zone : CHARS[k].zone;
      zi = Math.max(0, Math.min(ZONES.length - 1, zi));
      const z = zones[zi];
      if (!z) return;
      const r = z.getBoundingClientRect();
      const [fx, fy] = SLOTS[slotOf[k]];
      const x = (r.left - mRect.left) + r.width * fx;
      const y = (r.top - mRect.top) + r.height * fy;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      if (el.classList.contains('char--init')) {
        requestAnimationFrame(() => el.classList.remove('char--init'));
      }
    });
  }

  function renderMap() {
    positionChars();
    CHAR_KEYS.forEach(k => {
      const st = state.chars[k] || {};
      let zi = typeof st.zone === 'number' ? st.zone : CHARS[k].zone;
      zi = Math.max(0, Math.min(ZONES.length - 1, zi));
      const el = charNodes[k];
      if (el) el.setAttribute('aria-label', `${CHARS[k].name} — ${ZONES[zi]}`);
    });
    renderRoster();
  }

  let bubbleTimers = {};
  function showBubble(key, text) {
    const el = charNodes[key];
    if (!el) return;
    const b = el.querySelector('.char-bubble');
    b.textContent = text;
    el.classList.add('show-bubble');
    clearTimeout(bubbleTimers[key]);
    bubbleTimers[key] = setTimeout(() => el.classList.remove('show-bubble'), 3600);
  }

  let selected = null;
  function selectChar(key) {
    selected = key;
    CHAR_KEYS.forEach(k => charNodes[k] && charNodes[k].classList.toggle('is-active', k === key));
    $$('.roster-btn').forEach(b => b.classList.toggle('is-active', b.dataset.char === key));
    const hint = $('#mapHint');
    if (hint) hint.textContent = `${CHARS[key].name} 선택됨 · 구역을 눌러 이동`;
  }

  function renderRoster() {
    const ul = $('#roster');
    if (!ul) return;
    ul.innerHTML = CHAR_KEYS.map(k => {
      const st = state.chars[k] || {};
      let zi = typeof st.zone === 'number' ? st.zone : CHARS[k].zone;
      zi = Math.max(0, Math.min(ZONES.length - 1, zi));
      return `<li>
        <button type="button" class="roster-btn${selected === k ? ' is-active' : ''}" data-char="${k}">
          <span class="roster-dot" data-char="${k}" style="--cc:var(--c-${k});--cc-d:var(--c-${k}-d)" aria-hidden="true">${esc(CHARS[k].glyph)}</span>
          <span class="roster-info">
            <span class="roster-name">${esc(CHARS[k].name)}</span>
            <span class="roster-zone">${esc(ZONES[zi])}</span>
          </span>
        </button>
      </li>`;
    }).join('');
    $$('.roster-btn', ul).forEach(b => {
      b.addEventListener('click', () => {
        const k = b.dataset.char;
        selectChar(k);
        const st = state.chars[k] || {};
        let zi = typeof st.zone === 'number' ? st.zone : CHARS[k].zone;
        moveChar(k, (zi + 1) % ZONES.length);
      });
    });
  }

  /* ---------------------------------------------------------
     렌더 — 채팅
     --------------------------------------------------------- */
  const charOf = (who) => CHARS[who] ? CHARS[who] : null;

  function renderChat(scroll) {
    const box = $('#chatBody');
    if (!box) return;
    const msgs = Object.values(state.messages || {})
      .filter(m => m && typeof m === 'object')
      .sort((a, b) => (a.ts || 0) - (b.ts || 0));

    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90;

    if (!msgs.length) {
      box.innerHTML = `<div class="chat-empty">아직 대화가 없어요.<br>아래에서 <b>@반짝이</b>처럼 불러 시작해 보세요 ✨</div>`;
      return;
    }

    box.innerHTML = msgs.map(m => {
      if (m.who === 'system' || m.kind === 'sys' || m.kind === 'warn') {
        return `<div class="sys${m.kind === 'warn' ? ' warn' : ''}">${esc(m.text)}</div>`;
      }
      const c = charOf(m.who);
      if (m.who === 'me') {
        return `<div class="msg" data-char="me">
          <div class="msg-main">
            <div class="msg-top"><span class="msg-name">다름이맘</span><span class="msg-time">${hhmm(m.ts)}</span></div>
            <div class="msg-text">${esc(m.text)}</div>
          </div>
        </div>`;
      }
      const glyph = c ? c.glyph : '·';
      const name = c ? c.name : esc(m.who || '?');
      const key = c ? m.who : '';
      return `<div class="msg" data-char="${esc(key)}">
        <div class="msg-ava" style="--cc:var(--c-${esc(key)});--cc-d:var(--c-${esc(key)}-d)" aria-hidden="true">${esc(glyph)}</div>
        <div class="msg-main">
          <div class="msg-top"><span class="msg-name">${esc(name)}</span><span class="msg-time">${hhmm(m.ts)}</span></div>
          <div class="msg-text">${esc(m.text)}</div>
        </div>
      </div>`;
    }).join('');

    if (scroll || nearBottom) box.scrollTop = box.scrollHeight;
    if (typingSet.size) paintTyping();
  }

  const typingSet = new Set();
  function paintTyping() {
    const box = $('#chatBody');
    if (!box) return;
    typingSet.forEach(key => {
      const c = CHARS[key];
      if (!c) return;
      const el = document.createElement('div');
      el.className = 'msg is-typing';
      el.id = 'typing-' + key;
      el.dataset.char = key;
      el.innerHTML = `<div class="msg-ava" style="--cc:var(--c-${key});--cc-d:var(--c-${key}-d)" aria-hidden="true">${esc(c.glyph)}</div>
        <div class="msg-main"><div class="msg-top"><span class="msg-name">${esc(c.name)}</span><span class="msg-time">답하는 중…</span></div>
        <div class="msg-text">✏️ 생각하고 있어요…</div></div>`;
      box.appendChild(el);
    });
    if (typingSet.size) box.scrollTop = box.scrollHeight;
  }

  function setTyping(key, on) {
    if (on) typingSet.add(key); else typingSet.delete(key);
    const old = document.getElementById('typing-' + key);
    if (old) old.remove();
    paintTyping();
  }

  /* ---------------------------------------------------------
     렌더 — 할 일
     --------------------------------------------------------- */
  function renderTasks() {
    const ul = $('#taskList');
    if (!ul) return;
    const list = Object.values(state.tasks || {})
      .filter(t => t && typeof t === 'object')
      .sort((a, b) => (a.done === b.done ? (b.ts || 0) - (a.ts || 0) : (a.done ? 1 : -1)));

    if (!list.length) {
      ul.innerHTML = `<li class="chat-empty" style="font-size:12px">오늘 할 일이 없어요. 아래에 추가해 보세요 🌿</li>`;
    } else {
      ul.innerHTML = list.map(t => {
        const owner = CHARS[t.owner] ? t.owner : 'banjjagi';
        return `<li class="task${t.done ? ' done' : ''}" data-owner="${owner}">
          <button type="button" class="task-check" data-id="${esc(t.id)}" role="checkbox" aria-checked="${t.done ? 'true' : 'false'}" aria-label="완료 표시">${t.done ? '✓' : ''}</button>
          <span class="task-body">
            <span class="task-text">${esc(t.text)}</span>
            <span class="task-meta"><span class="task-owner">${esc(CHARS[owner].name)}</span></span>
          </span>
          <button type="button" class="task-del" data-del="${esc(t.id)}" aria-label="삭제">✕</button>
        </li>`;
      }).join('');
    }

    const done = list.filter(t => t.done).length;
    $('#taskCount').textContent = `${done} / ${list.length}`;
    $('#progressBar').style.width = list.length ? Math.round((done / list.length) * 100) + '%' : '0%';

    $$('.task-check', ul).forEach(b => b.addEventListener('click', () => toggleTask(b.dataset.id)));
    $$('.task-del', ul).forEach(b => b.addEventListener('click', () => removeTask(b.dataset.del)));
  }

  function render() {
    renderMap();
    renderChat(false);
    renderTasks();
  }

  /* ---------------------------------------------------------
     AI 연동 (브라우저에서 직접 호출)
     --------------------------------------------------------- */
  function taskContext() {
    const open = Object.values(state.tasks || {}).filter(t => t && !t.done).map(t => '· ' + t.text);
    return open.length ? `\n\n오늘 남은 할 일:\n${open.join('\n')}` : '';
  }

  function persona(key) {
    const base = '너는 「다름이맘 합동 비서실」에서 일하는 AI 동료다. 사용자는 두 아이를 키우는 육아 블로거 "다름이맘"이다. '
      + '한국어로 친근하고 정돈된 존댓말로 답한다. 답은 3문장 이내, 바로 쓸 수 있는 실용적인 내용만. '
      + '모르는 것은 지어내지 않는다. 이모지는 한두 개만.';
    const who = key === 'gpt' ? '너의 이름은 "GPT"이고, 기획·글쓰기·아이디어 담당이다.'
      : '너의 이름은 "제미나이"이고, 자료 조사·정리 담당이다.';
    return base + ' ' + who;
  }

  function aiError(key, e) {
    const name = CHARS[key].name;
    setTyping(key, false);
    addSystem(`⚠️ ${name} 연결 실패 — ${e.message}`, 'warn');
  }

  async function callGemini(key, prompt) {
    const custom = store.get(LS.gm, '').trim();
    const models = custom ? [custom] : ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    let lastErr = null;
    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: persona('gemini') }] },
            contents: [{ role: 'user', parts: [{ text: prompt + taskContext() }] }],
            generationConfig: { temperature: 0.8, maxOutputTokens: 700 }
          })
        });
      } catch (e) {
        throw new Error('네트워크 오류 (키·인터넷 확인)');
      }
      if (res.status === 404 && !custom) { lastErr = new Error('모델을 찾을 수 없음'); continue; }
      if (res.status === 403 || res.status === 401) throw new Error('API 키가 올바르지 않아요');
      if (res.status === 429) throw new Error('사용 한도를 넘었어요 (잠시 후 다시)');
      if (!res.ok) {
        let d = '';
        try { const j = await res.json(); d = (j.error && j.error.message) || ''; } catch { /* 무시 */ }
        throw new Error(d || ('HTTP ' + res.status));
      }
      const j = await res.json();
      const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
      const text = parts.map(p => p.text || '').join('').trim();
      if (!text) throw new Error('빈 응답');
      return text;
    }
    throw lastErr || new Error('응답 실패');
  }

  async function callOpenAI(key, prompt) {
    const custom = store.get(LS.om, '').trim();
    const models = custom ? [custom] : ['gpt-4o-mini', 'gpt-4.1-mini'];
    let lastErr = null;
    for (const model of models) {
      let res;
      try {
        res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: persona('gpt') },
              { role: 'user', content: prompt + taskContext() }
            ],
            temperature: 0.8,
            max_tokens: 700
          })
        });
      } catch (e) {
        throw new Error('네트워크 오류 (키·인터넷 확인)');
      }
      if (res.status === 404 && !custom) { lastErr = new Error('모델을 찾을 수 없음'); continue; }
      if (res.status === 401) throw new Error('API 키가 올바르지 않아요');
      if (res.status === 429) throw new Error('사용 한도를 넘었어요 (잠시 후 다시)');
      if (res.status === 403) throw new Error('이 키로는 호출할 수 없어요');
      if (!res.ok) {
        let d = '';
        try { const j = await res.json(); d = (j.error && j.error.message) || ''; } catch { /* 무시 */ }
        throw new Error(d || ('HTTP ' + res.status));
      }
      const j = await res.json();
      const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '').trim();
      if (!text) throw new Error('빈 응답');
      return text;
    }
    throw lastErr || new Error('응답 실패');
  }

  /* ---------------------------------------------------------
     메시지 전송
     --------------------------------------------------------- */
  const MENTIONS = [
    { key: 'banjjagi', re: /@반짝이/g, tag: '@반짝이' },
    { key: 'sinbi', re: /@신비/g, tag: '@신비' },
    { key: 'gpt', re: /@GPT/gi, tag: '@GPT' },
    { key: 'gemini', re: /@제미나이/g, tag: '@제미나이' }
  ];

  function findMentions(text) {
    const out = [];
    MENTIONS.forEach(m => { if (m.re.test(text)) { m.re.lastIndex = 0; out.push(m.key); } else m.re.lastIndex = 0; });
    return out;
  }

  const LOCAL_ACK = {
    banjjagi: [
      '접수했어요! 지금은 로컬 모드라 제가 여기서만 대답하고 있어요. ⚙️ 설정에서 실시간 DB를 연결하면 진짜 반짝이가 방에서 직접 답해요.',
      '알겠습니다, 미경 님! 할 일 보드에도 올려 둘게요. (실시간 DB를 연결하면 반짝이·신비가 같은 방을 봅니다.)'
    ],
    sinbi: [
      '확인했어요! 블로그 쪽은 제가 챙길게요. 지금은 로컬 모드라 실제 발행은 피클 앱에서 진행돼요.',
      '네, 메모했어요. 실시간 DB를 연결하면 신비와 같은 방에서 바로 이야기할 수 있어요 🌙'
    ]
  };

  function handleSend(raw) {
    const text = String(raw || '').trim();
    if (!text) return;
    addMessage('me', text);
    const targets = findMentions(text);
    const q = text.replace(/@(반짝이|신비|GPT|제미나이)/gi, '').trim();

    if (!targets.length) {
      if (mode === 'local') {
        // 멘션이 없으면 조용히 남겨 둡니다.
      }
      return;
    }

    targets.forEach((key) => {
      const key2 = key;
      if (key2 === 'gpt' || key2 === 'gemini') {
        const apiKey = key2 === 'gpt' ? store.get(LS.ok, '').trim() : store.get(LS.gk, '').trim();
        if (!apiKey) {
          addSystem(`⚙️ ${CHARS[key2].name}와 대화하려면 설정에서 API 키를 넣어 주세요. (키는 이 브라우저에만 저장돼요.)`, 'warn');
          return;
        }
        setTyping(key2, true);
        const fn = key2 === 'gpt' ? callOpenAI : callGemini;
        fn(apiKey, q || '안녕하세요! 짧게 인사해 주세요.')
          .then(ans => { setTyping(key2, false); addMessage(key2, ans); })
          .catch(err => aiError(key2, err));
      } else {
        if (mode === 'live') {
          addSystem(`📮 ${CHARS[key2].name}에게 DB로 전달했어요. 방을 열면 이 메시지를 봅니다.`, 'sys');
          // 위치를 살짝 옮겨 '일하러 간' 느낌
          const c = state.chars[key2] || {};
          if (typeof c.zone !== 'number') moveChar(key2, CHARS[key2].zone);
        } else {
          setTimeout(() => {
            const arr = LOCAL_ACK[key2] || ['확인했어요!'];
            addMessage(key2, arr[Math.floor(Math.random() * arr.length)]);
          }, 600);
        }
      }
    });
  }

  /* ---------------------------------------------------------
     설정 모달
     --------------------------------------------------------- */
  function openModal() {
    $('#dbUrl').value = store.get(LS.db, '');
    $('#geminiKey').value = store.get(LS.gk, '');
    $('#geminiModel').value = store.get(LS.gm, '');
    $('#openaiKey').value = store.get(LS.ok, '');
    $('#openaiModel').value = store.get(LS.om, '');
    setDbStatus(mode === 'live' ? `연결됨 — ${dbUrl}` : '연결 안 됨', mode === 'live' ? 'ok' : '');
    setKeyStatus('gemini');
    setKeyStatus('openai');
    $('#modal').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    $('#modal').hidden = true;
    document.body.style.overflow = '';
  }
  function setDbStatus(txt, cls) {
    const el = $('#dbStatus');
    el.textContent = txt;
    el.className = 'status ' + (cls || '');
  }
  function setKeyStatus(which) {
    const key = which === 'gemini' ? store.get(LS.gk, '').trim() : store.get(LS.ok, '').trim();
    const el = $(which === 'gemini' ? '#geminiStatus' : '#openaiStatus');
    if (key) {
      el.textContent = '키 저장됨 · ' + key.slice(0, 4) + '••••' + key.slice(-4);
      el.className = 'status ok';
    } else {
      el.textContent = '키 없음';
      el.className = 'status';
    }
  }

  function saveKeys() {
    store.set(LS.gk, $('#geminiKey').value.trim());
    store.set(LS.gm, $('#geminiModel').value.trim());
    store.set(LS.ok, $('#openaiKey').value.trim());
    store.set(LS.om, $('#openaiModel').value.trim());
    setKeyStatus('gemini');
    setKeyStatus('openai');
  }

  async function testDb() {
    const raw = $('#dbUrl').value;
    const url = normalizeDb(raw);
    if (!url) { setDbStatus('주소를 입력해 주세요.', 'err'); return; }
    setDbStatus('확인 중…', 'busy');
    try {
      const res = await fetch(`${url}/office.json`, { cache: 'no-store' });
      if (res.status === 401 || res.status === 403) {
        setDbStatus('주소는 맞지만 읽기 권한이 없어요. 보안 규칙을 확인해 주세요.', 'err');
        return;
      }
      if (!res.ok) { setDbStatus(`응답 오류 (HTTP ${res.status})`, 'err'); return; }
      setDbStatus('연결 가능! 아래 “연결”을 눌러 주세요.', 'ok');
    } catch (e) {
      setDbStatus('연결할 수 없어요 — 주소를 확인해 주세요 (CORS/오타).', 'err');
    }
  }

  function connectFromModal() {
    const raw = $('#dbUrl').value;
    const url = normalizeDb(raw);
    if (!url) {
      store.del(LS.db);
      disconnectDb();
      setDbStatus('연결 안 됨', '');
      return;
    }
    store.set(LS.db, url);
    connectDb(url);
    setDbStatus('연결됨 — ' + url, 'ok');
  }

  /* ---------------------------------------------------------
     초기화
     --------------------------------------------------------- */
  function initParams() {
    let p = '';
    try { p = new URLSearchParams(location.search).get('db') || ''; } catch { /* 무시 */ }
    if (!p && location.hash.startsWith('#db=')) p = decodeURIComponent(location.hash.slice(4));
    if (p) {
      const n = normalizeDb(p);
      store.set(LS.db, n);
      return n;
    }
    return normalizeDb(store.get(LS.db, ''));
  }

  function init() {
    // 캐릭터 색 변수
    CHAR_KEYS.forEach(k => {
      const c = CHARS[k];
      c.zone = Math.max(0, Math.min(ZONES.length - 1, c.zone));
    });

    const saved = loadLocalState();
    if (saved) state = saved; else seed();

    buildMap();
    render();

    // 첫 방문이면 구역 배치가 끝난 뒤 말풍선 한 번씩
    setTimeout(() => {
      positionChars();
      CHAR_KEYS.forEach((k, i) => {
        setTimeout(() => showBubble(k, (state.chars[k] && state.chars[k].status) || CHARS[k].status), i * 320);
      });
    }, 260);

    // 헤더/모달 이벤트
    $('#settingsBtn').addEventListener('click', openModal);
    $('#footSettings').addEventListener('click', openModal);
    $('#connBadge').addEventListener('click', openModal);
    $('#modalClose').addEventListener('click', closeModal);
    $$('[data-close]').forEach(el => el.addEventListener('click', closeModal));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#modal').hidden) closeModal();
    });

    $('#saveAll').addEventListener('click', () => {
      saveKeys();
      connectFromModal();
      closeModal();
      toast('설정을 저장했어요!');
    });
    $('#dbSave').addEventListener('click', connectFromModal);
    $('#dbTest').addEventListener('click', testDb);
    $('#dbClear').addEventListener('click', () => {
      $('#dbUrl').value = '';
      store.del(LS.db);
      disconnectDb();
      setDbStatus('연결 안 됨', '');
    });
    $('#copyRules').addEventListener('click', async () => {
      const txt = $('#rulesCode').textContent;
      try {
        await navigator.clipboard.writeText(txt);
        toast('보안 규칙을 복사했어요.');
      } catch {
        toast('복사가 안 되면 직접 선택해 주세요.');
      }
    });
    $$('.eye').forEach(b => {
      b.addEventListener('click', () => {
        const inp = document.getElementById(b.dataset.eye);
        inp.type = inp.type === 'password' ? 'text' : 'password';
        b.textContent = inp.type === 'password' ? '👁️' : '🙈';
      });
    });
    $('#resetAll').addEventListener('click', () => {
      if (!confirm('이 브라우저에 저장된 설정·대화·할 일을 모두 지울까요?')) return;
      [LS.db, LS.gk, LS.gm, LS.ok, LS.om, LS.state].forEach(k => store.del(k));
      disconnectDb(true);
      seed();
      render();
      closeModal();
      openModal();
      toast('모두 지웠어요.');
    });

    // 채팅
    $('#chatForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const ta = $('#chatText');
      const v = ta.value;
      if (!v.trim()) return;
      handleSend(v);
      ta.value = '';
      autoGrow(ta);
      ta.focus();
    });
    const ta = $('#chatText');
    ta.addEventListener('input', () => autoGrow(ta));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        $('#chatForm').requestSubmit();
      }
    });

    // 멘션 칩
    $$('.chip').forEach(ch => {
      ch.addEventListener('click', () => {
        const t = ch.dataset.mention;
        const cur = ta.value;
        if (cur.includes(t)) { ta.focus(); return; }
        ta.value = (cur ? cur.replace(/\s+$/, '') + ' ' : '') + t + ' ';
        autoGrow(ta);
        ta.focus();
        try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch { /* 무시 */ }
      });
    });

    // 할 일 추가
    $('#taskForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = $('#taskInput');
      const v = inp.value.trim();
      if (!v) return;
      addTask(v, $('#taskOwner').value);
      inp.value = '';
      inp.focus();
    });

    // DB 자동 연결
    const auto = initParams();
    if (auto) {
      setDbStatus('연결됨 — ' + auto, 'ok');
      connectDb(auto, { silent: true });
    } else {
      setBadge();
    }
  }

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 104) + 'px';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
