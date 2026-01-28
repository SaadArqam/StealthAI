
if (!process.env.GROQ_API_KEY) {
  console.warn("GROQ_API_KEY not found — using mock LLM response for local testing.");

  async function streamLLMResponse(prompt, onToken) {
    const tokens = ["Hello from the mock LLM.", " I can answer your question."];
    for (const t of tokens) {
      await new Promise((r) => setTimeout(r, 200));
      onToken(t);
    }
  }

  module.exports = { streamLLMResponse };
} else {
  const Groq = require("groq-sdk");

  const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
  });

  async function streamLLMResponse(prompt, onToken) {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
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
}
