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

const deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY);

const wss = new WebSocket.Server({ port: 8080 });
console.log("WebSocket server running on ws://localhost:8080");

wss.on("connection", (ws) => {
  const session = {
    id: crypto.randomUUID(),
    state: "LISTENING",
    turnEndTime: null,
    dgConnection: null,
  };

  console.log(`Client connected: ${session.id}`);

  ws.binaryType = "arraybuffer";

// Deepgram stream
  session.dgConnection = deepgram.transcription.live({
    model: "nova-2",
    language: "en-US",
    encoding: "linear16",
    sample_rate: 16000,
    interim_results: true,
  });

  session.dgConnection.on("transcriptReceived", (msg) => {
    const transcript =
      msg.channel.alternatives[0]?.transcript;

    if (!transcript) return;

    if (msg.is_final) {
      const latency =
        session.turnEndTime
          ? Date.now() - session.turnEndTime
          : null;

      console.log(
        `STT final transcript (latency ms):`,
        latency
      );

      ws.send(
        JSON.stringify({
          type: "transcript_final",
          text: transcript,
        })
      );
    } else {
      ws.send(
        JSON.stringify({
          type: "transcript_partial",
          text: transcript,
        })
      );
    }
  });


  ws.send(
    JSON.stringify({
      type: "state",
      value: session.state,
    })
  );

// WebSocket
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
        })
      );

      session.dgConnection.finish();
      console.log(`Session ${session.id} turn ended`);
    }

    if (msg.type === "barge_in") {
      session.state = "LISTENING";

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
        })
      );
    }
  });

  ws.on("close", () => {
    console.log(`Client disconnected: ${session.id}`);
    session.dgConnection.finish();
  });
});
