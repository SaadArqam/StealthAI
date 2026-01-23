const { TavilyClient } = require("tavily");

const tavily = new TavilyClient({
  apiKey: process.env.TAVILY_API_KEY,
});

async function webSearch(query) {
  const result = await tavily.search({
    query,
    search_depth: "basic",
    max_results: 5,
  });

  return result.results.map((r, i) => ({
    id: i + 1,
    title: r.title,
    url: r.url,
    content: r.content,
  }));
}

module.exports = { webSearch };
