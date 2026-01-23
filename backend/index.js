// ==============================
// imports
// ==============================
require("dotenv").config();

const WebSocket = require("ws");
const crypto = require("crypto");
const { createClient } = require("@deepgram/sdk");
const { streamLLMResponse } = require("./llm/groq");
// TEMP: comment TTS until STT works
// const { streamTTS } = require("./tts/deepgram");

// ==============================
// clients
// ==============================
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

// ==============================
// websocket server
// ==============================
const wss = new WebSocket.Server({ port: 8080 });
console.log("WebSocket server running on ws://localhost:8080");

// ==============================
// connection handler
// ==============================
wss.on("connection", (ws) => {
  const session = {
    id: crypto.randomUUID(),
    state: "LISTENING",
    finalTranscript: null,
    dgConnection: null,
  };

  console.log(`Client connected: ${session.id}`);
  ws.binaryType = "arraybuffer";

  ws.send(JSON.stringify({ type: "state", value: "LISTENING" }));

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
  typeof data === "string" ? data.length : data.byteLength
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

  // wait a moment for final transcript
  setTimeout(async () => {
    if (!session.finalTranscript) return;

    let llmPrompt = session.finalTranscript;

    // ==============================
    // web search (Day 7)
    // ==============================
    if (needsWebSearch(session.finalTranscript)) {
      console.log("Web search triggered");

      const results = await webSearch(session.finalTranscript);

      const context = results
        .map(r =>
          `[${r.id}] ${r.title}\n${r.content}\nSource: ${r.url}`
        )
        .join("\n\n");

      llmPrompt = `
Use the following web search results to answer the question.
Cite sources using [number].

${context}

Question:
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

    // go back to listening (TTS comes later)
    session.state = "LISTENING";
    ws.send(JSON.stringify({
      type: "state",
      value: "LISTENING",
    }));
  }, 100);
}

  });

  ws.on("close", () => {
    console.log(`Client disconnected: ${session.id}`);
    session.dgConnection.finish();
  });
});
