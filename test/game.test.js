const assert = require("assert");

const {
  allocatePower,
  calculateRoundResult,
  createRoom,
  endRound,
  joinRoom,
  isTeacherDevice,
  removePlayer,
  registerTeacherDevice,
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
}

console.log("game logic tests passed");
