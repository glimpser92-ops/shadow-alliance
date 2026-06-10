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
    body: "라운드마다 n이 무작위로 정해진다. 승리한 연합 안에서 높은 숫자 상위 n명은 0점 처리되고, 나머지가 자신이 낸 숫자 비율만큼 세력을 나눠 가진다.",
    formula: "10,000 × (내 숫자 ÷ 랜덤 컷 제외 후 숫자 총합)"
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

const simulation = {
  directive: 42,
  teams: {
    black: {
      numbers: [30, 42, 60],
      average: 44,
      distance: 2,
      gains: [4167, 5833, 0],
      penaltyTargetCount: 1,
      penaltyIndices: [2]
    },
    white: {
      numbers: [20, 70, 80],
      average: 56.7,
      distance: 14.7,
      gains: [0, 0, 0]
    }
  }
};

const simulationSteps = [
  {
    title: "본부 지령 공개",
    body: "예시 라운드의 중앙 지령은 42다. 각 연합은 자기 팀 평균을 42에 가깝게 만들려고 협상한다.",
    phase: "directive"
  },
  {
    title: "각자 숫자 제출",
    body: "블랙은 30, 42, 60을 냈고 화이트는 20, 70, 80을 냈다. 누가 어느 팀인지는 아직 서로 확실히 모른다.",
    phase: "submit"
  },
  {
    title: "팀 평균 비교",
    body: "블랙 평균은 44라서 지령과 2 차이, 화이트 평균은 56.7이라서 14.7 차이다. 그래서 블랙 연합이 라운드를 지배한다.",
    phase: "average"
  },
  {
    title: "승리팀 세력 분배",
    body: "이번 라운드의 랜덤 컷은 n=1이다. 블랙의 가장 큰 숫자 60은 0점 처리되고, 30과 42가 10,000 세력을 비율대로 나눠 가진다.",
    phase: "reward"
  },
  {
    title: "갈등의 씨앗 공개",
    body: "교사 화면에는 승리한 블랙의 제출 숫자만 익명 공개된다. 화이트 숫자는 감춰지고, 현재 순위 Top 5가 이어서 보인다.",
    phase: "reveal"
  }
];

const app = document.querySelector("#app");
let state = null;
let mode = "home";
let roomCode = null;
let teacherToken = null;
let playerId = null;
const deviceId = getDeviceId();
let appConfig = null;
let qrDataUrl = null;
let qrForUrl = null;
let soundOn = localStorage.getItem("shadow:sound") !== "off";
let ambientAudio = null;
let toastTimer = null;
let ruleIndex = 0;
let simulationIndex = 0;
let showSimulation = false;
let sceneMotion = "";
let submissionDraftValue = null;
let submissionDraftRound = null;

init();

// Browsers block audio until the first user gesture, so unlock the
// background music on any tap or click on the teacher screen.
document.addEventListener(
  "pointerdown",
  () => {
    if (mode === "teacher" && soundOn) primeAmbientMusic();
  },
  { passive: true }
);

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
  const keepStudentNumberFocus = shouldKeepStudentNumberFocus(nextState);
  captureSubmissionDraftFromDom();
  state = nextState;
  if (event === "start" || event === "result" || event === "final") {
    sceneMotion = event;
    showStageTransition(event, nextState);
    playTone(event);
  }
  if (keepStudentNumberFocus) {
    updateStudentRoundLive();
    syncAmbientMusic();
    return;
  }
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
  syncAmbientMusic();
}

function renderHome() {
  syncAmbientMusic();
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
        <h1 class="heading">${showSimulation ? "사례 시뮬레이션" : "세계관 & 규칙"}</h1>
        ${showSimulation ? simulationTrack() : ruleTrack()}
        ${showSimulation ? simulationCard() : ruleCard()}
        ${showSimulation ? simulationNav() : ruleNav()}
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
              <label>지령 최소</label>
              <input name="directiveMin" type="number" min="1" max="100" value="30" inputmode="numeric" />
            </div>
            <div class="field">
              <label>지령 최대</label>
              <input name="directiveMax" type="number" min="1" max="100" value="70" inputmode="numeric" />
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

function ruleCard() {
  const rule = rules[ruleIndex];
  return `
    <article class="panel rule-card" data-step="${String(ruleIndex + 1).padStart(2, "0")}">
      <h2 class="rule-title">${rule.title}</h2>
      <div class="rule-body">
        <p>${rule.body}</p>
        ${rule.formula ? `<div class="formula">${rule.formula}</div>` : ""}
      </div>
    </article>
  `;
}

function ruleNav() {
  return `
    <div class="rule-nav">
      <button class="btn ghost" data-action="rule-prev" ${ruleIndex === 0 ? "disabled" : ""}>〈 이전</button>
      <span class="muted">${ruleIndex + 1} / ${rules.length}</span>
      <button class="btn primary" data-action="${ruleIndex === rules.length - 1 ? "simulation-start" : "rule-next"}">
        ${ruleIndex === rules.length - 1 ? "사례 보기 〉" : "다음 〉"}
      </button>
    </div>
  `;
}

function simulationCard() {
  const step = simulationSteps[simulationIndex];
  return `
    <article class="panel rule-card simulation-card" data-step="${String(simulationIndex + 1).padStart(2, "0")}">
      <h2 class="rule-title">${step.title}</h2>
      <div class="rule-body">
        <p>${step.body}</p>
        ${simulationBoard(step.phase)}
      </div>
    </article>
  `;
}

function simulationBoard(phase) {
  return `
    <div class="sim-board phase-${phase}">
      <div class="sim-directive ${phase === "directive" ? "focus" : ""}">
        <span>중앙 지령</span>
        <strong>${simulation.directive}</strong>
      </div>
      <div class="sim-teams">
        ${simulationTeam("black", phase)}
        ${simulationTeam("white", phase)}
      </div>
      ${phase === "reveal" ? simulationReveal() : ""}
    </div>
  `;
}

function simulationTeam(team, phase) {
  const data = simulation.teams[team];
  const isWinner = team === "black";
  const showAverage = ["average", "reward", "reveal"].includes(phase);
  const showGains = ["reward", "reveal"].includes(phase);
  return `
    <section class="sim-team ${team} ${isWinner && showAverage ? "winner" : ""}">
      <div class="sim-team-head">
        <span class="team-mark ${team}"></span>
        <strong>${TEAMS[team].label}</strong>
      </div>
      <div class="sim-numbers">
        ${data.numbers
          .map(
            (number, index) => `
              <div class="sim-number">
                <span>${number}</span>
                ${
                  showGains
                    ? `<small class="${data.penaltyIndices?.includes(index) ? "penalty-text" : ""}">
                        ${data.penaltyIndices?.includes(index) ? "랜덤 컷 · " : ""}${data.gains[index].toLocaleString()} 세력
                      </small>`
                    : ""
                }
              </div>
            `
          )
          .join("")}
      </div>
      ${
        showAverage
          ? `<div class="sim-average">
              평균 <strong>${data.average}</strong>
              <span>지령과 ${data.distance} 차이</span>
            </div>`
          : `<p class="muted">협상 중</p>`
      }
    </section>
  `;
}

function simulationReveal() {
  const winningNumbers = [...simulation.teams.black.numbers].sort((a, b) => b - a);
  return `
    <div class="sim-reveal">
      <div class="eyebrow">결과 공개</div>
      <strong>블랙 연합 지배</strong>
      <div class="numbers">
        ${numberChips(winningNumbers)}
      </div>
      <p class="muted">패배 연합의 숫자는 공개되지 않습니다.</p>
    </div>
  `;
}

function simulationNav() {
  const isLast = simulationIndex === simulationSteps.length - 1;
  return `
    <div class="rule-nav">
      <button class="btn ghost" data-action="simulation-prev">〈 이전</button>
      <span class="muted">사례 ${simulationIndex + 1} / ${simulationSteps.length}</span>
      <button class="btn primary" data-action="${isLast ? "simulation-done" : "simulation-next"}">
        ${isLast ? "게임 개설하기 〉" : "다음 〉"}
      </button>
    </div>
  `;
}

function bindHome() {
  app.querySelector('[data-action="show-rules"]')?.addEventListener("click", () => {
    document.querySelector(".home-grid")?.scrollIntoView({ behavior: "smooth" });
  });
  app.querySelector('[data-action="rule-prev"]')?.addEventListener("click", () => {
    showSimulation = false;
    ruleIndex = Math.max(0, ruleIndex - 1);
    renderHome();
  });
  app.querySelector('[data-action="rule-next"]')?.addEventListener("click", () => {
    showSimulation = false;
    ruleIndex = Math.min(rules.length - 1, ruleIndex + 1);
    renderHome();
  });
  app.querySelector('[data-action="simulation-start"]')?.addEventListener("click", () => {
    showSimulation = true;
    simulationIndex = 0;
    renderHome();
  });
  app.querySelector('[data-action="simulation-prev"]')?.addEventListener("click", () => {
    if (simulationIndex === 0) {
      showSimulation = false;
      ruleIndex = rules.length - 1;
    } else {
      simulationIndex -= 1;
    }
    renderHome();
  });
  app.querySelector('[data-action="simulation-next"]')?.addEventListener("click", () => {
    simulationIndex = Math.min(simulationSteps.length - 1, simulationIndex + 1);
    renderHome();
  });
  app.querySelector('[data-action="simulation-done"]')?.addEventListener("click", () => {
    document.querySelector('[data-form="create-room"]')?.scrollIntoView({ behavior: "smooth" });
  });
  app.querySelector('[data-action="resume-room"]')?.addEventListener("click", () => {
    const previous = getPreviousTeacherRoom();
    if (previous) window.location.href = `/teacher/${previous.code}?t=${previous.token}`;
  });
  app.querySelector('[data-form="create-room"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const directiveValues = [
      clamp(Math.round(Number(form.get("directiveMin"))), 1, 100),
      clamp(Math.round(Number(form.get("directiveMax"))), 1, 100)
    ].sort((a, b) => a - b);
    createRoom({
      totalRounds: Number(form.get("totalRounds")),
      roundSeconds: Number(form.get("roundSeconds")),
      directiveMin: directiveValues[0],
      directiveMax: directiveValues[1]
    });
  });
}

function createRoom(settings) {
  emit("room:create", { settings, deviceId }).then((payload) => {
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

let watchInFlight = false;

async function watchRoom() {
  if (!roomCode || watchInFlight) return;
  watchInFlight = true;
  try {
    await doWatchRoom();
  } finally {
    watchInFlight = false;
  }
}

async function doWatchRoom() {
  await loadConfig();
  const payload = await emit("room:watch", {
    code: roomCode,
    teacherToken,
    role: "teacher",
    deviceId
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

let joinInFlight = false;

async function joinRoom() {
  if (!roomCode || joinInFlight) return;
  joinInFlight = true;
  try {
    await doJoinRoom();
  } finally {
    joinInFlight = false;
  }
}

async function doJoinRoom() {
  const knownTeacherToken = localStorage.getItem(`shadow:teacher:${roomCode}`);
  const payload = await emit("student:join", { code: roomCode, playerId, deviceId, teacherToken: knownTeacherToken });
  if (payload.blockedAsTeacher) {
    localStorage.removeItem(`shadow:player:${roomCode}`);
    const token = localStorage.getItem(`shadow:teacher:${roomCode}`);
    if (token) {
      window.location.replace(`/teacher/${roomCode}?t=${token}`);
      return;
    }
    mode = "teacher";
    state = payload.state;
    showToast("교사 기기는 학생 명단에 등록되지 않습니다.");
    renderTeacher();
    return;
  }
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
  const sceneClass = consumeSceneClass();
  app.innerHTML = `
    ${teacherHeader()}
    <main class="teacher-layout ${sceneClass}">
      ${state.status === "lobby" ? teacherLobby(joinUrl) : ""}
      ${state.status === "round" ? teacherRound() : ""}
      ${state.status === "result" ? teacherResult() : ""}
      ${state.status === "final" ? finalView(true) : ""}
      ${state.status !== "lobby" && state.status !== "final" ? teacherJoinPanel(joinUrl) : ""}
      ${state.status !== "final" ? rosterPanel() : ""}
    </main>
  `;
  bindTeacher();
  syncAmbientMusic();
}

function teacherHeader() {
  return `
    <header class="topbar">
      <div class="brand brand-small">${sigil()} <span>SHADOW ALLIANCE</span></div>
      <div class="actions">
        <span class="pill">ROUND ${state.currentRound || 0} / ${state.settings.totalRounds}</span>
        <button class="btn icon" title="${soundButtonTitle()}" data-action="sound">${soundButtonLabel()}</button>
        <button class="btn ghost" data-action="home">처음으로</button>
      </div>
    </header>
  `;
}

function teacherJoinPanel(joinUrl) {
  return `
    <section class="panel join-panel">
      <div>
        <div class="eyebrow">중간 입장</div>
        <strong class="gold">방 ${state.code}</strong>
        <p class="muted">라운드 중에도 학생은 QR 또는 주소로 들어와 바로 숫자를 제출할 수 있습니다.</p>
      </div>
      <div class="join-panel-right">
        <div class="qr compact">${qrDataUrl ? `<img alt="학생 입장 QR" src="${qrDataUrl}">` : ""}</div>
        <button class="join-url compact-url" data-action="copy-url">${joinUrl}</button>
      </div>
    </section>
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
      <div class="panel directive ${timerUrgencyClass()}">
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
  const penaltyMessage = result?.penalty
    ? `이번 랜덤 컷 n=${result.penalty.targetCount}. 높은 숫자 ${result.penalty.values.join(", ")} 제출자 ${result.penalty.count}명은 0점 처리됩니다.`
    : "이번 라운드 랜덤 컷 대상은 없습니다.";
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
                ? numberChips(result.winningNumbers)
                : `<span class="muted">공개할 숫자가 없습니다.</span>`
            }
          </div>
          <p class="muted center">패배 연합의 숫자는 공개되지 않습니다.</p>
          ${winner ? `<p class="penalty-note center">${penaltyMessage}</p>` : ""}
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
                    <div class="chip-actions">
                      <button class="mini-btn gold" data-action="exclude-player" data-player-id="${player.id}">교사 제외</button>
                      ${
                        state.status === "lobby" || state.status === "result"
                          ? `<button class="mini-btn" data-action="remove-player" data-player-id="${player.id}">명단 제거</button>`
                          : ""
                      }
                    </div>
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
  app.querySelector('[data-action="new-game"]')?.addEventListener("click", () => {
    const nextSettings = state?.settings || {
      totalRounds: 5,
      directiveMin: 30,
      directiveMax: 70,
      roundSeconds: 300
    };
    showToast("새 방을 여는 중입니다.");
    createRoom(nextSettings);
  });
  app.querySelectorAll('[data-action="copy-url"]').forEach((button) => {
    button.addEventListener("click", async (event) => {
      try {
        await navigator.clipboard.writeText(event.currentTarget.textContent.trim());
        showToast("학생 입장 주소를 복사했습니다.");
      } catch {
        showToast("주소를 선택해서 복사할 수 있습니다.");
      }
    });
  });
  app.querySelectorAll('[data-action="start-round"]').forEach((button) => {
    button.addEventListener("click", () => {
      primeAmbientMusic();
      teacherEmit("teacher:startRound").then(() => primeAmbientMusic());
    });
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
  app.querySelectorAll('[data-action="exclude-player"]').forEach((button) => {
    button.addEventListener("click", () => {
      teacherEmit("teacher:excludePlayer", {
        playerId: button.dataset.playerId
      }).then((payload) => {
        if (payload.removed?.nickname) showToast(`${payload.removed.nickname} 교사 제외 처리됨`);
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
  captureSubmissionDraftFromDom();
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
  const sceneClass = consumeSceneClass();
  app.innerHTML = `
    <header class="topbar">
      <div class="brand brand-small">${sigil()} <span>SHADOW ALLIANCE</span></div>
    </header>
    ${secretTabs()}
    <main class="student-main ${sceneClass}">
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
  const current = getSubmissionInputValue();
  return `
    <section class="panel directive ${timerUrgencyClass()}">
      <div class="eyebrow">중앙 본부 지령</div>
      <span class="number" data-live="directive">${state.directive}</span>
      <div class="timer" data-live="timer">${formatTimer(state.remainingMs)}</div>
      <div class="bar" data-live="timer-bar" style="--progress:${Math.max(0, Math.min(100, percent))}%"><span></span></div>
    </section>
    <section class="panel submit-box">
      <div class="stat-line">
        <span class="gold">제출 숫자</span>
        <strong data-live="submission-status">${state.personal?.currentSubmission ? `${state.personal.currentSubmission} 제출됨` : "미제출"}</strong>
      </div>
      <div class="number-input">
        <input type="range" min="1" max="100" value="${current}" data-input="range" />
        <input type="number" min="1" max="100" value="${current}" inputmode="numeric" pattern="[0-9]*" data-input="number" />
      </div>
      <button class="btn primary" data-action="submit-number" data-live="submit-button">
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
  const personalPenalty = result?.penalty?.playerIds?.includes(state.personal?.id);
  return `
    <section class="panel student-focus">
      <div>
        <div class="eyebrow">이번 라운드 획득</div>
        <div class="giant">${gain > 0 ? `+${gain.toLocaleString()}` : "0"}</div>
        <p class="gold">세력</p>
        <p class="${personalPenalty ? "penalty-text" : "muted"}">${
          personalPenalty
            ? "랜덤 컷 페널티로 이번 분배에서 제외되었습니다."
            : winner
              ? `${winner.label}이 지령을 지배했습니다.`
              : "양 연합 모두 세력 변동이 없습니다."
        }</p>
      </div>
    </section>
    <section class="panel">
      <div class="eyebrow">승리 연합의 제출 숫자 · 익명 공개</div>
      <div class="numbers">
        ${
          result?.winningNumbers?.length
            ? numberChips(result.winningNumbers)
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
    const saveDraft = (value) => {
      submissionDraftValue = normalizeSubmissionValue(value);
      submissionDraftRound = state.currentRound;
      return submissionDraftValue;
    };
    const saveDraftIfValid = (value) => {
      const parsed = parseSubmissionValue(value);
      if (parsed === null) return null;
      submissionDraftValue = parsed;
      submissionDraftRound = state.currentRound;
      return parsed;
    };
    range.addEventListener("input", () => {
      number.value = range.value;
      saveDraft(range.value);
    });
    range.addEventListener("change", () => {
      number.value = range.value;
      saveDraft(range.value);
    });
    number.addEventListener("input", () => {
      const value = saveDraftIfValid(number.value);
      if (value !== null) range.value = value;
    });
    number.addEventListener("change", () => {
      const value = saveDraft(number.value || getSubmissionInputValue());
      range.value = value;
      number.value = value;
    });
  }
  app.querySelector('[data-action="submit-number"]')?.addEventListener("click", () => {
    const input = app.querySelector('[data-input="number"]');
    const value = normalizeSubmissionValue(input?.value, getSubmissionInputValue());
    submissionDraftValue = value;
    submissionDraftRound = state.currentRound;
    if (input) input.value = value;
    emit("student:submit", {
      code: state.code,
      playerId,
      value
    }).then((payload) => {
      state = payload.state;
      submissionDraftValue = value;
      submissionDraftRound = state.currentRound;
      showToast(`${value} 제출 완료`);
      renderStudent();
    });
  });
}

function getSubmissionInputValue() {
  if (submissionDraftRound === state?.currentRound && Number.isFinite(submissionDraftValue)) {
    return submissionDraftValue;
  }
  submissionDraftRound = state?.currentRound || null;
  submissionDraftValue = normalizeSubmissionValue(state?.personal?.currentSubmission || 50);
  return submissionDraftValue;
}

function captureSubmissionDraftFromDom() {
  if (mode !== "student" || state?.status !== "round") return;
  const range = app.querySelector('[data-input="range"]');
  const number = app.querySelector('[data-input="number"]');
  const source =
    document.activeElement === number
      ? number
      : document.activeElement === range
        ? range
        : number || range;
  if (!source) return;
  const value = parseSubmissionValue(source.value);
  if (value === null) return;
  submissionDraftValue = value;
  submissionDraftRound = state.currentRound;
}

function parseSubmissionValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const number = Number(raw);
  if (!Number.isFinite(number)) return null;
  return clamp(Math.round(number), 1, 100);
}

function normalizeSubmissionValue(value, fallback = 50) {
  const parsed = parseSubmissionValue(value);
  if (parsed !== null) return parsed;
  return parseSubmissionValue(fallback) || 50;
}

function shouldKeepStudentNumberFocus(nextState) {
  return Boolean(
    mode === "student" &&
      state?.status === "round" &&
      nextState?.status === "round" &&
      state.currentRound === nextState.currentRound &&
      state.personal?.id === nextState.personal?.id &&
      document.activeElement?.matches?.('[data-input="number"]')
  );
}

function updateStudentRoundLive() {
  if (mode !== "student" || state?.status !== "round") return;
  const percent = Math.round((state.remainingMs / (state.settings.roundSeconds * 1000)) * 100);
  const directive = app.querySelector('[data-live="directive"]');
  const timer = app.querySelector('[data-live="timer"]');
  const timerBar = app.querySelector('[data-live="timer-bar"]');
  const directivePanel = app.querySelector(".student-main .directive");
  const submissionStatus = app.querySelector('[data-live="submission-status"]');
  const submitButton = app.querySelector('[data-live="submit-button"]');

  if (directive) directive.textContent = String(state.directive ?? "");
  if (timer) timer.textContent = formatTimer(state.remainingMs);
  if (timerBar) timerBar.style.setProperty("--progress", `${Math.max(0, Math.min(100, percent))}%`);
  if (directivePanel) directivePanel.classList.toggle("urgent", timerUrgencyClass() === "urgent");
  if (submissionStatus) {
    submissionStatus.textContent = state.personal?.currentSubmission
      ? `${state.personal.currentSubmission} 제출됨`
      : "미제출";
  }
  if (submitButton) {
    submitButton.textContent = state.personal?.currentSubmission ? "✧ 숫자 바꾸기" : "✧ 숫자 제출";
  }
}

function consumeSceneClass() {
  if (!sceneMotion) return "";
  const className = `scene-enter scene-${sceneMotion}`;
  sceneMotion = "";
  return className;
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
          ? `<div class="actions" style="justify-content:center; margin-top:22px"><button class="btn primary" data-action="new-game">새 게임 시작</button></div>`
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

function simulationTrack() {
  return `<div class="rule-track">${simulationSteps
    .map((_, index) => `<span class="rule-dot ${index <= simulationIndex ? "active" : ""}"></span>`)
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

function getDeviceId() {
  const key = "shadow:deviceId";
  let value = localStorage.getItem(key);
  if (!value) {
    value =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(key, value);
  }
  return value;
}

function timerUrgencyClass() {
  return state?.status === "round" && !state.paused && state.remainingMs <= 30000 ? "urgent" : "";
}

function numberChips(numbers) {
  return numbers
    .map((number, index) => `<span class="number-chip" style="--i:${index}">${number}</span>`)
    .join("");
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

function showStageTransition(event, nextState) {
  const labels = {
    start: {
      eyebrow: `ROUND ${nextState.currentRound} / ${nextState.settings.totalRounds}`,
      title: "지령 공개",
      detail: String(nextState.directive ?? "")
    },
    result: {
      eyebrow: `ROUND ${nextState.currentRound} 종료`,
      title: "결과 공개",
      detail: nextState.result?.winnerTeam ? TEAMS[nextState.result.winnerTeam].label : "교착"
    },
    final: {
      eyebrow: "FINAL",
      title: "최종 시상",
      detail: "세력 공개"
    }
  };
  const label = labels[event];
  if (!label) return;
  document.querySelector(".stage-transition")?.remove();
  const overlay = document.createElement("div");
  overlay.className = `stage-transition stage-${event}`;
  overlay.innerHTML = `
    <div class="stage-transition-inner">
      <div class="eyebrow">${label.eyebrow}</div>
      <div class="stage-title">${label.title}</div>
      <div class="stage-detail">${escapeHtml(label.detail)}</div>
    </div>
  `;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 1400);
}

function toggleSound() {
  if (soundOn && shouldPlayAmbientMusic() && !isAmbientRunning()) {
    primeAmbientMusic();
    showToast("배경음악을 시작했습니다.");
    render();
    return;
  }
  soundOn = !soundOn;
  localStorage.setItem("shadow:sound", soundOn ? "on" : "off");
  if (soundOn) {
    primeAmbientMusic();
    showToast("배경음악과 효과음을 켰습니다.");
  } else {
    syncAmbientMusic();
    showToast("사운드를 껐습니다.");
  }
  render();
}

function soundButtonLabel() {
  if (!soundOn) return "🔇";
  if (shouldPlayAmbientMusic() && !isAmbientRunning()) return "🎵";
  return "🔊";
}

function soundButtonTitle() {
  if (!soundOn) return "사운드 켜기";
  if (shouldPlayAmbientMusic() && !isAmbientRunning()) return "배경음악 시작";
  return "사운드 끄기";
}

function isAmbientRunning() {
  return Boolean(ambientAudio && ambientAudio.context.state === "running");
}

function shouldPlayAmbientMusic() {
  return mode === "teacher" && soundOn && Boolean(state);
}

function ambientTargetGain() {
  if (!shouldPlayAmbientMusic()) return 0.0001;
  if (state.status === "round") return 0.3;
  if (state.status === "result") return 0.2;
  if (state.status === "final") return 0.26;
  return 0.13;
}

function primeAmbientMusic() {
  if (!soundOn) return;
  try {
    const music = ensureAmbientMusic();
    const resumeResult = music.context.state === "suspended" ? music.context.resume() : Promise.resolve();
    syncAmbientMusic();
    Promise.resolve(resumeResult).then(syncAmbientMusic);
  } catch {
    // Background music is optional and may be blocked until the user interacts with the page.
  }
}

// 96 BPM, 8th-note steps. 8 bars of 8 steps = one 20-second loop in E minor.
const MUSIC_STEP_SECONDS = 60 / 96 / 2;
const MUSIC_TOTAL_STEPS = 64;
const MUSIC_BAR_ROOTS = [82.41, 82.41, 98.0, 98.0, 110.0, 110.0, 130.81, 123.47];
const MUSIC_MELODY = {
  0: 329.63, 2: 392.0, 4: 493.88, 6: 440.0,
  8: 392.0, 12: 369.99,
  16: 392.0, 18: 493.88, 20: 587.33, 22: 523.25,
  24: 493.88, 28: 392.0,
  32: 440.0, 34: 523.25, 36: 659.25, 38: 587.33,
  40: 523.25, 44: 493.88,
  48: 659.25, 50: 587.33, 52: 523.25, 54: 493.88,
  56: 493.88, 58: 587.33, 60: 369.99
};

function ensureAmbientMusic() {
  if (ambientAudio) return ambientAudio;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) throw new Error("AudioContext is not supported.");

  const context = new AudioContext();
  const master = context.createGain();
  const compressor = context.createDynamicsCompressor();
  master.gain.value = 0.0001;
  master.connect(compressor);
  compressor.connect(context.destination);

  // Dotted-eighth echo gives the melody its spy-thriller tail.
  const delay = context.createDelay(1.2);
  const delayFeedback = context.createGain();
  const delaySend = context.createGain();
  delay.delayTime.value = MUSIC_STEP_SECONDS * 1.5;
  delayFeedback.gain.value = 0.32;
  delaySend.gain.value = 0.4;
  delaySend.connect(delay);
  delay.connect(delayFeedback);
  delayFeedback.connect(delay);
  delay.connect(master);

  const noiseBuffer = context.createBuffer(1, context.sampleRate * 0.1, context.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseData.length; i += 1) {
    noiseData[i] = Math.random() * 2 - 1;
  }

  ambientAudio = {
    context,
    master,
    delaySend,
    noiseBuffer,
    step: 0,
    nextNoteTime: 0,
    timer: window.setInterval(scheduleAmbientMusic, 80)
  };
  return ambientAudio;
}

function scheduleAmbientMusic() {
  const music = ambientAudio;
  if (!music || music.context.state !== "running") return;
  const now = music.context.currentTime;
  if (music.nextNoteTime < now - 0.3) music.nextNoteTime = now + 0.05;
  while (music.nextNoteTime < now + 0.25) {
    playAmbientStep(music.step, music.nextNoteTime);
    music.step = (music.step + 1) % MUSIC_TOTAL_STEPS;
    music.nextNoteTime += MUSIC_STEP_SECONDS;
  }
}

function playAmbientStep(step, time) {
  const bar = Math.floor(step / 8);
  const beat = step % 8;
  const root = MUSIC_BAR_ROOTS[bar];
  if (beat === 0) playAmbientBass(root, time, 0.5, 1.4);
  if (beat === 6) playAmbientBass(root * 2, time, 0.3, 0.5);
  const melodyFrequency = MUSIC_MELODY[step];
  if (melodyFrequency) playAmbientPluck(melodyFrequency, time);
  if (beat % 2 === 1) playAmbientHat(time, beat === 5 ? 0.05 : 0.03);
}

function playAmbientBass(frequency, time, peak, duration) {
  const context = ambientAudio.context;
  const oscillator = context.createOscillator();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.value = frequency;
  filter.type = "lowpass";
  filter.frequency.value = 360;
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(peak, time + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(ambientAudio.master);
  oscillator.start(time);
  oscillator.stop(time + duration + 0.1);
}

function playAmbientPluck(frequency, time) {
  const context = ambientAudio.context;
  const oscillator = context.createOscillator();
  const shimmer = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.value = frequency;
  shimmer.type = "sine";
  shimmer.frequency.value = frequency;
  shimmer.detune.value = 7;
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(0.22, time + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.5);
  oscillator.connect(gain);
  shimmer.connect(gain);
  gain.connect(ambientAudio.master);
  gain.connect(ambientAudio.delaySend);
  oscillator.start(time);
  shimmer.start(time);
  oscillator.stop(time + 0.6);
  shimmer.stop(time + 0.6);
}

function playAmbientHat(time, peak) {
  const context = ambientAudio.context;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = ambientAudio.noiseBuffer;
  filter.type = "highpass";
  filter.frequency.value = 6500;
  gain.gain.setValueAtTime(peak, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(ambientAudio.master);
  source.start(time);
  source.stop(time + 0.08);
}

function syncAmbientMusic() {
  if (!ambientAudio) return;
  const context = ambientAudio.context;
  const target = ambientTargetGain();
  try {
    ambientAudio.master.gain.cancelScheduledValues(context.currentTime);
    ambientAudio.master.gain.setTargetAtTime(target, context.currentTime, target > 0.001 ? 0.8 : 0.35);
  } catch {
    // Ignore audio automation failures.
  }
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
