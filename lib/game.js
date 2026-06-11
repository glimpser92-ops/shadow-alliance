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
  room.updatedAt = Date.now();
  return [];
}

function isTeacherDevice(room, deviceId) {
  return Boolean(deviceId && Array.isArray(room.teacherDeviceIds) && room.teacherDeviceIds.includes(deviceId));
}

function isTeacherPlayer(room, player) {
  return Boolean(player?.isTeacher);
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

function excludeTeacherPlayer(room, playerId) {
  if (!room?.players?.[playerId]) {
    throw new Error("제외할 대상을 찾을 수 없습니다.");
  }
  const removed = deletePlayer(room, playerId);
  return removed ? [removed] : [];
}

function joinRoom(room, existingPlayerId, options = {}) {
  if (existingPlayerId && room.players[existingPlayerId]) {
    const player = room.players[existingPlayerId];
    if (isTeacherPlayer(room, player)) {
      deletePlayer(room, player.id);
      throw new Error("교사 계정은 학생으로 입장할 수 없습니다.");
    }
    player.connected = true;
    if (options.deviceId) player.deviceId = options.deviceId;
    player.lastSeenAt = Date.now();
    room.updatedAt = Date.now();
    return player;
  }

  if (options.deviceId) {
    const existingByDevice = getVisiblePlayers(room).find((player) => player.deviceId === options.deviceId);
    if (existingByDevice) {
      existingByDevice.connected = true;
      existingByDevice.lastSeenAt = Date.now();
      room.updatedAt = Date.now();
      return existingByDevice;
    }
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
    penaltyTargetCount: null,
    submissions: {},
    sanctionVotes: {},
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
    throw new Error("교사 계정은 숫자를 제출할 수 없습니다.");
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

function setPenaltyTargetCount(room, value) {
  if (room.status !== "round") {
    throw new Error("라운드 진행 중에만 랜덤 컷 n을 바꿀 수 있습니다.");
  }
  const round = getActiveRound(room);
  if (!round) {
    throw new Error("진행 중인 라운드를 찾을 수 없습니다.");
  }
  const raw = String(value ?? "").trim().toLowerCase();
  round.penaltyTargetCount =
    raw === "" || raw === "random" || raw === "auto" ? null : clampInteger(value, 1, 99, null);
  room.updatedAt = Date.now();
  return round.penaltyTargetCount;
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

function castSanctionVote(room, voterId, targetId) {
  if (room.status !== "result") {
    throw new Error("동맹 심판 투표는 결과 공개 후에만 할 수 있습니다.");
  }
  const round = getActiveRound(room);
  if (!round?.result?.winnerTeam) {
    throw new Error("투표할 수 있는 승리 연합이 없습니다.");
  }
  if (round.result.sanction?.applied) {
    throw new Error("이번 라운드의 동맹 심판은 이미 집행되었습니다.");
  }

  const voter = room.players[voterId];
  if (!voter || isTeacherPlayer(room, voter)) {
    throw new Error("투표할 공작원을 찾을 수 없습니다.");
  }
  if (!isEligibleSanctionVoter(room, round, voterId)) {
    throw new Error("이번 라운드 보상을 받은 승리 연합만 투표할 수 있습니다.");
  }

  const normalizedTargetId = String(targetId || "").trim();
  if (!round.sanctionVotes) round.sanctionVotes = {};
  if (!normalizedTargetId || normalizedTargetId === "abstain") {
    delete round.sanctionVotes[voterId];
    room.updatedAt = Date.now();
    return serializeSanctionVote(room, round, voter, "student");
  }

  const candidateIds = new Set(getSanctionCandidates(room, round, voterId).map((candidate) => candidate.playerId));
  if (!candidateIds.has(normalizedTargetId)) {
    throw new Error("같은 승리 연합의 투표 대상만 선택할 수 있습니다.");
  }

  round.sanctionVotes[voterId] = normalizedTargetId;
  applySanctionIfReady(room, round);
  room.updatedAt = Date.now();
  return serializeSanctionVote(room, round, voter, "student");
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
  const penalty = winnerTeam ? getPenalty(winningSubmissions, round.penaltyTargetCount) : null;
  const penaltyPlayerIds = new Set(penalty?.playerIds || []);
  const rewardedSubmissions = penalty
    ? winningSubmissions.filter((submission) => !penaltyPlayerIds.has(submission.playerId))
    : winningSubmissions;
  const gains = winnerTeam ? allocatePower(rewardedSubmissions) : {};
  for (const playerId of penaltyPlayerIds) {
    gains[playerId] = 0;
  }
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
    penalty,
    sanction: null,
    gains,
    top5
  };
}

function getPenalty(winningSubmissions, selectedTargetCount = null) {
  if (winningSubmissions.length <= 1) return null;
  const randomMaxPenaltyTarget = Math.max(1, Math.floor(winningSubmissions.length / 2));
  const selected = Number.parseInt(selectedTargetCount, 10);
  const targetCount = Number.isFinite(selected)
    ? clampInteger(selected, 1, winningSubmissions.length - 1, 1)
    : randomBetween(1, randomMaxPenaltyTarget);
  const sorted = [...winningSubmissions].sort((a, b) => b.value - a.value);
  const cutoffValue = sorted[targetCount - 1].value;
  const penalized = sorted.filter((submission) => submission.value >= cutoffValue);
  if (penalized.length >= winningSubmissions.length) return null;
  return {
    team: penalized[0].team,
    targetCount,
    targetMode: Number.isFinite(selected) ? "manual" : "random",
    count: penalized.length,
    cutoffValue,
    values: penalized.map((submission) => submission.value).sort((a, b) => b - a),
    playerIds: penalized.map((submission) => submission.playerId),
    reason: "winning-top-n-highest"
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

function isEligibleSanctionVoter(room, round, playerId) {
  const result = round?.result;
  const player = room?.players?.[playerId];
  const submission = round?.submissions?.[playerId];
  return Boolean(
    result?.winnerTeam &&
      player &&
      !isTeacherPlayer(room, player) &&
      submission &&
      submission.team === result.winnerTeam &&
      (result.gains?.[playerId] || 0) > 0
  );
}

function getSanctionCandidates(room, round, voterId = null) {
  const result = round?.result;
  if (!result?.winnerTeam || result.sanction?.applied) return [];
  return Object.values(round.submissions || {}).filter((submission) => {
    const player = room.players[submission.playerId];
    return (
      player &&
      !isTeacherPlayer(room, player) &&
      submission.team === result.winnerTeam &&
      submission.playerId !== voterId &&
      (result.gains?.[submission.playerId] || 0) > 0
    );
  });
}

function getSanctionNeeded(room, round, targetId) {
  const voterCount = Object.keys(round?.submissions || {}).filter(
    (playerId) => playerId !== targetId && isEligibleSanctionVoter(room, round, playerId)
  ).length;
  if (voterCount <= 0) return null;
  return Math.floor(voterCount / 2) + 1;
}

function getSanctionVoteRows(room, round, viewerId = null) {
  const votes = round?.sanctionVotes || {};
  return getSanctionCandidates(room, round, null).map((submission) => {
    const needed = getSanctionNeeded(room, round, submission.playerId);
    const voterIds = Object.keys(votes).filter(
      (voterId) =>
        votes[voterId] === submission.playerId &&
        voterId !== submission.playerId &&
        isEligibleSanctionVoter(room, round, voterId)
    );
    return {
      id: submission.playerId,
      nickname: submission.nickname,
      value: submission.value,
      gain: round.result.gains?.[submission.playerId] || 0,
      votes: voterIds.length,
      needed,
      selected: viewerId ? votes[viewerId] === submission.playerId : false
    };
  });
}

function applySanctionIfReady(room, round) {
  const result = round?.result;
  if (!result?.winnerTeam || result.sanction?.applied) return null;
  const ready = getSanctionVoteRows(room, round)
    .filter((row) => row.needed !== null && row.votes >= row.needed)
    .sort((a, b) => b.votes - a.votes || b.value - a.value || a.nickname.localeCompare(b.nickname, "ko"))[0];
  if (!ready) return null;

  const target = room.players[ready.id];
  if (!target) return null;
  const confiscated = result.gains?.[ready.id] || 0;
  if (confiscated <= 0) return null;

  target.power = Math.max(0, target.power - confiscated);
  target.gains[room.currentRound] = 0;
  result.gains[ready.id] = 0;
  result.sanction = {
    applied: true,
    team: result.winnerTeam,
    targetId: ready.id,
    targetNickname: target.nickname,
    votes: ready.votes,
    needed: ready.needed,
    submittedValue: ready.value,
    confiscated,
    appliedAt: Date.now()
  };
  result.top5 = getRankings(room).slice(0, 5);
  return result.sanction;
}

function serializeSanctionVote(room, round, personalPlayer = null, role = "student") {
  const result = round?.result;
  if (room.status !== "result" || !result?.winnerTeam) return null;
  const applied = result.sanction || null;
  const viewerIsWinningTeam = personalPlayer?.team === result.winnerTeam;
  const selectedTargetId = personalPlayer ? round.sanctionVotes?.[personalPlayer.id] || null : null;
  const allCandidates = getSanctionVoteRows(room, round, personalPlayer?.id || null);
  const candidates =
    role === "teacher" || viewerIsWinningTeam
      ? allCandidates.filter((candidate) => candidate.id !== personalPlayer?.id)
      : [];
  const eligible = Boolean(
    personalPlayer &&
      viewerIsWinningTeam &&
      isEligibleSanctionVoter(room, round, personalPlayer.id) &&
      candidates.length > 0 &&
      !applied?.applied
  );
  const eligibleVoterCount = Object.keys(round.submissions || {}).filter((id) => isEligibleSanctionVoter(room, round, id)).length;

  return {
    team: result.winnerTeam,
    teamLabel: TEAMS[result.winnerTeam].label,
    applied,
    eligible,
    selectedTargetId,
    candidates,
    totalVotes: Object.keys(round.sanctionVotes || {}).filter((id) => isEligibleSanctionVoter(room, round, id)).length,
    eligibleVoterCount
  };
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
    penaltyTargetCount: activeRound?.penaltyTargetCount ?? null,
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
    sanctionVote: serializeSanctionVote(room, activeRound, personalPlayer, role),
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
  castSanctionVote,
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
  setPenaltyTargetCount,
  startRound,
  submitNumber,
  updateSettings,
  adjustRoundTime,
  excludeTeacherPlayer,
  isTeacherDevice,
  purgeTeacherPlayers,
  removePlayer
};
