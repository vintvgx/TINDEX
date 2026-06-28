import os
import asyncio
import json
import re
from typing import Dict, Any, Optional, AsyncGenerator, Generator, List
from anthropic import AsyncAnthropic, Anthropic

# Model used for the in-app conversational AI agent (TINDEX assistant).
# Per Anthropic guidance we default to the latest Opus; override via env if needed.
AGENT_MODEL = os.getenv("AGENT_MODEL", "claude-opus-4-8")
# Cheaper/faster model for one-off utility calls (titles, contract scoring).
AGENT_UTILITY_MODEL = os.getenv("AGENT_UTILITY_MODEL", "claude-haiku-4-5")
# Whether to give the agent the server-side web_search tool so it can pull the
# latest market news. Requires web search to be enabled on the Anthropic account.
AGENT_ENABLE_WEB_SEARCH = os.getenv("AGENT_ENABLE_WEB_SEARCH", "true").lower() == "true"


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
        # Synchronous client for the Flask (sync/threaded) agent endpoints. The
        # streaming chat route runs inside a normal request thread, so a sync
        # client + generator is far simpler than bridging async into Flask.
        self.sync_client = Anthropic(
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

    # ── In-app AI agent (TINDEX assistant) ──────────────────────────────────────

    def stream_agent_chat(
        self,
        messages: List[Dict[str, str]],
        system_prompt: str,
        ticker_context: Optional[str] = None,
    ) -> Generator[str, None, None]:
        """
        Stream a conversational reply from the AI agent, yielding text chunks.

        Runs synchronously (intended for a Flask streaming route). Uses the
        server-side web_search tool so the model can pull the latest news, and
        loops on `pause_turn` so a long server-tool turn resumes cleanly.

        Args:
            messages: Full chat history as [{"role": "user"|"assistant", "content": str}].
            system_prompt: The agent persona/instructions (supplied by the client).
            ticker_context: Optional pre-fetched market snapshot text injected as an
                additional system block so the model answers from live data.

        Yields:
            Text fragments of the assistant's reply as they are generated.
        """
        system_blocks: List[Dict[str, Any]] = [{"type": "text", "text": system_prompt}]
        if ticker_context:
            system_blocks.append({
                "type": "text",
                "text": (
                    "Live market data for tickers the user referenced (fetched just now — "
                    "prefer these numbers over your training data):\n\n" + ticker_context
                ),
            })

        tools = []
        if AGENT_ENABLE_WEB_SEARCH:
            tools = [{"type": "web_search_20250305", "name": "web_search", "max_uses": 4}]

        working_messages = [dict(m) for m in messages]

        # Guard against runaway server-tool loops.
        for _ in range(4):
            with self.sync_client.messages.stream(
                model=AGENT_MODEL,
                max_tokens=4096,
                system=system_blocks,
                messages=working_messages,
                tools=tools,
            ) as stream:
                for text in stream.text_stream:
                    yield text
                final = stream.get_final_message()

            if final.stop_reason == "pause_turn":
                # Server-side tool loop paused — re-send to resume.
                working_messages.append({"role": "assistant", "content": final.content})
                continue
            break

    def generate_conversation_title(self, first_message: str) -> str:
        """Generate a short (<= 6 word) title for a new conversation."""
        try:
            response = self.sync_client.messages.create(
                model=AGENT_UTILITY_MODEL,
                max_tokens=24,
                messages=[{
                    "role": "user",
                    "content": (
                        "Write a concise 3-6 word title (no quotes, no period) for a chat that "
                        f"starts with this message:\n\n{first_message[:500]}"
                    ),
                }],
            )
            if response.content:
                title = response.content[0].text.strip().strip('"').strip()
                return title[:120] if title else "New conversation"
        except Exception as e:
            print(f"[agent] title generation failed: {e}")
        # Fallback: first few words of the message.
        words = first_message.strip().split()
        return " ".join(words[:6]) or "New conversation"

    def score_contract(
        self,
        ticker: str,
        contract: Dict[str, Any],
        system_prompt: str,
    ) -> Dict[str, Any]:
        """
        Produce an AI score (0-100) + signal + reasoning for an options contract.

        Returns a dict matching the ContractScore shape the mobile app expects:
        {score, signal, reasoning, factors}.
        """
        prompt = (
            f"Score this {ticker} options contract for a near-term trade on a 0-100 scale "
            "(0 = avoid, 100 = exceptional setup). Weigh the Greeks, implied volatility, "
            "open interest/volume (liquidity), the bid/ask spread, expiry timing, and the "
            "moneyness relative to the underlying.\n\n"
            f"Contract data:\n{json.dumps(contract, indent=2, default=str)}\n\n"
            "Respond with ONLY a JSON object (no markdown, no prose) of exactly this shape:\n"
            "{\n"
            '  "score": <integer 0-100>,\n'
            '  "signal": "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL",\n'
            '  "reasoning": "<2-3 specific, actionable sentences>",\n'
            '  "factors": {\n'
            '    "news_sentiment": <0-100>, "sector_performance": <0-100>,\n'
            '    "market_conditions": <0-100>, "greeks_score": <0-100>, "expiry_timing": <0-100>\n'
            "  }\n"
            "}"
        )

        response = self.sync_client.messages.create(
            model=AGENT_MODEL,
            max_tokens=1024,
            system=system_prompt,
            messages=[{"role": "user", "content": prompt}],
        )

        raw = next((b.text for b in response.content if b.type == "text"), "{}")
        data = self._parse_json_object(raw)

        # Normalize / defensively clamp to the ContractScore contract.
        valid_signals = {"STRONG_BUY", "BUY", "HOLD", "SELL", "STRONG_SELL"}
        try:
            score = max(0, min(100, int(round(float(data.get("score", 50))))))
        except (TypeError, ValueError):
            score = 50
        signal = str(data.get("signal", "HOLD")).upper().replace(" ", "_")
        if signal not in valid_signals:
            signal = "HOLD"
        return {
            "score": score,
            "signal": signal,
            "reasoning": str(data.get("reasoning", "")).strip(),
            "factors": data.get("factors") if isinstance(data.get("factors"), dict) else None,
        }

    @staticmethod
    def _parse_json_object(raw: str) -> Dict[str, Any]:
        """Extract the first JSON object from a model response (handles ```json fences)."""
        if not raw:
            return {}
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
        return {}

    @staticmethod
    def extract_tickers(text: str) -> List[str]:
        """Extract $-prefixed ticker symbols (e.g. '$IWM') from a message, de-duped."""
        matches = re.findall(r"\$([A-Za-z]{1,5})\b", text or "")
        seen: List[str] = []
        for m in matches:
            sym = m.upper()
            if sym not in seen:
                seen.append(sym)
        return seen[:3]  # cap to keep prompts tight

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
