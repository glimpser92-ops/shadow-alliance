const express = require("express");
const http = require("http");
const os = require("os");
const path = require("path");
const QRCode = require("qrcode");
const { Server } = require("socket.io");

const {
  createRoom,
  disconnectPlayer,
  endRound,
  finalizeRoom,
  joinRoom,
  makeRoomCode,
  maybeExpireRound,
  pauseRound,
  resumeRound,
  serializeRoom,
  startRound,
  submitNumber,
  updateSettings,
  adjustRoundTime,
  isTeacherDevice,
  registerTeacherDevice,
  removePlayer
} = require("./lib/game");

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const PUBLIC_URL = normalizePublicUrl(process.env.PUBLIC_URL);
const rooms = new Map();
const sockets = new Map();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true
  }
});

app.set("trust proxy", true);
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/config", (req, res) => {
  const requestOrigin = `${req.protocol}://${req.get("host")}`;
  res.json({
    publicUrl: PUBLIC_URL || requestOrigin,
    localUrls: getLocalUrls(PORT),
    hasPublicUrl: Boolean(PUBLIC_URL)
  });
});

app.get("/api/qr", async (req, res) => {
  const text = String(req.query.text || "");
  if (!text) {
    res.status(400).json({ error: "QR로 만들 주소가 필요합니다." });
    return;
  }
  try {
    const dataUrl = await QRCode.toDataURL(text, {
      margin: 1,
      width: 260,
      color: {
        dark: "#0b0b0f",
        light: "#fff8df"
      }
    });
    res.json({ dataUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

io.on("connection", (socket) => {
  socket.on("room:create", (payload = {}, reply) => {
    safeReply(reply, () => {
      const code = makeRoomCode(new Set(rooms.keys()));
      const { deviceId, settings } = normalizeCreatePayload(payload);
      const room = createRoom(code, settings);
      registerTeacherDevice(room, deviceId);
      rooms.set(code, room);
      setSocketRoom(socket, { code, role: "teacher", teacherToken: room.teacherToken, deviceId });
      return {
        code,
        teacherToken: room.teacherToken,
        state: serializeRoom(room, { role: "teacher" })
      };
    });
  });

  socket.on("room:watch", ({ code, teacherToken, playerId, role, deviceId } = {}, reply) => {
    safeReply(reply, () => {
      const room = requireRoom(code);
      const normalizedRole = teacherToken === room.teacherToken ? "teacher" : role === "teacher" ? "viewer" : "student";
      if (normalizedRole === "teacher") registerTeacherDevice(room, deviceId);
      setSocketRoom(socket, {
        code: room.code,
        role: normalizedRole,
        playerId,
        teacherToken: normalizedRole === "teacher" ? teacherToken : null,
        deviceId
      });
      return {
        state: serializeRoom(room, {
          role: normalizedRole,
          playerId
        }),
        role: normalizedRole
      };
    });
  });

  socket.on("student:join", ({ code, playerId, deviceId } = {}, reply) => {
    safeReply(reply, () => {
      const room = requireRoom(code);
      if (isTeacherDevice(room, deviceId)) {
        return {
          blockedAsTeacher: true,
          state: serializeRoom(room, { role: "teacher" })
        };
      }
      const player = joinRoom(room, playerId, { deviceId });
      setSocketRoom(socket, { code: room.code, role: "student", playerId: player.id, deviceId });
      broadcastRoom(room);
      return {
        playerId: player.id,
        state: serializeRoom(room, {
          role: "student",
          playerId: player.id
        })
      };
    });
  });

  socket.on("student:submit", ({ code, playerId, value } = {}, reply) => {
    safeReply(reply, () => {
      const room = requireRoom(code);
      submitNumber(room, playerId, value);
      broadcastRoom(room);
      return {
        state: serializeRoom(room, {
          role: "student",
          playerId
        })
      };
    });
  });

  socket.on("teacher:updateSettings", ({ code, teacherToken, settings } = {}, reply) => {
    safeReply(reply, () => {
      const room = requireTeacherRoom(code, teacherToken);
      updateSettings(room, settings);
      broadcastRoom(room);
      return { state: serializeRoom(room, { role: "teacher" }) };
    });
  });

  socket.on("teacher:startRound", ({ code, teacherToken } = {}, reply) => {
    safeReply(reply, () => {
      const room = requireTeacherRoom(code, teacherToken);
      startRound(room);
      broadcastRoom(room, "start");
      return { state: serializeRoom(room, { role: "teacher" }) };
    });
  });

  socket.on("teacher:pause", ({ code, teacherToken } = {}, reply) => {
    safeReply(reply, () => {
      const room = requireTeacherRoom(code, teacherToken);
      if (room.paused) resumeRound(room);
      else pauseRound(room);
      broadcastRoom(room);
      return { state: serializeRoom(room, { role: "teacher" }) };
    });
  });

  socket.on("teacher:adjustTime", ({ code, teacherToken, deltaSeconds } = {}, reply) => {
    safeReply(reply, () => {
      const room = requireTeacherRoom(code, teacherToken);
      adjustRoundTime(room, deltaSeconds);
      broadcastRoom(room);
      return { state: serializeRoom(room, { role: "teacher" }) };
    });
  });

  socket.on("teacher:endRound", ({ code, teacherToken } = {}, reply) => {
    safeReply(reply, () => {
      const room = requireTeacherRoom(code, teacherToken);
      endRound(room);
      broadcastRoom(room, "result");
      return { state: serializeRoom(room, { role: "teacher" }) };
    });
  });

  socket.on("teacher:removePlayer", ({ code, teacherToken, playerId } = {}, reply) => {
    safeReply(reply, () => {
      const room = requireTeacherRoom(code, teacherToken);
      const removed = removePlayer(room, playerId);
      clearRemovedPlayerSockets(room.code, playerId);
      broadcastRoom(room);
      return {
        removed: {
          id: removed.id,
          nickname: removed.nickname
        },
        state: serializeRoom(room, { role: "teacher" })
      };
    });
  });

  socket.on("teacher:finalize", ({ code, teacherToken } = {}, reply) => {
    safeReply(reply, () => {
      const room = requireTeacherRoom(code, teacherToken);
      finalizeRoom(room);
      broadcastRoom(room, "final");
      return { state: serializeRoom(room, { role: "teacher" }) };
    });
  });

  socket.on("disconnect", () => {
    const meta = sockets.get(socket.id);
    sockets.delete(socket.id);
    if (meta?.role === "student" && meta.playerId) {
      const room = rooms.get(meta.code);
      disconnectPlayer(room, meta.playerId);
      if (room) broadcastRoom(room);
    }
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    if (maybeExpireRound(room)) {
      broadcastRoom(room, "result");
    } else if (room.status === "round") {
      broadcastRoom(room);
    }
  }
}, 1000);

function safeReply(reply, handler) {
  try {
    const payload = handler();
    if (typeof reply === "function") reply({ ok: true, ...payload });
  } catch (error) {
    if (typeof reply === "function") reply({ ok: false, error: error.message });
  }
}

function normalizeCreatePayload(payload) {
  if (payload && Object.prototype.hasOwnProperty.call(payload, "settings")) {
    return {
      deviceId: payload.deviceId || null,
      settings: payload.settings || {}
    };
  }
  return {
    deviceId: null,
    settings: payload || {}
  };
}

function setSocketRoom(socket, meta) {
  const previous = sockets.get(socket.id);
  if (previous?.code && previous.code !== meta.code) {
    socket.leave(previous.code);
  }
  socket.join(meta.code);
  sockets.set(socket.id, meta);
}

function requireRoom(code) {
  const normalized = String(code || "").trim().toUpperCase();
  const room = rooms.get(normalized);
  if (!room) throw new Error("방을 찾을 수 없습니다.");
  return room;
}

function requireTeacherRoom(code, teacherToken) {
  const room = requireRoom(code);
  if (room.teacherToken !== teacherToken) {
    throw new Error("교사 권한이 없습니다.");
  }
  return room;
}

function broadcastRoom(room, event = "state") {
  const roomSockets = io.sockets.adapter.rooms.get(room.code);
  if (!roomSockets) return;
  for (const socketId of roomSockets) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;
    const meta = sockets.get(socketId) || {};
    socket.emit("room:state", {
      event,
      state: serializeRoom(room, {
        role: meta.role,
        playerId: meta.playerId
      })
    });
  }
}

function clearRemovedPlayerSockets(code, playerId) {
  for (const [socketId, meta] of sockets.entries()) {
    if (meta.code === code && meta.playerId === playerId) {
      sockets.set(socketId, {
        ...meta,
        playerId: null,
        removed: true
      });
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit("student:removed", { code, playerId });
      }
    }
  }
}

server.listen(PORT, "0.0.0.0", () => {
  const urls = getLocalUrls(PORT);
  console.log("");
  console.log("SHADOW ALLIANCE 교실 서버가 시작되었습니다.");
  if (PUBLIC_URL) console.log(`공개 접속 주소: ${PUBLIC_URL}`);
  console.log(`로컬 교사용 주소: http://localhost:${PORT}`);
  urls.forEach((url) => console.log(`같은 와이파이 접속 주소: ${url}`));
  console.log("");
});

function getLocalUrls(port) {
  const urls = [];
  const interfaces = os.networkInterfaces();
  for (const details of Object.values(interfaces)) {
    for (const detail of details || []) {
      if (detail.family === "IPv4" && !detail.internal) {
        urls.push(`http://${detail.address}:${port}`);
      }
    }
  }
  return urls;
}

function normalizePublicUrl(value) {
  if (!value) return "";
  return String(value).trim().replace(/\/+$/, "");
}
