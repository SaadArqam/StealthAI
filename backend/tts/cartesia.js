const cartesia = require("@cartesia/cartesia-js");

// create client
const client = cartesia.createClient({
  apiKey: process.env.CARTESIA_API_KEY,
});

// stream TTS audio as raw PCM
async function streamTTS(text, onAudioChunk) {
  const stream = await client.tts.stream({
    model: "sonic-english",
    voice: "neutral",
    format: "pcm",
    sampleRate: 16000,
    text,
  });

  for await (const chunk of stream) {
    if (chunk.audio) {
      onAudioChunk(chunk.audio);
    }
  }
}

module.exports = { streamTTS };
