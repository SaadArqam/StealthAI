const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const WebSocket = require("ws");
const crypto = require("crypto");
const { createClient } = require("@deepgram/sdk");
const { streamLLMResponse } = require("./llm/groq");
const { webSearch } = require("./tools/webSearch");
const { streamTTS } = require("./tts/deepgram");


const { streamLLMWithFallback } = require("./llm/llmWithFallback");
const { getEmbedding } = require("./llm/embeddings");
const {
  getCachedResponse,
  storeCachedResponse,
} = require("./cache/semanticCache");


const app = express();
app.use(express.json());


let deepgram = null;
if (process.env.DEEPGRAM_API_KEY) {
  try {
    deepgram = createClient(process.env.DEEPGRAM_API_KEY);
  } catch (err) {
    console.warn("Failed to initialize Deepgram client:", err.message);
    deepgram = null;
  }
} else {
  console.warn("DEEPGRAM_API_KEY not set — STT will be disabled (mock mode).");
}


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


// websocket server
const PORT1=process.env.PORT1||8080
const wss = new WebSocket.Server({ port: PORT1 });
console.log("WebSocket server running on ws://localhost:PORT1");

// Debug: log presence of important env keys (don't print values)
console.log("ENV: DEEPGRAM=", !!process.env.DEEPGRAM_API_KEY, "GROQ=", !!process.env.GROQ_API_KEY, "OPENAI=", !!process.env.OPENAI_API_KEY, "TAVILY=", !!process.env.TAVILY_API_KEY);


// session store

const sessions = new Map();


// websocket connection handler

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

  
  // Deepgram STT (v3) — if no Deepgram key, provide a mock connection
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
        session.metrics.sttFinal = Date.now();

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
    // Minimal mock dgConnection for local testing. It will accept .send() and .finish().
    session.dgConnection = {
      send: () => {},
      finish: () => {},
      on: () => {},
    };
  }

  
  // websocket messages
  
  ws.on("message", async (data) => {

    // The message may arrive as string or as a Buffer/ArrayBuffer.
    // Try to handle both: if it's textual JSON, parse it; otherwise treat as binary audio.
    let isText = typeof data === "string";
    let textData = null;

    if (!isText) {
      // Buffer (Node) or ArrayBuffer (ws in browser)
      try {
        if (data instanceof Buffer) {
          // Node Buffer
          const maybeText = data.toString("utf8");
          // crude check for JSON control
          if (maybeText.trim().startsWith("{")) {
            isText = true;
            textData = maybeText;
          }
        } else if (data instanceof ArrayBuffer) {
          const nodeBuf = Buffer.from(data);
          const maybeText = nodeBuf.toString("utf8");
          if (maybeText.trim().startsWith("{")) {
            isText = true;
            textData = maybeText;
          }
        }
      } catch (err) {
        // fall-through to treat as binary
      }
    }

    if (!isText) {
      try {
        const len = data.byteLength || data.length || 0;
        console.log(`Received binary audio chunk (${len} bytes) for session ${session.id}`);
      } catch {}

      if (session.state !== "LISTENING") return;
      session.dgConnection.send(Buffer.from(data));
      return;
    }

    // parse text JSON control message
    const msg = JSON.parse(isText && textData ? textData : data);
    console.log(`Received control message for session ${session.id}:`, msg.type);

    

    
    if (msg.type === "barge_in") {
      console.log("BARGE-IN");

      session.state = "LISTENING";
      session.finalTranscript = null;

      ws.send(JSON.stringify({
        type: "state",
        value: "LISTENING",
      }));

      return;
    }

    
    // user finished speaking
    
    if (msg.type === "user_stopped") {
      session.metrics.vadEnd = Date.now();
      session.state = "THINKING";

      ws.send(JSON.stringify({
        type: "state",
        value: "THINKING",
      }));

      setTimeout(async () => {
        if (!session.finalTranscript) {
          // If STT hasn't produced a final transcript (e.g. Deepgram not configured),
          // send a short canned response so the frontend shows the assistant flow.
          session.state = "SPEAKING";
          ws.send(JSON.stringify({ type: "state", value: "SPEAKING" }));

          ws.send(JSON.stringify({ type: "llm_token", text: "Sorry, I didn't catch that. Could you repeat?" }));
          ws.send(JSON.stringify({ type: "llm_done" }));

          session.state = "LISTENING";
          ws.send(JSON.stringify({ type: "state", value: "LISTENING" }));

          return;
        }

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

        
        // stream LLM
        
        // ==============================
        // Day 11: semantic cache
        // ==============================
        // const embedding = await getEmbedding(session.finalTranscript);
        // const cached = getCachedResponse(embedding);

        // if (cached) {
        //   console.log("CACHE HIT");

        //   session.state = "SPEAKING";
        //   ws.send(JSON.stringify({
        //     type: "state",
        //     value: "SPEAKING",
        //   }));

        //   ws.send(JSON.stringify({
        //     type: "llm_token",
        //     text: cached,
        //   }));

        //   ws.send(JSON.stringify({ type: "llm_done" }));

        //   session.state = "LISTENING";
        //   ws.send(JSON.stringify({
        //     type: "state",
        //     value: "LISTENING",
        //   }));

        //   return;
        // }

        let assistantText = "";
        let firstToken = true;

        session.metrics.llmStart = Date.now();

        await streamLLMWithFallback(llmPrompt, (token) => {
          if (firstToken) {
            firstToken = false;
            session.metrics.llmFirstToken = Date.now();

            session.state = "SPEAKING";
            ws.send(JSON.stringify({
              type: "state",
              value: "SPEAKING",
            }));
          }

          assistantText += token;

          ws.send(JSON.stringify({
            type: "llm_token",
            text: token,
          }));
        });

        session.metrics.llmEnd = Date.now();
        ws.send(JSON.stringify({ type: "llm_done" }));

        // storeCachedResponse(embedding, assistantText);

        
        // stream TTS audio
        
  await streamTTS(assistantText, (audioChunk) => {
    ws.send(audioChunk);
  });


        
        // reset
        
        session.finalTranscript = null;
        session.state = "LISTENING";

        ws.send(JSON.stringify({
          type: "state",
          value: "LISTENING",
        }));
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


// start admin server
PORT=process.env.PORT||3000

app.listen(PORT, () => {
  console.log("Admin API running on http://localhost:3000");
});
