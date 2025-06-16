import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Supabase serverless function to generate blog post
 */

// Blog post type
//TODO move to shared/types.ts
interface BlogGenerationRequest {
  topicId: string;
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
      userId,
      targetLength = 800,
    }: BlogGenerationRequest = await req.json();

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
    //TODO : Implement if topic not found , add topic 
    const { data: topic, error: topicError } = await supabase
      .from("topics")
      .select("*")
      .eq("id", topicId)
      .single();

    if (topicError || !topic) {
      console.log("Topic not within topic db. Continuing with generation...")
      // throw new Error("Topic not found");
    }

    // Step 1: Research
    await updateJobProgress(supabase, jobId, 20, "research");
    const researchData = await researchTopic(topic.name);

    // Step 2: Generate content
    await updateJobProgress(supabase, jobId, 50, "generation");
    const blogContent = await generateAIContent(
      topic.name,
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
  console.log("Update job Progress:", progress)
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
async function researchTopic(topic: string) {
  console.log(`Researching: ${topic}`);

  // Implement research logic here
  try {
    const newsResponse = await fetch(
      `https://newsapi.org/v2/everything?q=${encodeURIComponent(
        topic
      )}&apiKey=${Deno.env.get("NEWS_API_KEY")}&pageSize=5`
    );
    const newsData = await newsResponse.json();
    console.log("Research Topic (newsData):", newsData)

    return {
      newsArticles: newsData.articles || [],
      trendingInfo: [],
      statistics: [],
      recentDevelopments: [],
      keyFacts: [],
    };
  } catch (error) {
    console.error("Research error:", error);
    return {
      newsArticles: [],
      trendingInfo: [],
      statistics: [],
      recentDevelopments: [],
      keyFacts: [],
    };
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
