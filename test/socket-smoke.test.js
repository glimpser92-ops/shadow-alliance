const assert = require("assert");
const { io } = require("socket.io-client");

const SERVER_URL = process.env.SHADOW_SERVER_URL || "http://localhost:3000";

function connect() {
  const socket = io(SERVER_URL, {
    forceNew: true,
    reconnection: false,
    timeout: 5000
  });
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function emit(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (reply) => {
      if (!reply?.ok) {
        reject(new Error(reply?.error || `${event} failed`));
        return;
      }
      resolve(reply);
    });
  });
}

(async () => {
  const sockets = [];
  try {
    const teacher = await connect();
    sockets.push(teacher);

    const created = await emit(teacher, "room:create", {
      totalRounds: 1,
      directiveMin: 50,
      directiveMax: 50,
      roundSeconds: 30
    });

    const { code, teacherToken } = created;
    assert.match(code, /^[A-Z0-9]{4}$/);
    assert.ok(teacherToken);

    const students = [];
    for (let index = 0; index < 4; index += 1) {
      const socket = await connect();
      sockets.push(socket);
      const joined = await emit(socket, "student:join", { code });
      assert.ok(joined.playerId);
      assert.ok(joined.state.personal.nickname);
      assert.ok(["black", "white"].includes(joined.state.personal.team));
      students.push({
        socket,
        playerId: joined.playerId,
        team: joined.state.personal.team
      });
    }

    assert.ok(students.some((student) => student.team === "black"));
    assert.ok(students.some((student) => student.team === "white"));

    const started = await emit(teacher, "teacher:startRound", { code, teacherToken });
    assert.strictEqual(started.state.status, "round");
    assert.strictEqual(started.state.directive, 50);

    for (const student of students) {
      await emit(student.socket, "student:submit", {
        code,
        playerId: student.playerId,
        value: student.team === "black" ? 50 : 100
      });
    }

    const ended = await emit(teacher, "teacher:endRound", { code, teacherToken });
    assert.strictEqual(ended.state.status, "result");
    assert.strictEqual(ended.state.result.winnerTeam, "black");
    assert.strictEqual(
      ended.state.result.gains &&
        Object.values(ended.state.result.gains).reduce((sum, value) => sum + value, 0),
      10000
    );

    const finalized = await emit(teacher, "teacher:finalize", { code, teacherToken });
    assert.strictEqual(finalized.state.status, "final");
    assert.ok(finalized.state.final.rankings.length >= 4);

    const cleanupTeacher = await connect();
    sockets.push(cleanupTeacher);
    const cleanupRoom = await emit(cleanupTeacher, "room:create", {
      totalRounds: 1,
      directiveMin: 50,
      directiveMax: 50,
      roundSeconds: 30
    });
    const accidental = await connect();
    sockets.push(accidental);
    const accidentalJoin = await emit(accidental, "student:join", {
      code: cleanupRoom.code
    });
    const removed = await emit(cleanupTeacher, "teacher:removePlayer", {
      code: cleanupRoom.code,
      teacherToken: cleanupRoom.teacherToken,
      playerId: accidentalJoin.playerId
    });
    assert.strictEqual(removed.state.players.length, 0);

    console.log("socket smoke test passed");
  } finally {
    sockets.forEach((socket) => socket.close());
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
