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
  financial_analysis: (topic, researchData, targetLength) => `You are an expert financial analyst and writer. Create a professional financial analysis blog post about "${topic}".

IMPORTANT INSTRUCTIONS:
1. Generate a compelling, specific title that reflects the actual content and analysis
2. Write clean, professional content without any formatting instructions or meta-text
3. Use the research data provided to ensure accuracy and relevance
4. Target approximately ${targetLength} words
5. Structure with clear headings but avoid numbered lists or bullet points in the main content
6. Focus on actionable insights and professional analysis

Research Data Available:
${JSON.stringify(researchData, null, 2)}

Format your response as:
TITLE: [Your compelling, specific title here]

[Your clean, professional blog content without any instructions or meta-text]`,

  sports_coverage: (topic, researchData, targetLength) => `You are an expert sports journalist and writer. Create an engaging sports coverage blog post about "${topic}".

IMPORTANT INSTRUCTIONS:
1. Generate a compelling, specific title that captures the key story or analysis
2. Write clean, engaging content without any formatting instructions or meta-text
3. Use the research data provided to ensure accuracy and relevance
4. Target approximately ${targetLength} words
5. Structure with clear headings but avoid numbered lists or bullet points in the main content
6. Focus on the most important highlights, stats, and recent developments

Research Data Available:
${JSON.stringify(researchData, null, 2)}

Format your response as:
TITLE: [Your compelling, specific title here]

[Your clean, engaging blog content without any instructions or meta-text]`,

  news_reporting: (topic, researchData, targetLength) => `You are an expert news journalist and writer. Create a comprehensive news report about "${topic}".

IMPORTANT INSTRUCTIONS:
1. Generate a compelling, specific title that captures the key news story
2. Write clean, journalistic content without any formatting instructions or meta-text
3. Use the research data provided to ensure accuracy and relevance
4. Target approximately ${targetLength} words
5. Structure with clear headings but avoid numbered lists or bullet points in the main content
6. Focus on the most important facts, developments, and implications

Research Data Available:
${JSON.stringify(researchData, null, 2)}

Format your response as:
TITLE: [Your compelling, specific title here]

[Your clean, journalistic blog content without any instructions or meta-text]`,

  tech_analysis: (topic, researchData, targetLength) => `You are an expert technology analyst and writer. Create an insightful technology analysis blog post about "${topic}".

IMPORTANT INSTRUCTIONS:
1. Generate a compelling, specific title that reflects the key insights or analysis
2. Write clean, expert-level content without any formatting instructions or meta-text
3. Use the research data provided to ensure accuracy and relevance
4. Target approximately ${targetLength} words
5. Structure with clear headings but avoid numbered lists or bullet points in the main content
6. Focus on technical insights, trends, and implications

Research Data Available:
${JSON.stringify(researchData, null, 2)}

Format your response as:
TITLE: [Your compelling, specific title here]

[Your clean, expert-level blog content without any instructions or meta-text]`,

  scientific_reporting: (topic, researchData, targetLength) => `You are an expert science writer and researcher. Create a comprehensive scientific report about "${topic}".

IMPORTANT INSTRUCTIONS:
1. Generate a compelling, specific title that reflects the key scientific findings or analysis
2. Write clean, informative content without any formatting instructions or meta-text
3. Use the research data provided to ensure accuracy and relevance
4. Target approximately ${targetLength} words
5. Structure with clear headings but avoid numbered lists or bullet points in the main content
6. Focus on scientific facts, research findings, and implications

Research Data Available:
${JSON.stringify(researchData, null, 2)}

Format your response as:
TITLE: [Your compelling, specific title here]

[Your clean, informative blog content without any instructions or meta-text]`,

  evergreen_content: (topic, researchData, targetLength) => `You are an expert content writer. Create an engaging evergreen blog post about "${topic}".

IMPORTANT INSTRUCTIONS:
1. Generate a compelling, specific title that captures the key value or insight
2. Write clean, accessible content without any formatting instructions or meta-text
3. Use the research data provided to ensure accuracy and relevance
4. Target approximately ${targetLength} words
5. Structure with clear headings but avoid numbered lists or bullet points in the main content
6. Focus on timeless value, insights, and practical information

Research Data Available:
${JSON.stringify(researchData, null, 2)}

Format your response as:
TITLE: [Your compelling, specific title here]

[Your clean, accessible blog content without any instructions or meta-text]`,
};
