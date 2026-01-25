const { createClient } = require("@deepgram/sdk");

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

async function streamTTS(text, onAudioChunk) {
  const response = await deepgram.speak.request(
    { text },
    {
      model: "aura-asteria-en",
      encoding: "linear16",
      sample_rate: 16000,
    }
  );

  for await (const chunk of response.stream()) {
    if (chunk.type === "audio") {
      onAudioChunk(Buffer.from(chunk.data));
    }
  }
}

module.exports = { streamTTS };
