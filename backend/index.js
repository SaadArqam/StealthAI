require("dotenv").config();

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const { createClient } = require("@deepgram/sdk");
const { streamLLMWithFallback } = require("./llm/llmWithFallback");
const { webSearch } = require("./tools/webSearch");
const { streamTTS } = require("./tts/deepgram");

const app = express();
app.use(express.json());

/* ==============================
   ENV + CLIENTS
================================ */
const deepgram = process.env.DEEPGRAM_API_KEY
  ? createClient(process.env.DEEPGRAM_API_KEY)
  : null;

/* ==============================
   HTTP + WS (SAME SERVER)
================================ */
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

/* ==============================
   SESSION STORE
================================ */
const sessions = new Map();

/* ==============================
   HELPERS
================================ */
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

/* ==============================
   WEBSOCKET HANDLER
================================ */
wss.on("connection", (ws) => {
  const session = {
    id: crypto.randomUUID(),
    state: "LISTENING",
    finalTranscript: null,
    dgConnection: null,
  };

  sessions.set(session.id, session);
  ws.binaryType = "arraybuffer";

  console.log("Client connected:", session.id);

  ws.send(JSON.stringify({ type: "state", value: "LISTENING" }));

  /* ==============================
     DEEPGRAM STT
  ================================ */
  if (deepgram) {
    session.dgConnection = deepgram.listen.live({
      model: "nova-2",
      language: "en-US",
      encoding: "linear16",
      sample_rate: 16000,
      interim_results: true,
    });

    session.dgConnection.on("Results", (msg) => {
      const transcript =
        msg.channel?.alternatives?.[0]?.transcript;
      if (!transcript) return;

      if (msg.is_final) {
        session.finalTranscript = transcript;
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
  }

  /* ==============================
     WS MESSAGES
  ================================ */
  ws.on("message", async (data) => {

    /* ---------- AUDIO ---------- */
    if (!(typeof data === "string")) {
      if (session.state === "LISTENING") {
        session.dgConnection.send(Buffer.from(data));
      }
      return;
    }

    const msg = JSON.parse(data);

    /* ---------- BARGE-IN ---------- */
    if (msg.type === "barge_in") {
      session.state = "LISTENING";
      session.finalTranscript = null;
      ws.send(JSON.stringify({ type: "state", value: "LISTENING" }));
      return;
    }

    /* ---------- USER STOPPED ---------- */
    if (msg.type === "user_stopped") {
      session.state = "THINKING";
      ws.send(JSON.stringify({ type: "state", value: "THINKING" }));

      setTimeout(async () => {
        if (!session.finalTranscript) {
          ws.send(JSON.stringify({
            type: "llm_token",
            text: "Sorry, I didn’t catch that. Could you repeat?",
          }));
          ws.send(JSON.stringify({ type: "llm_done" }));
          ws.send(JSON.stringify({ type: "state", value: "LISTENING" }));
          return;
        }

        let prompt = `You are a helpful voice assistant.\n\nUser says:\n${session.finalTranscript}`;

        if (needsWebSearch(session.finalTranscript)) {
          const results = await webSearch(session.finalTranscript);
          const context = results
            .map(r => `${r.title}\n${r.content}`)
            .join("\n\n");

          prompt = `${context}\n\nUser:\n${session.finalTranscript}`;
        }

        session.state = "SPEAKING";
        ws.send(JSON.stringify({ type: "state", value: "SPEAKING" }));

        let assistantText = "";

        await streamLLMWithFallback(prompt, (token) => {
          assistantText += token;
          ws.send(JSON.stringify({
            type: "llm_token",
            text: token,
          }));
        });

        ws.send(JSON.stringify({ type: "llm_done" }));

        /* ---------- TTS ---------- */
        try {
          await streamTTS(assistantText, (audio) => {
            ws.send(audio);
          });
        } catch (e) {
          console.error("TTS failed:", e.message);
        }

        session.finalTranscript = null;
        session.state = "LISTENING";
        ws.send(JSON.stringify({ type: "state", value: "LISTENING" }));

      }, 150);
    }
  });

  ws.on("close", () => {
    session.dgConnection?.finish?.();
    sessions.delete(session.id);
    console.log("Client disconnected:", session.id);
  });
});

/* ==============================
   ADMIN + METRICS
================================ */
app.get("/metrics", (_, res) => {
  res.json([...sessions.values()].map(s => ({
    id: s.id,
    state: s.state,
  })));
});

/* ==============================
   START SERVER (RENDER SAFE)
================================ */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
