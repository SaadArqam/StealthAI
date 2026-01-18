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

const wss = new WebSocket.Server({ port: 8080 });
console.log("WebSocket server running on ws://localhost:8080");

wss.on("connection", (ws) => {
  const session = {
    id: crypto.randomUUID(),
    state: "LISTENING",
    audioChunks: []
  };

  console.log(`Client connected: ${session.id}`);

  ws.binaryType = "arraybuffer";

  // Send initial state
  ws.send(JSON.stringify({
    type: "state",
    value: session.state
  }));

  ws.on("message", (data) => {
    // Binary = audio
    if (typeof data !== "string") {
      if (session.state !== "LISTENING") return;
      session.audioChunks.push(data);
      return;
    }

    // JSON = control
    const msg = JSON.parse(data);

    if (msg.type === "user_stopped") {
      session.state = "THINKING";
      ws.send(JSON.stringify({ type: "state", value: "THINKING" }));
    }

    if (msg.type === "barge_in") {
      session.state = "LISTENING";
      session.audioChunks = [];
      ws.send(JSON.stringify({ type: "state", value: "LISTENING" }));
    }
  });

  ws.on("close", () => {
    console.log(`Client disconnected: ${session.id}`);
  });
});
