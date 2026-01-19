import { useEffect, useRef, useState } from "react";

function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);

  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    let sample = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

export default function App() {
  const TURN_END_DELAY = 800;
  const NOISE_THRESHOLD = 0.00015;
  const socketRef = useRef(null);
  const [agentState, setAgentState] = useState("LISTENING");
  const[partialText,setPartialText]=useState("")
  const[finalText,setFinalText]=useState("")

  useEffect(() => {
    async function init() {
      // Websocket
      const socket = new WebSocket("ws://localhost:8080");
      socketRef.current = socket;

      socket.onopen = () => {
        console.log("WebSocket connected");
      };

      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;

        const msg = JSON.parse(event.data);
        if (msg.type === "state") {
          setAgentState(msg.value);
        }
        if (msg.type === "transcript_partial") {
          setPartialText(msg.text);
        }

        if (msg.type === "transcript_final") {
          setFinalText((prev) => prev + " " + msg.text);
          setPartialText("");
        }

      };

      // Mic
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("Audio permission granted");

      const audioContext = new AudioContext({ sampleRate: 16000 });
      console.log("AudioContext sample rate:", audioContext.sampleRate);

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      source.connect(processor);
      processor.connect(audioContext.destination);

      let isSpeaking = false;
      let lastSpeechTime = 0;

      processor.onaudioprocess = (event) => {
        // speech detection logic
        const now = performance.now();

        // detecting silence
        if (isSpeaking && now - lastSpeechTime > TURN_END_DELAY) {
          console.log("User finished speaking");

          isSpeaking = false;

          // notify backend
          socketRef.current.send(JSON.stringify({ type: "user_stopped" }));
          return;
        }

        if (
          socketRef.current?.readyState !== WebSocket.OPEN ||
          agentState !== "LISTENING"
        ) {
          return;
        }

        const input = event.inputBuffer.getChannelData(0);

        // Energy (for later VAD)
        let sum = 0;
        for (let i = 0; i < input.length; i++) {
          sum += Math.abs(input[i]);
        }
        const energy = sum / input.length;
        console.log("Energy:", energy);

        if (energy < NOISE_THRESHOLD) {
          return; // noise / silence
        }

        if (!isSpeaking) {
          isSpeaking = true;
          console.log("Speaking Started");
        }

        lastSpeechTime = now;

        const pcmBuffer = floatTo16BitPCM(input);
        socketRef.current.send(pcmBuffer);
      };
    }

    init();
  }, []);

  return (
    <div>
      <h1>Voice Assistant</h1>
      <h2>Agent state: {agentState}</h2>
      <p><strong>Live:</strong> {partialText}</p>
      <p><strong>Final:</strong> {finalText}</p>

    </div>
  );
}
