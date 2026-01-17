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
  const sessionId = crypto.randomUUID();

  console.log(`Client connected: ${sessionId}`);

  ws.binaryType = "arraybuffer";

  ws.on("message", (data) => {
    const size = data.byteLength ?? data.length;

    console.log(
      `Session ${sessionId} | audio chunk bytes: ${size}`
    );
  });

  ws.on("close", () => {
    console.log(`Client disconnected: ${sessionId}`);
  });
});

