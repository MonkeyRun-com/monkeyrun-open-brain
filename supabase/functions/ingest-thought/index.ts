import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INGEST_KEY = Deno.env.get("INGEST_KEY") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function generateEmbedding(text: string): Promise<number[]> {
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
    }),
  });
  const data = await res.json();
  return data.data[0].embedding;
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Extract metadata from the following thought/note. Return valid JSON only with these fields:
- "type": one of "decision", "person_note", "insight", "meeting", "idea", "task", "reference", "observation"
- "topics": array of 1-5 topic keywords
- "people": array of people mentioned (empty if none)
- "action_items": array of action items (empty if none)
- "sentiment": one of "positive", "negative", "neutral", "mixed"
Return ONLY valid JSON, no markdown, no explanation.`,
        },
        { role: "user", content: text },
      ],
      temperature: 0,
    }),
  });
  const data = await res.json();
  try {
    return JSON.parse(data.choices[0].message.content);
  } catch {
    return { type: "observation", topics: [], people: [], action_items: [] };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-ingest-key",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  // Auth check
  const key = req.headers.get("x-ingest-key") || "";
  if (INGEST_KEY && key !== INGEST_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const { content, source } = await req.json();

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return new Response(JSON.stringify({ error: "content is required" }), { status: 400 });
    }

    // Generate embedding and extract metadata in parallel
    const [embedding, metadata] = await Promise.all([
      generateEmbedding(content),
      extractMetadata(content),
    ]);

    // Add source to metadata
    const enrichedMetadata = { ...metadata, source: source || "discord" };

    // Store in Supabase
    const { data, error } = await supabase
      .from("thoughts")
      .insert({
        content: content.trim(),
        embedding,
        metadata: enrichedMetadata,
      })
      .select("id, metadata, created_at")
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return new Response(JSON.stringify({ error: "Failed to store thought" }), { status: 500 });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        id: data.id,
        type: enrichedMetadata.type,
        topics: enrichedMetadata.topics || [],
        people: enrichedMetadata.people || [],
        action_items: enrichedMetadata.action_items || [],
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
