# Low-Latency Real-Time Voice Assistant

A production-ready, low-latency, multi-user voice assistant that supports
natural, interruptible conversations with real-time speech processing,
LLM reasoning, web search, dynamic context updates, and observability.

This project was built as part of a frontend-focused systems assignment,
with emphasis on performance, scalability, and engineering judgment.

---

## ✨ Features

- 🎙️ Real-time audio streaming (browser → backend)
- 🔊 Custom Voice Activity Detection (VAD) & turn detection
- 🧠 Streaming LLM responses (token-by-token)
- 🗣️ Streaming Text-to-Speech (TTS)
- ✋ Barge-in support (interrupt the assistant mid-speech)
- 🌐 Real-time web search integration
- 🧩 Dynamic context updates during active sessions
- 👥 Multi-user concurrent WebSocket sessions
- 📊 Observability: STT, LLM, TTFT, E2E latency metrics
- ⚡ Semantic caching + LLM provider fallback
- 🧾 Structured JSON logging

---

## 🏗️ Architecture Overview

### Voice Pipeline (Cascade)

User Mic

↓

Noise Filtering + Energy Detection

↓

VAD + Turn Detection

↓

WebSocket Audio Stream

↓

Speech-to-Text (Deepgram)

↓

LLM + Tools (Groq + Web Search)

↓

Text-to-Speech (Deepgram)

↓

Streaming Audio to Browser


### System Components

- **Frontend**: React + Web Audio API
- **Transport**: WebSocket (binary PCM audio)
- **STT**: Deepgram (streaming)
- **LLM**: Groq (with fallback support)
- **TTS**: Deepgram (PCM streaming)
- **Search**: External search API
- **State**: In-memory session store
- **Observability**: Custom latency instrumentation

---

## 🧠 Custom Audio Processing

### Voice Activity Detection (VAD)
- Energy-based detection on raw PCM frames
- Noise thresholding to avoid false triggers
- Adaptive silence detection for turn end

### Turn Detection
- Uses last-speech timestamp + delay window
- Balances responsiveness vs natural pauses
- Explicit `user_stopped` signal to backend

---

## 👥 Multi-User Architecture

- Each WebSocket connection = isolated session
- No per-user heavy processes
- Shared providers, isolated state
- Scales linearly with WebSocket connections

**Scalability considerations**:
- 10 users → single instance
- 100 users → horizontal scaling
- 1000+ users → Redis + load balancer

---

## 🌐 Web Search Integration

- Detects when queries require external knowledge
- Fetches fresh results dynamically
- Injects sources into LLM prompt
- Enables citation-aware answers

---

## 🔄 Real-Time Context Updates

Context can be updated **while a session is active**.

### API
```
POST /admin/context

{
"sessionId": "<id>",
"context": "You are a travel assistant."
}
```

The new context is applied immediately to the next user turn
without restarting the session.

---

## ⚡ Performance Targets (Measured)

| Metric | Typical Result |
|-----|-----|
| First audio response | ~700–1200ms |
| LLM TTFT | ~150–300ms |
| Barge-in reaction | <500ms |
| STT final latency | ~300–500ms |

---

## 📊 Observability

### Metrics Tracked
- VAD end time
- STT final time
- LLM start / TTFT / end
- End-to-end latency

### Metrics Endpoint
- GET /metrics


Returns live per-session metrics for debugging and analysis.

---

## 🔁 Provider Fallback & Caching

### Semantic Cache
- Embedding-based similarity matching
- TTL-based freshness
- Reduces repeated LLM calls

### Provider Fallback
- Primary LLM: Groq
- Automatic fallback on failure
- Transparent to the user

---

## 🚀 Getting Started

### Prerequisites
- Node.js ≥ 18
- npm
- Browser with Web Audio API support

### Installation

```bash
git clone <repo-url>
cd backend
npm install
```

## Environment Variables
```
Create .env:

DEEPGRAM_API_KEY=your_key_here
GROQ_API_KEY=your_key_here
CARTESIA_API_KEY=your_key_here
TAVILY_API_KEY=your_key_here
OPENAI_API_KEY=optional_fallback
```

## Run Backend
```
cd backend
npm start
```

## Run Frontend
```
cd frontend
npm install
npm run dev
```

## 🧪 Demo Instructions

1. Open the frontend in the browser  
2. Speak naturally into the microphone  
3. Observe live speech-to-text transcripts  
4. Interrupt the assistant mid-speech (barge-in)  
5. Ask a current-events question (news, score, weather, etc.)  
6. Update the assistant context via the admin API  
7. Check live metrics at the `/metrics` endpoint  

---

## 🧠 Tradeoffs & Future Work

### Tradeoffs

- In-memory session state instead of Redis
- Energy-based VAD instead of ML-based VAD
- Single-region deployment

### Future Improvements

- Replace `ScriptProcessorNode` with `AudioWorkletNode`
- Redis-backed session and cache store
- UI-based observability dashboard
- Multilingual speech and text support

