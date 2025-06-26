import { PROMPT_STYLES } from "./client.ts";


const BASIC_PROMPT = `You are an expert blog writer. Create engaging, well-structured content.

Write a [TARGET_LENGTH]-word blog post about "[TOPIC]". Include a compelling title, structured content with headings, and conclude with key takeaways.

Research Data Available:
[RESEARCH_DATA]

Use the provided relevant and current events research data to inform your content and ensure accuracy.`

const INTERMEDIATE_PROMPT = `You are an expert blog writer and fact-checker. Create engaging, well-structured, and factually accurate content.

Topic: "[TOPIC]"
Target Length: [TARGET_LENGTH] words

Research Data Provided:
[RESEARCH_DATA]

Instructions:
1. Write a comprehensive blog post using the provided research data
2. Cross-reference claims with the research data to ensure accuracy
3. Include a compelling title and structured content with headings
4. Verify numerical data, dates, and statistics from the research
5. If any claims cannot be verified from the provided data, clearly indicate this
6. Conclude with key takeaways based on verified information

Structure your response with clear headings and factual accuracy indicators.`

/**
 * Replaces variables in the prompt template with actual values
 * @param topic - The topic to write about
 * @param targetLength - Target word count for the blog post
 * @param researchData - Research data to include in the prompt
 * @param promptStyle - The style of prompt to use (from PROMPT_STYLES enum)
 * @returns Formatted prompt string with variables replaced
 */
export function formatPrompt(
  topic: string,
  targetLength: number,
  researchData: any,
  promptStyle: PROMPT_STYLES
): string {
  // Convert research data to a readable format
  const researchDataString = researchData ? JSON.stringify(researchData, null, 2) : "No research data available";
  
  // Map the prompt style enum to the actual prompt template
  let promptTemplate: string;
  switch (promptStyle) {
    case PROMPT_STYLES.basic:
      promptTemplate = BASIC_PROMPT;
      break;
    case PROMPT_STYLES.inter:
      promptTemplate = INTERMEDIATE_PROMPT;
      break;
    default:
      promptTemplate = BASIC_PROMPT; // fallback to basic
  }
  
  return promptTemplate
    .replace('[TARGET_LENGTH]', targetLength.toString())
    .replace('[TOPIC]', topic)
    .replace('[RESEARCH_DATA]', researchDataString);
}

export { BASIC_PROMPT, INTERMEDIATE_PROMPT };

