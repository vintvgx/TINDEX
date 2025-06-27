import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ApiKeys, PriorityLevel, PROMPT_STYLES, Topic, TopicReturn } from "../shared/client.ts";
import {
  NEWS_API_THUNDER_PACERS_DATA_06_16_25,
  SERP_API_THUNDER_PACERS_DATA_06_23_25,
} from "./DATA.ts";
import { formatPrompt } from "../shared/prompts.ts";

/**
 * Supabase serverless function to generate blog post
 */

// Blog post type
//TODO move to shared/types.ts
interface BlogGenerationRequest {
  topicId?: string;
  topicName?: string;
  userId: string;
  targetLength?: number;
  priority?: PriorityLevel;
}

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
    if (req.method !== "POST") {
      console.log("Invalid method:", req.method);
      throw new Error(
        `Method ${req.method} not allowed. Only POST is supported.`
      );
    }

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

    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!supabase) {
      throw new Error ("Failed to connect to supabase :(")
    }

    let requestBody;
    try {
      requestBody = await req.json();
      console.log("Request body parsed:", JSON.stringify(requestBody, null, 2));
    } catch (parseError) {
      console.error("Failed to parse request body:", parseError);
      throw new Error("Invalid JSON in request body: " + parseError.message);
    }

    const {
      topicId,
      topicName,
      userId,
      targetLength = 500, //TODO change this based on the priority status 
      priority,
    }: BlogGenerationRequest = requestBody;

    //TODO remove : topic validation is in getOrCreateTopic func, after processing Priority.Debug
    // Validate input - must have either topicId or topicName
    // if (!topicId && !topicName) {
    //   console.error(
    //     "Validation failed: Neither topicId nor topicName provided"
    //   );
    //   throw new Error("Either topicId or topicName must be provided");
    // }

    if (!userId) {
      console.error("Validation failed: userId not provided");
      throw new Error("userId is required");
    }

    // Create generation job
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

    // Step 1: Get Topic
    const topic = await getOrCreateTopic(
      supabase,
      topicId,
      topicName,
      userId,
      priority
    );

    // Step 2: Research Topic
    console.log("=== STEP 1: RESEARCH ===");
    await updateJobProgress(supabase, jobId, 20, "research");
    const researchData = await researchTopic(
      supabase,
      topic,
      priority
    );

    if (!researchData) {
      console.error("Research failed: No data returned from researchTopic");
      throw new Error("Research phase failed - no data returned");
    }

    console.log("Research completed, data keys:", Object.keys(researchData));

    // Step 2: Generate content
    console.log("=== STEP 2: CONTENT GENERATION ===");
    await updateJobProgress(supabase, jobId, 50, "generation");
    const blogContent = await generateAIContent(
      topic,
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
    //MOCK POST
    // const blogPostData = {
    //   topic_id: "f7a8b9c0-1234-5678-9abc-def012345678",
    //   user_id: "a1b2c3d4-5678-90ab-cdef-123456789012",
    //   title: "Understanding Machine Learning: A Complete Guide",
    //   content:
    //     "Machine learning is transforming industries worldwide. This comprehensive guide covers the basics, applications, and future trends of ML technology.",
    //   meta_description:
    //     "Learn about machine learning basics, applications, and future trends in this comprehensive guide for beginners and professionals.",
    //   keywords: ["machine learning", "AI", "technology", "automation"],
    //   hashtags: ["#MachineLearning", "#AI", "#Tech"],
    //   word_count: 150,
    //   reading_time: 2,
    //   status: "published",
    //   generation_job_id: "job_789abc12-3456-7890-abcd-ef1234567890",
    //   seo_data: {
    //     metaDescription: "Learn ML basics",
    //     keywords: ["AI"],
    //     readabilityScore: 85,
    //   },
    //   multimedia_data: { images: [], videos: [], tables: [] },
    //   research_data: {
    //     newsArticles: [],
    //     serpApiData: [],
    //     trendingInfo: [],
    //     statistics: [],
    //     recentDevelopments: [],
    //     keyFacts: [],
    //   },
    //   published_at: new Date().toISOString(),
    // };
    const blogPostData = {
      topic_id: topic.id,
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
      blogPostData: blogPostData
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
  topic: Topic,
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
    //NOTE: Topic is created within getORCreateTopic() func (if topic/topicID return it, else create new one)
    if (topic.id) {
      // Start new search by creating cache record (update with information after completing research)
      console.log("Creating pending cache record...");
      try {
        const pendingData = {
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
          console.error("Failed to create pending cache record:", insertError);
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

    if (!keys) {
      throw new Error("Failed to fetch API keys");
    }

    console.log("Fetching news data...");
    const newsApiData = await fetchNewsApi(topic.name, keys.NEWS_API_KEY, priority);
    console.log("News API data received:", {
      articlesCount: newsApiData.articles?.length || 0,
      status: newsApiData.status,
      totalResults: newsApiData.totalResults,
    });

    console.log("Fetching SERP data...");
    const serpData = await fetchSerpAPIData(topic.name, keys.SERP_API_KEY, priority);

    const researchResult = {
      newsArticles: newsApiData,
      serpApiData: serpData,
      trendingInfo: [],
      statistics: [],
      recentDevelopments: [],
      keyFacts: [],
    };

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
          serp_api_data: serpData,
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
 * Fetch data from SerpAPI for search results
 */
async function fetchSerpAPIData(
  topic: string,
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
    return SERP_API_THUNDER_PACERS_DATA_06_23_25
  }
  //TODO move data to its own json file and load dynamically as such
  // export const loadSerpOcgnData = () => import('./data/serp-ocgn-data.json');

  if (!apiKey) {
    //TODO remove / fetchAPIKeys throws an error if the keys are not present
    console.warn("SERP_API_KEY not found, skipping SerpAPI data");
    return [];
  }

  try {
    const encodedTopic = encodeURIComponent(topic);
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
  topic: Topic,
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
    const requestBody = {
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      temperature: 0.7,
      messages: [
        {
          role: "user",
          content: formatPrompt(
            topic.name,
            targetLength,
            researchData,
            PROMPT_STYLES.inter
          ),
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

    const content = data.content[0].text;
    console.log("Generated content length:", content.length);
    console.log(
      "Generated content preview:",
      content.substring(0, 200) + "..."
    );

    const result = {
      title: `Blog Post for ${topic.name} created`,
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
  userId?: string,
  priority?: PriorityLevel
) : Promise<Topic> {
  // TODO create Return Promise to return topic + topicID
  let topic;
  let topicIdentification;

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

  // 
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
      // NOTE: If there is an error fetching the topic by its ID, the user should not go forward as their would be a newly created topic for a
      // topic that exists. This is an internal error and the user should be notified and the topic should be re-fetched.
      throw new Error(
        `INTERNAL ERROR: Detected an error fetching the topic id [${providedTopicId}] from the DB.`
      );
    }
  }
  // If only topicName is provided, search by name
  else if (providedTopicName) {
    // Normalize the topic name for consistent searching
    const normalizedName = normalizeTopicName(providedTopicName);

    // First, try to find existing topic by normalized name
    const { data: existingTopics, error: searchError } = await supabase
      .from("topics")
      .select("*")
      .ilike("name", normalizedName);

    if (!searchError && existingTopics && existingTopics.length > 0) {
      // Use the first matching topic
      topic = existingTopics[0];
      topicIdentification = topic.id;
      console.log(`Found existing topic by name: ${topic.name}`);
    } else {
      // Create new topic (no topic id or name within DB)
      console.log(`Creating new topic: ${providedTopicName}`);

      const newTopicId = crypto.randomUUID();
      const slug = generateSlug(providedTopicName);

      const { data: newTopic, error: createError } = await supabase
        .from("topics")
        .insert({
          id: newTopicId,
          name: providedTopicName,
          slug: slug,
          description: `Topic about ${providedTopicName}`,
          category: categorizeTopicType(providedTopicName),
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
          .select("*")
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
          .select("*")
          .eq("topic_name", topic)
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

    if (!newsApiKey) {
      console.warn("NEWS_API_KEY not found");
      throw new Error(`News API key not found. Canceling request.`);
    }
    if (!serpApiKey) {
      throw new Error(`Serp API key not found. Canceling request.`);
    }
    console.log("API Keys loaded.");
    return {
      NEWS_API_KEY: newsApiKey,
      SERP_API_KEY: serpApiKey,
    };
  } catch (error) {
    console.log(`Error fetching API keys: ${error}`);
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
 * Normalize topic name for consistent searching
 */
function normalizeTopicName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Helper functions
 */

function categorizeTopicType(topic: string): string {
  const lowerTopic = topic.toLowerCase();

  if (
    lowerTopic.includes("news") ||
    lowerTopic.includes("breaking") ||
    lowerTopic.includes("latest")
  ) {
    return "trending";
  }
  if (
    lowerTopic.includes("election") ||
    lowerTopic.includes("covid") ||
    lowerTopic.includes("war")
  ) {
    return "current_events";
  }
  if (
    lowerTopic.includes("technology") ||
    lowerTopic.includes("ai") ||
    lowerTopic.includes("software")
  ) {
    return "technology";
  }
  if (
    lowerTopic.includes("research") ||
    lowerTopic.includes("study") ||
    lowerTopic.includes("science")
  ) {
    return "academic";
  }

  // General
  return "evergreen";
}
