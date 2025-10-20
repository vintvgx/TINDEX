"""
Blog Generation Service Layer

This module provides a centralized interface for blog post generation operations.
It orchestrates AI content generation, research data integration, and database persistence.

Architecture:
- Service layer pattern that coordinates content generation
- Integrates research data with AI generation
- Handles blog post persistence to database
- Provides clean separation between research and generation

Key Responsibilities:
- Generate blog posts using Anthropic AI
- Integrate research data into blog content
- Save blog posts to database with proper associations
- Validate and format blog content
"""

from typing import Dict, Any, Optional
import asyncio
from log import get_logger
from services.anthropic_service import anthropic_service

logger = get_logger(__name__)


class BlogGenerationService:
    """
    Service class for managing blog post generation operations.
    
    This service provides a clean interface for blog generation with:
    - AI-powered content generation
    - Research data integration
    - Database persistence
    - Error handling and validation
    
    Example Usage:
        blog_service = BlogGenerationService(supabase_service)
        result = blog_service.generate_blog_post(
            ticker="AAPL",
            research_data=research_data,
            save_to_db=True,
            research_id="uuid-from-research"
        )
        
        if result["success"]:
            blog_content = result["data"]
            blog_id = result.get("blog_id")
    """
    
    def __init__(self, supabase_service=None):
        """
        Initialize the blog generation service.
        
        Args:
            supabase_service: Optional Supabase service instance for storage
        """
        self.supabase_service = supabase_service
        logger.info("BlogGenerationService initialized")
    
    def generate_blog_post(
        self,
        ticker: str,
        research_data: Dict[str, Any],
        save_to_db: bool | None= False,
        research_id: Optional[str] = None,
        target_length: int = 800
    ) -> Dict[str, Any]:
        """
        Generate a complete blog post using AI and research data.
        
        This method orchestrates the blog generation process:
        1. Validate research data
        2. Generate blog content using Anthropic AI
        3. Save to database (if requested)
        4. Associate with research data
        
        Args:
            ticker: Stock ticker symbol (e.g., "AAPL", "GOOGL")
            research_data: Research data to inform the blog content
            save_to_db: Whether to persist blog post to database
            research_id: Optional research ID to link blog to research
            target_length: Target word count for the blog post
            
        Returns:
            Dict containing:
                - success (bool): Whether the operation succeeded
                - data (dict): Blog content if successful
                - blog_id (str, optional): Database ID if saved
                - error (str, optional): Error message if failed
                
        Example Response:
            {
                "success": True,
                "data": {
                    "title": "Apple Inc.: Market Analysis and Investment Outlook",
                    "content": "...",
                    "ticker": "AAPL",
                    "stock_research_id": "uuid-here"
                },
                "blog_id": "blog-uuid-here",
                "saved": True
            }
        """
        try:
            ticker = ticker.strip().upper()
            logger.info(f"Generating blog post for {ticker} (save={save_to_db})")
            
            # Step 1: Validate research data
            if not isinstance(research_data, dict):
                return {
                    "success": False,
                    "error": "Research data must be a dictionary"
                }
            
            # Step 2: Generate blog content using AI
            blog_content = self._generate_content(
                ticker=ticker,
                research_data=research_data,
                target_length=target_length
            )
            
            if not blog_content:
                return {
                    "success": False,
                    "error": "Blog content generation failed"
                }
            
            # Step 3: Associate with research data
            if research_id:
                blog_content["stock_research_id"] = research_id
            
            # Step 4: Save to database if requested
            blog_id = None
            if save_to_db and self.supabase_service:
                blog_id = self._save_blog_post(blog_content)
            
            return {
                "success": True,
                "data": blog_content,
                "blog_id": blog_id,
                "saved": blog_id is not None
            }
            
        except Exception as e:
            logger.error(f"Blog generation failed for {ticker}: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": f"Blog generation failed: {str(e)}"
            }
    
    def _generate_content(
        self,
        ticker: str,
        research_data: Dict[str, Any],
        target_length: int,
    ) -> Optional[Dict[str, Any]]:
        """
        Generate blog content using Anthropic AI.
        
        Args:
            ticker: Stock ticker symbol
            research_data: Research data to inform content
            target_length: Target word count
            
        Returns:
            Blog content dict if successful, None otherwise
        """
        try:
            # Run async function in sync context
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                blog_content = loop.run_until_complete(
                    anthropic_service.generate_blog_post(
                        topic=ticker,
                        research_data=research_data,
                        target_length=target_length,
                        ticker=ticker
                    )
                )
                return blog_content
            finally:
                loop.close()
                
        except Exception as e:
            logger.error(f"Content generation failed for {ticker}: {str(e)}", exc_info=True)
            return None
    
    def _save_blog_post(self, blog_content: Dict[str, Any]) -> Optional[str]:
        """
        Save blog post to database.
        
        Args:
            blog_content: Blog content to save
            
        Returns:
            Database ID of saved blog post, or None if failed
        """
        try:
            if not self.supabase_service:
                return None
            
            # Verify blog post contains the expected fields
            can_save_blog = (
                isinstance(blog_content, dict)
                and bool(blog_content.get("title"))
                and bool(blog_content.get("content"))
            )
            
            if not can_save_blog:
                logger.warning("Skipping blog save: missing title/content")
                return None
            
            # Set status if not already set
            if "status" not in blog_content:
                blog_content["status"] = "published"
            
            result = self.supabase_service.save_blog_post(blog_content)
            
            if result and result.get("success"):
                blog_id = result.get("data", {}).get("id")
                logger.info(f"Blog post saved with ID: {blog_id}")
                return blog_id
            
            logger.warning("Blog post save returned unexpected result")
            return None
            
        except Exception as e:
            logger.error(f"Failed to save blog post: {str(e)}", exc_info=True)
            return None


# Global instance for use across the application
blog_generation_service = None

def get_blog_service():
    """
    Factory function to get blog generation service instance.
    Uses lazy loading to avoid circular imports.
    """
    global blog_generation_service
    if blog_generation_service is None:
        try:
            from services.supabase_service import get_supabase_service
            blog_generation_service = BlogGenerationService(get_supabase_service())
        except Exception as e:
            logger.warning(f"Could not initialize blog service with Supabase: {e}")
            blog_generation_service = BlogGenerationService(None)
    return blog_generation_service
