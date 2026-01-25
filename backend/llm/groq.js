const Groq = require("groq-sdk");


const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});


async function streamLLMResponse(prompt, onToken) {
  const completion = await groq.chat.completions.create({
    model: "llama3-8b-8192",
    messages: [
      {
        role: "system",
        content:
          "You are a helpful, concise voice assistant. Keep responses short and conversational.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    stream: true,
  });

  for await (const chunk of completion) {
    const token = chunk.choices[0]?.delta?.content;
    if (token) {
      onToken(token);
    }
  }
}

module.exports = { streamLLMResponse };
