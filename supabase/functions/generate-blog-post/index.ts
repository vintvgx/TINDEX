//@ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
//@ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  PROMPT_STYLES,
  TopicDetails,
  TopicReturn,
} from "../shared/types/client.ts";
import {
  NEWS_API_THUNDER_PACERS_DATA_06_16_25,
  SERP_API_THUNDER_PACERS_DATA_06_23_25,
  generateMockAlphaVantageData,
} from "./DATA.ts";
import { formatPrompt } from "../shared/types/prompts.ts";
import {
  ApiKeys,
  BlogGenerationRequest,
  PriorityLevel,
  AlphaVantageData,
  PolygonData,
  PolygonNewsArticle,
  PolygonDailyBar,
} from "../shared/types/requests.ts";
import {
  RESEARCH_STRATEGIES,
  PROMPT_STYLE_TEMPLATES,
  ALLOWED_CATEGORIES,
  API_RATE_LIMITS,
  ERROR_MESSAGES,
} from "../shared/utils/constants.ts";

// Data source function mapping
const DATA_SOURCE_FUNCTIONS = {
  news: fetchNewsApi,
  serp: fetchSerpAPIData,
  alpha_vantage: fetchAlphaVantageData,
  polygon: fetchPolygonData,
  sports_api: async () => {
    return { articles: [] };
  }, // stub
  tech_apis: async () => {
    return { articles: [] };
  }, // stub
  research_apis: async () => {
    return { articles: [] };
  }, // stub
};

/**
 * Supabase serverless function to generate blog post
 *
 * Steps:
 * 1. Connect to supabase
 * 2.
 */
serve(async (req) => {
  console.log("=== BLOG GENERATION START ===");

  // Handle CORS
  if (req.method === "OPTIONS") {
    console.log("CORS preflight request handled");
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
      },
    });
  }

  try {
    let requestBody;

    if (req.method !== "POST") {
      console.log("Invalid method:", req.method);
      throw new Error(
        `Method ${req.method} not allowed. Only POST is supported.`
      );
    }

    //TODO! Delete : Test connectClient() first
    // console.log("Creating Supabase client...");
    // const supabaseUrl = Deno.env.get("SUPABASE_URL");
    // const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    // if (!supabaseUrl) {
    //   throw new Error("SUPABASE_URL environment variable is not set");
    // }

    // if (!supabaseKey) {
    //   throw new Error(
    //     "SUPABASE_SERVICE_ROLE_KEY environment variable is not set"
    //   );
    // }

    // const supabase = createClient(supabaseUrl, supabaseKey);

    const supabase = connectClient();

    if (!supabase) {
      throw new Error("Failed to connect to supabase :(");
    }

    try {
      requestBody = await req.json();
      console.log("Request body parsed:", JSON.stringify(requestBody, null, 2));
    } catch (parseError) {
      console.error("Failed to parse request body:", parseError);
      console.log("Request body parsed:", JSON.stringify(requestBody, null, 2));
      throw new Error(`Invalid JSON in request body`);
    }

    const {
      topicId,
      topicName,
      categoryName,
      userId,
      targetLength = 500, //TODO change this based on the priority status
      priority,
    }: BlogGenerationRequest = requestBody;

    if (!userId) {
      console.error("Validation failed: userId not provided");
      throw new Error("userId is required");
    }

    // Create generation job
    //TODO Create job manager to keep track of job progress instead of calling within functionality
    console.log("Creating generation job...");
    const jobId = crypto.randomUUID();
    const jobInsertData = {
      id: jobId,
      topic_id: topicId ? topicId : null,
      user_id: userId,
      status: "processing",
      current_step: "initializing",
      started_at: new Date().toISOString(),
    };

    const { data: jobData, error: jobError } = await supabase
      .from("generation_jobs")
      .insert(jobInsertData)
      .select();

    if (jobError) {
      console.error("Failed to create generation job:", jobError);
      throw new Error(`Failed to create generation job: ${jobError.message}`);
    }
    console.log("Generation job created successfully");
    //TODO End here

    // Step 1: Get Topic and Category
    console.log("=== STEP 1: Get Topic and Category ===");
    const topicDetails = await getOrCreateTopic(
      supabase,
      topicId,
      topicName,
      categoryName,
      userId,
      priority
    );

    // Step 2: Research Topic
    console.log("=== STEP 2: Researching Topic ===");
    await updateJobProgress(supabase, jobId, 20, "research");
    const researchData = await researchTopic(supabase, topicDetails, priority);

    if (!researchData) {
      console.error("Research failed: No data returned from researchTopic");
      throw new Error("Research phase failed - no data returned");
    }

    console.log("Research completed, data keys:", Object.keys(researchData));

    // Step 2: Generate content
    console.log("=== STEP 2: CONTENT GENERATION ===");
    await updateJobProgress(supabase, jobId, 50, "generation");
    const blogContent = await generateAIContent(
      topicDetails,
      researchData,
      targetLength
    );
    console.log("Content generation completed");

    // Step 3: Enhance
    //TODO enhance?
    console.log("=== STEP 3: ENHANCEMENT ===");
    // await updateJobProgress(supabase, jobId, 80, "enhancement");
    // const enhancedContent = await enhanceWithMedia(blogContent);
    // console.log("Content enhancement completed");

    // Save blog post
    console.log("=== STEP 4: SAVING BLOG POST ===");

    const blogPostData = {
      topic: topicDetails,
      user_id: userId,
      title: blogContent.title,
      content: blogContent.content,
      // meta_description: blogContent.seo?.metaDescription,
      // keywords: blogContent.keywords,
      // hashtags: blogContent.hashtags,
      word_count: blogContent.wordCount,
      reading_time: blogContent.readingTime,
      status: "published",
      generation_job_id: jobId,
      // seo_data: enhancedContent.seo,
      // multimedia_data: blogContent.multimedia,
      research_data: researchData,
      published_at: new Date().toISOString(),
    };
    console.log(
      "Blog post data to insert:",
      JSON.stringify(blogPostData, null, 2)
    );

    // Adds the blog post to DB
    const { data: blogPost, error: insertError } = await supabase
      .from("blog_posts")
      .insert(blogPostData)
      .select()
      .single();

    if (insertError) {
      console.error("Failed to insert blog post:", insertError);
      throw new Error(`Failed to save blog post: ${insertError.message}`);
    }

    console.log("Blog post saved successfully, ID:", blogPost.id);

    // Complete job
    console.log("=== STEP 5: COMPLETING JOB ===");
    await updateJobProgress(supabase, jobId, 100, "completed");

    const jobUpdateData = {
      status: "completed",
      completed_at: new Date().toISOString(),
      result_data: { blog_post_id: blogPost.id, result: blogPost.status },
    };
    console.log("Job completion data:", JSON.stringify(jobUpdateData, null, 2));

    const { error: jobCompleteError } = await supabase
      .from("generation_jobs")
      .update(jobUpdateData)
      .eq("id", jobId);

    if (jobCompleteError) {
      console.error("Failed to complete job:", jobCompleteError);
      throw new Error(`Failed to complete job: ${jobCompleteError.message}`);
    }

    console.log("Job completed successfully");
    const successResponse = {
      success: true,
      jobId,
      blogPostId: blogPost.id,
      message: "Blog post generated successfully",
      blogPostData: blogPostData,
    };

    console.log(
      "Returning success response:",
      JSON.stringify(successResponse, null, 2)
    );
    console.log("=== BLOG GENERATION SUCCESS ===");

    return new Response(JSON.stringify(successResponse), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      status: 200,
    });
  } catch (error) {
    console.error("=== BLOG GENERATION ERROR ===");
    console.error("Error type:", error.constructor.name);
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    console.error("Error cause:", error.cause);
    console.error(
      "Full error object:",
      JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
    );

    const errorResponse = {
      success: false,
      error: error.message,
      details: error.stack,
      errorType: error.constructor.name,
    };
    console.log(
      "Returning error response:",
      JSON.stringify(errorResponse, null, 2)
    );

    return new Response(JSON.stringify(errorResponse), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      status: 500,
    });
  }
});

async function updateJobProgress(
  supabase: any,
  jobId: string,
  progress: number,
  step: string
) {
  console.log(`Updating job progress: ${progress}% - ${step}`);
  try {
    const updateData = {
      progress,
      current_step: step,
    };
    console.log(
      "Job progress update data:",
      JSON.stringify(updateData, null, 2)
    );

    const { error } = await supabase
      .from("generation_jobs")
      .update(updateData)
      .eq("id", jobId);

    if (error) {
      console.error("Failed to update job progress:", error);
      throw new Error(`Failed to update job progress: ${error.message}`);
    }
    console.log("Job progress updated successfully");
  } catch (error) {
    console.error("Error in updateJobProgress:", error);
    throw error;
  }
}

/**
 * Looks up the data of the specified topic and returns information on the topic.
 * First, checks if the topic has any data available in the cache
 *
 * @param supabase DB
 * @param topic name of searched topic
 * @param priority level of topic request
 * @returns
 */
async function researchTopic(
  supabase: any,
  topic: TopicDetails,
  priority?: PriorityLevel
) {
  console.log("=== RESEARCH TOPIC START ===");
  console.log(`Researching topic: "${JSON.stringify(topic, null, 2)}"`);

  // Go through cache data and return if data is found, else continue to research topic
  let cachedData = await fetchCacheTopic(supabase, topic.name, topic.id);
  if (cachedData) return cachedData;

  // The record for the data being cached
  let cacheRecordId = null;

  // No cache data for topic - start new research
  try {
    console.log("Starting fresh research...");

    // Set initial status to pending if we have a topicId
    if (topic.id) {
      // Start new search by creating cache record (update with information after completing research)
      console.log("Creating pending cache record...");
      try {
        const pendingData = {
          topic: topic,
          topic_id: topic.id,
          research_status: "pending",
        };
        console.log(
          "Pending cache data:",
          JSON.stringify(pendingData, null, 2)
        );

        const { data: pendingRecord, error: insertError } = await supabase
          .from("research_topic_cache")
          .insert(pendingData)
          .select("id")
          .single();

        if (insertError) {
          console.error("Failed to create cache record:", insertError);
          // Continue without caching
        } else if (pendingRecord) {
          // Cache record successfully created - set cacheRecordID
          cacheRecordId = pendingRecord.id;
          console.log("Pending cache record created with ID:", cacheRecordId);
        }
      } catch (pendingError) {
        console.error("Error creating pending cache record:", pendingError);
        // Continue without caching
      }
    }

    // Get API keys
    const keys: ApiKeys | undefined = await fetchAPIKeys();
    if (!keys) throw new Error("Failed to fetch API keys");

    // Get strategy for this category
    const categoryKey =
      typeof topic.category === "string" && RESEARCH_STRATEGIES[topic.category]
        ? topic.category
        : "evergreen";
    console.log(`Research Topic | categoryKey : ${categoryKey}`);
    const strategy = RESEARCH_STRATEGIES[categoryKey];
    console.log(`Research Topic | strategy : ${strategy}`);

    const researchResult: any = {};

    // TODO: DEPRECATED - delete when new functionality is verified
    // console.log("Fetching news data...");
    // const newsApiData = await fetchNewsApi(
    //   topic.name,
    //   keys.NEWS_API_KEY,
    //   priority
    // );
    // console.log("News API data received:", {
    //   articlesCount: newsApiData.articles?.length || 0,
    //   status: newsApiData.status,
    //   totalResults: newsApiData.totalResults,
    // });

    // console.log("Fetching SERP data...");
    // const serpData = await fetchSerpAPIData(
    //   topic.name,
    //   keys.SERP_API_KEY,
    //   priority
    // );

    // if (topic.category == "stocks") {
    //   console.log("Fetching Alpha Vantage Stock Data");
    //   const alphaData = await fetchAlphaVantageData(
    //     topic.name,
    //     keys.ALPHA_API_KEY,
    //     priority
    //   );

    // Dynamically call each data source (sequential for now)
    for (const source of strategy.dataSources) {
      const fetchFn = DATA_SOURCE_FUNCTIONS[source];
      if (!fetchFn) {
        console.warn(`No fetch function for data source: ${source}`);
        continue;
      }

      try {
        let result;
        if (source === "news") {
          console.log(`Fetching news for ${topic.name}`);
          result = await fetchFn(topic.name, keys.NEWS_API_KEY, priority);
          researchResult.newsArticles = result;
        } else if (source === "serp") {
          console.log(
            `Fetching serp for ${topic.name} (category: ${topic.category})`
          );
          result = await fetchFn(topic, keys.SERP_API_KEY, priority);
          researchResult.serpApiData = result;
        } else if (source === "alpha_vantage") {
          //TODO apply a field in topic for ticker / grab ticker from topic name to better optimize ticker data fetching
          console.log(`Fetching alpha vantage for ticker: ${topic.name}`);
          result = await fetchFn(topic, keys.ALPHA_API_KEY, priority);
          researchResult.alphaVantageData = result;
        } else if (source === "polygon") {
          console.log(`Fetching polygon data for ticker: ${topic.name}`);
          result = await fetchFn(topic, keys.POLYGON_API_KEY, priority);
          researchResult.polygonData = result;
        } else {
          // For custom APIs, pass what is needed
          result = await fetchFn(topic.name, keys, priority);
          researchResult[source] = result;
        }

        console.log(`Successfully fetched data from ${source}`);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(`Failed to fetch data from ${source}:`, errorMessage);
        // Continue with other data sources instead of failing completely
        // Set empty defaults for failed sources
        if (source === "news") {
          researchResult.newsArticles = {
            articles: [],
            status: "error",
            error: errorMessage,
          };
        } else if (source === "serp") {
          researchResult.serpApiData = {
            status: "error",
            error: errorMessage,
          };
        } else if (source === "alpha_vantage") {
          researchResult.alphaVantageData = {
            companyOverview: null,
            recentNews: [],
            realTimeData: null,
            error: errorMessage,
          };
        } else if (source === "polygon") {
          researchResult.polygonData = {
            tickerDetails: null,
            recentNews: [],
            dailyBars: [],
            previousClose: null,
            error: errorMessage,
          };
        } else {
          researchResult[source] = { error: errorMessage };
        }
      }
    }

    // Fill in empty arrays for expected fields if not set
    researchResult.trendingInfo = researchResult.trendingInfo || [];
    researchResult.statistics = researchResult.statistics || [];
    researchResult.recentDevelopments = researchResult.recentDevelopments || [];
    researchResult.keyFacts = researchResult.keyFacts || [];

    console.log("Research Results: ", JSON.stringify(researchResult, null, 2));

    // Save successful research data to cache
    if (topic && cacheRecordId) {
      console.log("Updating cache with research results...");
      try {
        const cacheUpdateData = {
          news_articles: researchResult.newsArticles,
          trending_info: researchResult.trendingInfo,
          statistics: researchResult.statistics,
          recent_developments: researchResult.recentDevelopments,
          key_facts: researchResult.keyFacts,
          serp_api_data: researchResult.serpApiData,
          alpha_vantage_data: researchResult.alphaVantageData,
          polygon_data: researchResult.polygonData,
          research_status: "completed",
        };

        const { error: updateError } = await supabase
          .from("research_topic_cache")
          .update(cacheUpdateData)
          .eq("id", cacheRecordId);

        if (updateError) {
          console.error("Failed to update cache:", updateError);
        } else {
          console.log("Research data cached successfully");
        }
      } catch (updateError) {
        console.error("Error updating cache:", updateError);
      }
    }

    console.log("=== RESEARCH TOPIC SUCCESS ===");
    return researchResult;
  } catch (error) {
    console.error("=== RESEARCH TOPIC ERROR ===");
    console.error("Research error:", error);

    // Update cache with error status if we have a record
    if (topic && cacheRecordId) {
      console.log("Updating cache with error status...");
      try {
        await supabase
          .from("research_topic_cache")
          .update({
            research_status: "failed",
            error_message:
              error instanceof Error ? error.message : "Unknown error",
          })
          .eq("id", cacheRecordId);
        console.log("Cache updated with error status");
      } catch (updateError) {
        console.error("Failed to update cache with error:", updateError);
      }
    }
    throw new Error("Error researching the topic", error);
  }
}

async function fetchNewsApi(
  topic: string,
  apiKey: string,
  priority?: PriorityLevel
) {
  console.log("=== FETCH NEWS API START ===");
  console.log("Topic:", topic);
  console.log("API Key exists:", !!apiKey);

  if (priority == PriorityLevel.DEBUG) {
    //Return mocked data if debugging
    console.log(
      "Debugging enabled. Returning NEWS API THUNDER PACERS 06/16/2025 data..."
    );
    return NEWS_API_THUNDER_PACERS_DATA_06_16_25;
  }
  //TODO move data to its own json file and load dynamically as such
  // export const loadSerpOcgnData = () => import('./data/serp-ocgn-data.json');

  if (!apiKey) {
    //TODO remove / fetchAPIKeys throws an error if the keys are not present
    console.warn("No News API key provided, returning empty result");
    return { articles: [] };
  }

  try {
    const encodedTopic = encodeURIComponent(topic);
    const url = `https://newsapi.org/v2/everything?q=${encodedTopic}&sortBy=publishedAt&apiKey=${apiKey}&pageSize=5`;
    console.debug(
      "News API URL (without key):",
      url.replace(apiKey, "[REDACTED]")
    );

    console.log("Making News API request...");
    const newsResponse = await fetch(url);
    console.log("News API response status:", newsResponse.status);
    console.log("News API response ok:", newsResponse.ok);

    if (!newsResponse.ok) {
      const errorText = await newsResponse.text();
      console.error("News API error response:", errorText);
      throw new Error(
        `News API request failed with status ${newsResponse.status}: ${errorText}`
      );
    }

    console.log("Parsing News API response...");
    const newsData = await newsResponse.json();
    console.log("News API response data:", {
      status: newsData.status,
      totalResults: newsData.totalResults,
      articles: newsData.articles,
    });

    if (newsData.status === "error") {
      console.error("News API returned error:", newsData);
      throw new Error(`News API error: ${newsData.message || "Unknown error"}`);
    }

    console.log(`News Api Processed Data: ${newsData}`);

    console.log("=== FETCH NEWS API SUCCESS ===");
    return newsData;
  } catch (error) {
    console.error("=== FETCH NEWS API ERROR ===");
    console.error("NewsApi request failed:", error);
    throw new Error(`News API fetch failed: ${error.message}`);
  }
}

/**
 * Utility function to make API requests with timeout and error handling
 */
async function makeApiRequest(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error(ERROR_MESSAGES.REQUEST_TIMEOUT);
    }
    throw error;
  }
}

/**
 * Check if Alpha Vantage response indicates rate limiting
 */
function isAlphaVantageRateLimited(response: any): boolean {
  return (
    response &&
    response.Note &&
    (response.Note.includes("rate limit") ||
      response.Note.includes("API key") ||
      response.Note.includes("premium"))
  );
}

/**
 * Fetch data from Alpha Vantage (stocks) data
 *
 * Returns structured stock data including company overview, news, and real-time pricing
 * Implements rate limiting protection and efficient request strategy
 */
async function fetchAlphaVantageData(
  topic: TopicDetails,
  apiKey: string,
  priority?: PriorityLevel
): Promise<AlphaVantageData> {
  console.log("=== FETCH ALPHA VANTAGE API START ===");
  console.debug("Ticker:", topic.name);
  console.debug("API Key exists:", !!apiKey);

  if (!apiKey) {
    console.warn("ALPHA_API_KEY not found, returning empty result");
    return {
      companyOverview: null,
      recentNews: [],
      realTimeData: null,
      error: "API key not provided",
    };
  }

  if (priority == PriorityLevel.DEBUG) {
    //Return mocked data if debugging
    console.log("Debugging enabled. Returning mock Alpha Vantage data...");
    return generateMockAlphaVantageData(topic.name);
  }

  try {
    // Extract ticker symbol (remove any additional text)
    const tickerSymbol = extractTickerSymbol(topic.name);
    const encodedTicker = encodeURIComponent(tickerSymbol);

    console.log(`Fetching Alpha Vantage data for ticker: ${tickerSymbol}`);

    // Sequential requests to minimize API usage and handle rate limits gracefully
    // Start with the most important data first (company overview)
    let companyOverview = null;
    let recentNews = [];
    let realTimeData = null;
    let rateLimitHit = false;

    // 1. Company Overview (most important for financial analysis)
    try {
      console.log("Fetching company overview...");
      const overviewResponse = await makeApiRequest(
        `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodedTicker}&apikey=${apiKey}`,
        {},
        API_RATE_LIMITS.ALPHA_VANTAGE.REQUEST_TIMEOUT_MS
      );

      if (overviewResponse.ok) {
        const overviewData = await overviewResponse.json();

        // Check for rate limit message
        if (isAlphaVantageRateLimited(overviewData)) {
          console.warn("Alpha Vantage rate limit detected in overview request");
          rateLimitHit = true;
        } else if (
          overviewData &&
          Object.keys(overviewData).length > 0 &&
          !overviewData.Note
        ) {
          companyOverview = overviewData;
          console.log("Company overview data retrieved successfully");
        } else {
          console.warn("No company overview data available");
        }
      } else {
        console.warn(
          `Company overview request failed with status: ${overviewResponse.status}`
        );
      }
    } catch (error) {
      console.warn("Company overview request failed:", error);
    }

    // 2. Recent News (if rate limit not hit)
    if (!rateLimitHit) {
      try {
        console.log("Fetching recent news...");
        const newsResponse = await makeApiRequest(
          `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${encodedTicker}&time_from=20250101T0000&time_to=20250131T2359&limit=5&sort=LATEST&apikey=${apiKey}`,
          {},
          API_RATE_LIMITS.ALPHA_VANTAGE.REQUEST_TIMEOUT_MS
        );

        if (newsResponse.ok) {
          const newsData = await newsResponse.json();

          // Check for rate limit message
          if (isAlphaVantageRateLimited(newsData)) {
            console.warn("Alpha Vantage rate limit detected in news request");
            rateLimitHit = true;
          } else if (
            newsData &&
            newsData.feed &&
            Array.isArray(newsData.feed)
          ) {
            recentNews = newsData.feed;
            console.log(`Retrieved ${recentNews.length} news articles`);
          } else {
            console.warn("No news data available");
          }
        } else {
          console.warn(
            `News request failed with status: ${newsResponse.status}`
          );
        }
      } catch (error) {
        console.warn("News request failed:", error);
      }
    }

    // 3. Real-time data (if rate limit not hit)
    if (!rateLimitHit) {
      try {
        console.log("Fetching real-time data...");
        const timeSeriesResponse = await makeApiRequest(
          `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodedTicker}&outputsize=compact&apikey=${apiKey}`,
          {},
          API_RATE_LIMITS.ALPHA_VANTAGE.REQUEST_TIMEOUT_MS
        );

        if (timeSeriesResponse.ok) {
          const timeSeriesData = await timeSeriesResponse.json();

          // Check for rate limit message
          if (isAlphaVantageRateLimited(timeSeriesData)) {
            console.warn(
              "Alpha Vantage rate limit detected in time series request"
            );
            rateLimitHit = true;
          } else if (
            timeSeriesData &&
            timeSeriesData["Meta Data"] &&
            !timeSeriesData.Note
          ) {
            realTimeData = timeSeriesData;
            console.log("Real-time data retrieved successfully");
          } else {
            console.warn("No real-time data available");
          }
        } else {
          console.warn(
            `Time series request failed with status: ${timeSeriesResponse.status}`
          );
        }
      } catch (error) {
        console.warn("Time series request failed:", error);
      }
    }

    const result = {
      companyOverview,
      recentNews,
      realTimeData,
      error: rateLimitHit ? ERROR_MESSAGES.ALPHA_VANTAGE_RATE_LIMIT : null,
    };

    if (rateLimitHit) {
      console.warn("=== ALPHA VANTAGE RATE LIMIT WARNING ===");
      console.warn("Some or all Alpha Vantage requests hit rate limit");
      console.warn(
        "Consider upgrading to premium plan or implementing request caching"
      );
    } else {
      console.log("=== FETCH ALPHA VANTAGE API SUCCESS ===");
    }

    return result;
  } catch (error) {
    console.error("=== FETCH ALPHA VANTAGE API ERROR ===");
    console.error("Alpha Vantage API request failed:", error);

    return {
      companyOverview: null,
      recentNews: [],
      realTimeData: null,
      error: `Alpha Vantage API fetch failed: ${error.message}`,
    };
  }
}

/**
 * Extract ticker symbol from topic string
 * Removes any additional text and returns just the ticker symbol
 */
function extractTickerSymbol(topic: string): string {
  // Remove common words and extract just the ticker
  const cleanTopic = topic
    .toUpperCase()
    .replace(/\s+/g, "") // Remove spaces
    .replace(/[^A-Z0-9]/g, ""); // Keep letters and numbers

  // If it looks like a ticker (3-5 characters, mostly letters), return it
  if (
    cleanTopic.length >= 2 &&
    cleanTopic.length <= 5 &&
    /^[A-Z]+[0-9]*$/.test(cleanTopic)
  ) {
    return cleanTopic;
  }

  // Otherwise, try to extract a ticker pattern
  const tickerMatch = topic.match(/[A-Z]{2,5}/);
  return tickerMatch ? tickerMatch[0] : cleanTopic.slice(0, 5);
}

/**
 * Fetch data from SerpAPI for search results
 */
async function fetchSerpAPIData(
  topic: TopicDetails,
  apiKey: string,
  priority?: PriorityLevel
) {
  console.log("=== FETCH SERP API START ===");
  console.debug("Topic:", topic);
  console.debug("API Key exists:", !!apiKey);

  if (priority == PriorityLevel.DEBUG) {
    //Return mocked data if debugging
    console.log(
      "Debugging enabled. Returning SERP_API_THUNDER_PACERS_DATA 06/23/25 data..."
    );
    return SERP_API_THUNDER_PACERS_DATA_06_23_25;
  }

  try {
    // Build category-aware query
    const searchQuery = topic.category
      ? buildGoogleSearchQuery(topic)
      : topic.name;
    console.log("Search query: ", searchQuery);

    const encodedTopic = encodeURIComponent(searchQuery);
    const url = `https://serpapi.com/search.json?q=${encodedTopic}&api_key=${apiKey}&engine=google&num=10`;
    console.log(
      "SERP API URL (without key):",
      url.replace(apiKey, "[REDACTED]")
    );

    console.log("Making SERP API request...");
    const serpResponse = await fetch(url);
    console.log("SERP API response status:", serpResponse.status);
    console.log("SERP API response ok:", serpResponse.ok);

    if (!serpResponse.ok) {
      const errorText = await serpResponse.text();
      console.error("SERP API error response:", errorText);
      throw new Error(
        `SerpAPI request failed with status ${serpResponse.status}: ${errorText}`
      );
    }

    console.log("Parsing SERP API response...");
    const serpData = await serpResponse.json();
    console.log("SERP API response data keys:", Object.keys(serpData));
    console.log(
      "SERP API organic results count:",
      serpData.organic_results?.length || 0
    );

    if (serpData.error) {
      console.error("SERP API returned error:", serpData.error);
      throw new Error(`SERP API error: ${serpData.error}`);
    }

    console.log("Processing results...");
    const processedData = {
      status: serpData.search_metadata.status,
      title: serpData.search_parameters.q,
      organicResults: serpData.organic_results,
      topStories: serpData.top_stories,
      metadata: serpData.search_metadata,
    };

    console.log(`Serp Api Processed Data: ${processedData}`);

    // console.log("Processed SERP results count:", processedResults.length);
    console.log("=== FETCH SERP API SUCCESS ===");
    return processedData;
  } catch (error) {
    console.error("=== FETCH SERP API ERROR ===");
    console.error("SerpAPI request failed:", error);
    // Return empty array instead of throwing to prevent breaking the flow
    console.log("Returning empty SERP results due to error");
    return [];
  }
}

/**
 * Uses claude to generate a blog post based on the specified topic.
 */
async function generateAIContent(
  topic: TopicDetails,
  researchData: any,
  targetLength: number
) {
  console.log("=== GENERATE AI CONTENT START ===");
  console.log(`Topic: "${topic.name}"`);
  console.log("Target length:", targetLength);
  console.log("Research data available:", !!researchData);

  //TODO apply to generateKeys function
  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
  console.log("Anthropic API Key exists:", !!anthropicApiKey);

  if (!anthropicApiKey) {
    console.error("ANTHROPIC_API_KEY not found");
    throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  }

  try {
    // Use prompt style from strategy
    const categoryKey =
      typeof topic.category === "string" && RESEARCH_STRATEGIES[topic.category]
        ? topic.category
        : "evergreen";

    console.log("🚀 ~ categoryKey:", categoryKey);

    const strategy = RESEARCH_STRATEGIES[categoryKey];
    const promptStyleKey =
      typeof strategy.promptStyle === "string" &&
      PROMPT_STYLE_TEMPLATES[strategy.promptStyle]
        ? strategy.promptStyle
        : "evergreen_content";
    const promptTemplate = PROMPT_STYLE_TEMPLATES[promptStyleKey];
    if (!promptTemplate)
      throw new Error(`No prompt template for style: ${promptStyleKey}`);
    const prompt = promptTemplate(topic.name, researchData, targetLength);

    const requestBody = {
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 2048,
      temperature: 0.7,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    };

    console.log("Making Anthropic API request...");
    console.log("Request body:", JSON.stringify(requestBody, null, 2));

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    console.log("Anthropic API response status:", response.status);
    console.log("Anthropic API response ok:", response.ok);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Anthropic API error response:", errorText);
      throw new Error(
        `Anthropic API request failed with status ${response.status}: ${errorText}`
      );
    }

    console.log("Parsing Anthropic API response...");
    const data = await response.json();
    console.log("Anthropic API response data keys:", Object.keys(data));
    console.log("Content array length:", data.content?.length || 0);

    if (!data.content || !data.content[0] || !data.content[0].text) {
      console.error("Invalid response structure from Anthropic API:", data);
      throw new Error("Invalid response structure from Anthropic API");
    }

    const rawContent = data.content[0].text;
    console.log("Generated content length:", rawContent.length);
    console.log(
      "Generated content preview:",
      rawContent.substring(0, 200) + "..."
    );

    // Parse the AI response to extract title and clean content
    const { title, content } = parseAIResponse(rawContent, topic.name);

    const result = {
      title: title,
      content: content,
      // keywords: [topic.toLowerCase()],
      // hashtags: [`#${topic.replace(/\s+/g, "")}`],
      wordCount: content.split(" ").length,
      readingTime: Math.ceil(content.split(" ").length / 200),
      researchData,
    };

    console.log("AI content generation result:", {
      title: result.title,
      wordCount: result.wordCount,
      readingTime: result.readingTime,
      // keywordsCount: result.keywords.length,
      // hashtagsCount: result.hashtags.length,
      researchData,
    });

    console.log("=== GENERATE AI CONTENT SUCCESS ===");
    return result;
  } catch (error) {
    console.error("=== GENERATE AI CONTENT ERROR ===");
    console.error("AI generation error:", error);
    throw new Error("Error generating blog post from Anthropic API");
  }
}

/**
 * Parse AI response to extract title and clean content
 */
function parseAIResponse(
  rawContent: string,
  topicName: string
): { title: string; content: string } {
  console.log("=== PARSING AI RESPONSE ===");
  console.log("Raw Content:", rawContent);

  // Default fallback values
  let title = `Comprehensive Analysis: ${topicName}`;
  let content = rawContent;

  try {
    // Look for TITLE: pattern in the response
    const titleMatch = rawContent.match(/TITLE:\s*(.+?)(?:\n|$)/i);
    if (titleMatch && titleMatch[1]) {
      title = titleMatch[1].trim();
      console.log("Extracted title:", title);

      // Remove the title line from content
      content = rawContent.replace(/TITLE:\s*.+?(?:\n|$)/i, "").trim();
    } else {
      // If no TITLE: pattern found, try to extract first line as title
      const lines = rawContent
        .split("\n")
        .filter((line) => line.trim().length > 0);
      if (lines.length > 0) {
        const firstLine = lines[0].trim();
        // Check if first line looks like a title (not too long, ends with punctuation)
        if (
          firstLine.length < 100 &&
          !firstLine.includes("Here's") &&
          !firstLine.includes("Write")
        ) {
          title = firstLine;
          content = lines.slice(1).join("\n").trim();
          console.log("Extracted title from first line:", title);
        }
      }
    }

    // Clean up content by removing any remaining instruction text
    content = content
      .replace(/^(Here's|Write|Create|Generate).*?:\n?/gi, "") // Remove instruction prefixes
      .replace(
        /^(IMPORTANT INSTRUCTIONS|Research Data Available|Format your response).*?(?=\n\n|\n[A-Z]|$)/gis,
        ""
      ) // Remove instruction blocks
      .replace(/^\d+\.\s*.*?(?=\n\n|\n[A-Z]|$)/gm, "") // Remove numbered instruction lines
      .replace(/\[.*?\]/g, "") // Remove bracketed placeholders
      .replace(/\n{3,}/g, "\n\n") // Normalize multiple newlines
      .trim();

    // If content is empty after cleaning, use original content
    if (!content || content.length < 50) {
      console.warn("Content too short after cleaning, using original");
      content = rawContent;
    }

    console.log("Final title length:", title.length);
    console.log("Final content length:", content.length);
    console.log("=== PARSING AI RESPONSE SUCCESS ===");

    return { title, content };
  } catch (error) {
    console.error("Error parsing AI response:", error);
    return { title, content: rawContent };
  }
}

/**
 * Enhance blog post by appending a cover, adding multimedia to a post, etc.
 */
async function enhanceWithMedia(blogContent: any) {
  console.log("=== ENHANCE WITH MEDIA START ===");
  console.log("Blog content keys:", Object.keys(blogContent));

  const enhanced = {
    ...blogContent,
    multimedia: {
      images: [],
      videos: [],
      tables: [],
    },
    seo: {
      metaDescription:
        blogContent.content?.substring(0, 155) || "Generated blog content",
      keywords: blogContent.keywords || [],
      readabilityScore: 85,
    },
  };

  console.log("Enhancement completed");
  console.log("Enhanced content keys:", Object.keys(enhanced));
  console.log("=== ENHANCE WITH MEDIA SUCCESS ===");

  return enhanced;
}

/**
 * Get existing topic or create a new one.
 *
 * @param supabase DB
 * @param providedTopicId the topic id provided
 * @param providedTopicName the topic name provided
 * @param userId the identification of the user making the request
 *
 *
 */
async function getOrCreateTopic(
  supabase: any,
  providedTopicId?: string,
  providedTopicName?: string,
  providedCategory?: string,
  userId?: string,
  priority?: PriorityLevel
): Promise<TopicDetails> {
  // TODO create Return Promise to return topic + topicID
  let topic;
  let topicIdentification;
  let category: string;

  // Return [EVERGREEN] topic when debugging
  // if (priority == PriorityLevel.DEBUG) {
  //   console.log("Debug mode: Returning evergreen topic");
  //   const { data: everGreenTopic, error: everGreenError } = await supabase
  //     .from("topics")
  //     .select("*")
  //     .eq("id", '84ac4196-b125-4f52-8d0f-9038d20b6308')
  //     .single();

  //   if (everGreenError) {
  //     console.error("Error fetching evergreen topic:", everGreenError);
  //     throw new Error("Failed to fetch debug topic");
  //   }

  //   topic = everGreenTopic;
  //   return topic;
  // }

  if (!providedTopicId && !providedTopicName) {
    throw new Error("No topic information provided. Canceling request");
  }

  if (providedTopicId) {
    const { data: existingTopic, error: topicError } = await supabase
      .from("topics")
      .select("*")
      .eq("id", providedTopicId)
      .single();

    if (existingTopic && !topicError) {
      topic = existingTopic;
      topicIdentification = existingTopic.id;
      console.log(`Found existing topic by ID: ${topic.name}`);
    } else if (topicError) {
      throw new Error(
        `INTERNAL ERROR: Detected an error fetching the topic id [${providedTopicId}] from the DB.`
      );
    }
  }
  // If only topicName is provided, search by name
  else if (providedTopicName) {
    // Normalize the topic name for consistent searching
    const normalizedName = normalizeTopicName(providedTopicName);

    // Try to find existing topic by normalized name
    const { data: existingTopics, error: searchError } = await supabase
      .from("topics")
      .select("*")
      .ilike("name", normalizedName);

    if (existingTopics && existingTopics.length > 0 && !searchError) {
      // Use the first matching topic
      topic = existingTopics[0];
      topicIdentification = topic.id;
      console.log(`Found existing topic by name: ${topic.name}`);
    } else {
      // Create new topic (no topic id or name within DB)
      console.log(`Creating new topic: ${providedTopicName}`);

      const newTopicId = crypto.randomUUID();
      const slug = generateSlug(providedTopicName);

      // CATEGORY ASSIGNMENT
      category = await resolveCategory(providedTopicName, providedCategory);

      const { data: newTopic, error: createError } = await supabase
        .from("topics")
        .insert({
          id: newTopicId,
          name: providedTopicName,
          slug: slug,
          description: `Topic about ${providedTopicName}`,
          category: category,
          created_by: userId,
          post_count: 0,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (createError) {
        // Check if it's a unique constraint error (topic might have been created concurrently)
        if (createError.code === "23505") {
          // Try to fetch again
          const { data: retryTopic } = await supabase
            .from("topics")
            .select("*")
            .ilike("name", normalizedName)
            .single();

          if (retryTopic) {
            topic = retryTopic;
            topicIdentification = retryTopic.id;
          } else {
            throw new Error("Error creating topic. Canceling request");
          }
        } else {
          throw new Error("Error creating topic. Canceling request");
        }
      } else {
        topic = newTopic;
        topicIdentification = newTopic.id;
        console.log(
          `Created new topic: ${topic.name} (ID: ${topicIdentification})`
        );
      }
    }
  }

  return topic;
}

/**
 * Checks if the requested topic has cached data.
 * Retrieves the cached data and returns to the user, otherwise researches the topic.
 * NOTE: Only returns data if search happened within the same week.
 *
 * @param supabase DB
 * @param topic name of searched topic
 * @param topicIdentification id of topic
 * @returns
 */
async function fetchCacheTopic(
  supabase: any,
  topic?: string,
  topicIdentification?: string
) {
  if (topicIdentification || topic) {
    console.log("Checking for cached research data...");
    try {
      let cachedData: any = null;
      let cacheError: any = null;

      // Priority 1: Search by topic id
      if (topicIdentification) {
        console.log("Searching cache by topic ID...");
        const { data, error } = await supabase
          .from("research_topic_cache")
          .select(
            `
            *,
            topics:topic_id (
              id,
              name,
              description,
              category,
              slug
            )
          `
          )
          .eq("topic_id", topicIdentification)
          .gte(
            "research_date",
            new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // return if search was within the last week ?
          )
          .single();

        cachedData = data;
        cacheError = error;
      }
      // Priority 2: Search by topic name (if no topic ID)
      else if (topic) {
        console.log("Searching cache by topic name...");
        const { data, error } = await supabase
          .from("research_topic_cache")
          .select(
            `
            *,
            topics:topic_id (
              id,
              name,
              description,
              category,
              slug
            )
          `
          )
          .eq("topics.name", topic)
          .gte(
            "research_date",
            new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
          )
          .single();

        cachedData = data;
        cacheError = error;
      }

      if (cacheError) {
        console.log(
          "No cached data found or cache query error:",
          cacheError.message
        );
        return undefined;
      } else if (cachedData) {
        console.log("Found cached research data, using cached result");
        const cachedResult = {
          newsArticles: cachedData.news_articles || [],
          serpApiData: cachedData.serp_api_data || [],
          trendingInfo: cachedData.trending_info || [],
          statistics: cachedData.statistics || [],
          recentDevelopments: cachedData.recent_developments || [],
          keyFacts: cachedData.key_facts || [],
        };
        console.log("Cached result summary:", {
          newsArticles: cachedResult.newsArticles.length,
          serpApiData: cachedResult.serpApiData.length,
          trendingInfo: cachedResult.trendingInfo.length,
          statistics: cachedResult.statistics.length,
          recentDevelopments: cachedResult.recentDevelopments.length,
          keyFacts: cachedResult.keyFacts.length,
        });
        return cachedResult;
      }
    } catch (cacheError) {
      console.error("Error checking cache:", cacheError);
      return undefined; // return undefined to trigger new topic research
    }
    // if no topic or topicID defined, return undefined
  } else {
    console.warn("No topic or topic id for searched topic");
    return undefined;
  }
}

/**
 * Retrieves the api keys used to fetch data from the external sources.
 * Throws error if key is not found or loaded successfully.
 *
 * @returns api keys of external sources
 */
async function fetchAPIKeys(): Promise<ApiKeys | undefined> {
  try {
    const newsApiKey = Deno.env.get("NEWS_API_KEY");
    const serpApiKey = Deno.env.get("SERP_API_KEY");
    const alphaVantageKey = Deno.env.get("ALPHA_API_KEY");
    const polygonIoKey = Deno.env.get("POLYGON_IO_API_KEY")

    if (!newsApiKey) {
      console.error("NEWS_API_KEY not found");
      throw new Error(`News API key not found. Canceling request.`);
    }
    if (!serpApiKey) {
      console.error("SERP_API_KEY not found");
      throw new Error(`Serp API key not found. Canceling request.`);
    }
    if (!alphaVantageKey) {
      console.error("ALPHA_API_KEY not found");
      throw new Error(`Alpha Vantage API key not found. Canceling request.`);
    }
    if (!polygonIoKey) {
      console.error("POLYGON_IO_API_KEY not found");
      throw new Error(`Alpha Vantage API key not found. Canceling request.`);
    }

    console.log("API Keys loaded successfully");

    return {
      NEWS_API_KEY: newsApiKey,
      SERP_API_KEY: serpApiKey,
      ALPHA_API_KEY: alphaVantageKey,
      POLYGON_API_KEY: polygonIoKey

    };
  } catch (error) {
    console.error(`Error fetching API keys: ${error}`);
    return undefined;
  }
}

/**
 * Generate URL-friendly slug from topic name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // Remove special characters
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-"); // Replace multiple hyphens with single hyphen
}

/**
 * Normalize topic name for consistent searching.
 * Removes any white spaces and converts string to lowercase.
 */
function normalizeTopicName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Resolves the category for a topic, using user input, keyword mapping, or AI fallback.
 *
 * @param topic The topic name
 * @param providedCategory Optional user-provided category
 * @returns The resolved category string
 */
async function resolveCategory(
  topic: string,
  providedCategory?: string
): Promise<string> {
  let category;
  if (providedCategory) {
    const normalized = providedCategory.toLowerCase().trim();
    if (ALLOWED_CATEGORIES.includes(normalized)) {
      console.log(`Category is provided: ${providedCategory}`);
      return normalized;
    }
  }
  try {
    category = categorizeTopicType(topic);
    console.log(`Returning categorized topic type: ${category}`);
    return category;
  } catch {
    try {
      category = await anthropicCategorizeTopic(topic);
      console.log(`Returning ai generated topic type: ${category}`);
      return category;
    } catch {
      console.log(`Returning fall safe category EVERGREEN`);

      return "evergreen";
    }
  }
}

/**
 * Returns a category based on the topic.
 * The topic is filtered for terms to assign a category, otherwise an error is thrown.
 * NOTE: AI generated category function is called when error is thrown
 *
 * @param topic The topic being used
 *
 * @returns the category of the topic
 */

function categorizeTopicType(topic: string): string {
  const lowerTopic = topic.toLowerCase();

  // Keyword-based mapping
  if (
    lowerTopic.includes("news") ||
    lowerTopic.includes("breaking") ||
    lowerTopic.includes("headline") ||
    lowerTopic.includes("update")
  ) {
    return "news";
  }
  if (
    lowerTopic.includes("sports") ||
    lowerTopic.includes("nba") ||
    lowerTopic.includes("football") ||
    lowerTopic.includes("soccer") ||
    lowerTopic.includes("olympics") ||
    lowerTopic.includes("basketball") ||
    lowerTopic.includes("mlb") ||
    lowerTopic.includes("nfl") ||
    lowerTopic.includes("warriors") ||
    lowerTopic.includes("celtics")
  ) {
    return "sports";
  }
  if (
    lowerTopic.includes("stock") ||
    lowerTopic.includes("market") ||
    lowerTopic.includes("nasdaq") ||
    lowerTopic.includes("dow") ||
    lowerTopic.includes("shares")
  ) {
    return "stocks";
  }
  if (
    lowerTopic.includes("science") ||
    lowerTopic.includes("research") ||
    lowerTopic.includes("study") ||
    lowerTopic.includes("biology") ||
    lowerTopic.includes("physics")
  ) {
    return "science";
  }
  if (
    lowerTopic.includes("technology") ||
    lowerTopic.includes("tech") ||
    lowerTopic.includes("ai") ||
    lowerTopic.includes("software") ||
    lowerTopic.includes("hardware")
  ) {
    return "technology";
  }

  // If no keyword match, use AI to classify
  // This is a synchronous wrapper for an async call, so in real use, you may want to refactor to async/await
  // For now, we use a synchronous hack with deasync or similar, but here is the async version for Deno:
  // (You may want to refactor the call site to await this function)
  throw new Error(
    "AI category classification required but categorizeTopicType is not async. Refactor to async and call aiCategorizeTopic."
  );
}

/**
 *
 * Async AI-based categorization of the topic (to be called if no keyword match)
 *
 * @param topic the topic being used
 * @returns the category of the topic
 */
export async function anthropicCategorizeTopic(topic: string): Promise<string> {
  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  }

  const prompt = `Given the following topic, classify it into one of the following categories: news, sports, stocks, science, technology, or evergreen (as other). Only return the category name.\n\nTopic: ${topic}\nCategory:`;

  const requestBody = {
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 10,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API request failed: ${errorText}`);
  }

  const data = await response.json();
  if (!data.content || !data.content[0] || !data.content[0].text) {
    throw new Error("Invalid response structure from Anthropic API");
  }
  // Return the trimmed category string
  return data.content[0].text.trim().toLowerCase();
}

/**
 * Create client to supabase
 */
function connectClient() {
  console.log("Creating Supabase client...");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL environment variable is not set");
  }

  if (!supabaseKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY environment variable is not set"
    );
  }

  return createClient(supabaseUrl, supabaseKey);
}

/**
 * Builds a Google search query based on the topic and category.
 *
 * @param topic The topic being used
 * @param category The category being used
 * @returns The Google search query
 */
function buildGoogleSearchQuery(topic: TopicDetails): string {
  const searchOperators = {
    stocks: {
      // Force financial context
      query: `"${topic.name}" (stock OR ticker OR financial OR market)`,
      // Exclude common non-financial meanings
      // Example : exclude: '-"Space Launch System" -"NASA" -"rocket"'
      exclude: "",
    },
    sports: {
      query: `"${topic.name}" (sports OR game OR team OR player)`,
      exclude: "",
    },
    news: {
      query: `"${topic.name}" (news OR breaking OR latest)`,
      exclude: "",
    },
    technology: {
      query: `"${topic.name}" (technology OR tech OR software)`,
      exclude: "",
    },
    science: {
      query: `"${topic.name}" (science)`,
      exclude: "",
    }
  } as const;

  // Ensure topic.category is a valid key of searchOperators
  type Category = keyof typeof searchOperators;

  // Defensive: Validate category type and existence in searchOperators
  const category = topic?.category as Category | undefined;
  const config =
    category && category in searchOperators
      ? searchOperators[category]
      : undefined;

  if (!config) {
    // Fallback: return topic name if category is missing or invalid
    return topic.name;
  }

  // Build and return the search query string
  return `${config.query} ${config.exclude}`.trim();
}

/**
 * Make a request to Polygon.io API with proper error handling
 */
async function makePolygonRequest(url: string): Promise<Response> {
  return makeApiRequest(url, {}, 10000);
}

/**
 * Transform Polygon.io API response data to PolygonDailyBar format
 */
function transformPolygonBarData(apiData: any): PolygonDailyBar {
  return {
    volume: apiData.v,
    volumeWeighted: apiData.vw,
    open: apiData.o,
    close: apiData.c,
    high: apiData.h,
    low: apiData.l,
    timestamp: apiData.t,
    transactions: apiData.n
  };
}

/**
 * Fetch stock data from Polygon.io
 * 
 * Returns structured stock data including ticker details, news, and price data
 */
async function fetchPolygonData(
  topic: TopicDetails,
  apiKey: string,
  priority?: PriorityLevel
): Promise<PolygonData> {
  console.log("=== FETCH POLYGON.IO API START ===");
  console.debug("Ticker:", topic.name);
  console.debug("API Key exists:", !!apiKey);

  if (!apiKey) {
    console.warn("POLYGON_API_KEY not found, returning empty result");
    return {
      tickerDetails: null,
      recentNews: [],
      dailyBars: [],
      previousClose: null,
      error: "API key not provided"
    };
  }

  // if (priority === PriorityLevel.DEBUG) {
  //   console.log("Debugging enabled. Returning mock Polygon data...");
  //   return generateMockPolygonData(topic.name);
  // }

  try {
    const tickerSymbol = extractTickerSymbol(topic.name);
    const encodedTicker = encodeURIComponent(tickerSymbol);
    
    console.log(`Fetching Polygon.io data for ticker: ${tickerSymbol}`);

    let tickerDetails = null;
    let recentNews: PolygonNewsArticle[] = [];
    let dailyBars: PolygonDailyBar[] = [];
    let previousClose: PolygonDailyBar | null = null;

    // 1. Ticker Details (company info)
    try {
      console.log("Fetching ticker details...");
      const detailsUrl = `https://api.polygon.io/v3/reference/tickers/${encodedTicker}?apiKey=${apiKey}`;
      const detailsResponse = await fetch(detailsUrl);

      if (detailsResponse.ok) {
        const data = await detailsResponse.json();
        
        if (data.status === 'OK' && data.results) {
          tickerDetails = data.results;
          console.log("Ticker details retrieved successfully");
        } else {
          console.warn("No ticker details data available:", data);
        }
      } else {
        const errorText = await detailsResponse.text();
        throw new Error(`Ticker details request failed (${detailsResponse.status}): ${errorText}`);
      }
    } catch (error) {
      console.error("Ticker details request error:", error);
      throw error;
    }

    // 2. Previous Close (most recent trading data) - previous day and a week before
    try {
      console.log("Fetching previous close data...");
      
      // Calculate dates: previous day and a week before
      const today = new Date();
      const previousDay = new Date(today);
      previousDay.setDate(today.getDate() - 1);
      
      const weekBefore = new Date(today);
      weekBefore.setDate(today.getDate() - 7);
      
      // Format dates as YYYY-MM-DD
      const endDate = previousDay.toISOString().split('T')[0];
      const startDate = weekBefore.toISOString().split('T')[0];
      
      const prevCloseUrl = `https://api.polygon.io/v2/aggs/ticker/${encodedTicker}/range/1/day/${startDate}/${endDate}?adjusted=true&sort=desc&limit=7&apiKey=${apiKey}`;
      const prevCloseResponse = await fetch(prevCloseUrl);

      if (prevCloseResponse.ok) {
        const data = await prevCloseResponse.json();
        
        if (data.status === 'OK' && data.results && data.results.length > 0) {
          // Get the most recent data (first in the array since we sorted desc)
          const result = data.results[0];
          previousClose = {
            volume: result.v,
            volumeWeighted: result.vw,
            open: result.o,
            close: result.c,
            high: result.h,
            low: result.l,
            timestamp: result.t,
            transactions: result.n
          };
          console.log("Previous close data retrieved successfully");
          console.log(`Retrieved ${data.results.length} days of data from ${startDate} to ${endDate}`);
        } else {
          console.warn("No previous close data available:", data);
        }
      } else {
        const errorText = await prevCloseResponse.text();
        throw new Error(`Previous close request failed (${prevCloseResponse.status}): ${errorText}`);
      }
    } catch (error) {
      console.error("Previous close request error:", error);
      throw error;
    }

    // 3. Recent News
    try {
      console.log("Fetching recent news...");
      const newsUrl = `https://api.polygon.io/v2/reference/news?ticker=${encodedTicker}&limit=5&sort=published_utc&order=desc&apiKey=${apiKey}`;
      const newsResponse = await makePolygonRequest(newsUrl);

      if (newsResponse.ok) {
        const data = await newsResponse.json();
        
        if (data.status === 'OK' && data.results) {
          recentNews = data.results;
          console.log(`Retrieved ${recentNews.length} news articles`);
        } else {
          console.warn("No news data available:", data);
        }
      } else {
        const errorText = await newsResponse.text();
        throw new Error(`News request failed (${newsResponse.status}): ${errorText}`);
      }
    } catch (error) {
      console.error("News request error:", error);
      throw error;
    }

    // 4. Daily bars (historical data) - extended period for analysis
    try {
      console.log("Fetching extended daily bars...");
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // 60 days
      
      const barsUrl = `https://api.polygon.io/v2/aggs/ticker/${encodedTicker}/range/1/day/${startDate}/${endDate}?adjusted=true&sort=desc&limit=60&apiKey=${apiKey}`;
      const barsResponse = await makePolygonRequest(barsUrl);

      if (barsResponse.ok) {
        const data = await barsResponse.json();
        
        if (data.status === 'OK' && data.results) {
          dailyBars = data.results;
          console.log(`Retrieved ${dailyBars.length} daily bars for extended analysis`);
        } else {
          console.warn("No daily bars data available:", data);
        }
      } else {
        const errorText = await barsResponse.text();
        throw new Error(`Daily bars request failed (${barsResponse.status}): ${errorText}`);
      }
    } catch (error) {
      console.error("Daily bars request error:", error);
      throw error;
    }

    const result: PolygonData = {
      tickerDetails,
      recentNews,
      dailyBars,
      previousClose,
      error: null
    };

    console.log("=== FETCH POLYGON.IO API SUCCESS ===");
    return result;

  } catch (error) {
    console.error("=== FETCH POLYGON.IO API ERROR ===");
    console.error("Polygon.io API request failed:", error);

    return {
      tickerDetails: null,
      recentNews: [],
      dailyBars: [],
      previousClose: null,
      error: `Polygon.io API fetch failed: ${error.message}`
    };
  }
}

// /**
//  * Fetch stock data from Polygon.io
//  * 
//  * Returns structured stock data including ticker details, news, and price data
//  * Implements rate limiting protection (5 requests/minute for basic tier)
//  */
// async function fetchPolygonData(
//   topic: TopicDetails,
//   apiKey: string,
//   priority?: PriorityLevel
// ): Promise<PolygonData> {
//   console.log("=== FETCH POLYGON.IO API START ===");
//   console.debug("Ticker:", topic.name);
//   console.debug("API Key exists:", !!apiKey);
  
//   // Get current rate limit status
//   const rateLimitInfo = {
//     requestsUsed: polygonRateLimiter.getCurrentRequestCount(),
//     requestsRemaining: Math.max(0, 5 - polygonRateLimiter.getCurrentRequestCount()),
//     timeUntilReset: polygonRateLimiter.getTimeUntilNextSlot()
//   };
  
//   console.log(`Rate limit status: ${rateLimitInfo.requestsUsed}/5 requests used`);
//   if (rateLimitInfo.timeUntilReset > 0) {
//     console.log(`Next slot available in ${Math.ceil(rateLimitInfo.timeUntilReset / 1000)}s`);
//   }

//   if (!apiKey) {
//     console.warn("POLYGON_API_KEY not found, returning empty result");
//     return {
//       tickerDetails: null,
//       recentNews: [],
//       dailyBars: [],
//       previousClose: null,
//       error: "API key not provided",
//       rateLimitInfo
//     };
//   }

//   if (priority === PriorityLevel.DEBUG) {
//     console.log("Debugging enabled. Returning mock Polygon data...");
//     return generateMockPolygonData(topic.name);
//   }

//   try {
//     const tickerSymbol = extractTickerSymbol(topic.name);
//     const encodedTicker = encodeURIComponent(tickerSymbol);
    
//     console.log(`Fetching Polygon.io data for ticker: ${tickerSymbol}`);

//     let tickerDetails = null;
//     let recentNews: PolygonNewsArticle[] = [];
//     let dailyBars: PolygonDailyBar[] = [];
//     let previousClose = null;
//     let rateLimitHit = false;
//     let specificError = null;

//     // 1. Ticker Details (company info)
//     try {
//       console.log("Fetching ticker details...");
//       const detailsUrl = `https://api.polygon.io/v3/reference/tickers/${encodedTicker}?apiKey=${apiKey}`;
//       const detailsResponse = await makePolygonRequest(detailsUrl);

//       if (detailsResponse.ok) {
//         const data = await detailsResponse.json();
        
//         if (isPolygonRateLimited(data)) {
//           console.warn("Polygon.io rate limit hit on ticker details");
//           rateLimitHit = true;
//           specificError = "Rate limit exceeded (5 requests/minute)";
//         } else if (data.status === 'OK' && data.results) {
//           tickerDetails = data.results;
//           console.log("Ticker details retrieved successfully");
//         }
//       } else if (detailsResponse.status === 429) {
//         console.warn("HTTP 429 Rate Limit response");
//         rateLimitHit = true;
//         specificError = "Rate limit exceeded (5 requests/minute)";
//       } else {
//         console.warn(`Ticker details request failed: ${detailsResponse.status}`);
//       }
//     } catch (error) {
//       console.warn("Ticker details request error:", error);
//     }

//     // 2. Previous Close (most recent trading data)
//     if (!rateLimitHit) {
//       try {
//         console.log("Fetching previous close data...");
//         const prevCloseUrl = `https://api.polygon.io/v2/aggs/ticker/${encodedTicker}/prev?adjusted=true&apiKey=${apiKey}`;
//         const prevCloseResponse = await makePolygonRequest(prevCloseUrl);

//         if (prevCloseResponse.ok) {
//           const data = await prevCloseResponse.json();
          
//           if (isPolygonRateLimited(data)) {
//             console.warn("Polygon.io rate limit hit on previous close");
//             rateLimitHit = true;
//             specificError = "Rate limit exceeded (5 requests/minute)";
//           } else if (data.status === 'OK' && data.results && data.results.length > 0) {
//             const result = data.results[0];
//             previousClose = {
//               symbol: data.ticker,
//               close: result.c,
//               high: result.h,
//               low: result.l,
//               open: result.o,
//               volume: result.v,
//               afterHours: data.afterHours,
//               preMarket: data.preMarket
//             };
//             console.log("Previous close data retrieved successfully");
//           }
//         } else if (prevCloseResponse.status === 429) {
//           console.warn("HTTP 429 Rate Limit response");
//           rateLimitHit = true;
//           specificError = "Rate limit exceeded (5 requests/minute)";
//         }
//       } catch (error) {
//         console.warn("Previous close request error:", error);
//       }
//     }

//     // 3. Recent News
//     if (!rateLimitHit) {
//       try {
//         console.log("Fetching recent news...");
//         const newsUrl = `https://api.polygon.io/v2/reference/news?ticker=${encodedTicker}&limit=5&sort=published_utc&order=desc&apiKey=${apiKey}`;
//         const newsResponse = await makePolygonRequest(newsUrl);

//         if (newsResponse.ok) {
//           const data = await newsResponse.json();
          
//           if (isPolygonRateLimited(data)) {
//             console.warn("Polygon.io rate limit hit on news");
//             rateLimitHit = true;
//             specificError = "Rate limit exceeded (5 requests/minute)";
//           } else if (data.status === 'OK' && data.results) {
//             recentNews = data.results;
//             console.log(`Retrieved ${recentNews.length} news articles`);
//           }
//         } else if (newsResponse.status === 429) {
//           console.warn("HTTP 429 Rate Limit response");
//           rateLimitHit = true;
//           specificError = "Rate limit exceeded (5 requests/minute)";
//         }
//       } catch (error) {
//         console.warn("News request error:", error);
//       }
//     }

//     // 4. Daily bars (historical data) - last 30 days
//     if (!rateLimitHit) {
//       try {
//         console.log("Fetching daily bars...");
//         const endDate = new Date().toISOString().split('T')[0];
//         const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
//         const barsUrl = `https://api.polygon.io/v2/aggs/ticker/${encodedTicker}/range/1/day/${startDate}/${endDate}?adjusted=true&sort=desc&limit=30&apiKey=${apiKey}`;
//         const barsResponse = await makePolygonRequest(barsUrl);

//         if (barsResponse.ok) {
//           const data = await barsResponse.json();
          
//           if (isPolygonRateLimited(data)) {
//             console.warn("Polygon.io rate limit hit on daily bars");
//             rateLimitHit = true;
//             specificError = "Rate limit exceeded (5 requests/minute)";
//           } else if (data.status === 'OK' && data.results) {
//             dailyBars = data.results;
//             console.log(`Retrieved ${dailyBars.length} daily bars`);
//           }
//         } else if (barsResponse.status === 429) {
//           console.warn("HTTP 429 Rate Limit response");
//           rateLimitHit = true;
//           specificError = "Rate limit exceeded (5 requests/minute)";
//         }
//       } catch (error) {
//         console.warn("Daily bars request error:", error);
//       }
//     }

//     // Update rate limit info
//     const finalRateLimitInfo = {
//       requestsUsed: polygonRateLimiter.getCurrentRequestCount(),
//       requestsRemaining: Math.max(0, 5 - polygonRateLimiter.getCurrentRequestCount()),
//       timeUntilReset: polygonRateLimiter.getTimeUntilNextSlot()
//     };

//     const result: PolygonData = {
//       tickerDetails,
//       recentNews,
//       dailyBars,
//       previousClose,
//       error: specificError || (rateLimitHit ? "Rate limit exceeded" : null),
//       rateLimitInfo: finalRateLimitInfo
//     };

//     if (rateLimitHit) {
//       console.warn("=== POLYGON.IO RATE LIMIT HIT ===");
//       console.warn(`Requests used: ${finalRateLimitInfo.requestsUsed}/5`);
//       console.warn(`Time until reset: ${Math.ceil(finalRateLimitInfo.timeUntilReset / 1000)}s`);
//     } else {
//       console.log("=== FETCH POLYGON.IO API SUCCESS ===");
//     }

//     return result;
//   } catch (error) {
//     console.error("=== FETCH POLYGON.IO API ERROR ===");
//     console.error("Polygon.io API request failed:", error);

//     return {
//       tickerDetails: null,
//       recentNews: [],
//       dailyBars: [],
//       previousClose: null,
//       error: `Polygon.io API fetch failed: ${error.message}`,
//       rateLimitInfo: {
//         requestsUsed: polygonRateLimiter.getCurrentRequestCount(),
//         requestsRemaining: Math.max(0, 5 - polygonRateLimiter.getCurrentRequestCount()),
//         timeUntilReset: polygonRateLimiter.getTimeUntilNextSlot()
//       }
//     };
//   }
// }
