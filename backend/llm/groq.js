const logger = require('../logger');

if (!process.env.GROQ_API_KEY) {
  logger.warn("GROQ_API_KEY not found — using mock LLM response for local testing.");

  async function streamLLMResponse(prompt, onToken) {
    const tokens = ["Hello from the mock LLM.", " I can answer your question."];
    for (const t of tokens) {
      await new Promise((r) => setTimeout(r, 200));
      onToken(t);
    }
  }

  module.exports = { streamLLMResponse };
  async function prewarm() {
    return;
  }

  module.exports.prewarm = prewarm;
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
  async function prewarm() {
    try {
      await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: "You are a warmup bot." },
          { role: "user", content: "Hi" },
        ],
        max_tokens: 1,
        stream: false,
      });
    } catch (err) {
      logger.warn("Groq prewarm failed:", err?.message || err);
    }
  }

  module.exports.prewarm = prewarm;
}
