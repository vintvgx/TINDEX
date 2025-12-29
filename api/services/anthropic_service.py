import os
import asyncio
import json
from typing import Dict, Any, Optional, AsyncGenerator, List
from anthropic import AsyncAnthropic

class AnthropicService:
    """
    Service class for managing Anthropic API requests with streaming support.

    This service provides:
    - Blog post generation with streaming
    - Ticker information integration
    - Error handling and retry logic
    - Type safety and validation
    """

    def __init__(self):
        """Initialize Anthropic client with environment variables"""
        self.anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
        # Use the latest stable Claude 3.5 Sonnet model
        # If 20241022 doesn't work, try: claude-3-5-sonnet-20240620
        self.anthropic_model = "claude-haiku-4-5"

        if not self.anthropic_api_key:
            raise ValueError("ANTHROPIC_API_KEY not defined")

        self.client = AsyncAnthropic(
            api_key=self.anthropic_api_key,
        )

    async def generate_blog_post_stream(
        self,
        topic: str,
        research_data: Dict[str, Any],
        target_length: int = 800,
        ticker: Optional[str] = None,
    ) -> AsyncGenerator[str, None]:
        """
        Generate a blog post with streaming response using ticker information.

        Args:
            topic: The topic to generate content about
            research_data: Research data to inform the content
            target_length: Target word count for the blog post
            ticker: Optional stock ticker symbol

        Yields:
            String chunks of the generated content as they become available
        """
        try:
            # Build the prompt with ticker information
            prompt = self._build_blog_prompt(
                topic, research_data, target_length, ticker
            )

            # Create streaming request
            async with self.client.messages.stream(
                max_tokens=2048,
                temperature=0.7,
                model=self.anthropic_model,
                messages=[
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
            ) as stream:
                async for text in stream.text_stream:
                    yield text

        except Exception as e:
            yield f"Error generating blog post: {str(e)}"
            raise

    async def generate_blog_post(
        self,
        topic: str,
        research_data: Dict[str, Any],
        target_length: int | None = 800,
        ticker: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generate a complete blog post without streaming.

        Args:
            topic: The topic to generate content about
            research_data: Research data to inform the content
            target_length: Target word count for the blog post
            ticker: Optional stock ticker symbol

        Returns:
            Dict containing the generated blog post data
        """
        target_length = target_length or 800
        try:
            # Build the prompt with ticker information
            prompt = self._build_blog_prompt(
                topic, research_data, target_length, ticker
            )

            # Create non-streaming request
            response = await self.client.messages.create(
                max_tokens=2048,
                temperature=0.7,
                model=self.anthropic_model,
                messages=[  
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
            )

            # Extract content from response
            if response.content and len(response.content) > 0:
                raw_content = response.content[0].text
                parsed_content = self._parse_ai_response(raw_content, topic)

                return {
                    # "success": True,
                    "title": parsed_content["title"],
                    "content": parsed_content["content"],
                    "word_count": len(parsed_content["content"].split()),
                    "reading_time": self._calculate_reading_time(
                        parsed_content["content"]
                    ),
                    "ticker": ticker,
                    "research_data": research_data,
                    "model_used": self.anthropic_model,
                    "target_length": target_length,
                }
            else:
                raise Exception("No content generated from AI response")

        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to generate blog post: {str(e)}",
            }

    def _build_blog_prompt(
        self,
        topic: str,
        research_data: Dict[str, Any],
        target_length: int,
        ticker: Optional[str] = None,
    ) -> str:
        """
        Build the blog post generation prompt with ticker information.

        Args:
            topic: The topic to generate content about
            research_data: Research data to inform the content
            target_length: Target word count
            ticker: Optional stock ticker symbol

        Returns:
            Formatted prompt string
        """
        # Add ticker context if available
        ticker_context = ""
        if ticker:
            ticker_context = f"Focus on {ticker} ({topic}) as the primary subject. "

        prompt = f"""You are an expert financial analyst and writer. Create a professional financial analysis blog post about "{topic}".

        IMPORTANT INSTRUCTIONS:
        1. Generate a compelling, specific title that reflects the actual content and analysis
        2. Write clean, professional content without any formatting instructions or meta-text
        3. Use the research data provided to ensure accuracy and relevance
        4. Target approximately {target_length} words
        5. Structure with clear headings but avoid numbered lists or bullet points in the main content
        6. Focus on actionable insights and professional analysis
        7. {ticker_context}Provide comprehensive analysis including market trends, financial metrics, and investment considerations

        Research Data Available:
        {json.dumps(research_data, indent=2)}

        Format your response as:
        TITLE: [Your compelling, specific title here]

        [Your clean, professional blog content without any instructions or meta-text]"""

        return prompt

    def _parse_ai_response(self, raw_content: str, topic: str) -> Dict[str, str]:
        """
        Parse AI response to extract title and clean content.

        Args:
            raw_content: Raw AI response
            topic: Original topic for fallback

        Returns:
            Dict containing title and cleaned content
        """
        # Default fallback values
        title = f"Comprehensive Analysis: {topic}"
        content = raw_content

        try:
            # Look for TITLE: pattern in the response
            import re

            title_match = re.search(
                r"TITLE:\s*(.+?)(?:\n|$)", raw_content, re.IGNORECASE
            )
            if title_match and title_match.group(1):
                title = title_match.group(1).strip()

                # Remove the title line from content
                content = re.sub(
                    r"TITLE:\s*.+?(?:\n|$)", "", raw_content, flags=re.IGNORECASE
                ).strip()
            else:
                # If no TITLE: pattern found, try to extract first line as title
                lines = [
                    line.strip() for line in raw_content.split("\n") if line.strip()
                ]
                if lines:
                    first_line = lines[0]
                    # Check if first line looks like a title
                    if len(first_line) < 100 and not any(
                        phrase in first_line.lower()
                        for phrase in ["here's", "write", "create", "generate"]
                    ):
                        title = first_line
                        content = "\n".join(lines[1:]).strip()

            # Clean up content by removing instruction text
            content = re.sub(
                r"^(Here\'s|Write|Create|Generate).*?:\n?",
                "",
                content,
                flags=re.IGNORECASE,
            )
            content = re.sub(
                r"^(IMPORTANT INSTRUCTIONS|Research Data Available|Format your response).*?(?=\n\n|\n[A-Z]|$)",
                "",
                content,
                flags=re.IGNORECASE | re.DOTALL,
            )
            content = re.sub(
                r"^\d+\.\s*.*?(?=\n\n|\n[A-Z]|$)", "", content, flags=re.MULTILINE
            )
            content = re.sub(r"\[.*?\]", "", content)
            content = re.sub(r"\n{3,}", "\n\n", content)
            content = content.strip()

            # If content is empty after cleaning, use original content
            if not content:
                content = raw_content

        except Exception as e:
            # If parsing fails, use fallback values
            title = f"Comprehensive Analysis: {topic}"
            content = raw_content

        return {"title": title, "content": content}

    def _calculate_reading_time(self, content: str) -> int:
        """
        Calculate estimated reading time in minutes.

        Args:
            content: The content to calculate reading time for

        Returns:
            Estimated reading time in minutes
        """
        words_per_minute = 200
        word_count = len(content.split())
        return max(1, round(word_count / words_per_minute))

    async def generate_ticker_update(
        self,
        research_data: Dict[str, Any],
        target_length: int = 500,
        ticker: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generate a ticker update (tweet-like content) with market analysis tags.

        This method generates a concise, engaging update about a stock ticker based on
        research data, similar to a tweet. It also analyzes the research data to determine
        relevant market tags such as "Good for Puts", "Stock to buy", "Volatile", etc.

        Args:
            research_data: Research data dictionary containing stock information
            target_length: Maximum character length for the update (default: 270)
            ticker: Stock ticker symbol
        Returns:
            Dict containing:
                - success (bool): Whether generation succeeded
                - content (str): The generated ticker update text
                - tags (List[str]): List of relevant market tags
                - character_count (int): Actual character count of content
                - ticker (str): The ticker symbol
                - error (str, optional): Error message if failed
        """
        try:
            # Extract research data from nested structure if needed
            actual_research_data = research_data
            if isinstance(research_data, dict) and "data" in research_data:
                actual_research_data = research_data["data"]
            
            # Build the prompt for ticker update generation
            prompt = self._build_ticker_update_prompt(
                actual_research_data, target_length, ticker
            )

            # Create request to generate content and tags
            response = await self.client.messages.create(
                max_tokens=1024,
                temperature=0.8,  # Slightly higher for more engaging content
                model=self.anthropic_model,
                messages=[
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
            )

            # Extract and parse response
            if response.content and len(response.content) > 0:
                raw_content = response.content[0].text
                parsed_response = self._parse_ticker_update_response(
                    raw_content, ticker, actual_research_data
                )

                return {
                    "success": True,
                    "content": parsed_response["content"],
                    "tags": parsed_response["tags"],
                    "character_count": len(parsed_response["content"]),
                    "ticker": ticker,
                    "model_used": self.anthropic_model,
                    "research_data" : research_data["data"]
                }
            else:
                raise Exception("No content generated from AI response")
        except Exception as e:
            # Handle any other unexpected errors
            return {
                "success": False,
                "error": f"Failed to generate ticker update: {str(e)}",
                "error_details": {
                    "type": "unknown_error",
                    "status_code": 500
                },
                "ticker": ticker,
            }

    def _build_ticker_update_prompt(
        self,
        research_data: Dict[str, Any],
        target_length: int,
        ticker: Optional[str] = None,
    ) -> str:
        """
        Build the prompt for ticker update generation with tag analysis.

        Args:
            research_data: Research data dictionary
            target_length: Maximum character length
            ticker: Stock ticker symbol

        Returns:
            Formatted prompt string
        """
        ticker_name = ticker or research_data.get("ticker", "the stock")
        company_name = research_data.get("company_name", "")

        prompt = f"""You are a financial analyst creating a concise, engaging stock market update (similar to a tweet) for {ticker_name} ({company_name}).

IMPORTANT INSTRUCTIONS:
1. Generate a tweet-like update that is engaging, informative, and up to {target_length} characters or less
2. Focus on the most important and recent information: price movements, news, market sentiment, key metrics
3. Make it conversational and engaging - use emojis sparingly if appropriate
4. Include specific numbers (price changes, percentages, key metrics) when relevant
5. Write in a clear, punchy style that captures attention

After generating the update, analyze the research data and provide relevant market tags.

Available Tags (select all that apply based on the data):
- "Good for Puts" - If bearish signals, high volatility, negative sentiment, or declining price
- "Stock to buy" - If bullish signals, positive momentum, strong fundamentals, or buy recommendations
- "Low Float" - If shares outstanding or float is relatively low (typically < 50M shares)
- "High interest" - If high volume, unusual activity, or significant market attention
- "Volatile" - If high beta (>1.5), large price swings, or high IV for options
- "Concerning P/E" - If P/E ratio is very high (>30) or negative, indicating overvaluation or losses
- "High Volume" - If trading volume is significantly above average
- "Momentum Play" - If strong recent price movement or trend
- "Value Play" - If low P/E, P/B ratios, or appears undervalued
- "Dividend Stock" - If has meaningful dividend yield
- "Growth Stock" - If high revenue/earnings growth rates
- "Options Opportunity" - If options analysis shows good opportunities

Research Data:
{json.dumps(research_data, indent=2, default=str)}

Format your response EXACTLY as follows (this is critical for parsing):
CONTENT: [Your tweet-like update here, {target_length} characters max]

TAGS: [comma-separated list of applicable tags from the list above, e.g., "Volatile, High interest, Good for Puts"]"""

        return prompt

    def _parse_ticker_update_response(
        self,
        raw_content: str,
        ticker: Optional[str],
        research_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Parse AI response to extract content and tags.

        Args:
            raw_content: Raw AI response
            ticker: Stock ticker symbol
            research_data: Research data for fallback tag analysis

        Returns:
            Dict containing content and tags
        """
        import re

        # Default values
        content = raw_content.strip()
        tags = []

        try:
            # Extract CONTENT section
            content_match = re.search(
                r"CONTENT:\s*(.+?)(?=\nTAGS:|$)", raw_content, re.IGNORECASE | re.DOTALL
            )
            if content_match:
                content = content_match.group(1).strip()
                # Remove any remaining formatting artifacts
                content = re.sub(r"^\[|\]$", "", content).strip()

            # Extract TAGS section
            tags_match = re.search(
                r"TAGS:\s*(.+?)(?:\n|$)", raw_content, re.IGNORECASE
            )
            if tags_match:
                tags_str = tags_match.group(1).strip()
                # Parse comma-separated tags, removing quotes
                tags = [
                    tag.strip().strip('"').strip("'")
                    for tag in tags_str.split(",")
                    if tag.strip()
                ]

            # If tags weren't found in response, analyze research data programmatically
            if not tags:
                tags = self._analyze_research_data_for_tags(research_data)

            # Clean up content - remove any instruction remnants
            content = re.sub(
                r"^(Here's|Here is|Update:|Ticker Update:).*?:\s*",
                "",
                content,
                flags=re.IGNORECASE,
            )
            content = re.sub(
                r"^(IMPORTANT INSTRUCTIONS|Research Data|Format your response).*?(?=\n\n|\n[A-Z]|$)",
                "",
                content,
                flags=re.IGNORECASE | re.DOTALL,
            )
            content = content.strip()

            # Ensure content doesn't exceed reasonable length (add buffer for safety)
            max_length = 280  # Slightly above target for safety
            if len(content) > max_length:
                content = content[:max_length].rsplit(" ", 1)[0] + "..."

        except Exception as e:
            # If parsing fails, use fallback
            content = raw_content.strip()[:270]
            tags = self._analyze_research_data_for_tags(research_data)

        return {"content": content, "tags": tags}

    def _analyze_research_data_for_tags(self, research_data: Dict[str, Any]) -> List[str]:
        """
        Programmatically analyze research data to determine relevant tags.

        This serves as a fallback if AI doesn't provide tags, and ensures
        tags are based on actual data metrics.

        Args:
            research_data: Research data dictionary

        Returns:
            List of applicable tags
        """
        tags = []

        try:
            # Extract key metrics
            pe_ratio = research_data.get("pe_ratio")
            beta = research_data.get("beta")
            price_change_percent = research_data.get("price_change_percent", 0)
            volume = research_data.get("volume", 0)
            average_volume = research_data.get("average_volume", 0)
            market_cap = research_data.get("market_cap", 0)
            dividend_yield = research_data.get("dividend_yield")
            revenue_growth = research_data.get("revenue_growth")
            earnings_growth = research_data.get("earnings_growth")
            sentiment_score = research_data.get("sentiment_score", 0)
            options_analysis = research_data.get("options_analysis", {})

            # Analyze for tags
            if pe_ratio:
                if pe_ratio > 30 or pe_ratio < 0:
                    tags.append("Concerning P/E")

            if beta and beta > 1.5:
                tags.append("Volatile")

            if volume > 0 and average_volume > 0:
                volume_ratio = volume / average_volume
                if volume_ratio > 2.0:
                    tags.append("High Volume")
                    tags.append("High interest")

            if market_cap and market_cap < 5_000_000_000:  # Less than 5B market cap
                # Estimate float (rough approximation)
                shares_outstanding = market_cap / research_data.get("current_price", 1)
                if shares_outstanding < 50_000_000:
                    tags.append("Low Float")

            if dividend_yield and dividend_yield > 0.02:  # > 2%
                tags.append("Dividend Stock")

            if revenue_growth and revenue_growth > 0.15:  # > 15% growth
                tags.append("Growth Stock")
            if earnings_growth and earnings_growth > 0.15:
                tags.append("Growth Stock")

            if abs(price_change_percent) > 5:
                tags.append("Momentum Play")

            if sentiment_score < -0.3:
                tags.append("Good for Puts")
            elif sentiment_score > 0.3:
                tags.append("Stock to buy")

            if options_analysis and options_analysis.get("has_opportunities"):
                tags.append("Options Opportunity")

            # Remove duplicates while preserving order
            seen = set()
            unique_tags = []
            for tag in tags:
                if tag not in seen:
                    seen.add(tag)
                    unique_tags.append(tag)

            return unique_tags

        except Exception as e:
            # Return empty list on error
            return []

    async def test_connection(self) -> Dict[str, Any]:
        """
        Test the Anthropic API connection.

        Returns:
            Dict containing connection test result
        """
        try:
            response = await self.client.messages.create(
                max_tokens=10,
                model=self.anthropic_model,
                messages=[
                    {
                        "role": "user",
                        "content": "Say hello!",
                    }
                ],
            )

            return {
                "success": True,
                "message": "Anthropic API connection successful",
                "response": (
                    response.content[0].text if response.content else "No content"
                ),
            }

        except Exception as e:
            return {
                "success": False,
                "error": f"Anthropic API connection failed: {str(e)}",
            }


# Global instance for use across the application
anthropic_service = AnthropicService()
