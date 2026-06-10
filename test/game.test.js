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
  assert.strictEqual(room.players[black.id].power, 10000);
  assert.strictEqual(room.players[white.id].power, 0);
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
