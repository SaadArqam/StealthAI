const groqModule = require("./groq");
const streamLLMResponse = groqModule.streamLLMResponse;

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

async function prewarmLLM() {
  // Try groq prewarm if available
  if (typeof groqModule.prewarm === "function") {
    try {
      await groqModule.prewarm();
      console.log("LLM prewarm: Groq prewarm completed");
      return;
    } catch (err) {
      console.warn("LLM prewarm: Groq prewarm failed:", err?.message || err);
    }
  }

  // Try OpenAI lightweight warmup if available
  if (process.env.OPENAI_API_KEY) {
    try {
      const OpenAI = require("openai");
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
        stream: false,
      });
      console.log("LLM prewarm: OpenAI prewarm completed");
      return;
    } catch (err) {
      console.warn("LLM prewarm: OpenAI prewarm failed:", err?.message || err);
    }
  }

  // otherwise nothing to prewarm (mock)
  console.log("LLM prewarm: no provider to prewarm (mock or no keys)");
}

module.exports = { streamLLMWithFallback, prewarmLLM };
