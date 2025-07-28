/**
 * Enhanced research topic function with category-specific data retrieval
 */
//TODO implement remaining functions 
import { 
    fetchNewsApi, 
    fetchSerpAPIData, 
    fetchStockData, 
    fetchSportsData, 
    fetchScienceData 
  } from './research/categoryResearchers.ts';
  import { generateCategoryPrompt } from './prompts/categoryPrompts.ts';
  import { TopicDetails, PriorityLevel, ResearchResult } from "../../shared/types/client.ts"
  
  /**
   * Category-specific research strategies
   */
  const RESEARCH_STRATEGIES = {
    stocks: {
      dataSources: ['alpha_vantage', 'news', 'serp'],
      prioritySources: ['alpha_vantage'],
      promptStyle: 'financial_analysis',
      cacheExpiry: 1, // 1 hour for stocks (fast-moving data)
    },
    sports: {
      dataSources: ['news', 'serp', 'sports_api'],
      prioritySources: ['sports_api', 'news'],
      promptStyle: 'sports_coverage',
      cacheExpiry: 6, // 6 hours for sports
    },
    news: {
      dataSources: ['news', 'serp'],
      prioritySources: ['news'],
      promptStyle: 'news_reporting',
      cacheExpiry: 2, // 2 hours for news
    },
    technology: {
      dataSources: ['news', 'serp', 'tech_apis'],
      prioritySources: ['serp', 'news'],
      promptStyle: 'tech_analysis',
      cacheExpiry: 12, // 12 hours for tech
    },
    science: {
      dataSources: ['news', 'serp', 'research_apis'],
      prioritySources: ['research_apis', 'serp'],
      promptStyle: 'scientific_reporting',
      cacheExpiry: 24, // 24 hours for science
    },
    evergreen: {
      dataSources: ['serp', 'news'],
      prioritySources: ['serp'],
      promptStyle: 'evergreen_content',
      cacheExpiry: 168, // 1 week for evergreen
    },
  };
  
  /**
   * Enhanced research topic function with category-based optimization
   */
  async function researchTopic(
    supabase: any,
    topic: TopicDetails,
    category: string,
    priority?: PriorityLevel
  ): Promise<ResearchResult> {
    console.log("=== ENHANCED RESEARCH TOPIC START ===");
    console.log(`Researching topic: "${topic.name}" in category: "${category}"`);
  
    // Get research strategy for category
    const strategy = RESEARCH_STRATEGIES[category] || RESEARCH_STRATEGIES.evergreen;
    console.log(`Using research strategy for ${category}:`, strategy);
  
    // Check cache with category-specific expiry
    const cachedData = await fetchCacheTopicWithExpiry(
      supabase, 
      topic.name, 
      topic.id, 
      strategy.cacheExpiry
    );
    if (cachedData) {
      console.log("Returning cached data");
      return cachedData;
    }
  
    let cacheRecordId = null;
  
    try {
      // Create pending cache record
      if (topic.id) {
        cacheRecordId = await createPendingCacheRecord(supabase, topic.id);
      }
  
      // Get API keys
      const keys = await fetchAPIKeys();
      if (!keys) {
        throw new Error("Failed to fetch API keys");
      }
  
      // Execute category-specific research
      const researchResult = await executeCategoryResearch(
        topic,
        category,
        strategy,
        keys,
        priority
      );
  
      // Save to cache
      if (topic.id && cacheRecordId) {
        await updateCacheWithResults(supabase, cacheRecordId, researchResult);
      }
  
      console.log("=== ENHANCED RESEARCH TOPIC SUCCESS ===");
      return researchResult;
  
    } catch (error) {
      console.error("=== ENHANCED RESEARCH TOPIC ERROR ===");
      console.error("Research error:", error);
  
      // Update cache with error status
      if (topic.id && cacheRecordId) {
        await updateCacheWithError(supabase, cacheRecordId, error);
      }
  
      throw new Error(`Error researching the topic: ${error.message}`);
    }
  }
  
  /**
   * Execute research based on category strategy
   */
  async function executeCategoryResearch(
    topic: TopicDetails,
    category: string,
    strategy: any,
    keys: any,
    priority?: PriorityLevel
  ): Promise<ResearchResult> {
    console.log(`Executing ${category} research strategy...`);
    
    const researchPromises: Promise<any>[] = [];
    const researchResult: ResearchResult = {
      newsArticles: [],
      serpApiData: [],
      stockData: null,
      sportsData: null,
      scienceData: null,
      trendingInfo: [],
      statistics: [],
      recentDevelopments: [],
      keyFacts: [],
      category,
      promptStyle: strategy.promptStyle,
    };
  
    // Execute category-specific data collection
    switch (category) {
      case 'stocks':
        console.log("Fetching stock-specific data...");
        
        // Priority 1: Alpha Vantage stock data
        if (strategy.dataSources.includes('alpha_vantage')) {
          researchPromises.push(
            fetchStockData(topic.name, keys.ALPHA_VANTAGE_API_KEY, priority)
              .then(data => ({ type: 'stock', data }))
              .catch(err => {
                console.warn("Alpha Vantage fetch failed:", err);
                return { type: 'stock', data: null };
              })
          );
        }
        
        // Priority 2: Financial news
        if (strategy.dataSources.includes('news')) {
          researchPromises.push(
            fetchNewsApi(`${topic.name} stock financial`, keys.NEWS_API_KEY, priority)
              .then(data => ({ type: 'news', data }))
              .catch(err => {
                console.warn("News API fetch failed:", err);
                return { type: 'news', data: [] };
              })
          );
        }
        
        // Priority 3: SERP for additional context
        if (strategy.dataSources.includes('serp')) {
          researchPromises.push(
            fetchSerpAPIData(`${topic.name} stock analysis market`, keys.SERP_API_KEY, priority)
              .then(data => ({ type: 'serp', data }))
              .catch(err => {
                console.warn("SERP API fetch failed:", err);
                return { type: 'serp', data: [] };
              })
          );
        }
        break;
  
      case 'sports':
        console.log("Fetching sports-specific data...");
        
        if (strategy.dataSources.includes('sports_api')) {
          researchPromises.push(
            fetchSportsData(topic.name, keys.SPORTS_API_KEY, priority)
              .then(data => ({ type: 'sports', data }))
              .catch(err => {
                console.warn("Sports API fetch failed:", err);
                return { type: 'sports', data: null };
              })
          );
        }
        
        if (strategy.dataSources.includes('news')) {
          researchPromises.push(
            fetchNewsApi(`${topic.name} sports`, keys.NEWS_API_KEY, priority)
              .then(data => ({ type: 'news', data }))
              .catch(err => {
                console.warn("Sports news fetch failed:", err);
                return { type: 'news', data: [] };
              })
          );
        }
        break;
  
      case 'science':
        console.log("Fetching science-specific data...");
        
        if (strategy.dataSources.includes('research_apis')) {
          researchPromises.push(
            fetchScienceData(topic.name, keys.RESEARCH_API_KEY, priority)
              .then(data => ({ type: 'science', data }))
              .catch(err => {
                console.warn("Science API fetch failed:", err);
                return { type: 'science', data: null };
              })
          );
        }
        
        if (strategy.dataSources.includes('news')) {
          researchPromises.push(
            fetchNewsApi(`${topic.name} science research`, keys.NEWS_API_KEY, priority)
              .then(data => ({ type: 'news', data }))
              .catch(err => {
                console.warn("Science news fetch failed:", err);
                return { type: 'news', data: [] };
              })
          );
        }
        break;
  
      default:
        // Default research for news, technology, evergreen
        console.log(`Fetching default research data for ${category}...`);
        
        if (strategy.dataSources.includes('news')) {
          researchPromises.push(
            fetchNewsApi(topic.name, keys.NEWS_API_KEY, priority)
              .then(data => ({ type: 'news', data }))
              .catch(err => {
                console.warn("News API fetch failed:", err);
                return { type: 'news', data: [] };
              })
          );
        }
        
        if (strategy.dataSources.includes('serp')) {
          researchPromises.push(
            fetchSerpAPIData(topic.name, keys.SERP_API_KEY, priority)
              .then(data => ({ type: 'serp', data }))
              .catch(err => {
                console.warn("SERP API fetch failed:", err);
                return { type: 'serp', data: [] };
              })
          );
        }
        break;
    }
  
    // Wait for all research to complete
    const results = await Promise.all(researchPromises);
    
    // Process results
    results.forEach(result => {
      switch (result.type) {
        case 'stock':
          researchResult.stockData = result.data;
          break;
        case 'sports':
          researchResult.sportsData = result.data;
          break;
        case 'science':
          researchResult.scienceData = result.data;
          break;
        case 'news':
          researchResult.newsArticles = result.data;
          break;
        case 'serp':
          researchResult.serpApiData = result.data;
          break;
      }
    });
  
    console.log("Category research completed:", {
      category,
      stockData: !!researchResult.stockData,
      sportsData: !!researchResult.sportsData,
      scienceData: !!researchResult.scienceData,
      newsArticles: researchResult.newsArticles?.length || 0,
      serpResults: researchResult.serpApiData?.length || 0,
    });
  
    return researchResult;
  }
  
  /**
   * Enhanced cache fetching with category-specific expiry
   */
  async function fetchCacheTopicWithExpiry(
    supabase: any,
    topicName?: string,
    topicId?: string,
    expiryHours: number = 24
  ) {
    if (!topicId && !topicName) return null;
  
    console.log(`Checking cache with ${expiryHours}h expiry...`);
    
    try {
      const expiryDate = new Date(Date.now() - expiryHours * 60 * 60 * 1000).toISOString();
      
      let query = supabase
        .from("research_topic_cache")
        .select("*")
        .eq("research_status", "completed")
        .gte("research_date", expiryDate);
  
      if (topicId) {
        query = query.eq("topic_id", topicId);
      } else {
        query = query.eq("topic_name", topicName);
      }
  
      const { data, error } = await query.single();
  
      if (error || !data) {
        console.log("No valid cache found");
        return null;
      }
  
      console.log("Found valid cached data");
      return {
        newsArticles: data.news_articles || [],
        serpApiData: data.serp_api_data || [],
        stockData: data.stock_data || null,
        sportsData: data.sports_data || null,
        scienceData: data.science_data || null,
        trendingInfo: data.trending_info || [],
        statistics: data.statistics || [],
        recentDevelopments: data.recent_developments || [],
        keyFacts: data.key_facts || [],
        category: data.category,
        promptStyle: data.prompt_style,
      };
  
    } catch (error) {
      console.error("Cache fetch error:", error);
      return null;
    }
  }
  
  /**
   * Create pending cache record
   */
  async function createPendingCacheRecord(supabase: any, topicId: string): Promise<string | null> {
    try {
      console.log("Creating pending cache record...");
      const { data, error } = await supabase
        .from("research_topic_cache")
        .insert({
          topic_id: topicId,
          research_status: "pending",
        })
        .select("id")
        .single();
  
      if (error) {
        console.error("Failed to create pending cache record:", error);
        return null;
      }
  
      console.log("Pending cache record created:", data.id);
      return data.id;
    } catch (error) {
      console.error("Error creating pending cache record:", error);
      return null;
    }
  }
  
  /**
   * Update cache with research results
   */
  async function updateCacheWithResults(
    supabase: any, 
    cacheRecordId: string, 
    results: ResearchResult
  ) {
    try {
      console.log("Updating cache with research results...");
      const { error } = await supabase
        .from("research_topic_cache")
        .update({
          news_articles: results.newsArticles,
          serp_api_data: results.serpApiData,
          stock_data: results.stockData,
          sports_data: results.sportsData,
          science_data: results.scienceData,
          trending_info: results.trendingInfo,
          statistics: results.statistics,
          recent_developments: results.recentDevelopments,
          key_facts: results.keyFacts,
          category: results.category,
          prompt_style: results.promptStyle,
          research_status: "completed",
          research_date: new Date().toISOString(),
        })
        .eq("id", cacheRecordId);
  
      if (error) {
        console.error("Failed to update cache:", error);
      } else {
        console.log("Cache updated successfully");
      }
    } catch (error) {
      console.error("Error updating cache:", error);
    }
  }
  
  /**
   * Update cache with error status
   */
  async function updateCacheWithError(
    supabase: any, 
    cacheRecordId: string, 
    error: any
  ) {
    try {
      await supabase
        .from("research_topic_cache")
        .update({
          research_status: "failed",
          error_message: error instanceof Error ? error.message : "Unknown error",
        })
        .eq("id", cacheRecordId);
    } catch (updateError) {
      console.error("Failed to update cache with error:", updateError);
    }
  }
  
  export { researchTopic, RESEARCH_STRATEGIES };