// ==============================
// imports
// ==============================
require("dotenv").config();

const express = require("express");
const WebSocket = require("ws");
const crypto = require("crypto");
const { createClient } = require("@deepgram/sdk");
const { streamLLMResponse } = require("./llm/groq");
const { webSearch } = require("./tools/webSearch");

// ==============================
// app + middleware
// ==============================
const app = express();
app.use(express.json());

// ==============================
// clients
// ==============================
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

// ==============================
// helpers
// ==============================
function needsWebSearch(text) {
  const triggers = [
    "latest",
    "today",
    "current",
    "news",
    "price",
    "who won",
    "score",
    "weather",
    "stock",
    "match",
  ];

  return triggers.some(t =>
    text.toLowerCase().includes(t)
  );
}

// ==============================
// websocket server
// ==============================
const wss = new WebSocket.Server({ port: 8080 });
console.log("WebSocket server running on ws://localhost:8080");

// ==============================
// session store
// ==============================
const sessions = new Map();

// ==============================
// websocket connection handler
// ==============================
wss.on("connection", (ws) => {
  const session = {
    id: crypto.randomUUID(),
    state: "LISTENING",
    finalTranscript: null,
    context: "You are a helpful voice assistant.",
    dgConnection: null,
  };

  sessions.set(session.id, session);

  console.log(`Client connected: ${session.id}`);
  ws.binaryType = "arraybuffer";

  ws.send(JSON.stringify({
    type: "state",
    value: "LISTENING",
  }));

  // ==============================
  // Deepgram STT (v3)
  // ==============================
  session.dgConnection = deepgram.listen.live({
    model: "nova-2",
    language: "en-US",
    encoding: "linear16",
    sample_rate: 16000,
    interim_results: true,
  });

  session.dgConnection.on("Open", () => {
    console.log("Deepgram STT OPEN");
  });

  session.dgConnection.on("Results", (msg) => {
    const transcript =
      msg.channel?.alternatives?.[0]?.transcript;

    if (!transcript) return;

    if (msg.is_final) {
      session.finalTranscript = transcript;
      console.log("FINAL:", transcript);

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

  session.dgConnection.on("Error", (err) => {
    console.error("Deepgram error:", err);
  });

  // ==============================
  // websocket messages
// ==============================
  ws.on("message", async (data) => {
    // ------------------------------
    // audio frames
    // ------------------------------
    if (typeof data !== "string") {
      if (session.state !== "LISTENING") return;

      console.log(
        "Audio chunk received:",
        data.byteLength
      );

      session.dgConnection.send(Buffer.from(data));
      return;
    }

    const msg = JSON.parse(data);

    // ==============================
    // user finished speaking
    // ==============================
    if (msg.type === "user_stopped") {
      console.log("User stopped speaking");
      session.state = "THINKING";

      ws.send(JSON.stringify({
        type: "state",
        value: "THINKING",
      }));

      // wait briefly for final STT
      setTimeout(async () => {
        if (!session.finalTranscript) return;

        let llmPrompt = `
System Instructions:
${session.context}

User says:
${session.finalTranscript}
`;

        // ==============================
        // Web Search 
        // ==============================
        if (needsWebSearch(session.finalTranscript)) {
          console.log("Web search triggered");

          const results = await webSearch(
            session.finalTranscript
          );

          const context = results
            .map(r =>
              `[${r.id}] ${r.title}\n${r.content}\nSource: ${r.url}`
            )
            .join("\n\n");

          llmPrompt = `
System Instructions:
${session.context}

Web Search Context:
${context}

User says:
${session.finalTranscript}
`;
        }

        // ==============================
        // stream LLM
        // ==============================
        let firstToken = true;

        await streamLLMResponse(llmPrompt, (token) => {
          if (firstToken) {
            firstToken = false;
            session.state = "SPEAKING";

            ws.send(JSON.stringify({
              type: "state",
              value: "SPEAKING",
            }));
          }

          ws.send(JSON.stringify({
            type: "llm_token",
            text: token,
          }));
        });

        ws.send(JSON.stringify({ type: "llm_done" }));

        // reset for next turn
        session.finalTranscript = null;
        session.state = "LISTENING";

        ws.send(JSON.stringify({
          type: "state",
          value: "LISTENING",
        }));
      }, 100);
    }
  });

  // ==============================
  // cleanup
  // ==============================
  ws.on("close", () => {
    console.log(`Client disconnected: ${session.id}`);
    session.dgConnection.finish();
    sessions.delete(session.id);
  });
});

// ==============================

// ==============================
app.post("/admin/context", (req, res) => {
  const { sessionId, context } = req.body;

  if (!sessions.has(sessionId)) {
    return res
      .status(404)
      .json({ error: "Session not found" });
  }

  const session = sessions.get(sessionId);
  session.context = context;

  console.log(
    `Context updated for session ${sessionId}:`,
    context
  );

  res.json({ success: true });
});

// ==============================
// start admin server
// ==============================
app.listen(3000, () => {
  console.log("Admin API running on http://localhost:3000");
});
