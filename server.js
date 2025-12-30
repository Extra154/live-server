require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3").verbose();
const { v4: uuidv4 } = require("uuid");
const { RtcTokenBuilder, RtcRole } = require("agora-access-token");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
  })
});

function sendLiveNotification(tokens, stream_id, host) {
  const message = {
    notification: {
      title: "Live now 🔴",
      body: `${host} just started a live stream`
    },
    data: {
      stream_id
    },
    tokens
  };

  admin.messaging().sendMulticast(message);
}

app.use(cors());
app.use(express.json());

/* ================= DATABASE ================= */
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

/* ================= AGORA TOKEN ================= */
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

/* ================= START LIVE ================= */
app.post("/live/start", (req, res) => {
  const { host_username } = req.body;
  const stream_id = uuidv4();

  db.run(
    `INSERT INTO live_streams (stream_id, host_username)
     VALUES (?, ?)`,
    [stream_id, host_username],
    function (err) {
      if (err) {
        return res.status(500).json({ error: "Failed to start live" });
      }
      res.json({ stream_id });
    }
  );
});

/* ================= END LIVE ================= */
app.post("/live/end", (req, res) => {
  const { stream_id } = req.body;

  db.run(
    `UPDATE live_streams SET is_live = 0 WHERE stream_id = ?`,
    [stream_id],
    function (err) {
      if (err) {
        return res.status(500).json({ error: "Failed to end live" });
      }
      res.json({ message: "Live ended" });
    }
  );
});

/* ================= LIST LIVE ================= */
app.get("/live/list", (req, res) => {
  db.all(
    `SELECT * FROM live_streams
     WHERE is_live = 1
     ORDER BY created_at DESC`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      res.json(rows);
    }
  );
});

/* ================= SOCKET.IO ================= */
io.on("connection", socket => {
  console.log("User connected:", socket.id);

  /* JOIN LIVE */
  socket.on("joinLive", ({ stream_id, user_id }) => {
    socket.join(stream_id);

    db.run(
      `INSERT OR IGNORE INTO live_viewers (stream_id, user_id)
       VALUES (?, ?)`,
      [stream_id, user_id]
    );

    db.run(
      `UPDATE live_streams SET views = views + 1
       WHERE stream_id = ?`,
      [stream_id]
    );

    db.get(
      `SELECT views FROM live_streams WHERE stream_id = ?`,
      [stream_id],
      (err, row) => {
        if (row) {
          io.to(stream_id).emit("viewsUpdate", row.views);
        }
      }
    );
  });

  /* LEAVE LIVE */
  socket.on("leaveLive", ({ stream_id }) => {
    socket.leave(stream_id);
  });

  /* LIKE */
  socket.on("like", ({ stream_id }) => {
    db.run(
      `UPDATE live_streams SET likes = likes + 1
       WHERE stream_id = ?`,
      [stream_id],
      () => {
        db.get(
          `SELECT likes FROM live_streams WHERE stream_id = ?`,
          [stream_id],
          (err, row) => {
            if (row) {
              io.to(stream_id).emit("likesUpdate", row.likes);
            }
          }
        );
      }
    );
  });

  /* COMMENT */
  socket.on("comment", ({ stream_id, username, comment }) => {
    db.run(
      `INSERT INTO live_comments (stream_id, username, comment)
       VALUES (?, ?, ?)`,
      [stream_id, username, comment],
      () => {
        db.run(
          `UPDATE live_streams
           SET comment_count = comment_count + 1
           WHERE stream_id = ?`,
          [stream_id]
        );

        io.to(stream_id).emit("newComment", {
          username,
          comment,
          time: new Date()
        });
      }
    );
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

/* ================= START SERVER ================= */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Live server running on port ${PORT}`);
});







