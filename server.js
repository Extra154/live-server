require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3").verbose();
const { v4: uuidv4 } = require("uuid");
const {
  RtcTokenBuilder,
  RtcRole
} = require("agora-access-token");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

app.use(cors());
app.use(express.json());

// ================= DATABASE =================
const db = new sqlite3.Database("./live.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS live_streams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id TEXT UNIQUE,
      host_username TEXT,
      views INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      comment_count INTEGER DEFAULT 0,
      is_live INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS live_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id TEXT,
      username TEXT,
      comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS live_viewers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id TEXT,
      user_id TEXT,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(stream_id, user_id)
    )
  `);
});

// ================= AGORA TOKEN =================
app.get("/rtc-token", (req, res) => {
  const channelName = req.query.channel;
  const uid = req.query.uid || 0;

  if (!channelName) {
    return res.status(400).json({ error: "channel required" });
  }

  const expirationTimeInSeconds = 3600;
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

  const token = RtcTokenBuilder.buildTokenWithUid(
    process.env.AGORA_APP_ID,
    process.env.AGORA_APP_CERTIFICATE,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    privilegeExpiredTs
  );

  res.json({ token });
});

// ================= START LIVE =================
app.post("/live/start", (req, res) => {
  const { host_username } = req.body;
  const stream_id = uuidv4();

db.run(
  `INSERT INTO live_streams (stream_id, host_username) VALUES (?, ?)`,
  [streamId, hostUsername],
  function (err) {
    if (err) {
      console.error("Error inserting live stream:", err.message);
      return res.status(500).json({ error: "Failed to start live stream" });
    }
    res.json({ message: "Live stream started", id: this.lastID });
  }
);

// ================= END LIVE =================
app.post("/live/end", (req, res) => {
  const { stream_id } = req.body;

  db.run(
    UPDATE live_streams SET is_live = 0 WHERE stream_id = ?,
    [stream_id],
    () => {
      io.to(stream_id).emit("liveEnded");
      res.json({ success: true });
    }
  );
});

// ================= GET LIVE STREAMS =================
app.get("/live/list", (req, res) => {
  db.all(
    SELECT * FROM live_streams WHERE is_live = 1 ORDER BY created_at DESC,
    [],
    (err, rows) => {
      res.json(rows);
    }
  );
});

// ================= SOCKET.IO =================
io.on("connection", socket => {
  console.log("User connected:", socket.id);

  // JOIN STREAM
  socket.on("joinLive", ({ stream_id, user_id }) => {
    socket.join(stream_id);

    db.run(
      INSERT OR IGNORE INTO live_viewers (stream_id, user_id) VALUES (?, ?),
      [stream_id, user_id]
    );

    db.run(
      UPDATE live_streams SET views = views + 1 WHERE stream_id = ?,
      [stream_id]
    );

    db.get(
      SELECT views FROM live_streams WHERE stream_id = ?,
      [stream_id],
      (err, row) => {
        io.to(stream_id).emit("viewsUpdate", row.views);
      }
    );
  });

  // LEAVE STREAM
  socket.on("leaveLive", ({ stream_id, user_id }) => {
    socket.leave(stream_id);
  });

  // LIKE STREAM
  socket.on("like", ({ stream_id }) => {
    db.run(
      UPDATE live_streams SET likes = likes + 1 WHERE stream_id = ?,
      [stream_id]
    );

    db.get(
      SELECT likes FROM live_streams WHERE stream_id = ?,
      [stream_id],
      (err, row) => {
        io.to(stream_id).emit("likesUpdate", row.likes);
      }
    );
  });

  // COMMENT
  socket.on("comment", ({ stream_id, username, comment }) => {
    db.run(
      INSERT INTO live_comments (stream_id, username, comment) VALUES (?, ?, ?),
      [stream_id, username, comment]
    );

    db.run(
      UPDATE live_streams SET comment_count = comment_count + 1 WHERE stream_id = ?,
      [stream_id]
    );

    io.to(stream_id).emit("newComment", {
      username,
      comment,
      time: new Date()
    });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(Live server running on port ${PORT});

});
