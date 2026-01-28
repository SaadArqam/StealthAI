import { useEffect, useRef, useState } from "react";

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

export default function App() {
  const TURN_END_DELAY = 800;
  const NOISE_THRESHOLD = 0.0002;

  const socketRef = useRef(null);
  const agentStateRef = useRef("LISTENING");

  const outputContextRef = useRef(null);
  const playbackQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const currentSourceRef = useRef(null);

  const [agentState, setAgentState] = useState("LISTENING");
  const [partialText, setPartialText] = useState("");
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    let isSpeaking = false;
    let lastSpeechTime = 0;

    async function init() {
      const socket = new WebSocket("ws://localhost:8080");
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      socket.onopen = () => {
        console.log("WebSocket connected");
      };

      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          playbackQueueRef.current.push(event.data);
          if (!isPlayingRef.current) playAudio();
          return;
        }

        const msg = JSON.parse(event.data);

        if (msg.type === "state") {
          agentStateRef.current = msg.value;
          setAgentState(msg.value);
        }

        if (msg.type === "transcript_partial") {
          setPartialText(msg.text);
        }

        if (msg.type === "transcript_final") {
          setMessages((prev) => [
            ...prev,
            { role: "user", text: msg.text },
          ]);
          setPartialText("");
        }

        if (msg.type === "llm_token") {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant") {
              return [
                ...prev.slice(0, -1),
                { role: "assistant", text: last.text + msg.text },
              ];
            }
            return [...prev, { role: "assistant", text: msg.text }];
          });
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext({ sampleRate: 16000 });

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      source.connect(processor);
      processor.connect(audioContext.destination);

      processor.onaudioprocess = (event) => {
        const now = performance.now();

        if (isSpeaking && now - lastSpeechTime > TURN_END_DELAY * 2) {
          isSpeaking = false;
          socketRef.current.send(JSON.stringify({ type: "user_stopped" }));
          return;
        }

        if (
          socketRef.current.readyState !== WebSocket.OPEN ||
          agentStateRef.current !== "LISTENING"
        ) {
          return;
        }

        const input = event.inputBuffer.getChannelData(0);

        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += Math.abs(input[i]);
        const energy = sum / input.length;
        if (energy < NOISE_THRESHOLD) return;

        if (!isSpeaking) {
          isSpeaking = true;
          if (agentStateRef.current === "SPEAKING") {
            stopPlayback();
            socketRef.current.send(JSON.stringify({ type: "barge_in" }));
          }
        }

        lastSpeechTime = now;
        socketRef.current.send(floatTo16BitPCM(input));
      };

      outputContextRef.current = new AudioContext({ sampleRate: 16000 });
    }

    init();
  }, []);

  async function playAudio() {
    if (outputContextRef.current.state === "suspended") {
      await outputContextRef.current.resume();
    }

    isPlayingRef.current = true;

    while (playbackQueueRef.current.length > 0) {
      const pcmBuffer = playbackQueueRef.current.shift();
      const int16 = new Int16Array(pcmBuffer);

      const audioBuffer =
        outputContextRef.current.createBuffer(1, int16.length, 16000);

      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < int16.length; i++) {
        channelData[i] = int16[i] / 32768;
      }

      const source = outputContextRef.current.createBufferSource();
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

  function stopPlayback() {
    playbackQueueRef.current.length = 0;
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch {}
    }
    isPlayingRef.current = false;
  }

  return (
    <div style={styles.container}>
      <h1>Voice Assistant</h1>
      <p style={styles.state}>Agent state: {agentState}</p>

      <div style={styles.chat}>
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              ...styles.message,
              ...(m.role === "user"
                ? styles.user
                : styles.assistant),
            }}
          >
            {m.text}
          </div>
        ))}

        {partialText && (
          <div style={{ ...styles.message, ...styles.user, opacity: 0.6 }}>
            {partialText}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    background: "#0f0f0f",
    minHeight: "100vh",
    color: "#fff",
    padding: "20px",
    fontFamily: "system-ui, sans-serif",
  },
  state: {
    color: "#aaa",
    marginBottom: "16px",
  },
  chat: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    maxWidth: "900px",
  },
  message: {
    padding: "12px 16px",
    borderRadius: "14px",
    maxWidth: "70%",
    lineHeight: "1.4",
    whiteSpace: "pre-wrap",
  },
  user: {
    alignSelf: "flex-start",
    background: "#1e1e1e",
  },
  assistant: {
    alignSelf: "flex-end",
    background: "#2b6cff",
  },
};
