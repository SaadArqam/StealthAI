// const express=require('express');
// const app=express()
// const WebSocket=require('ws');

// app.use(express.json())

// const wss = new WebSocket.Server({ port: 8080 });
// wss.on("connection", (ws) => {
//   console.log("Client connected");

//   ws.on("message", (data) => {
//     console.log("Received message size:", data.length);
//   });
// });

// app.listen(3000,()=>{
//     console.log("server running")
// })
const WebSocket = require("ws");
const crypto = require("crypto");
const { Deepgram } = require("@deepgram/sdk");
const { streamLLMResponse } = require("./llm/groq");
const { streamTTS } = require("./tts/cartesia");


const deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY);

// websocket server
const wss = new WebSocket.Server({ port: 8080 });
console.log("WebSocket server running on ws://localhost:8080");

wss.on("connection", (ws) => {
  const session = {
    id: crypto.randomUUID(),
    state: "LISTENING",
    turnEndTime: null,
    finalTranscript: null,
    dgConnection: null,
  };

  console.log(`Client connected: ${session.id}`);
  ws.binaryType = "arraybuffer";

  ws.send(
    JSON.stringify({
      type: "state",
      value: session.state,
    }),
  );

  // Deepgram streaming STT
  session.dgConnection = deepgram.transcription.live({
    model: "nova-2",
    language: "en-US",
    encoding: "linear16",
    sample_rate: 16000,
    interim_results: true,
  });

  session.dgConnection.on("transcriptReceived", (msg) => {
    const transcript = msg.channel.alternatives[0]?.transcript;

    if (!transcript) return;

    // final transcript
    if (msg.is_final) {
      const latency = session.turnEndTime
        ? Date.now() - session.turnEndTime
        : null;

      console.log(`STT final transcript (latency ms):`, latency);

      session.finalTranscript = transcript;

      ws.send(
        JSON.stringify({
          type: "transcript_final",
          text: transcript,
        }),
      );
    }
    // partial transcript
    else {
      ws.send(
        JSON.stringify({
          type: "transcript_partial",
          text: transcript,
        }),
      );
    }
  });

  ws.on("message", (data) => {
    if (typeof data !== "string") {
      if (session.state !== "LISTENING") return;

      session.dgConnection.send(Buffer.from(data));
      return;
    }

    const msg = JSON.parse(data);

    if (msg.type === "user_stopped") {
      if (session.state !== "LISTENING") return;

      session.state = "THINKING";
      session.turnEndTime = Date.now();

      ws.send(
        JSON.stringify({
          type: "state",
          value: "THINKING",
        }),
      );

      console.log(`Session ${session.id} turn ended`);

      // flush Deepgram to get final transcript
      session.dgConnection.finish();

      setTimeout(async () => {
        if (!session.finalTranscript) return;

        const llmStartTime = Date.now();
        let firstTokenTime = null;

        // stream LLM tokens
        await streamLLMResponse(session.finalTranscript, (token) => {
          // first token → SPEAKING
          if (!firstTokenTime) {
            firstTokenTime = Date.now();
            console.log("LLM TTFT (ms):", firstTokenTime - llmStartTime);

            session.state = "SPEAKING";
            ws.send(
              JSON.stringify({
                type: "state",
                value: "SPEAKING",
              }),
            );
          }

          ws.send(
            JSON.stringify({
              type: "llm_token",
              text: token,
            }),
          );
        });

        ws.send(
          JSON.stringify({
            type: "llm_done",
          }),
        );
      }, 50);
    }

    // ==============================
// start TTS
// ==============================
let fullAssistantText = "";

await streamLLMResponse(session.finalTranscript, (token) => {
  fullAssistantText += token;

  ws.send(JSON.stringify({
    type: "llm_token",
    text: token,
  }));
});

// tell frontend speaking is starting
ws.send(JSON.stringify({
  type: "state",
  value: "SPEAKING",
}));

// stream audio
await streamTTS(fullAssistantText, (audioChunk) => {
  ws.send(audioChunk);
});

// done speaking
session.state = "LISTENING";
ws.send(JSON.stringify({
  type: "state",
  value: "LISTENING",
}));


    if (msg.type === "barge_in") {
      session.state = "LISTENING";
      session.finalTranscript = null;

      session.dgConnection.finish();
      session.dgConnection = deepgram.transcription.live({
        model: "nova-2",
        language: "en-US",
        encoding: "linear16",
        sample_rate: 16000,
        interim_results: true,
      });

      ws.send(
        JSON.stringify({
          type: "state",
          value: "LISTENING",
        }),
      );
    }
  });

  ws.on("close", () => {
    console.log(`Client disconnected: ${session.id}`);
    session.dgConnection.finish();
  });
});
