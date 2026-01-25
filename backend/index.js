require("dotenv").config();

const express = require("express");
const WebSocket = require("ws");
const crypto = require("crypto");
const { createClient } = require("@deepgram/sdk");
const { streamLLMResponse } = require("./llm/groq");
const { webSearch } = require("./tools/webSearch");


const app = express();
app.use(express.json());


const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

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

  return triggers.some(t => text.toLowerCase().includes(t));
}


// websocket server
const wss = new WebSocket.Server({ port: 8080 });
console.log("WebSocket server running on ws://localhost:8080");


const sessions = new Map();

wss.on("connection", (ws) => {
  const session = {
    id: crypto.randomUUID(),
    state: "LISTENING",
    finalTranscript: null,
    context: "You are a helpful voice assistant.",
    dgConnection: null,
    metrics: {
      vadEnd: null,
      sttFinal: null,
      llmStart: null,
      llmFirstToken: null,
      llmEnd: null,
    },
  };

  sessions.set(session.id, session);

  console.log(`Client connected: ${session.id}`);
  ws.binaryType = "arraybuffer";

  ws.send(JSON.stringify({ type: "state", value: "LISTENING" }));


  // Deepgram STT (v3)
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
    const transcript = msg.channel?.alternatives?.[0]?.transcript;
    if (!transcript) return;

    if (msg.is_final) {
      session.finalTranscript = transcript;
      session.metrics.sttFinal = Date.now();

      console.log(JSON.stringify({
        event: "stt_final",
        sessionId: session.id,
        sttLatencyMs:
          session.metrics.sttFinal - session.metrics.vadEnd,
      }));

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


  ws.on("message", async (data) => {
    // audio frames
    if (typeof data !== "string") {
      if (session.state !== "LISTENING") return;

      session.dgConnection.send(Buffer.from(data));
      return;
    }

    const msg = JSON.parse(data);


    // user finished speaking

    if (msg.type === "user_stopped") {
      session.metrics.vadEnd = Date.now();
      session.state = "THINKING";

      ws.send(JSON.stringify({ type: "state", value: "THINKING" }));


      setTimeout(async () => {
        if (!session.finalTranscript) return;

        let llmPrompt = `
System Instructions:
${session.context}

User says:
${session.finalTranscript}
`;


        // web search
        if (needsWebSearch(session.finalTranscript)) {
          const results = await webSearch(session.finalTranscript);

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

        // stream LLM (metrics)
        session.metrics.llmStart = Date.now();
        let firstToken = true;

        await streamLLMResponse(llmPrompt, (token) => {
          if (firstToken) {
            firstToken = false;
            session.metrics.llmFirstToken = Date.now();

            console.log(JSON.stringify({
              event: "llm_ttft",
              sessionId: session.id,
              ttftMs:
                session.metrics.llmFirstToken -
                session.metrics.llmStart,
            }));

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

        session.metrics.llmEnd = Date.now();

        console.log(JSON.stringify({
          event: "llm_complete",
          sessionId: session.id,
          llmTotalMs:
            session.metrics.llmEnd -
            session.metrics.llmStart,
        }));

        const e2eLatency =
          session.metrics.llmEnd -
          session.metrics.vadEnd;

        console.log(JSON.stringify({
          event: "turn_complete",
          sessionId: session.id,
          e2eLatencyMs: e2eLatency,
        }));

        ws.send(JSON.stringify({ type: "llm_done" }));

        // reset for next turn
        session.finalTranscript = null;
        session.state = "LISTENING";
        ws.send(JSON.stringify({ type: "state", value: "LISTENING" }));
      }, 100);
    }
  });


  // cleanup
  ws.on("close", () => {
    session.dgConnection.finish();
    sessions.delete(session.id);
    console.log(`Client disconnected: ${session.id}`);
  });
});

// admin API 
app.post("/admin/context", (req, res) => {
  const { sessionId, context } = req.body;

  if (!sessions.has(sessionId)) {
    return res.status(404).json({ error: "Session not found" });
  }

  sessions.get(sessionId).context = context;
  res.json({ success: true });
});

// metrics API 
app.get("/metrics", (req, res) => {
  const out = [];
  sessions.forEach((s) => {
    out.push({
      sessionId: s.id,
      state: s.state,
      metrics: s.metrics,
    });
  });
  res.json(out);
});


app.listen(3000, () => {
  console.log("Admin API running on http://localhost:3000");
});
