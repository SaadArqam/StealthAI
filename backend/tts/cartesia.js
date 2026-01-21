const {Cartesia}=require("@cartesia/cartesia-js");

const client=new Cartesia({
    apiKey:process.env.CARTESIA_API_KEY
})


async function streamTTS(text,onAudioChunks) {
    const response=await client.tts.stream({
        model: "sonic-english",
        voice: "neutral",
        format: "pcm",
        sampleRate: 16000,
        text,
    })
    for await(const chunk of response){
        onAudioChunks(chunk.audio)
    }
}

module.exports={streamTTS}