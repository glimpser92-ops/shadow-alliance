const socket = io();

const TEAMS = {
  black: { label: "블랙 연합", mark: "●" },
  white: { label: "화이트 연합", mark: "○" }
};

const rules = [
  {
    title: "두 개의 그림자",
    body: "입장하면 블랙 연합 또는 화이트 연합에 자동 배정된다. 정체는 자신만 알고, 말해도 좋고 속여도 좋다."
  },
  {
    title: "매 라운드, 하나의 지령",
    body: "본부는 30~70 사이의 비밀 숫자를 내린다. 협상 시간 동안 돌아다니며 설득하고, 1~100 중 하나를 제출한다."
  },
  {
    title: "지령에 가까운 자가 지배한다",
    body: "각 연합의 제출 숫자 평균을 비교한다. 지령에 더 가까운 연합이 라운드를 지배하고 10,000 세력을 차지한다."
  },
  {
    title: "욕심 VS 팀",
    body: "승리한 연합 내부에서는 자신이 낸 숫자 비율만큼 세력을 나눠 가진다.",
    formula: "10,000 × (내 숫자 ÷ 우리 팀 숫자 총합)"
  },
  {
    title: "갈등의 씨앗",
    body: "라운드 종료 후 승리 연합의 제출 숫자만 익명 공개된다. 패배 연합의 숫자는 공개되지 않는다."
  },
  {
    title: "최후의 공작원",
    body: "5라운드 후 누적 세력이 가장 많은 공작원이 최종 승리한다. 마지막에는 전체 순위와 진영 명단이 공개된다."
  }
];

const app = document.querySelector("#app");
let state = null;
let mode = "home";
let roomCode = null;
let teacherToken = null;
let playerId = null;
let appConfig = null;
let qrDataUrl = null;
let qrForUrl = null;
let soundOn = localStorage.getItem("shadow:sound") !== "off";
let toastTimer = null;
let ruleIndex = 0;

init();

function init() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "teacher" && parts[1]) {
    mode = "teacher";
    roomCode = parts[1].toUpperCase();
    const url = new URL(window.location.href);
    teacherToken = url.searchParams.get("t") || localStorage.getItem(`shadow:teacher:${roomCode}`);
    if (teacherToken) localStorage.setItem(`shadow:teacher:${roomCode}`, teacherToken);
    watchRoom();
    return;
  }
  if (parts[0] === "join" && parts[1]) {
    mode = "student";
    roomCode = parts[1].toUpperCase();
    const url = new URL(window.location.href);
    const teacherTokenForRoom = localStorage.getItem(`shadow:teacher:${roomCode}`);
    if (teacherTokenForRoom && url.searchParams.get("student") !== "1") {
      window.location.replace(`/teacher/${roomCode}?t=${teacherTokenForRoom}`);
      return;
    }
    playerId = localStorage.getItem(`shadow:player:${roomCode}`);
    joinRoom();
    return;
  }
  renderHome();
}

socket.on("room:state", ({ event, state: nextState }) => {
  state = nextState;
  if (event === "start" || event === "result" || event === "final") playTone(event);
  render();
});

socket.on("student:removed", ({ code }) => {
  if (code) localStorage.removeItem(`shadow:player:${code}`);
  playerId = null;
  showToast("명단에서 제거되었습니다.");
});

socket.on("connect", () => {
  if (mode === "teacher" && roomCode) watchRoom();
  if (mode === "student" && roomCode) joinRoom();
});

function render() {
  if (mode === "teacher") renderTeacher();
  if (mode === "student") renderStudent();
}

function renderHome() {
  const previous = getPreviousTeacherRoom();
  app.className = "app-shell";
  app.innerHTML = `
    <section class="brand brand-large">
      ${sigil("large")}
      <div class="title">SHADOW ALLIANCE</div>
      <div class="subtitle">그림자 연합</div>
      <div class="motto">말하라 · 속여라 · 배신하라 · 진실은 마지막에만 드러난다</div>
      <button class="btn primary" data-action="show-rules">✧ 세계관 보기</button>
    </section>
    <section class="home-grid">
      <div class="home-card">
        <div class="eyebrow">Briefing · 본부 기밀</div>
        <h1 class="heading">세계관 & 규칙</h1>
        ${ruleTrack()}
        <article class="panel rule-card" data-step="${String(ruleIndex + 1).padStart(2, "0")}">
          <h2 class="rule-title">${rules[ruleIndex].title}</h2>
          <div class="rule-body">
            <p>${rules[ruleIndex].body}</p>
            ${rules[ruleIndex].formula ? `<div class="formula">${rules[ruleIndex].formula}</div>` : ""}
          </div>
        </article>
        <div class="rule-nav">
          <button class="btn ghost" data-action="rule-prev" ${ruleIndex === 0 ? "disabled" : ""}>〈 이전</button>
          <span class="muted">${ruleIndex + 1} / ${rules.length}</span>
          <button class="btn primary" data-action="${ruleIndex === rules.length - 1 ? "rule-done" : "rule-next"}">
            ${ruleIndex === rules.length - 1 ? "완료 〉" : "다음 〉"}
          </button>
        </div>
      </div>
      <div class="home-card">
        <div class="eyebrow">본부 개설</div>
        <h2 class="heading">게임 방 열기</h2>
        <form class="room-form" data-form="create-room">
          <div class="settings-grid">
            <div class="field">
              <label>라운드</label>
              <select name="totalRounds">
                ${optionRange(3, 7, 5, "라운드")}
              </select>
            </div>
            <div class="field">
              <label>협상 시간</label>
              <select name="roundSeconds">
                <option value="180">3분</option>
                <option value="300" selected>5분</option>
                <option value="420">7분</option>
                <option value="600">10분</option>
              </select>
            </div>
            <div class="field">
              <label>지령 범위</label>
              <select name="rangePreset">
                <option value="30,70" selected>30~70</option>
                <option value="20,80">20~80</option>
                <option value="1,100">1~100</option>
              </select>
            </div>
          </div>
          <button class="btn primary" type="submit">✧ 방 열기</button>
        </form>
        ${
          previous
            ? `<div class="panel" style="margin-top:18px">
                <div class="muted">이전에 진행하던 게임이 있습니다.</div>
                <div class="gold">방 ${previous.code} · 라운드 ${previous.round || "?"}</div>
                <button class="btn primary" data-action="resume-room" style="margin-top:10px">이어서 진행</button>
              </div>`
            : ""
        }
      </div>
    </section>
  `;
  bindHome();
}

function bindHome() {
  app.querySelector('[data-action="show-rules"]')?.addEventListener("click", () => {
    document.querySelector(".home-grid")?.scrollIntoView({ behavior: "smooth" });
  });
  app.querySelector('[data-action="rule-prev"]')?.addEventListener("click", () => {
    ruleIndex = Math.max(0, ruleIndex - 1);
    renderHome();
  });
  app.querySelector('[data-action="rule-next"]')?.addEventListener("click", () => {
    ruleIndex = Math.min(rules.length - 1, ruleIndex + 1);
    renderHome();
  });
  app.querySelector('[data-action="rule-done"]')?.addEventListener("click", () => {
    document.querySelector('[data-form="create-room"]')?.scrollIntoView({ behavior: "smooth" });
  });
  app.querySelector('[data-action="resume-room"]')?.addEventListener("click", () => {
    const previous = getPreviousTeacherRoom();
    if (previous) window.location.href = `/teacher/${previous.code}?t=${previous.token}`;
  });
  app.querySelector('[data-form="create-room"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const [directiveMin, directiveMax] = String(form.get("rangePreset")).split(",").map(Number);
    createRoom({
      totalRounds: Number(form.get("totalRounds")),
      roundSeconds: Number(form.get("roundSeconds")),
      directiveMin,
      directiveMax
    });
  });
}

function createRoom(settings) {
  emit("room:create", settings).then((payload) => {
    localStorage.setItem(`shadow:teacher:${payload.code}`, payload.teacherToken);
    localStorage.setItem(
      "shadow:lastTeacher",
      JSON.stringify({ code: payload.code, token: payload.teacherToken, round: 0 })
    );
    window.location.href = `/teacher/${payload.code}?t=${payload.teacherToken}`;
  });
}

function getPreviousTeacherRoom() {
  try {
    return JSON.parse(localStorage.getItem("shadow:lastTeacher") || "null");
  } catch {
    return null;
  }
}

async function watchRoom() {
  if (!roomCode) return;
  await loadConfig();
  const payload = await emit("room:watch", {
    code: roomCode,
    teacherToken,
    role: "teacher"
  });
  state = payload.state;
  if (payload.role !== "teacher") {
    showToast("교사 권한 토큰이 없어 관전 화면으로 열렸습니다.");
  }
  localStorage.setItem(
    "shadow:lastTeacher",
    JSON.stringify({ code: roomCode, token: teacherToken, round: state.currentRound })
  );
  renderTeacher();
}

async function joinRoom() {
  if (!roomCode) return;
  const payload = await emit("student:join", { code: roomCode, playerId });
  playerId = payload.playerId;
  localStorage.setItem(`shadow:player:${roomCode}`, playerId);
  state = payload.state;
  renderStudent();
}

async function renderTeacher() {
  app.className = "app-shell";
  if (!state) {
    app.innerHTML = loading("본부에 접속 중");
    return;
  }
  if (!appConfig) loadConfig();
  const joinUrl = getJoinUrl(state.code);
  if (qrForUrl !== joinUrl) {
    qrDataUrl = null;
    qrForUrl = joinUrl;
    loadQr(joinUrl);
  }
  app.innerHTML = `
    ${teacherHeader()}
    <main class="teacher-layout">
      ${state.status === "lobby" ? teacherLobby(joinUrl) : ""}
      ${state.status === "round" ? teacherRound() : ""}
      ${state.status === "result" ? teacherResult() : ""}
      ${state.status === "final" ? finalView(true) : ""}
      ${state.status !== "final" ? rosterPanel() : ""}
    </main>
  `;
  bindTeacher();
}

function teacherHeader() {
  return `
    <header class="topbar">
      <div class="brand brand-small">${sigil()} <span>SHADOW ALLIANCE</span></div>
      <div class="actions">
        <span class="pill">ROUND ${state.currentRound || 0} / ${state.settings.totalRounds}</span>
        <button class="btn icon" title="사운드" data-action="sound">${soundOn ? "🔊" : "🔇"}</button>
        <button class="btn ghost" data-action="home">처음으로</button>
      </div>
    </header>
  `;
}

function teacherLobby(joinUrl) {
  const accessLabel = appConfig?.hasPublicUrl ? "공개 접속 주소" : "학생 입장 주소";
  return `
    <section class="panel hero-panel">
      <div>
        <div class="eyebrow">학생 접속</div>
        <div class="code-display">${state.code}</div>
        <div class="qr">${qrDataUrl ? `<img alt="학생 입장 QR" src="${qrDataUrl}">` : ""}</div>
        <p class="muted">${accessLabel}</p>
        <button class="join-url" data-action="copy-url">${joinUrl}</button>
        ${
          appConfig?.hasPublicUrl
            ? `<p class="muted">와이파이가 달라도 이 주소로 입장할 수 있습니다.</p>`
            : `<p class="muted">외부 접속은 공개 서버 배포 또는 터널 주소 설정이 필요합니다.</p>`
        }
      </div>
    </section>
    <section class="panel">
      <div class="eyebrow">게임 규칙 설정</div>
      <div class="stat-line"><span>총 라운드</span><strong>${state.settings.totalRounds} 라운드</strong></div>
      <div class="stat-line"><span>중앙 지령 범위</span><strong>${state.settings.directiveMin} ~ ${state.settings.directiveMax}</strong></div>
      <div class="stat-line"><span>협상 시간</span><strong>${formatMinutes(state.settings.roundSeconds)}</strong></div>
      <div class="actions" style="margin-top:18px">
        <button class="btn primary" data-action="start-round">✧ 라운드 시작</button>
      </div>
    </section>
  `;
}

function teacherRound() {
  const percent = Math.round((state.remainingMs / (state.settings.roundSeconds * 1000)) * 100);
  return `
    <section class="round-grid">
      <div class="panel directive">
        <div class="eyebrow">중앙 본부 지령</div>
        <span class="number">${state.directive}</span>
        <div class="timer">${formatTimer(state.remainingMs)}</div>
        <div class="bar" style="--progress:${Math.max(0, Math.min(100, percent))}%"><span></span></div>
        <div class="actions" style="justify-content:center">
          <button class="btn" data-action="pause">${state.paused ? "▶ 재개" : "⏸ 일시정지"}</button>
          <button class="btn ghost" data-action="plus-time">+30초</button>
          <button class="btn ghost" data-action="minus-time">-30초</button>
          <button class="btn danger" data-action="end-round">결과 공개</button>
        </div>
      </div>
      <div class="panel">
        <div class="stat-line">
          <span class="gold">제출 현황</span>
          <strong>${state.counts.submitted} / ${state.counts.total} 제출 완료</strong>
        </div>
        <div class="submission-grid" style="margin-top:16px">
          ${state.players.map(studentChip).join("") || `<p class="muted">학생이 접속하면 여기에 표시됩니다.</p>`}
        </div>
      </div>
    </section>
  `;
}

function studentChip(player) {
  return `
    <div class="student-chip ${player.submitted ? "done" : ""}">
      <strong>${escapeHtml(player.nickname)}</strong>
      <span>${player.submitted ? "제출 완료" : "협상 중"} · ${player.connected ? "접속" : "자리 비움"}</span>
    </div>
  `;
}

function teacherResult() {
  const result = state.result;
  const winner = result?.winnerTeam ? TEAMS[result.winnerTeam] : null;
  return `
    <section class="panel">
      <div class="eyebrow center">라운드 ${state.currentRound} 종료</div>
      <h2 class="result-title">
        ${
          winner
            ? `<span class="team-mark ${result.winnerTeam}"></span> ${winner.label} 지배`
            : "양 연합 교착"
        }
      </h2>
      <div class="columns">
        <div class="panel">
          <div class="eyebrow">승리 연합의 제출 숫자 · 익명 공개</div>
          <div class="numbers">
            ${
              result?.winningNumbers?.length
                ? result.winningNumbers.map((number) => `<span class="number-chip">${number}</span>`).join("")
                : `<span class="muted">공개할 숫자가 없습니다.</span>`
            }
          </div>
          <p class="muted center">패배 연합의 숫자는 공개되지 않습니다.</p>
        </div>
        <div class="panel">
          <div class="eyebrow">현재 세력 순위 · TOP 5</div>
          <div class="rank-list" style="margin-top:16px">${rankRows(state.top5)}</div>
        </div>
      </div>
      <div class="actions" style="justify-content:center; margin-top:22px">
        ${
          state.currentRound >= state.settings.totalRounds
            ? `<button class="btn primary" data-action="finalize">✧ 최종 시상대</button>`
            : `<button class="btn primary" data-action="start-round">✧ 다음 지령</button>`
        }
      </div>
    </section>
  `;
}

function rosterPanel() {
  const black = state.players.filter((player) => player.team === "black").length;
  const white = state.players.filter((player) => player.team === "white").length;
  return `
    <section class="panel">
      <div class="stat-line">
        <span class="gold">명단</span>
        <strong>총 ${state.counts.total}명 · ● ${black} · ○ ${white}</strong>
      </div>
      ${
        state.players.length
          ? `<div class="submission-grid" style="margin-top:16px">${state.players
              .map(
                (player) => `
                  <div class="student-chip">
                    <strong>${escapeHtml(player.nickname)}</strong>
                    <span>${player.connected ? "접속 중" : "연결 끊김"} · ${player.power.toLocaleString()} 세력</span>
                    ${
                      state.status === "lobby" || state.status === "result"
                        ? `<button class="mini-btn" data-action="remove-player" data-player-id="${player.id}">명단 제거</button>`
                        : ""
                    }
                  </div>
                `
              )
              .join("")}</div>`
          : `<p class="muted center">학생이 접속하면 여기에 표시됩니다.</p>`
      }
    </section>
  `;
}

function bindTeacher() {
  app.querySelector('[data-action="home"]')?.addEventListener("click", () => {
    window.location.href = "/";
  });
  app.querySelector('[data-action="sound"]')?.addEventListener("click", toggleSound);
  app.querySelector('[data-action="copy-url"]')?.addEventListener("click", async (event) => {
    try {
      await navigator.clipboard.writeText(event.currentTarget.textContent.trim());
      showToast("학생 입장 주소를 복사했습니다.");
    } catch {
      showToast("주소를 선택해서 복사할 수 있습니다.");
    }
  });
  app.querySelectorAll('[data-action="start-round"]').forEach((button) => {
    button.addEventListener("click", () => teacherEmit("teacher:startRound"));
  });
  app.querySelector('[data-action="pause"]')?.addEventListener("click", () => teacherEmit("teacher:pause"));
  app.querySelector('[data-action="plus-time"]')?.addEventListener("click", () =>
    teacherEmit("teacher:adjustTime", { deltaSeconds: 30 })
  );
  app.querySelector('[data-action="minus-time"]')?.addEventListener("click", () =>
    teacherEmit("teacher:adjustTime", { deltaSeconds: -30 })
  );
  app.querySelector('[data-action="end-round"]')?.addEventListener("click", () => teacherEmit("teacher:endRound"));
  app.querySelectorAll('[data-action="remove-player"]').forEach((button) => {
    button.addEventListener("click", () => {
      teacherEmit("teacher:removePlayer", {
        playerId: button.dataset.playerId
      }).then((payload) => {
        if (payload.removed?.nickname) showToast(`${payload.removed.nickname} 명단에서 제거됨`);
      });
    });
  });
  app.querySelector('[data-action="finalize"]')?.addEventListener("click", () => teacherEmit("teacher:finalize"));
}

function teacherEmit(event, extra = {}) {
  return emit(event, {
    code: state.code,
    teacherToken,
    ...extra
  }).then((payload) => {
    state = payload.state;
    renderTeacher();
  });
}

async function loadQr(joinUrl) {
  try {
    const response = await fetch(`/api/qr?text=${encodeURIComponent(joinUrl)}`);
    const payload = await response.json();
    qrDataUrl = payload.dataUrl;
    renderTeacher();
  } catch {
    qrDataUrl = null;
  }
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    appConfig = await response.json();
  } catch {
    appConfig = {
      publicUrl: window.location.origin,
      localUrls: [],
      hasPublicUrl: false
    };
  }
}

function getJoinUrl(code) {
  const origin = (appConfig?.publicUrl || window.location.origin).replace(/\/+$/, "");
  return `${origin}/join/${code}`;
}

function renderStudent() {
  app.className = "app-shell student-shell";
  if (!state) {
    app.innerHTML = loading("잠입 중");
    return;
  }
  if (!state.personal) {
    app.innerHTML = `
      <header class="topbar">
        <div class="brand brand-small">${sigil()} <span>SHADOW ALLIANCE</span></div>
      </header>
      <section class="panel student-focus">
        <div>
          <div class="eyebrow">입장 정보 없음</div>
          <div class="giant">?</div>
          <p class="muted">교사 화면에서 명단이 제거되었습니다. 다시 입장하려면 학생 QR을 새로 열어주세요.</p>
        </div>
      </section>
    `;
    return;
  }
  app.innerHTML = `
    <header class="topbar">
      <div class="brand brand-small">${sigil()} <span>SHADOW ALLIANCE</span></div>
    </header>
    ${secretTabs()}
    <main class="student-main">
      ${state.status === "lobby" ? studentLobby() : ""}
      ${state.status === "round" ? studentRound() : ""}
      ${state.status === "result" ? studentResult() : ""}
      ${state.status === "final" ? finalView(false) : ""}
    </main>
  `;
  bindStudent();
}

function secretTabs() {
  const personal = state.personal || {};
  return `
    <section class="secret-tabs" aria-label="내 비밀 정보">
      <button class="secret-card" data-secret>
        <span class="secret-label">👁 내 닉네임</span>
        <span class="secret-value">${escapeHtml(personal.nickname || "")}</span>
      </button>
      <button class="secret-card" data-secret>
        <span class="secret-label">👁 내 팀</span>
        <span class="secret-value">${teamText(personal.team)}</span>
      </button>
      <button class="secret-card" data-secret>
        <span class="secret-label">👁 내 세력</span>
        <span class="secret-value">${(personal.power || 0).toLocaleString()} 세력</span>
      </button>
    </section>
  `;
}

function studentLobby() {
  return `
    <section class="panel student-focus">
      <div>
        <div class="eyebrow">잠입 완료</div>
        <div class="giant">${state.code}</div>
        <p class="muted">교실 화면의 지령을 기다리세요.</p>
      </div>
    </section>
  `;
}

function studentRound() {
  const percent = Math.round((state.remainingMs / (state.settings.roundSeconds * 1000)) * 100);
  const current = state.personal?.currentSubmission || 50;
  return `
    <section class="panel directive">
      <div class="eyebrow">중앙 본부 지령</div>
      <span class="number">${state.directive}</span>
      <div class="timer">${formatTimer(state.remainingMs)}</div>
      <div class="bar" style="--progress:${Math.max(0, Math.min(100, percent))}%"><span></span></div>
    </section>
    <section class="panel submit-box">
      <div class="stat-line">
        <span class="gold">제출 숫자</span>
        <strong>${state.personal?.currentSubmission ? `${state.personal.currentSubmission} 제출됨` : "미제출"}</strong>
      </div>
      <div class="number-input">
        <input type="range" min="1" max="100" value="${current}" data-input="range" />
        <input type="number" min="1" max="100" value="${current}" data-input="number" />
      </div>
      <button class="btn primary" data-action="submit-number">
        ${state.personal?.currentSubmission ? "✧ 숫자 바꾸기" : "✧ 숫자 제출"}
      </button>
      <p class="muted center">제출 후에도 시간이 끝나기 전까지 바꿀 수 있습니다.</p>
    </section>
  `;
}

function studentResult() {
  const result = state.result;
  const winner = result?.winnerTeam ? TEAMS[result.winnerTeam] : null;
  const gain = state.personal?.lastGain || 0;
  return `
    <section class="panel student-focus">
      <div>
        <div class="eyebrow">이번 라운드 획득</div>
        <div class="giant">${gain > 0 ? `+${gain.toLocaleString()}` : "0"}</div>
        <p class="gold">세력</p>
        <p class="muted">${winner ? `${winner.label}이 지령을 지배했습니다.` : "양 연합 모두 세력 변동이 없습니다."}</p>
      </div>
    </section>
    <section class="panel">
      <div class="eyebrow">승리 연합의 제출 숫자 · 익명 공개</div>
      <div class="numbers">
        ${
          result?.winningNumbers?.length
            ? result.winningNumbers.map((number) => `<span class="number-chip">${number}</span>`).join("")
            : `<span class="muted">공개할 숫자가 없습니다.</span>`
        }
      </div>
    </section>
    <section class="panel">
      <div class="eyebrow">현재 세력 순위 · TOP 5</div>
      <div class="rank-list" style="margin-top:16px">${rankRows(state.top5)}</div>
    </section>
  `;
}

function bindStudent() {
  bindSecrets();
  const range = app.querySelector('[data-input="range"]');
  const number = app.querySelector('[data-input="number"]');
  if (range && number) {
    range.addEventListener("input", () => {
      number.value = range.value;
    });
    number.addEventListener("input", () => {
      const value = clamp(Number(number.value), 1, 100);
      range.value = value;
    });
  }
  app.querySelector('[data-action="submit-number"]')?.addEventListener("click", () => {
    const value = Number(app.querySelector('[data-input="number"]').value);
    emit("student:submit", {
      code: state.code,
      playerId,
      value
    }).then((payload) => {
      state = payload.state;
      showToast(`${value} 제출 완료`);
      renderStudent();
    });
  });
}

function bindSecrets() {
  app.querySelectorAll("[data-secret]").forEach((element) => {
    const reveal = () => element.classList.add("revealed");
    const hide = () => element.classList.remove("revealed");
    element.addEventListener("pointerdown", reveal);
    element.addEventListener("pointerup", hide);
    element.addEventListener("pointercancel", hide);
    element.addEventListener("pointerleave", hide);
    element.addEventListener("touchstart", reveal, { passive: true });
    element.addEventListener("touchend", hide, { passive: true });
  });
}

function finalView(isTeacher) {
  const final = state.final;
  const rankings = final?.rankings || [];
  const top = rankings.slice(0, 3);
  const teamWinner = final?.teamWinner ? TEAMS[final.teamWinner] : null;
  return `
    <section class="panel">
      <div class="eyebrow center">최종 결과</div>
      <h2 class="result-title">세력 시상대</h2>
      <div class="panel center" style="margin:16px 0">
        <div class="eyebrow">우승 연합 · ${state.settings.totalRounds}라운드 중 승리 횟수</div>
        <h3 class="result-title">
          ${teamWinner ? `<span class="team-mark ${final.teamWinner}"></span> ${teamWinner.label} 우승` : "양 연합 동률"}
        </h3>
        <p class="muted">● ${final?.teamWins.black || 0}승 · ○ ${final?.teamWins.white || 0}승</p>
      </div>
      <div class="podium">
        ${podiumCard(top[1], 2)}
        ${podiumCard(top[0], 1)}
        ${podiumCard(top[2], 3)}
      </div>
      <div class="columns">
        <section class="panel">
          <div class="eyebrow">전체 순위</div>
          <div class="rank-list" style="margin-top:16px">${rankRows(rankings.map((player, index) => ({ ...player, rank: index + 1 })))}</div>
        </section>
        <section class="panel">
          <div class="eyebrow">진영 공개</div>
          ${rosterList("black", final?.rosters.black || [])}
          ${rosterList("white", final?.rosters.white || [])}
        </section>
      </div>
      ${
        isTeacher
          ? `<div class="actions" style="justify-content:center; margin-top:22px"><button class="btn primary" data-action="home">새 게임 시작</button></div>`
          : ""
      }
    </section>
  `;
}

function podiumCard(player, place) {
  if (!player) {
    return `<div class="podium-card place-${place}"><div class="place">${place}</div><p class="muted">공석</p></div>`;
  }
  return `
    <div class="podium-card place-${place}">
      <div class="place">${place}</div>
      <strong>${escapeHtml(player.nickname)}</strong>
      <span class="gold">${player.power.toLocaleString()}</span>
    </div>
  `;
}

function rosterList(team, players) {
  return `
    <h3 class="gold"><span class="team-mark ${team}"></span> ${TEAMS[team].label}</h3>
    <div class="rank-list">
      ${
        players.length
          ? players
              .map(
                (player, index) => `
                  <div class="rank-row">
                    <span class="rank">${index + 1}</span>
                    <span class="name">${escapeHtml(player.nickname)}</span>
                    <span class="score">${player.power.toLocaleString()}</span>
                  </div>
                `
              )
              .join("")
          : `<p class="muted">명단 없음</p>`
      }
    </div>
  `;
}

function rankRows(rows) {
  if (!rows?.length) return `<p class="muted center">아직 순위가 없습니다.</p>`;
  return rows
    .map(
      (row, index) => `
        <div class="rank-row ${index === 0 ? "first" : ""}">
          <span class="rank">${row.rank || index + 1}</span>
          <span class="name">${escapeHtml(row.nickname)}</span>
          <span class="score">${Number(row.power || 0).toLocaleString()}</span>
        </div>
      `
    )
    .join("");
}

function ruleTrack() {
  return `<div class="rule-track">${rules
    .map((_, index) => `<span class="rule-dot ${index <= ruleIndex ? "active" : ""}"></span>`)
    .join("")}</div>`;
}

function optionRange(min, max, selected, suffix) {
  const options = [];
  for (let value = min; value <= max; value += 1) {
    options.push(`<option value="${value}" ${value === selected ? "selected" : ""}>${value}${suffix}</option>`);
  }
  return options.join("");
}

function sigil(size = "") {
  return `
    <span class="sigil ${size}" aria-hidden="true">
      <svg viewBox="0 0 100 100" role="img">
        <circle cx="50" cy="50" r="42"></circle>
        <path d="M50 10 86 72H14Z"></path>
        <path d="M50 90 14 28h72Z"></path>
        <circle cx="50" cy="50" r="8" fill="currentColor"></circle>
      </svg>
    </span>
  `;
}

function loading(text) {
  return `
    <section class="panel student-focus">
      <div>
        <div class="eyebrow">${text}</div>
        <div class="giant">...</div>
      </div>
    </section>
  `;
}

function emit(event, payload) {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (reply) => {
      if (!reply?.ok) {
        showToast(reply?.error || "요청을 처리하지 못했습니다.");
        reject(new Error(reply?.error || "socket error"));
        return;
      }
      resolve(reply);
    });
  });
}

function formatTimer(ms) {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatMinutes(seconds) {
  if (seconds % 60 === 0) return `${seconds / 60}분`;
  return `${seconds}초`;
}

function teamText(team) {
  if (!team || !TEAMS[team]) return "";
  return `${TEAMS[team].mark} ${TEAMS[team].label}`;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showToast(message) {
  clearTimeout(toastTimer);
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toastTimer = setTimeout(() => toast.remove(), 2400);
}

function toggleSound() {
  soundOn = !soundOn;
  localStorage.setItem("shadow:sound", soundOn ? "on" : "off");
  render();
}

function playTone(event) {
  if (!soundOn) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext();
    const osc = context.createOscillator();
    const gain = context.createGain();
    const frequency = event === "result" ? 260 : event === "final" ? 520 : 392;
    osc.frequency.value = frequency;
    osc.type = "triangle";
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.14, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.32);
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start();
    osc.stop(context.currentTime + 0.34);
  } catch {
    // Audio is optional and may be blocked until the user interacts with the page.
  }
}
