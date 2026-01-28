const { streamLLMResponse } = require("./groq");

async function streamLLMWithFallback(prompt, onToken) {
  try {
    console.log("LLM: using Groq");
    await streamLLMResponse(prompt, onToken);
  } catch (err) {
    console.error("Groq failed, falling back:", err.message);


    if (process.env.OPENAI_API_KEY) {
      const OpenAI = require("openai");
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const stream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        stream: true,
      });

      for await (const part of stream) {
        const token = part.choices[0]?.delta?.content;
        if (token) onToken(token);
      }
    } else {

      const mock = ["(mock) I can't reach the LLM right now.", " Please check keys."];
      for (const t of mock) {
        await new Promise((r) => setTimeout(r, 200));
        onToken(t);
      }
    }
  }
}

module.exports = { streamLLMWithFallback };
