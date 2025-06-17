import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  priority?: "low" | "normal" | "high";
}

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // create supabase client
    // const supabaseUrl = "https://djpgoofhctzmbgcuxdqr.supabase.co";
    // //TODO delete after testing
    // const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqcGdvb2ZoY3R6bWJnY3V4ZHFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAwMzI2MDgsImV4cCI6MjA2NTYwODYwOH0.vSwKF3G01IgDzaLzqfgdhOGclitwsKnRqhwnwRH8Oug'
    // const supabase = createClient(supabaseUrl, supabaseKey);

    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const {
      topicId,
      topicName,
      userId,
      targetLength = 800,
    }: BlogGenerationRequest = await req.json();

     // Validate input - must have either topicId or topicName
     if (!topicId && !topicName) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Either topicId or topicName must be provided",
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
          status: 400,
        }
      );
    }

    // Create generation job
    const jobId = crypto.randomUUID();
    const { error: jobError } = await supabase.from("generation_jobs").insert({
      id: jobId,
      topic_id: topicId,
      user_id: userId,
      status: "processing",
      current_step: "initializing",
      started_at: new Date().toISOString(),
    });

    if (jobError) throw jobError;

    // Get topic details
    // const { data: topic, error: topicError } = await supabase
    //   .from("topics")
    //   .select("*")
    //   .eq("id", topicId)
    //   .single();

      const { topic: providedTopicName, topicId: providedTopicId, topicError, createError } = await getOrCreateTopic(
        supabase,
        topicId,
        topicName,
        userId
      );
  

    if (topicError || createError || !providedTopicName) {
      console.log("Topic not within topic db. Continuing with generation...");
      // throw new Error("Topic not found");
    }

    // Step 1: Research
    await updateJobProgress(supabase, jobId, 20, "research");
    const researchData = await researchTopic(providedTopicName.name, supabase);

    // Step 2: Generate content
    await updateJobProgress(supabase, jobId, 50, "generation");
    const blogContent = await generateAIContent(
      providedTopicName.name,
      researchData,
      targetLength
    );

    // Step 3: Enhance
    await updateJobProgress(supabase, jobId, 80, "enhancement");
    const enhancedContent = await enhanceWithMedia(blogContent);

    // Save blog post
    const { data: blogPost, error: insertError } = await supabase
      .from("blog_posts")
      .insert({
        topic_id: topicId,
        user_id: userId,
        title: enhancedContent.title,
        content: enhancedContent.content,
        meta_description: enhancedContent.seo?.metaDescription,
        keywords: enhancedContent.keywords,
        hashtags: enhancedContent.hashtags,
        word_count: enhancedContent.wordCount,
        reading_time: enhancedContent.readingTime,
        status: "published",
        generation_job_id: jobId,
        seo_data: enhancedContent.seo,
        multimedia_data: enhancedContent.multimedia,
        research_data: researchData,
        published_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Complete job
    await updateJobProgress(supabase, jobId, 100, "completed");
    await supabase
      .from("generation_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        result_data: { blog_post_id: blogPost.id, result: blogPost.status },
      })
      .eq("id", jobId);

    return new Response(
      JSON.stringify({
        success: true,
        jobId,
        blogPostId: blogPost.id,
        message: "Blog post generated successfully",
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Generation error:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        status: 500,
      }
    );
  }
});

async function updateJobProgress(
  supabase: any,
  jobId: string,
  progress: number,
  step: string
) {
  console.log("Update job Progress:", progress);
  await supabase
    .from("generation_jobs")
    .update({
      progress,
      current_step: step,
    })
    .eq("id", jobId);
}

/**
 * Looks up the data of the specified topic and returns information on the topic
 *
 * TODO: optimize to generate data based on the trending topic or most recent data
 * TODO: apply statistical information to generate tables with AI
 */
async function researchTopic(topic: string, supabase: any, topicId?: string) {
  let cacheRecordId = null;

  console.log(`Researching: ${topic}`);

  // Check if we have cached data first (optional - for performance)
  // Return the cached data
  if (topicId) {
    const { data: cachedData } = await supabase
      .from("research_topic_cache")
      .select("*")
      .eq("topic_id", topicId)
      .gte(
        "research_date",
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      ) // Within last 24 hours
      .single();

    if (cachedData) {
      console.log("Using cached research data");
      return {
        newsArticles: cachedData.news_articles || [],
        trendingInfo: cachedData.trending_info || [],
        statistics: cachedData.statistics || [],
        recentDevelopments: cachedData.recent_developments || [],
        keyFacts: cachedData.key_facts || [],
      };
    }
  }

  try {
    // Set initial status to pending if we have a topicId
    if (topicId) {
      const { data: pendingRecord, error: insertError } = await supabase
        .from("research_topic_cache")
        .insert({
          topic_id: topicId,
          research_status: "pending",
        })
        .select("id")
        .single();

      if (!insertError && pendingRecord) {
        cacheRecordId = pendingRecord.id;
      }
    }
    const newsApiKey = Deno.env.get("NEWS_API_KEY");
    const serpApiKey = Deno.env.get("SERP_API_KEY");


    const newsApiData = await fetchNewsApi(topic, newsApiKey);
    const serpData = await fetchSerpAPIData(topic, serpApiKey);

    if (newsApiData.articles) { 
      const processedArticles = newsApiData.articles.map(article => ({
        title: article.title,
        description: article.description,
        source: article.source.name,
        publishedAt: article.publishedAt,
        url: article.url,
        imageUrl: article.urlToImage,
        content: article.content
      }));
      console.log("Research Data: Processed Articles - ", processedArticles)
    }


    const researchResult = {
      newsArticles: newsApiData.articles || [],
      serpApiData: serpData || [],
      trendingInfo: [],
      statistics: [],
      recentDevelopments: [],
      keyFacts: [],
    };

    // Save successful research data to cache
    if (topicId && cacheRecordId) {
      const { error: updateError } = await supabase
        .from("research_topic_cache")
        .update({
          news_articles: researchResult.newsArticles,
          trending_info: researchResult.trendingInfo,
          statistics: researchResult.statistics,
          recent_developments: researchResult.recentDevelopments,
          key_facts: researchResult.keyFacts,
          research_status: "completed",
        })
        .eq("id", cacheRecordId);

      if (updateError) {
        console.error("Failed to update cache:", updateError);
      } else {
        console.log("Research data cached successfully");
      }
    } else if (topicId) {
      // If we don't have a cache record ID, try direct insert
      const { error: insertError } = await supabase
        .from("research_topic_cache")
        .insert({
          topic_id: topicId,
          news_articles: researchResult.newsArticles,
          trending_info: researchResult.trendingInfo,
          statistics: researchResult.statistics,
          recent_developments: researchResult.recentDevelopments,
          key_facts: researchResult.keyFacts,
          serp_api_data: serpData,
          research_status: "completed",
        });

      if (insertError) {
        console.error("Failed to cache research data:", insertError);
      } else {
        console.log("Research data cached successfully");
      }
    }

    return researchResult;
  } catch (error) {
    console.error("Research error:", error);

    // Update cache with error status if we have a record
    if (topicId && cacheRecordId) {
      await supabase
        .from("research_topic_cache")
        .update({
          research_status: "failed",
          error_message:
            error instanceof Error ? error.message : "Unknown error",
        })
        .eq("id", cacheRecordId);
    } else if (topicId) {
      // Insert failed record
      await supabase.from("research_topic_cache").insert({
        topic_id: topicId,
        research_status: "failed",
        error_message: error instanceof Error ? error.message : "Unknown error",
        news_articles: [],
        trending_info: [],
        statistics: [],
        recent_developments: [],
        key_facts: [],
      });
    }

    return {
      newsArticles: [],
      trendingInfo: [],
      statistics: [],
      recentDevelopments: [],
      keyFacts: [],
    };
  }
}

async function fetchNewsApi(topic: string, apiKey: string) {
  try {
    const newsResponse = await fetch(
      `https://newsapi.org/v2/everything?q=${encodeURIComponent(
        topic
      )}&apiKey=${Deno.env.get("NEWS_API_KEY")}&pageSize=5`
    );
    const newsData = await newsResponse.json();
    console.log("Research Topic (newsData):", newsData);

    return newsData
  } catch (error) {
    console.error("NewsApi request failed:", error);
    throw error;
  }
}

/**
 * Fetch data from SerpAPI for search results
 * Add this function to your code after the fetchNewsApi function
 */
async function fetchSerpAPIData(topic: string, apiKey: string) {
  if (!apiKey) {
    console.warn("SERP_API_KEY not found, skipping SerpAPI data");
    return [];
  }

  try {
    const serpResponse = await fetch(
      `https://serpapi.com/search.json?q=${encodeURIComponent(topic)}&api_key=${apiKey}&engine=google&num=10`
    );
    
    if (!serpResponse.ok) {
      throw new Error(`SerpAPI request failed: ${serpResponse.status}`);
    }
    
    const serpData = await serpResponse.json();
    console.log("SerpAPI data:", serpData);

    // Extract organic results if available
    const organicResults = serpData.organic_results || [];
    
    return organicResults.map((result: any) => ({
      title: result.title,
      link: result.link,
      snippet: result.snippet,
      displayedLink: result.displayed_link,
      position: result.position
    }));
  } catch (error) {
    console.error("SerpAPI request failed:", error);
    return []; // Return empty array instead of throwing to prevent breaking the flow
  }
}


/**
 * Uses claude to generate a blog post based on the specified topic.
 *
 * TODO: update to return blog post in markdown language
 * TODO: ensure statistical information is displayed in tables , utilize the use of blog post type definitions
 *
 * @param topic
 * @param researchData
 * @param targetLength
 * @returns
 */
async function generateAIContent(
  topic: string,
  researchData: any,
  targetLength: number
) {
  console.log(`Generating content for: ${topic}`);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        // max_tokens: Math.min(4096, Math.floor(targetLength * 1.5)),
        temperature: 0.7,
        messages: [
          {
            role: "user",
            content: `You are an expert blog writer. Create engaging, well-structured content.

Write a ${targetLength}-word blog post about "${topic}". Include a compelling title, structured content with headings, and conclude with key takeaways.`,
          },
        ],
      }),
    });

    const data = await response.json();
    const content = data.content[0].text;

    return {
      title: `Understanding ${topic}: A Comprehensive Guide`,
      content: content,
      keywords: [topic.toLowerCase()],
      hashtags: [`#${topic.replace(/\s+/g, "")}`],
      wordCount: content.split(" ").length,
      readingTime: Math.ceil(content.split(" ").length / 200),
    };
  } catch (error) {
    console.error("AI generation error:", error);
    return {
      title: `Understanding ${topic}`,
      content: `This is a comprehensive guide about ${topic}. Content generation encountered an issue, but this fallback ensures you still receive valuable information.`,
      keywords: [topic.toLowerCase()],
      hashtags: [`#${topic.replace(/\s+/g, "")}`],
      wordCount: 50,
      readingTime: 1,
    };
  }
}

/**
 * TODO: Enhance blog post by appending a cover, adding multimedia to a post, etc.
 * NOTE: Currently returns the blog post as is
 *
 * @param blogContent
 * @returns
 */
async function enhanceWithMedia(blogContent: any) {
  console.log("Enhancing with multimedia");

  return {
    ...blogContent,
    multimedia: {
      images: [],
      videos: [],
      tables: [],
    },
    seo: {
      metaDescription: blogContent.content.substring(0, 155),
      keywords: blogContent.keywords,
      readabilityScore: 85,
    },
  };
}

/**
 * Get existing topic or create a new one
 */
async function getOrCreateTopic(
  supabase: any,
  providedTopicId?: string,
  providedTopicName?: string,
  userId?: string
) {
  let topic;
  let topicId;
  let topicError;
  let createError;

  // If topicId is provided, try to fetch it
  if (providedTopicId) {
    const { data: existingTopic, error: topicError } = await supabase
      .from("topics")
      .select("*")
      .eq("id", providedTopicId)
      .single();

    if (existingTopic && !topicError) {
      topic = existingTopic;
      topicId = existingTopic.id;
      console.log(`Found existing topic by ID: ${topic.name}`);
    } else if (providedTopicName) {
      // If topic not found by ID but name is provided, search by name
      console.log(`Topic ID ${providedTopicId} not found, searching by name: ${providedTopicName}`);
      return getOrCreateTopic(supabase, undefined, providedTopicName, userId);
    } else {
      throw new Error(`Topic with ID ${providedTopicId} not found`);
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
      topicId = topic.id;
      console.log(`Found existing topic by name: ${topic.name}`);
    } else {
      // Create new topic
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
        if (createError.code === '23505') {
          // Try to fetch again
          const { data: retryTopic } = await supabase
            .from("topics")
            .select("*")
            .ilike("name", normalizedName)
            .single();
          
          if (retryTopic) {
            topic = retryTopic;
            topicId = retryTopic.id;
          } else {
            throw createError;
          }
        } else {
          throw createError;
        }
      } else {
        topic = newTopic;
        topicId = newTopic.id;
        console.log(`Created new topic: ${topic.name} (ID: ${topicId})`);
      }
    }
  }

  return { topic, topicId, topicError, createError };
}

/**
 * Generate URL-friendly slug from topic name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-'); // Replace multiple hyphens with single hyphen
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
  
  function  categorizeTopicType(topic: string): string {
    const lowerTopic = topic.toLowerCase();
    
    if (lowerTopic.includes('news') || lowerTopic.includes('breaking') || lowerTopic.includes('latest')) {
      return 'trending';
    }
    if (lowerTopic.includes('election') || lowerTopic.includes('covid') || lowerTopic.includes('war')) {
      return 'current_events';
    }
    if (lowerTopic.includes('technology') || lowerTopic.includes('ai') || lowerTopic.includes('software')) {
      return 'technology';
    }
    if (lowerTopic.includes('research') || lowerTopic.includes('study') || lowerTopic.includes('science')) {
      return 'academic';
    }
    
    // General
    return 'evergreen';
  }
  