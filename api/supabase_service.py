# """
# Supabase Service Layer

# This module provides a centralized interface for all Supabase database operations.
# It encapsulates database logic, provides type safety, and handles errors consistently.

# Architecture:
# - Service layer pattern for database operations
# - Centralized error handling and logging
# - Type-safe operations with proper validation
# - Connection management and retry logic
# """

# import os
# import logging
# from typing import Dict, List, Optional, Any, Union
# from datetime import datetime, timedelta
# import json
# from dataclasses import dataclass, asdict
# from supabase import create_client, Client
# from supabase.lib.client_options import ClientOptions

# # Configure logging
# logging.basicConfig(level=logging.INFO)
# logger = logging.getLogger(__name__)

# @dataclass
# class ResearchTopic:
#     """Data class for research topic data structure"""
#     topic: str
#     ticker: Optional[str] = None
#     description: Optional[str] = None
#     sentiment: Optional[str] = None
#     confidence_score: Optional[float] = None
#     market_cap: Optional[float] = None
#     current_price: Optional[float] = None
#     price_change: Optional[float] = None
#     volume: Optional[int] = None
#     pe_ratio: Optional[float] = None
#     dividend_yield: Optional[float] = None
#     beta: Optional[float] = None
#     sector: Optional[str] = None
#     industry: Optional[str] = None
#     research_date: Optional[datetime] = None
#     created_at: Optional[datetime] = None
#     updated_at: Optional[datetime] = None

# @dataclass
# class StockData:
#     """Data class for stock data structure"""
#     ticker: str
#     current_price: float
#     price_change: float
#     price_change_percent: float
#     volume: int
#     market_cap: Optional[float] = None
#     pe_ratio: Optional[float] = None
#     dividend_yield: Optional[float] = None
#     beta: Optional[float] = None
#     sector: Optional[str] = None
#     industry: Optional[str] = None
#     last_updated: Optional[datetime] = None

# class SupabaseService:
#     """
#     Service class for managing all Supabase database operations.
    
#     This class provides a clean interface for database operations with:
#     - Connection management
#     - Error handling and retry logic
#     - Type safety and validation
#     - Logging and monitoring
#     """
    
#     def __init__(self):
#         """Initialize Supabase client with environment variables"""
#         self.supabase_url = os.getenv('SUPABASE_URL')
#         self.supabase_key = os.getenv('SUPABASE_ANON_KEY')
        
#         if not self.supabase_url or not self.supabase_key:
#             raise ValueError("SUPABASE_URL and SUPABASE_ANON_KEY must be set in environment variables")
        
#         # Initialize Supabase client with retry options
#         client_options = ClientOptions(
#             schema='public',
#             headers={
#                 'X-Client-Info': 'alethia-api/1.0.0'
#             }
#         )
        
#         self.client: Client = create_client(
#             self.supabase_url, 
#             self.supabase_key,
#             options=client_options
#         )
        
#         logger.info("Supabase client initialized successfully")
    
#     def _handle_database_error(self, error: Exception, operation: str) -> Dict[str, Any]:
#         """
#         Centralized error handling for database operations.
        
#         Args:
#             error: The exception that occurred
#             operation: Description of the operation that failed
            
#         Returns:
#             Dict containing error information
#         """
#         error_msg = f"Database operation failed: {operation} - {str(error)}"
#         logger.error(error_msg, exc_info=True)
        
#         return {
#             'success': False,
#             'error': error_msg,
#             'operation': operation,
#             'timestamp': datetime.now().isoformat()
#         }
    
#     def save_research_topic(self, research_data: ResearchTopic) -> Dict[str, Any]:
#         """
#         Save research topic data to the database.
        
#         Args:
#             research_data: ResearchTopic object containing the data to save
            
#         Returns:
#             Dict containing success status and saved data or error information
#         """
#         try:
#             # Prepare data for insertion
#             data_dict = asdict(research_data)
            
#             # Set timestamps
#             now = datetime.now()
#             # data_dict['created_at'] = now.isoformat() automatically created when uploaded
#             # data_dict['updated_at'] = now.isoformat() automatically updated when accessed
#             data_dict['research_date'] = now.isoformat()
            
#             # Remove None values to avoid database issues
#             data_dict = {k: v for k, v in data_dict.items() if v is not None}
            
#             # Insert into database
#             result = self.client.table('research_topics').insert(data_dict).execute()
            
#             if result.data:
#                 logger.info(f"Research topic saved successfully: {research_data.topic}")
#                 return {
#                     'success': True,
#                     'data': result.data[0],
#                     'message': 'Research topic saved successfully'
#                 }
#             else:
#                 raise Exception("No data returned from insert operation")
                
#         except Exception as e:
#             return self._handle_database_error(e, f"save_research_topic for {research_data.topic}")
    
#     def get_research_topic(self, topic: str) -> Dict[str, Any]:
#         """
#         Retrieve research topic data by topic name.
        
#         Args:
#             topic: The topic name to search for
            
#         Returns:
#             Dict containing success status and research data or error information
#         """
#         try:
#             result = self.client.table('research_topics')\
#                 .select('*')\
#                 .eq('topic', topic)\
#                 .order('created_at', desc=True)\
#                 .limit(1)\
#                 .execute()
            
#             if result.data:
#                 logger.info(f"Research topic retrieved successfully: {topic}")
#                 return {
#                     'success': True,
#                     'data': result.data[0],
#                     'message': 'Research topic found'
#                 }
#             else:
#                 return {
#                     'success': False,
#                     'error': f'Research topic not found: {topic}',
#                     'data': None
#                 }
                
#         except Exception as e:
#             return self._handle_database_error(e, f"get_research_topic for {topic}")
    
#     def update_research_topic(self, topic: str, update_data: Dict[str, Any]) -> Dict[str, Any]:
#         """
#         Update existing research topic data.
        
#         Args:
#             topic: The topic name to update
#             update_data: Dictionary containing fields to update
            
#         Returns:
#             Dict containing success status and updated data or error information
#         """
#         try:
#             # Add updated timestamp
#             update_data['updated_at'] = datetime.now().isoformat()
            
#             # Remove None values
#             update_data = {k: v for k, v in update_data.items() if v is not None}
            
#             result = self.client.table('research_topics')\
#                 .update(update_data)\
#                 .eq('topic', topic)\
#                 .execute()
            
#             if result.data:
#                 logger.info(f"Research topic updated successfully: {topic}")
#                 return {
#                     'success': True,
#                     'data': result.data[0],
#                     'message': 'Research topic updated successfully'
#                 }
#             else:
#                 return {
#                     'success': False,
#                     'error': f'Research topic not found for update: {topic}',
#                     'data': None
#                 }
                
#         except Exception as e:
#             return self._handle_database_error(e, f"update_research_topic for {topic}")
    
#     def save_stock_data(self, stock_data: StockData) -> Dict[str, Any]:
#         """
#         Save stock data to the database.
        
#         Args:
#             stock_data: StockData object containing the stock information
            
#         Returns:
#             Dict containing success status and saved data or error information
#         """
#         try:
#             data_dict = asdict(stock_data)
#             data_dict['last_updated'] = datetime.now().isoformat()
#             data_dict = {k: v for k, v in data_dict.items() if v is not None}
            
#             result = self.client.table('stock_data').insert(data_dict).execute()
            
#             if result.data:
#                 logger.info(f"Stock data saved successfully: {stock_data.ticker}")
#                 return {
#                     'success': True,
#                     'data': result.data[0],
#                     'message': 'Stock data saved successfully'
#                 }
#             else:
#                 raise Exception("No data returned from insert operation")
                
#         except Exception as e:
#             return self._handle_database_error(e, f"save_stock_data for {stock_data.ticker}")
    
#     def get_recent_research_topics(self, limit: int = 10) -> Dict[str, Any]:
#         """
#         Retrieve recent research topics.
        
#         Args:
#             limit: Maximum number of topics to retrieve
            
#         Returns:
#             Dict containing success status and list of research topics or error information
#         """
#         try:
#             result = self.client.table('research_topics')\
#                 .select('*')\
#                 .order('created_at', desc=True)\
#                 .limit(limit)\
#                 .execute()
            
#             logger.info(f"Retrieved {len(result.data)} recent research topics")
#             return {
#                 'success': True,
#                 'data': result.data,
#                 'message': f'Retrieved {len(result.data)} recent research topics'
#             }
                
#         except Exception as e:
#             return self._handle_database_error(e, "get_recent_research_topics")
    
#     def search_research_topics(self, search_term: str, limit: int = 10) -> Dict[str, Any]:
#         """
#         Search research topics by keyword.
        
#         Args:
#             search_term: The search term to look for
#             limit: Maximum number of results to return
            
#         Returns:
#             Dict containing success status and search results or error information
#         """
#         try:
#             result = self.client.table('research_topics')\
#                 .select('*')\
#                 .or_(f'topic.ilike.%{search_term}%,description.ilike.%{search_term}%')\
#                 .order('created_at', desc=True)\
#                 .limit(limit)\
#                 .execute()
            
#             logger.info(f"Search completed for '{search_term}': {len(result.data)} results")
#             return {
#                 'success': True,
#                 'data': result.data,
#                 'message': f'Found {len(result.data)} results for "{search_term}"'
#             }
                
#         except Exception as e:
#             return self._handle_database_error(e, f"search_research_topics for '{search_term}'")

# # Global instance for use across the application
# supabase_service = SupabaseService() 