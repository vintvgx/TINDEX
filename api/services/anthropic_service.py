import os
import asyncio
import json
from typing import Dict, Any, Optional, AsyncGenerator
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
        self.anthropic_model = "claude-3-5-sonnet-20241022"

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
        target_length: int = 800,
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
        try:
            # Build the prompt with ticker information
            prompt = self._build_blog_prompt(
                topic, research_data, target_length, ticker
            )

            # Create non-streaming request
            response = await self.client.messages.create(
                max_tokens=2048,
                temperature=0.7,
                model="claude-3-5-sonnet-20241022",
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

    async def test_connection(self) -> Dict[str, Any]:
        """
        Test the Anthropic API connection.

        Returns:
            Dict containing connection test result
        """
        try:
            response = await self.client.messages.create(
                max_tokens=10,
                model="claude-3-5-sonnet-20241022",
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
