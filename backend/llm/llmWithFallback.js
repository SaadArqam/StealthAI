const { streamLLMResponse } = require("./groq");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function streamLLMWithFallback(prompt, onToken) {
  try {
    console.log("LLM: using Groq");
    await streamLLMResponse(prompt, onToken);
  } catch (err) {
    console.error("Groq failed, falling back:", err.message);

    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      stream: true,
    });

    for await (const part of stream) {
      const token = part.choices[0]?.delta?.content;
      if (token) onToken(token);
    }
  }
}

module.exports = { streamLLMWithFallback };
