const crypto = require("crypto");

const TEAMS = {
  black: {
    id: "black",
    label: "블랙 연합",
    mark: "●"
  },
  white: {
    id: "white",
    label: "화이트 연합",
    mark: "○"
  }
};

const ADJECTIVES = [
  "용감한",
  "담대한",
  "고독한",
  "기민한",
  "묵직한",
  "우아한",
  "정교한",
  "은밀한",
  "차분한",
  "날카로운",
  "침착한",
  "과묵한",
  "명랑한",
  "집요한",
  "신중한",
  "재빠른",
  "대담한",
  "비밀스런",
  "현명한",
  "단호한"
];

const NOUNS = [
  "살무사",
  "담비",
  "너구리",
  "몽구스",
  "수리부엉이",
  "흑표범",
  "늑대",
  "여우",
  "매",
  "족제비",
  "푸마",
  "표범",
  "독수리",
  "스라소니",
  "비버",
  "올빼미",
  "삵",
  "수달",
  "황조롱이",
  "매화검"
];

function randomId(bytes = 12) {
  return crypto.randomBytes(bytes).toString("hex");
}

function makeRoomCode(existingCodes = new Set()) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    let code = "";
    for (let i = 0; i < 4; i += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!existingCodes.has(code)) return code;
  }
  throw new Error("방 코드를 만들 수 없습니다.");
}

function makeNickname(usedNames = new Set()) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const name = `${adjective} ${noun}`;
    if (!usedNames.has(name)) return name;
  }
  return `익명의 공작원 ${Math.floor(1000 + Math.random() * 9000)}`;
}

function normalizeSettings(settings = {}) {
  const totalRounds = clampInteger(settings.totalRounds, 1, 9, 5);
  const directiveMin = clampInteger(settings.directiveMin, 1, 99, 30);
  const directiveMax = clampInteger(settings.directiveMax, directiveMin, 100, 70);
  const roundSeconds = clampInteger(settings.roundSeconds, 30, 1800, 300);
  return {
    totalRounds,
    directiveMin,
    directiveMax,
    roundSeconds
  };
}

function createRoom(code, settings = {}) {
  return {
    code,
    teacherToken: randomId(16),
    teacherDeviceIds: [],
    status: "lobby",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    settings: normalizeSettings(settings),
    currentRound: 0,
    directive: null,
    roundStartedAt: null,
    roundEndsAt: null,
    paused: false,
    pausedRemainingMs: null,
    players: {},
    teamWins: {
      black: 0,
      white: 0
    },
    rounds: []
  };
}

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function chooseTeam(room) {
  const counts = countTeams(room);
  if (counts.black < counts.white) return "black";
  if (counts.white < counts.black) return "white";
  return Math.random() < 0.5 ? "black" : "white";
}

function countTeams(room) {
  return getVisiblePlayers(room).reduce(
    (counts, player) => {
      if (player.team === "black") counts.black += 1;
      if (player.team === "white") counts.white += 1;
      return counts;
    },
    { black: 0, white: 0 }
  );
}

function registerTeacherDevice(room, deviceId) {
  if (!room || !deviceId) return [];
  if (!Array.isArray(room.teacherDeviceIds)) room.teacherDeviceIds = [];
  if (!room.teacherDeviceIds.includes(deviceId)) {
    room.teacherDeviceIds.push(deviceId);
  }
  const removed = purgeTeacherPlayers(room);
  room.updatedAt = Date.now();
  return removed;
}

function isTeacherDevice(room, deviceId) {
  return Boolean(deviceId && Array.isArray(room.teacherDeviceIds) && room.teacherDeviceIds.includes(deviceId));
}

function isTeacherPlayer(room, player) {
  return Boolean(player && (player.isTeacher || isTeacherDevice(room, player.deviceId)));
}

function getVisiblePlayers(room) {
  return Object.values(room?.players || {}).filter((player) => !isTeacherPlayer(room, player));
}

function deletePlayer(room, playerId) {
  const player = room?.players?.[playerId];
  if (!player) return null;
  for (const round of room.rounds) {
    if (round?.submissions) delete round.submissions[playerId];
    if (round?.result?.gains) delete round.result.gains[playerId];
  }
  delete room.players[playerId];
  room.updatedAt = Date.now();
  return player;
}

function purgeTeacherPlayers(room) {
  if (!room) return [];
  const removed = [];
  for (const player of Object.values(room.players || {})) {
    if (isTeacherPlayer(room, player)) {
      const deleted = deletePlayer(room, player.id);
      if (deleted) removed.push(deleted);
    }
  }
  return removed;
}

function joinRoom(room, existingPlayerId, options = {}) {
  if (isTeacherDevice(room, options.deviceId)) {
    throw new Error("교사 기기는 학생으로 입장할 수 없습니다.");
  }

  if (existingPlayerId && room.players[existingPlayerId]) {
    const player = room.players[existingPlayerId];
    if (isTeacherPlayer(room, player)) {
      deletePlayer(room, player.id);
      throw new Error("교사 기기는 학생으로 입장할 수 없습니다.");
    }
    player.connected = true;
    if (options.deviceId) player.deviceId = options.deviceId;
    player.lastSeenAt = Date.now();
    room.updatedAt = Date.now();
    return player;
  }

  const id = randomId(10);
  const usedNames = new Set(getVisiblePlayers(room).map((player) => player.nickname));
  const player = {
    id,
    nickname: makeNickname(usedNames),
    team: chooseTeam(room),
    deviceId: options.deviceId || null,
    power: 0,
    joinedAt: Date.now(),
    lastSeenAt: Date.now(),
    connected: true,
    submissions: {},
    gains: {}
  };
  room.players[id] = player;
  room.updatedAt = Date.now();
  return player;
}

function disconnectPlayer(room, playerId) {
  if (!room || !room.players[playerId]) return;
  room.players[playerId].connected = false;
  room.players[playerId].lastSeenAt = Date.now();
  room.updatedAt = Date.now();
}

function removePlayer(room, playerId) {
  if (!room || !room.players[playerId]) {
    throw new Error("제거할 학생을 찾을 수 없습니다.");
  }
  if (room.status === "round") {
    throw new Error("라운드 진행 중에는 명단에서 제거할 수 없습니다.");
  }

  return deletePlayer(room, playerId);
}

function canEditSettings(room) {
  return room.status === "lobby" && room.currentRound === 0;
}

function updateSettings(room, settings) {
  if (!canEditSettings(room)) {
    throw new Error("첫 라운드가 시작된 뒤에는 설정을 바꿀 수 없습니다.");
  }
  room.settings = normalizeSettings({
    ...room.settings,
    ...settings
  });
  room.updatedAt = Date.now();
  return room.settings;
}

function startRound(room) {
  if (room.status === "round") {
    throw new Error("이미 라운드가 진행 중입니다.");
  }
  if (room.currentRound >= room.settings.totalRounds) {
    finalizeRoom(room);
    return room;
  }

  const roundNumber = room.currentRound + 1;
  room.currentRound = roundNumber;
  room.status = "round";
  room.directive = randomBetween(room.settings.directiveMin, room.settings.directiveMax);
  room.roundStartedAt = Date.now();
  room.roundEndsAt = room.roundStartedAt + room.settings.roundSeconds * 1000;
  room.paused = false;
  room.pausedRemainingMs = null;
  room.rounds[roundNumber - 1] = {
    round: roundNumber,
    directive: room.directive,
    startedAt: room.roundStartedAt,
    endedAt: null,
    submissions: {},
    result: null
  };
  room.updatedAt = Date.now();
  return room;
}

function randomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function getActiveRound(room) {
  if (room.currentRound <= 0) return null;
  return room.rounds[room.currentRound - 1] || null;
}

function submitNumber(room, playerId, value) {
  if (room.status !== "round") {
    throw new Error("지금은 숫자를 제출할 수 없습니다.");
  }
  const player = room.players[playerId];
  if (!player) {
    throw new Error("입장 정보를 찾을 수 없습니다.");
  }
  if (isTeacherPlayer(room, player)) {
    throw new Error("교사 기기는 숫자를 제출할 수 없습니다.");
  }
  const number = clampInteger(value, 1, 100, null);
  if (number === null) {
    throw new Error("1부터 100까지의 숫자를 제출해야 합니다.");
  }
  const round = getActiveRound(room);
  round.submissions[playerId] = {
    playerId,
    team: player.team,
    value: number,
    nickname: player.nickname,
    submittedAt: Date.now()
  };
  player.submissions[room.currentRound] = number;
  room.updatedAt = Date.now();
  return number;
}

function pauseRound(room) {
  if (room.status !== "round" || room.paused) return;
  room.pausedRemainingMs = getRemainingMs(room);
  room.roundEndsAt = null;
  room.paused = true;
  room.updatedAt = Date.now();
}

function resumeRound(room) {
  if (room.status !== "round" || !room.paused) return;
  room.roundEndsAt = Date.now() + Math.max(0, room.pausedRemainingMs || 0);
  room.pausedRemainingMs = null;
  room.paused = false;
  room.updatedAt = Date.now();
}

function adjustRoundTime(room, deltaSeconds) {
  if (room.status !== "round") return;
  const deltaMs = clampInteger(deltaSeconds, -600, 600, 0) * 1000;
  if (room.paused) {
    room.pausedRemainingMs = Math.max(0, (room.pausedRemainingMs || 0) + deltaMs);
  } else {
    room.roundEndsAt = Math.max(Date.now(), (room.roundEndsAt || Date.now()) + deltaMs);
  }
  room.updatedAt = Date.now();
}

function getRemainingMs(room, now = Date.now()) {
  if (room.status !== "round") return 0;
  if (room.paused) return Math.max(0, room.pausedRemainingMs || 0);
  return Math.max(0, (room.roundEndsAt || now) - now);
}

function maybeExpireRound(room, now = Date.now()) {
  if (room.status === "round" && !room.paused && getRemainingMs(room, now) <= 0) {
    endRound(room);
    return true;
  }
  return false;
}

function endRound(room) {
  if (room.status !== "round") return room.rounds[room.currentRound - 1]?.result || null;
  const round = getActiveRound(room);
  const result = calculateRoundResult(room, round);
  round.endedAt = Date.now();
  round.result = result;
  room.status = "result";
  room.roundEndsAt = null;
  room.paused = false;
  room.pausedRemainingMs = null;
  if (result.winnerTeam) {
    room.teamWins[result.winnerTeam] += 1;
    for (const [playerId, gain] of Object.entries(result.gains)) {
      room.players[playerId].power += gain;
      room.players[playerId].gains[room.currentRound] = gain;
    }
  }
  room.updatedAt = Date.now();
  return result;
}

function calculateRoundResult(room, round) {
  const submissions = Object.values(round.submissions || {}).filter((submission) => {
    const player = room.players[submission.playerId];
    return player && !isTeacherPlayer(room, player);
  });
  const byTeam = {
    black: submissions.filter((submission) => submission.team === "black"),
    white: submissions.filter((submission) => submission.team === "white")
  };
  const averages = {
    black: average(byTeam.black.map((submission) => submission.value)),
    white: average(byTeam.white.map((submission) => submission.value))
  };
  const distances = {
    black: averages.black === null ? Infinity : Math.abs(averages.black - round.directive),
    white: averages.white === null ? Infinity : Math.abs(averages.white - round.directive)
  };
  let winnerTeam = null;
  if (distances.black < distances.white) winnerTeam = "black";
  if (distances.white < distances.black) winnerTeam = "white";

  const winningSubmissions = winnerTeam ? byTeam[winnerTeam] : [];
  const gains = winnerTeam ? allocatePower(winningSubmissions) : {};
  const top5 = getRankings(room, gains).slice(0, 5);

  return {
    directive: round.directive,
    averages,
    distances,
    winnerTeam,
    tie: !winnerTeam,
    submittedCount: submissions.length,
    teamSubmissionCounts: {
      black: byTeam.black.length,
      white: byTeam.white.length
    },
    winningNumbers: winningSubmissions
      .map((submission) => submission.value)
      .sort((a, b) => b - a),
    gains,
    top5
  };
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function allocatePower(winningSubmissions) {
  const totalSubmitted = winningSubmissions.reduce((sum, submission) => sum + submission.value, 0);
  if (!totalSubmitted) return {};

  const exact = winningSubmissions.map((submission) => {
    const raw = (10000 * submission.value) / totalSubmitted;
    return {
      playerId: submission.playerId,
      floor: Math.floor(raw),
      remainder: raw - Math.floor(raw),
      value: submission.value
    };
  });

  let allocated = exact.reduce((sum, item) => sum + item.floor, 0);
  let remaining = 10000 - allocated;
  exact
    .sort((a, b) => b.remainder - a.remainder || b.value - a.value)
    .forEach((item) => {
      if (remaining > 0) {
        item.floor += 1;
        remaining -= 1;
      }
    });

  return exact.reduce((gains, item) => {
    gains[item.playerId] = item.floor;
    return gains;
  }, {});
}

function getRankings(room, pendingGains = {}) {
  return getVisiblePlayers(room)
    .map((player) => ({
      id: player.id,
      nickname: player.nickname,
      team: player.team,
      power: player.power + (pendingGains[player.id] || 0)
    }))
    .sort((a, b) => b.power - a.power || a.nickname.localeCompare(b.nickname, "ko"));
}

function finalizeRoom(room) {
  room.status = "final";
  room.directive = null;
  room.roundEndsAt = null;
  room.paused = false;
  room.pausedRemainingMs = null;
  room.updatedAt = Date.now();
  return getFinalResult(room);
}

function getFinalResult(room) {
  const teamWinner =
    room.teamWins.black === room.teamWins.white
      ? null
      : room.teamWins.black > room.teamWins.white
        ? "black"
        : "white";
  return {
    teamWinner,
    teamWins: { ...room.teamWins },
    rankings: getRankings(room),
    rosters: {
      black: getVisiblePlayers(room)
        .filter((player) => player.team === "black")
        .map(publicPlayer),
      white: getVisiblePlayers(room)
        .filter((player) => player.team === "white")
        .map(publicPlayer)
    }
  };
}

function publicPlayer(player) {
  return {
    id: player.id,
    nickname: player.nickname,
    team: player.team,
    power: player.power,
    connected: player.connected
  };
}

function serializeRoom(room, options = {}) {
  const { role = "student", playerId = null } = options;
  const activeRound = getActiveRound(room);
  const result = activeRound?.result || null;
  const rankings = getRankings(room);
  const players = getVisiblePlayers(room);
  const visiblePlayerIds = new Set(players.map((player) => player.id));
  const submittedIds = new Set(Object.keys(activeRound?.submissions || {}).filter((id) => visiblePlayerIds.has(id)));
  const personalPlayer =
    playerId && room.players[playerId] && !isTeacherPlayer(room, room.players[playerId])
      ? room.players[playerId]
      : null;
  const lastGain =
    personalPlayer && room.currentRound > 0
      ? personalPlayer.gains[room.currentRound] || 0
      : 0;

  const base = {
    code: room.code,
    status: room.status,
    settings: room.settings,
    currentRound: room.currentRound,
    directive: room.directive,
    remainingMs: getRemainingMs(room),
    paused: room.paused,
    teamWins: { ...room.teamWins },
    counts: {
      total: players.length,
      connected: players.filter((player) => player.connected).length,
      teams: countTeams(room),
      submitted: submittedIds.size
    },
    top5: rankings.slice(0, 5).map((player, index) => ({
      rank: index + 1,
      nickname: room.status === "result" && index === 0 ? "??? 선두는 비밀에 부쳐진다" : player.nickname,
      team: player.team,
      power: player.power
    })),
    result,
    final: room.status === "final" ? getFinalResult(room) : null,
    personal: personalPlayer
      ? {
          id: personalPlayer.id,
          nickname: personalPlayer.nickname,
          team: personalPlayer.team,
          teamLabel: TEAMS[personalPlayer.team].label,
          teamMark: TEAMS[personalPlayer.team].mark,
          power: personalPlayer.power,
          currentSubmission: personalPlayer.submissions[room.currentRound] || null,
          lastGain
        }
      : null
  };

  if (role === "teacher") {
    base.players = players.map((player) => ({
      id: player.id,
      nickname: player.nickname,
      team: player.team,
      teamLabel: TEAMS[player.team].label,
      connected: player.connected,
      submitted: submittedIds.has(player.id),
      power: player.power
    }));
    base.fullRankings = rankings;
  }

  return base;
}

module.exports = {
  TEAMS,
  allocatePower,
  calculateRoundResult,
  canEditSettings,
  createRoom,
  disconnectPlayer,
  endRound,
  finalizeRoom,
  getFinalResult,
  getRankings,
  getRemainingMs,
  joinRoom,
  makeRoomCode,
  maybeExpireRound,
  normalizeSettings,
  pauseRound,
  registerTeacherDevice,
  resumeRound,
  serializeRoom,
  startRound,
  submitNumber,
  updateSettings,
  adjustRoundTime,
  isTeacherDevice,
  purgeTeacherPlayers,
  removePlayer
};
