const Gorq=require("groq-sdk");


const gorq=new Gorq({
    apiKey:process.env.GORQ_API_KEY
})


async function streamLLMResponse(prompt,onTOken){
    const completion=groq.chat.completion.create({
        model:"llama3-8b-8192",
        meassages:[
            {
                role:"system",
                content:"You are a helpful, conversational voice assistant. Keep responses concise and natural."
            },
            {
                role:"user",content:"prompt"
            }
        ],
        stream:true
    })
    for await (const chunk of completion) {
    const token = chunk.choices[0]?.delta?.content;
    if (token) onToken(token);
  }
}

module.exports={streamLLMResponse}
