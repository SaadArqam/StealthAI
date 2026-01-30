
const { createClient } = require("@deepgram/sdk");

let deepgram = null;
if (process.env.DEEPGRAM_API_KEY) {
  try {
    deepgram = createClient(process.env.DEEPGRAM_API_KEY);
  } catch (err) {
    console.warn("Failed to initialize Deepgram client for TTS:", err?.message || err);
    deepgram = null;
  }
} else {
  const logger = require('../logger');
  logger.warn("DEEPGRAM_API_KEY not found — using mock TTS for local testing.");
}

function generateSinePCM(durationMs = 800, sampleRate = 16000) {
  const samples = Math.floor((durationMs / 1000) * sampleRate);
  const buffer = Buffer.alloc(samples * 2);
  const freq = 440;
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const amp = Math.round(Math.sin(2 * Math.PI * freq * t) * 0.2 * 32767);
    buffer.writeInt16LE(amp, i * 2);
  }
  return buffer;
}

async function streamTTS(text, onAudioChunk) {

  if (deepgram && deepgram.speak && typeof deepgram.speak.stream === "function") {
    try {
      const stream = await deepgram.speak.stream({
        text,
        model: "aura-asteria-en",
        encoding: "linear16",
        sample_rate: 16000,
      });

      for await (const message of stream) {
        if (message.type === "audio") {
          onAudioChunk(Buffer.from(message.data));
        }
      }

      return;
    } catch (err) {
      const logger = require('../logger');
      logger.warn("Deepgram TTS failed, falling back to mock TTS:", err?.message || err);
    }
  } else if (deepgram) {
    const logger = require('../logger');
    logger.warn("Deepgram client present but speak.stream is not available — using mock TTS fallback.");
  }


  const pcm = generateSinePCM(900, 16000);
  const chunkSize = 32000;
  for (let i = 0; i < pcm.length; i += chunkSize) {
    const chunk = pcm.slice(i, i + chunkSize);
    onAudioChunk(chunk);
    await new Promise((r) => setTimeout(r, 120));
  }
}

module.exports = { streamTTS };

async function prewarmTTS() {
  if (!deepgram) return;

  if (deepgram.speak && typeof deepgram.speak.stream === "function") {
    try {
      const stream = await deepgram.speak.stream({
        text: "hello",
        model: "aura-asteria-en",
        encoding: "linear16",
        sample_rate: 16000,
      });

      
      let i = 0;
      for await (const msg of stream) {
        i++;
        if (i > 2) break;
      }
        const logger = require('../logger');
        logger.info("TTS prewarm completed");
      return;
      } catch (err) {
        const logger = require('../logger');
        logger.warn("TTS prewarm failed:", err?.message || err);
      }
  }
  
  generateSinePCM(200, 16000);
  const logger = require('../logger');
  logger.info("TTS prewarm: performed local PCM warmup");
}

module.exports.prewarm = prewarmTTS;
