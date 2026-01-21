import { useEffect, useRef, useState } from "react";

// ==============================
// utils
// ==============================
function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);

  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    let sample = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(
      offset,
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      true
    );
  }
  return buffer;
}

// ==============================
// component
// ==============================
export default function App() {
  const TURN_END_DELAY = 800;
  const NOISE_THRESHOLD = 0.00015;

  const socketRef = useRef(null);

  // output audio refs
  const outputContextRef = useRef(null);
  const playbackQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const currentSourceRef = useRef(null);

  const [agentState, setAgentState] = useState("LISTENING");
  const [partialText, setPartialText] = useState("");
  const [finalText, setFinalText] = useState("");
  const [assistantText, setAssistantText] = useState("");

  // ==============================
  // init once
  // ==============================
  useEffect(() => {
    let isSpeaking = false;
    let lastSpeechTime = 0;

    async function init() {
      // ------------------------------
      // websocket
      // ------------------------------
      const socket = new WebSocket("ws://localhost:8080");
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      socket.onopen = () => {
        console.log("WebSocket connected");
      };

      socket.onmessage = async (event) => {
        // ------------------------------
        // binary audio = TTS
        // ------------------------------
        if (event.data instanceof ArrayBuffer) {
          playbackQueueRef.current.push(event.data);
          if (!isPlayingRef.current) playAudio();
          return;
        }

        // ------------------------------
        // JSON messages
        // ------------------------------
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

        if (msg.type === "llm_token") {
          setAssistantText((prev) => prev + msg.text);
        }

        if (msg.type === "llm_done") {
          console.log("LLM response complete");
        }
      };

      // ------------------------------
      // microphone
      // ------------------------------
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("Audio permission granted");

      const audioContext = new AudioContext({ sampleRate: 16000 });
      console.log("AudioContext sample rate:", audioContext.sampleRate);

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      source.connect(processor);
      processor.connect(audioContext.destination);

      processor.onaudioprocess = (event) => {
        const now = performance.now();

        // detecting silence
        if (isSpeaking && now - lastSpeechTime > TURN_END_DELAY) {
          isSpeaking = false;
          socketRef.current.send(JSON.stringify({ type: "user_stopped" }));
          return;
        }

        if (
          socketRef.current.readyState !== WebSocket.OPEN ||
          agentState !== "LISTENING"
        ) {
          return;
        }

        const input = event.inputBuffer.getChannelData(0);

        let sum = 0;
        for (let i = 0; i < input.length; i++) {
          sum += Math.abs(input[i]);
        }
        const energy = sum / input.length;

        if (energy < NOISE_THRESHOLD) return;

        if (!isSpeaking) {
          isSpeaking = true;

          // barge-in
          if (agentState === "SPEAKING") {
            stopPlayback();
            socketRef.current.send(JSON.stringify({ type: "barge_in" }));
          }
        }

        lastSpeechTime = now;

        const pcmBuffer = floatTo16BitPCM(input);
        socketRef.current.send(pcmBuffer);
      };

      // ------------------------------
      // output audio context
      // ------------------------------
      outputContextRef.current = new AudioContext({ sampleRate: 16000 });
    }

    init();
  }, []);

  // ==============================
  // audio playback (PCM)
  // ==============================
  async function playAudio() {
    isPlayingRef.current = true;

    while (playbackQueueRef.current.length > 0) {
      const pcmBuffer = playbackQueueRef.current.shift();

      const int16 = new Int16Array(pcmBuffer);
      const audioBuffer =
        outputContextRef.current.createBuffer(
          1,
          int16.length,
          16000
        );

      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < int16.length; i++) {
        channelData[i] = int16[i] / 32768;
      }

      const source =
        outputContextRef.current.createBufferSource();
      currentSourceRef.current = source;

      source.buffer = audioBuffer;
      source.connect(outputContextRef.current.destination);

      await new Promise((res) => {
        source.onended = res;
        source.start();
      });
    }

    isPlayingRef.current = false;
  }

  // ==============================
  // stop playback (barge-in)
  // ==============================
  function stopPlayback() {
    playbackQueueRef.current.length = 0;
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch {}
    }
    isPlayingRef.current = false;
  }

  // ==============================
  // UI
  // ==============================
  return (
    <div>
      <h1>Voice Assistant</h1>
      <h2>Agent state: {agentState}</h2>

      <p><strong>Live:</strong> {partialText}</p>
      <p><strong>Final:</strong> {finalText}</p>
      <p><strong>Assistant:</strong> {assistantText}</p>
    </div>
  );
}
