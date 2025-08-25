import logging
import sys
import os
from typing import Optional


def _configure_logging_once() -> None:
    """
    Configure logging once to avoid repeated basicConfig calls.
    This function ensures logging is only configured once per application lifecycle.
    """
    # Check if logging is already configured
    if logging.getLogger().handlers:
        return
    
    # Get log level from environment variable, default to INFO
    log_level_str = os.getenv('LOG_LEVEL', 'INFO').upper()
    log_level = getattr(logging, log_level_str, logging.INFO)
    
    # Configure logging for Railway deployment
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),  # Output to stdout for Railway
        ],
    )


def get_logger(name: str) -> logging.Logger:
    """
    Get a logger instance with the specified name.
    
    This function ensures logging is configured once and returns a properly
    configured logger instance that can be used throughout the application.
    
    Args:
        name: The name for the logger (typically __name__)
        
    Returns:
        A configured logging.Logger instance
        
    Example:
        from api.logging_config import get_logger
        
        logger = get_logger(__name__)
        logger.info("Application started")
    """
    _configure_logging_once()
    return logging.getLogger(name) 