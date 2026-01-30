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
  const TURN_END_DELAY = 500;
  const NOISE_THRESHOLD = 0.0006;

  const socketRef = useRef(null);
  const agentStateRef = useRef("LISTENING");
  const turnIdRef = useRef(null);

  const outputContextRef = useRef(null);
  const playbackQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const currentSourceRef = useRef(null);

  const [agentState, setAgentState] = useState("LISTENING");
  const [partialText, setPartialText] = useState("");
  const [messages, setMessages] = useState([]);


  async function playAudio() {
    if (!outputContextRef.current) return;
    if (outputContextRef.current.state === "suspended") {
      await outputContextRef.current.resume();
    }

    isPlayingRef.current = true;

    while (playbackQueueRef.current.length > 0) {
      const pcmBuffer = playbackQueueRef.current.shift();
      const int16 = new Int16Array(pcmBuffer);

      const audioBuffer = outputContextRef.current.createBuffer(
        1,
        int16.length,
        16000,
      );

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
      } catch (err){
        throw new Error(err)
      }
    }
    isPlayingRef.current = false;
  }

  useEffect(() => {
    let isSpeaking = false;
    let lastSpeechTime = 0;
    let reconnectAttempts = 0;
    let reconnectTimer = null;

    function scheduleReconnect() {
      reconnectAttempts += 1;
      const backoff = Math.min(30000, 500 * Math.pow(2, reconnectAttempts));
      console.warn(`WS: scheduling reconnect in ${backoff}ms (attempt ${reconnectAttempts})`);
      reconnectTimer = setTimeout(() => {
        initSocket();
      }, backoff);
    }

    function clearReconnect() {
      reconnectAttempts = 0;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }


    const envUrl = import.meta.env.VITE_WS_URL;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.hostname;
    const portPart = window.location.port ? ":" + window.location.port : "";
    const defaultUrl = `${proto}//${host}${portPart}`;

    async function init() {
      // audio + mic setup

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

          try { socketRef.current.send(JSON.stringify({ type: "user_stopped", id: turnIdRef.current })); } catch (e) { void e; }
          turnIdRef.current = null;
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

          try {
            turnIdRef.current = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
          } catch {
            turnIdRef.current = String(Date.now());
          }

          try { socketRef.current.send(JSON.stringify({ type: "turn_start", id: turnIdRef.current })); } catch (e) { void e; }

          if (agentStateRef.current === "SPEAKING") {
            stopPlayback();
            try { socketRef.current.send(JSON.stringify({ type: "barge_in", id: turnIdRef.current })); } catch (e) { void e; }
          }
        }

        lastSpeechTime = now;
        socketRef.current.send(floatTo16BitPCM(input));
      };

      outputContextRef.current = new AudioContext({ sampleRate: 16000 });


      initSocket();
    }

    function initSocket() {
      const socket = new WebSocket(import.meta.env.PROD ? (envUrl || defaultUrl) : "ws://localhost:3000");
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      socket.onopen = () => {
        console.log("WebSocket connected");
        clearReconnect();
      };

      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          playbackQueueRef.current.push(event.data);
          if (!isPlayingRef.current) playAudio();
          return;
        }

        let parsed = null;
        try {
          parsed = JSON.parse(event.data);
        } catch (err) {
          console.warn("WS: failed to parse message as JSON:", err, event.data);
          return;
        }

        const msg = parsed;

        if (msg.type === "state") {
          agentStateRef.current = msg.value;
          setAgentState(msg.value);
        }

        if (msg.type === "transcript_partial") {
          setPartialText(msg.text);
        }

        if (msg.type === "transcript_final") {
          setMessages((prev) => [...prev, { role: "user", text: msg.text }]);
          setPartialText("");
        }

        if (msg.type === "llm_started") {

          console.debug("LLM started on server at", new Date(msg.ts).toISOString());
        }

        if (msg.type === "llm_token") {

          try {
            if (msg.ts) {
              const latencyMs = Date.now() - msg.ts;
              console.debug(`llm_token idx=${msg.index} latency=${latencyMs}ms`, msg.text);
            }
          } catch (e) { void e; }


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

      socket.onerror = (err) => {
        console.error("WebSocket error:", err);
      };

      socket.onclose = (ev) => {
        console.warn("WebSocket closed", ev.code, ev.reason, ev.wasClean);

        scheduleReconnect();
      };
    }

    init();

    return () => {

      clearReconnect();
      try {
        socketRef.current?.close();
      } catch (e) {

        void e;
      }
    };
  }, []);
  

  return (
  <div className="app">
    <header className="header">
      <h1>Voice Assistant</h1>
      <span className={`state ${agentState.toLowerCase()}`}>
        {agentState}
      </span>
    </header>

    <main className="chat-wrapper">
      {messages.length === 0 && (
        <div className="empty-state">
          <div className={`alexa-sphere ${agentState.toLowerCase()}`}>
  <div className="ring ring-1" />
  <div className="ring ring-2" />
  <div className="ring ring-3" />
</div>

          {agentState === "LISTENING" && (
            <p>🎙️ Speak your thoughts…</p>
          )}
          {agentState === "THINKING" && (
            <p>🤔 Thinking…</p>
          )}
          {agentState === "SPEAKING" && (
            <p>🔊 Responding…</p>
          )}
        </div>
      )}

      <div className="chat">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`bubble ${m.role === "user" ? "user" : "assistant"}`}
          >
            {m.text}
          </div>
        ))}

        {partialText && (
          <div className="bubble user partial">{partialText}</div>
        )}
      </div>
    </main>
  </div>
);

}

