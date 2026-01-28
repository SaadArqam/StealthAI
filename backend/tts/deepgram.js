const { createClient } = require("@deepgram/sdk");

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

async function streamTTS(text, onAudioChunk) {
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
}

module.exports = { streamTTS };
