const { createClient } = require("@deepgram/sdk");

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

// stream TTS audio as raw PCM
async function streamTTS(text, onAudioChunk) {
  const response = await deepgram.speak.live({
    model: "aura-asteria-en",
    encoding: "linear16",
    sample_rate: 16000,
    text,
  });

  response.on("data", (chunk) => {
    onAudioChunk(chunk);
  });

  await new Promise((res) => response.on("end", res));
}

module.exports = { streamTTS };
