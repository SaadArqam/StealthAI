require("dotenv").config();

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const { createClient } = require("@deepgram/sdk");
const { streamLLMWithFallback, prewarmLLM } = require("./llm/llmWithFallback");
const { webSearch } = require("./tools/webSearch");
const { streamTTS, prewarm: prewarmTTS } = require("./tts/deepgram");
const logger = require("./logger");

const app = express();
app.use(express.json());


//  ENV + CLIENTS

const deepgram = process.env.DEEPGRAM_API_KEY
  ? createClient(process.env.DEEPGRAM_API_KEY)
  : null;


//  HTTP + WS 

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// WebSocket heartbeat settings (helps detect/stabilize dead connections)
const WS_HEARTBEAT_MS = parseInt(process.env.WS_HEARTBEAT_MS || "30000", 10);
function noop() {}
function heartbeat() { this.isAlive = true; }


//  SESSION STORE

const sessions = new Map();


function needsWebSearch(text) {
  const triggers = [
    "latest",
    "today",
    "current",
    "news",
    "price",
    "weather",
    "score",
    "stock",
    "match",
  ];
  return triggers.some((t) => text.toLowerCase().includes(t));
}


//  WEBSOCKET HANDLER

wss.on("connection", (ws) => {

  ws.isAlive = true;
  ws.on("pong", heartbeat);

  ws.on("error", (err) => {
    console.warn("WebSocket error for client:", session?.id, err?.message || err);
  });

  const session = {
    id: crypto.randomUUID(),
    state: "LISTENING",
    finalTranscript: null,
    partialTranscript: null,
    dgConnection: null,
    lastHandledTurnId: null,
  };

  sessions.set(session.id, session);
  ws.binaryType = "arraybuffer";
  logger.info("Client connected:", session.id);


  try {
    ws.send(JSON.stringify({ type: "session_id", id: session.id }));
  } catch (e) {
    logger.debug("Failed to send session_id to client (likely transient):", e?.message || e);
  }
  ws.send(JSON.stringify({ type: "state", value: "LISTENING" }));


  //  DEEPGRAM STT

  if (deepgram) {
    session.dgConnection = deepgram.listen.live({
      model: "nova-2",
      language: "en-US",
      encoding: "linear16",
      sample_rate: 16000,
      interim_results: true,
    });

    session.dgConnection.on("Results", (msg) => {
      const transcript = msg.channel?.alternatives?.[0]?.transcript;
      if (!transcript) return;


      session.partialTranscript = transcript;

      if (msg.is_final) {
        session.finalTranscript = transcript;
        session.partialTranscript = null;
        ws.send(JSON.stringify({
          type: "transcript_final",
          text: transcript,
        }));
      } else {
        ws.send(JSON.stringify({
          type: "transcript_partial",
          text: transcript,
        }));
      }
    });
  } else {
    session.dgConnection = { send() {}, finish() {} };
    logger.warn("DEEPGRAM not configured — running with mock STT/TTS behavior");
  }


  //  WS MESSAGES

  ws.on("message", async (data) => {
    let text = null;

    if (typeof data === "string") {
      text = data;
    } 
    else if (data instanceof ArrayBuffer) {
      if (session.state === "LISTENING") {
        session.dgConnection.send(Buffer.from(data));
      }
      return;
    } 
    else if (Buffer.isBuffer(data)) {
      const maybeText = data.toString("utf8");
      if (maybeText.trim().startsWith("{")) {
        text = maybeText;
      } else {
        if (session.state === "LISTENING") {
          session.dgConnection.send(data);
        }
        return;
      }
    } 
    else {
      return;
    }

  const msg = JSON.parse(text);


    //  BARGE-IN 

    if (msg.type === "barge_in") {
      session.state = "LISTENING";
      session.finalTranscript = null;
      ws.send(JSON.stringify({ type: "state", value: "LISTENING" }));
      return;
    }


    //  TURN START
    if (msg.type === "turn_start") {

      try { session.currentTurnId = msg.id; } catch {}
      return;
    }

    //  USER STOPPED 

    if (msg.type === "user_stopped") {

      if (msg.id && session.lastHandledTurnId === msg.id) {
        console.log("Ignoring duplicate user_stopped for turn", msg.id);
        return;
      }
      if (msg.id) session.lastHandledTurnId = msg.id;

        session.state = "THINKING";
        ws.send(JSON.stringify({ type: "state", value: "THINKING" }));

        const transcriptToUse = session.finalTranscript || session.partialTranscript;

        if (!transcriptToUse) {
          // No transcript available — reply with a short fallback and return to listening
          session.state = "SPEAKING";
          ws.send(JSON.stringify({ type: "state", value: "SPEAKING" }));
          ws.send(JSON.stringify({ type: "llm_token", text: "Sorry, I didn’t catch that. Could you repeat?" }));
          ws.send(JSON.stringify({ type: "llm_done" }));

          session.finalTranscript = null;
          session.partialTranscript = null;
          session.state = "LISTENING";
          ws.send(JSON.stringify({ type: "state", value: "LISTENING" }));
          return;
        }

        let prompt = `You are a helpful voice assistant.\n\nUser says:\n${transcriptToUse}`;

        if (needsWebSearch(transcriptToUse)) {
          try {
            const results = await webSearch(transcriptToUse);
            const context = results.map(r => `${r.title}\n${r.content}`).join("\n\n");
            prompt = `${context}\n\nUser:\n${transcriptToUse}`;
          } catch (err) {
            logger.warn("WebSearch failed (continuing without web context):", err?.message || err);
          }
        }

        session.state = "SPEAKING";
        ws.send(JSON.stringify({ type: "state", value: "SPEAKING" }));

        let assistantText = "";

        try {
          logger.info("LLM start for session", session.id);

          try { ws.send(JSON.stringify({ type: "llm_started", ts: Date.now() })); } catch (e) { logger.debug("failed to send llm_started", e?.message || e); }

          let tokenIndex = 0;
          await streamLLMWithFallback(prompt, (token) => {
            assistantText += token;
            const payload = { type: "llm_token", text: token, index: tokenIndex++, ts: Date.now() };
            try {
              ws.send(JSON.stringify(payload));
            } catch (err) {
              logger.warn("Failed sending llm_token to client:", err?.message || err);
            }
          });

          try { ws.send(JSON.stringify({ type: "llm_done", ts: Date.now() })); } catch (e) { logger.debug("failed to send llm_done", e?.message || e); }
          logger.info("LLM done for session", session.id);
        } catch (err) {
          logger.error("LLM streaming failed for session", session.id, err?.message || err);

          try {
            ws.send(JSON.stringify({ type: "llm_token", text: "[error]", ts: Date.now() }));
            ws.send(JSON.stringify({ type: "llm_done", ts: Date.now() }));
          } catch (e) {
            logger.warn("Failed to notify client of LLM error:", e?.message || e);
          }
        }

        try {
          await streamTTS(assistantText, (audio) => ws.send(audio));
        } catch (e) {
          logger.warn("TTS streaming failed:", e?.message || e);
        }

        session.finalTranscript = null;
        session.partialTranscript = null;
        session.state = "LISTENING";
        try {
          ws.send(JSON.stringify({ type: "state", value: "LISTENING" }));
        } catch (err) {
          console.warn("Failed to send LISTENING state to client:", err?.message || err);
        }
    }
  });


  ws.on("close", (code, reason) => {
    try {
      session.dgConnection?.finish?.();
    } catch (e) {

    }
    sessions.delete(session.id);
    let reasonText = "";
    try {
      reasonText = reason && reason.toString ? reason.toString() : String(reason || "");
    } catch (e) {
      reasonText = "<unserializable>";
    }
    logger.info("Client disconnected:", session.id, "code:", code, "reason:", reasonText);
  });
});


const wsInterval = setInterval(() => {
  wss.clients.forEach((client) => {
    if (client.isAlive === false) return client.terminate();
    client.isAlive = false;
    try {
      client.ping(noop);
    } catch (err) {

    }
  });
}, WS_HEARTBEAT_MS);

process.on("exit", () => clearInterval(wsInterval));




app.get("/metrics", (_, res) => {
  res.json([...sessions.values()].map(s => ({
    id: s.id,
    state: s.state,
  })));
});


//  HEALTH

app.get("/health", (_, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    activeSessions: sessions.size,
  });
});



app.post("/prewarm", async (req, res) => {
  try {

    const tasks = [];
    if (typeof prewarmLLM === "function") tasks.push(prewarmLLM());
    if (typeof prewarmTTS === "function") tasks.push(prewarmTTS());

    await Promise.race([
      Promise.all(tasks),
      new Promise((r) => setTimeout(r, 5000)), 
    ]);

    res.json({ warmed: true });
  } catch (err) {
    console.warn("/prewarm error:", err?.message || err);
    res.status(500).json({ warmed: false });
  }
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


if (process.env.PREWARM_ON_STARTUP === "true") {
  (async () => {
    console.log("PREWARM_ON_STARTUP=true — running prewarm tasks...");
    try {
      const tasks = [];
      if (typeof prewarmLLM === "function") tasks.push(prewarmLLM());
      if (typeof prewarmTTS === "function") tasks.push(prewarmTTS());
      await Promise.race([Promise.all(tasks), new Promise((r) => setTimeout(r, 8000))]);
      console.log("Startup prewarm complete");
    } catch (err) {
      console.warn("Startup prewarm failed:", err?.message || err);
    }
  })();
}


const PREWARM_INTERVAL_MS = parseInt(process.env.PREWARM_INTERVAL_MS || "900000", 10); 
if (process.env.ENABLE_PERIODIC_PREWARM === "true") {
  setInterval(() => {
    (async () => {
      try {
        console.log("Periodic prewarm triggered");
        if (typeof prewarmLLM === "function") await prewarmLLM();
        if (typeof prewarmTTS === "function") await prewarmTTS();
      } catch (err) {
        console.warn("Periodic prewarm failed:", err?.message || err);
      }
    })();
  }, PREWARM_INTERVAL_MS);
}
