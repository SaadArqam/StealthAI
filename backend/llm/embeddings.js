// When GROQ_API_KEY is not set, provide a deterministic mock embedding
// so the semantic cache and flow can still function locally.
if (!process.env.GROQ_API_KEY) {
  console.warn("GROQ_API_KEY not found — using mock embeddings for local testing.");

  function getEmbedding(text) {
    // Simple deterministic embedding: produce a length-8 vector from char codes
    const out = new Array(8).fill(0);
    for (let i = 0; i < text.length; i++) {
      out[i % out.length] += text.charCodeAt(i) % 97;
    }
    // normalize
    const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0)) || 1;
    return out.map((v) => v / norm);
  }

  module.exports = { getEmbedding };
} else {
  const Groq = require("groq-sdk");

  const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
  });

  async function getEmbedding(text) {
    try {
      const res = await groq.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
      });

      return res.data[0].embedding;
    } catch (err) {
      console.warn("Groq embeddings failed (will use mock embedding):", err?.message || err);
      // Fallback deterministic mock embedding (length 8)
      const out = new Array(8).fill(0);
      for (let i = 0; i < text.length; i++) {
        out[i % out.length] += text.charCodeAt(i) % 97;
      }
      const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0)) || 1;
      return out.map((v) => v / norm);
    }
  }

  module.exports = { getEmbedding };
}
