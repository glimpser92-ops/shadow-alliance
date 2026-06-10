const assert = require("assert");

const {
  allocatePower,
  calculateRoundResult,
  createRoom,
  endRound,
  excludeTeacherPlayer,
  getRankings,
  joinRoom,
  isTeacherDevice,
  removePlayer,
  registerTeacherDevice,
  serializeRoom,
  setPenaltyTargetCount,
  startRound,
  submitNumber
} = require("../lib/game");

function withMathRandom(value, callback) {
  const original = Math.random;
  Math.random = () => value;
  try {
    callback();
  } finally {
    Math.random = original;
  }
}

{
  const gains = allocatePower([
    { playerId: "a", value: 50 },
    { playerId: "b", value: 30 },
    { playerId: "c", value: 20 }
  ]);
  assert.deepStrictEqual(gains, { a: 5000, b: 3000, c: 2000 });
  assert.strictEqual(Object.values(gains).reduce((sum, value) => sum + value, 0), 10000);
}

{
  const room = createRoom("TEST", {
    directiveMin: 50,
    directiveMax: 50,
    roundSeconds: 300,
    totalRounds: 5
  });
  const black = joinRoom(room);
  const white = joinRoom(room);
  black.team = "black";
  white.team = "white";
  withMathRandom(0, () => startRound(room));
  submitNumber(room, black.id, 49);
  submitNumber(room, white.id, 70);
  const result = endRound(room);
  assert.strictEqual(result.winnerTeam, "black");
  assert.strictEqual(result.penalty, null);
  assert.strictEqual(room.players[black.id].power, 10000);
  assert.strictEqual(room.players[white.id].power, 0);
}

{
  const room = createRoom("PENALTY", {
    directiveMin: 50,
    directiveMax: 50,
    roundSeconds: 300,
    totalRounds: 5
  });
  const blackLow = joinRoom(room);
  const blackMid = joinRoom(room);
  const blackHigh = joinRoom(room);
  const white = joinRoom(room);
  blackLow.team = "black";
  blackMid.team = "black";
  blackHigh.team = "black";
  white.team = "white";
  withMathRandom(0, () => startRound(room));
  submitNumber(room, blackLow.id, 40);
  submitNumber(room, blackMid.id, 60);
  submitNumber(room, blackHigh.id, 90);
  submitNumber(room, white.id, 100);

  const result = endRound(room);

  assert.strictEqual(result.winnerTeam, "black");
  assert.strictEqual(result.penalty.targetCount, 1);
  assert.deepStrictEqual(result.penalty.values, [90]);
  assert.deepStrictEqual(result.penalty.playerIds, [blackHigh.id]);
  assert.strictEqual(result.gains[blackLow.id], 4000);
  assert.strictEqual(result.gains[blackMid.id], 6000);
  assert.strictEqual(result.gains[blackHigh.id], 0);
  assert.strictEqual(Object.values(result.gains).reduce((sum, value) => sum + value, 0), 10000);
  assert.strictEqual(room.players[blackHigh.id].power, 0);
}

{
  const room = createRoom("NOPE", {
    directiveMin: 50,
    directiveMax: 50,
    roundSeconds: 300,
    totalRounds: 5
  });
  const blackLow = joinRoom(room);
  const blackHighA = joinRoom(room);
  const blackHighB = joinRoom(room);
  const white = joinRoom(room);
  blackLow.team = "black";
  blackHighA.team = "black";
  blackHighB.team = "black";
  white.team = "white";
  withMathRandom(0, () => startRound(room));
  submitNumber(room, blackLow.id, 40);
  submitNumber(room, blackHighA.id, 60);
  submitNumber(room, blackHighB.id, 60);
  submitNumber(room, white.id, 100);

  const result = endRound(room);

  assert.strictEqual(result.winnerTeam, "black");
  assert.strictEqual(result.penalty.targetCount, 1);
  assert.deepStrictEqual(result.penalty.values, [60, 60]);
  assert.strictEqual(result.gains[blackLow.id], 10000);
  assert.strictEqual(result.gains[blackHighA.id], 0);
  assert.strictEqual(result.gains[blackHighB.id], 0);
  assert.strictEqual(Object.values(result.gains).reduce((sum, value) => sum + value, 0), 10000);
}

{
  const room = createRoom("SAME", {
    directiveMin: 50,
    directiveMax: 50,
    roundSeconds: 300,
    totalRounds: 5
  });
  const blackA = joinRoom(room);
  const blackB = joinRoom(room);
  const white = joinRoom(room);
  blackA.team = "black";
  blackB.team = "black";
  white.team = "white";
  withMathRandom(0, () => startRound(room));
  submitNumber(room, blackA.id, 50);
  submitNumber(room, blackB.id, 50);
  submitNumber(room, white.id, 100);

  const result = endRound(room);

  assert.strictEqual(result.winnerTeam, "black");
  assert.strictEqual(result.penalty, null);
  assert.strictEqual(result.gains[blackA.id], 5000);
  assert.strictEqual(result.gains[blackB.id], 5000);
  assert.strictEqual(Object.values(result.gains).reduce((sum, value) => sum + value, 0), 10000);
}

{
  const room = createRoom("MANUAL", {
    directiveMin: 50,
    directiveMax: 50,
    roundSeconds: 300,
    totalRounds: 5
  });
  const blackLow = joinRoom(room);
  const blackMid = joinRoom(room);
  const blackHigh = joinRoom(room);
  const blackTop = joinRoom(room);
  const white = joinRoom(room);
  blackLow.team = "black";
  blackMid.team = "black";
  blackHigh.team = "black";
  blackTop.team = "black";
  white.team = "white";
  withMathRandom(0, () => startRound(room));
  setPenaltyTargetCount(room, 2);
  submitNumber(room, blackLow.id, 20);
  submitNumber(room, blackMid.id, 40);
  submitNumber(room, blackHigh.id, 60);
  submitNumber(room, blackTop.id, 80);
  submitNumber(room, white.id, 100);

  const result = endRound(room);

  assert.strictEqual(result.winnerTeam, "black");
  assert.strictEqual(result.penalty.targetMode, "manual");
  assert.strictEqual(result.penalty.targetCount, 2);
  assert.deepStrictEqual(result.penalty.values, [80, 60]);
  assert.strictEqual(result.gains[blackLow.id], 3333);
  assert.strictEqual(result.gains[blackMid.id], 6667);
  assert.strictEqual(result.gains[blackHigh.id], 0);
  assert.strictEqual(result.gains[blackTop.id], 0);
  assert.strictEqual(Object.values(result.gains).reduce((sum, value) => sum + value, 0), 10000);
}

{
  const room = createRoom("TIE", {
    directiveMin: 40,
    directiveMax: 40,
    roundSeconds: 300,
    totalRounds: 5
  });
  const black = joinRoom(room);
  const white = joinRoom(room);
  black.team = "black";
  white.team = "white";
  withMathRandom(0, () => startRound(room));
  submitNumber(room, black.id, 30);
  submitNumber(room, white.id, 50);
  const round = room.rounds[0];
  const result = calculateRoundResult(room, round);
  assert.strictEqual(result.winnerTeam, null);
  assert.deepStrictEqual(result.gains, {});
}

{
  const room = createRoom("DROP");
  const player = joinRoom(room);
  assert.strictEqual(Object.keys(room.players).length, 1);
  removePlayer(room, player.id);
  assert.strictEqual(Object.keys(room.players).length, 0);
  assert.strictEqual(room.code, "DROP");
  assert.strictEqual(room.status, "lobby");
}

{
  const room = createRoom("TEACHER");
  registerTeacherDevice(room, "teacher-device");
  assert.strictEqual(isTeacherDevice(room, "teacher-device"), true);
  assert.strictEqual(isTeacherDevice(room, "student-device"), false);
  const sameDeviceStudent = joinRoom(room, null, { deviceId: "teacher-device" });
  sameDeviceStudent.power = 100;
  assert.strictEqual(serializeRoom(room, { role: "teacher" }).players.length, 1);
  assert.deepStrictEqual(getRankings(room).map((player) => player.id), [sameDeviceStudent.id]);
}

{
  const room = createRoom("EXCLUDE", {
    directiveMin: 50,
    directiveMax: 50,
    roundSeconds: 300,
    totalRounds: 1
  });
  const accidentalTeacher = joinRoom(room, null, { deviceId: "teacher-phone" });
  withMathRandom(0, () => startRound(room));
  submitNumber(room, accidentalTeacher.id, 77);

  const removed = excludeTeacherPlayer(room, accidentalTeacher.id);

  assert.strictEqual(removed.length, 1);
  assert.strictEqual(removed[0].id, accidentalTeacher.id);
  assert.strictEqual(isTeacherDevice(room, "teacher-phone"), false);
  assert.strictEqual(room.players[accidentalTeacher.id], undefined);
  assert.strictEqual(Object.keys(room.rounds[0].submissions).length, 0);
  const rejoined = joinRoom(room, null, { deviceId: "teacher-phone" });
  assert.ok(rejoined.id);
}

{
  // 같은 기기에서 playerId 없이 연달아 입장해도 명단에는 1명만 생겨야 한다.
  const room = createRoom("DEDUP", {
    directiveMin: 50,
    directiveMax: 50,
    roundSeconds: 300,
    totalRounds: 1
  });
  const first = joinRoom(room, null, { deviceId: "student-device-1" });
  const second = joinRoom(room, null, { deviceId: "student-device-1" });
  assert.strictEqual(first.id, second.id);
  assert.strictEqual(Object.keys(room.players).length, 1);
  const other = joinRoom(room, null, { deviceId: "student-device-2" });
  assert.notStrictEqual(other.id, first.id);
  assert.strictEqual(Object.keys(room.players).length, 2);
}

console.log("game logic tests passed");
