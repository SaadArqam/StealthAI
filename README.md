# StealthAI

# 🎙️ Real-Time Voice Assistant (In Progress)

A low-latency, real-time voice assistant built with a **streaming audio pipeline**, **custom audio processing**, and a **session-based WebSocket architecture**.  
The system is designed to support natural, interruptible conversations with multiple concurrent users.

> ⚠️ This project is under active development.  
> Current progress covers **audio ingestion, custom VAD, turn detection, and session state management**.

---

## ✨ Current Features (Implemented)

### ✅ Real-Time Audio Ingestion
- Browser microphone capture using **Web Audio API**
- Audio resampled to **16kHz mono**
- Continuous frame-based processing
- Float32 → Int16 PCM conversion for downstream compatibility

### ✅ Custom Audio Processing (No Third-Party VAD)
- **Amplitude-based noise suppression** (noise gating)
- **Energy-based Voice Activity Detection (VAD)**
- Edge-based detection of speech start
- Robust handling of silence vs pauses

### ✅ Turn Detection
- Silence-duration heuristic to detect end-of-turn
- Distinguishes natural pauses from conversation completion
- Emits a single `user_stopped` event per turn
- Eliminates state flicker and false triggers

### ✅ WebSocket-Based Transport Layer
- Low-latency **binary audio streaming** over WebSockets
- Clear separation of:
  - Binary messages → audio frames
  - JSON messages → control & state
- Each WebSocket connection represents an **isolated voice session**

### ✅ Session State Machine
Backend-driven session lifecycle:
LISTENING → THINKING → SPEAKING
↑ ↓ ↓
└────────┴──────────┘ (barge-in, upcoming)



- Backend is the **source of truth** for state
- Frontend reacts to real-time state updates
- Prevents overlapping audio ingestion and processing

### ✅ Frontend State Awareness
- Live UI indicator for agent state (`LISTENING`, `THINKING`, etc.)
- Audio streaming gated by backend session state
- Ready for barge-in and streaming responses

---

## 🏗️ Architecture Overview (Current)

Browser
├─ Microphone (Web Audio API)
├─ Noise Gate + VAD + Turn Detection
├─ PCM Audio Frames (16kHz)
└─ WebSocket Client
⇅
Backend (Node.js + ws)
├─ Session Manager (per connection)
├─ State Machine
└─ Control Protocol



### Key Design Principles
- **Frontend owns audio intelligence** (VAD, noise suppression, turn detection)
- **Backend owns conversation intelligence** (state, orchestration)
- Event-driven transitions instead of time-based heuristics
- Stateless backend design (per-session isolation)

---

## 🔊 Custom Audio Processing Approach

### Noise Suppression
- Lightweight amplitude-based noise gating
- Drops low-energy frames (ambient noise, silence)
- Zero additional latency

### Voice Activity Detection (VAD)
- Energy computed per audio frame
- Edge-based detection (`not speaking → speaking`)
- Avoids frame-level false positives

### Turn Detection
- Silence duration measured using timestamps
- End-of-turn triggered only after sustained silence
- Prevents premature interruption during natural pauses

> This approach avoids using any pre-built VAD or noise suppression services, as required.

---

## 🔄 WebSocket Message Protocol (Current)

### Client → Server
- **Binary**: Int16 PCM audio frames
- **JSON**:
  ```json
  { "type": "user_stopped" }


