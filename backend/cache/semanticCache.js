const cache = [];
const TTL_MS = 5 * 60 * 1000;
const SIMILARITY_THRESHOLD = 0.85;

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function getCachedResponse(embedding) {
  const now = Date.now();

  for (const entry of cache) {
    if (now - entry.timestamp > TTL_MS) continue;

    const similarity = cosineSimilarity(
      embedding,
      entry.embedding
    );

    if (similarity >= SIMILARITY_THRESHOLD) {
      return entry.response;
    }
  }

  return null;
}

function storeCachedResponse(embedding, response) {
  cache.push({
    embedding,
    response,
    timestamp: Date.now(),
  });
}

module.exports = {
  getCachedResponse,
  storeCachedResponse,
};
