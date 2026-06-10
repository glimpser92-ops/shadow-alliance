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
    const manualCut = await emit(teacher, "teacher:setPenaltyTarget", {
      code,
      teacherToken,
      targetCount: 1
    });
    assert.strictEqual(manualCut.state.penaltyTargetCount, 1);

    const lateSocket = await connect();
    sockets.push(lateSocket);
    const lateJoin = await emit(lateSocket, "student:join", {
      code,
      deviceId: "late-student-device"
    });
    assert.strictEqual(lateJoin.state.status, "round");
    assert.ok(lateJoin.playerId);
    assert.ok(["black", "white"].includes(lateJoin.state.personal.team));
    const lateFirstSubmit = await emit(lateSocket, "student:submit", {
      code,
      playerId: lateJoin.playerId,
      value: 17
    });
    assert.strictEqual(lateFirstSubmit.state.personal.currentSubmission, 17);
    const lateFinalValue = lateJoin.state.personal.team === "black" ? 50 : 100;
    const lateSecondSubmit = await emit(lateSocket, "student:submit", {
      code,
      playerId: lateJoin.playerId,
      value: lateFinalValue
    });
    assert.strictEqual(lateSecondSubmit.state.personal.currentSubmission, lateFinalValue);
    students.push({
      socket: lateSocket,
      playerId: lateJoin.playerId,
      team: lateJoin.state.personal.team
    });

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

    const nextGame = await emit(teacher, "room:create", {
      deviceId: "same-teacher-after-final",
      settings: finalized.state.settings
    });
    assert.notStrictEqual(nextGame.code, code);
    assert.strictEqual(nextGame.state.status, "lobby");
    assert.strictEqual(nextGame.state.currentRound, 0);
    assert.strictEqual(nextGame.state.players.length, 0);

    const cleanupTeacher = await connect();
    sockets.push(cleanupTeacher);
    const cleanupRoom = await emit(cleanupTeacher, "room:create", {
      deviceId: "teacher-device",
      settings: {
        totalRounds: 1,
        directiveMin: 50,
        directiveMax: 50,
        roundSeconds: 30
      }
    });
    const firstStudent = await connect();
    sockets.push(firstStudent);
    const firstStudentJoin = await emit(firstStudent, "student:join", {
      code: cleanupRoom.code,
      deviceId: "teacher-device"
    });
    assert.ok(firstStudentJoin.playerId);
    assert.strictEqual(firstStudentJoin.state.personal.deviceId, undefined);

    const cleanupStudent = await connect();
    sockets.push(cleanupStudent);
    const cleanupStudentJoin = await emit(cleanupStudent, "student:join", {
      code: cleanupRoom.code,
      deviceId: "cleanup-student-device"
    });
    const cleanupWatch = await emit(cleanupTeacher, "room:watch", {
      code: cleanupRoom.code,
      teacherToken: cleanupRoom.teacherToken,
      role: "teacher",
      deviceId: "teacher-device"
    });
    assert.strictEqual(cleanupWatch.state.players.length, 2);
    assert.ok(cleanupWatch.state.players.some((player) => player.id === firstStudentJoin.playerId));
    assert.ok(cleanupWatch.state.players.some((player) => player.id === cleanupStudentJoin.playerId));

    const tokenCarrier = await connect();
    sockets.push(tokenCarrier);
    const tokenBlockedJoin = await emit(tokenCarrier, "student:join", {
      code: cleanupRoom.code,
      deviceId: "token-carrying-browser",
      teacherToken: cleanupRoom.teacherToken
    });
    assert.strictEqual(tokenBlockedJoin.blockedAsTeacher, true);
    assert.strictEqual(tokenBlockedJoin.state.players.length, 2);

    const excludeRoom = await emit(cleanupTeacher, "room:create", {
      deviceId: "main-teacher-device",
      settings: {
        totalRounds: 1,
        directiveMin: 50,
        directiveMax: 50,
        roundSeconds: 30
      }
    });
    const teacherPhone = await connect();
    sockets.push(teacherPhone);
    const teacherPhoneJoin = await emit(teacherPhone, "student:join", {
      code: excludeRoom.code,
      deviceId: "teacher-phone-device"
    });
    await emit(cleanupTeacher, "teacher:startRound", {
      code: excludeRoom.code,
      teacherToken: excludeRoom.teacherToken
    });
    await emit(teacherPhone, "student:submit", {
      code: excludeRoom.code,
      playerId: teacherPhoneJoin.playerId,
      value: 77
    });
    const excluded = await emit(cleanupTeacher, "teacher:excludePlayer", {
      code: excludeRoom.code,
      teacherToken: excludeRoom.teacherToken,
      playerId: teacherPhoneJoin.playerId
    });
    assert.strictEqual(excluded.state.status, "round");
    assert.strictEqual(excluded.state.players.length, 0);
    const teacherPhoneAgain = await emit(teacherPhone, "student:join", {
      code: excludeRoom.code,
      deviceId: "teacher-phone-device"
    });
    assert.ok(teacherPhoneAgain.playerId);
    assert.strictEqual(teacherPhoneAgain.state.players, undefined);

    const legacyTeacher = await connect();
    sockets.push(legacyTeacher);
    const legacyRoom = await emit(legacyTeacher, "room:create", {
      settings: {
        totalRounds: 1,
        directiveMin: 50,
        directiveMax: 50,
        roundSeconds: 30
      }
    });
    const legacyAccidental = await connect();
    sockets.push(legacyAccidental);
    await emit(legacyAccidental, "student:join", {
      code: legacyRoom.code,
      deviceId: "legacy-teacher-device"
    });
    const watchedLegacyWithTeacherDevice = await emit(legacyTeacher, "room:watch", {
      code: legacyRoom.code,
      teacherToken: legacyRoom.teacherToken,
      role: "teacher",
      deviceId: "legacy-teacher-device"
    });
    assert.strictEqual(watchedLegacyWithTeacherDevice.state.players.length, 1);
    const legacyStudent = await connect();
    sockets.push(legacyStudent);
    const legacyStudentJoin = await emit(legacyStudent, "student:join", {
      code: legacyRoom.code,
      deviceId: "legacy-student-device"
    });
    const watchedLegacyRoom = await emit(legacyTeacher, "room:watch", {
      code: legacyRoom.code,
      teacherToken: legacyRoom.teacherToken,
      role: "teacher",
      deviceId: "legacy-teacher-device"
    });
    assert.strictEqual(watchedLegacyRoom.state.players.length, 2);
    assert.ok(watchedLegacyRoom.state.players.some((player) => player.id === legacyStudentJoin.playerId));

    const studentRoom = await emit(cleanupTeacher, "room:create", {
      settings: {
        totalRounds: 1,
        directiveMin: 50,
        directiveMax: 50,
        roundSeconds: 30
      }
    });
    const accidental = await connect();
    sockets.push(accidental);
    const accidentalJoin = await emit(accidental, "student:join", {
      code: studentRoom.code,
      deviceId: "student-device"
    });
    const removed = await emit(cleanupTeacher, "teacher:removePlayer", {
      code: studentRoom.code,
      teacherToken: studentRoom.teacherToken,
      playerId: accidentalJoin.playerId
    });
    assert.strictEqual(removed.state.players.length, 0);
    assert.strictEqual(removed.state.code, studentRoom.code);
    assert.strictEqual(removed.state.status, "lobby");

    console.log("socket smoke test passed");
  } finally {
    sockets.forEach((socket) => socket.close());
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
