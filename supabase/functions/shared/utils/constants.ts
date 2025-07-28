/**
 * The research strategies based on the category
 */
export const RESEARCH_STRATEGIES = {
  stocks: {
    dataSources: ["alpha_vantage", "news", "serp"],
    promptStyle: "financial_analysis",
  },
  sports: {
    dataSources: ["news", "serp", "sports_api"],
    promptStyle: "sports_coverage",
  },
  news: {
    dataSources: ["news", "serp"],
    promptStyle: "news_reporting",
  },
  technology: {
    dataSources: ["news", "serp", "tech_apis"],
    promptStyle: "tech_analysis",
  },
  science: {
    dataSources: ["news", "serp", "research_apis"],
    promptStyle: "scientific_reporting",
  },
  evergreen: {
    dataSources: ["serp", "news"],
    promptStyle: "evergreen_content",
  },
};

export const ALLOWED_CATEGORIES = [
  "news",
  "sports",
  "stocks",
  "science",
  "technology",
  "evergreen",
];

/**
 * Prompt style templates
 */
export const PROMPT_STYLE_TEMPLATES = {
  financial_analysis: (topic, researchData, targetLength) => `\nWrite a detailed financial analysis blog post about "${topic}".\nIncorporate the following research data: ${JSON.stringify(researchData)}.\nTarget length: ${targetLength} words.\nUse a professional, analytical tone suitable for investors.\n`,
  sports_coverage: (topic, researchData, targetLength) => `\nWrite an engaging sports coverage blog post about "${topic}".\nInclude highlights, stats, and recent news: ${JSON.stringify(researchData)}.\nTarget length: ${targetLength} words.\nUse an energetic, fan-friendly style.\n`,
  news_reporting: (topic, researchData, targetLength) => `\nWrite a news report about "${topic}".\nInclude the following research data: ${JSON.stringify(researchData)}.\nTarget length: ${targetLength} words.\nUse a neutral, journalistic tone.\n`,
  tech_analysis: (topic, researchData, targetLength) => `\nWrite a technology analysis blog post about "${topic}".\nIncorporate the following research data: ${JSON.stringify(researchData)}.\nTarget length: ${targetLength} words.\nUse an expert, insightful tone.\n`,
  scientific_reporting: (topic, researchData, targetLength) => `\nWrite a scientific report about "${topic}".\nInclude the following research data: ${JSON.stringify(researchData)}.\nTarget length: ${targetLength} words.\nUse a clear, informative style.\n`,
  evergreen_content: (topic, researchData, targetLength) => `\nWrite an evergreen blog post about "${topic}".\nIncorporate the following research data: ${JSON.stringify(researchData)}.\nTarget length: ${targetLength} words.\nUse a timeless, accessible style.\n`,
};
