import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INGEST_KEY = Deno.env.get("INGEST_KEY")!;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function generateEmbedding(text: string, retries = 2): Promise<number[]> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${OPENROUTER_BASE}/embeddings`, {
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
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      if (attempt < retries) {
        console.warn(`Embedding attempt ${attempt + 1} failed (${res.status}), retrying...`);
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw new Error(`OpenRouter embeddings failed after ${retries + 1} attempts: ${res.status} ${msg}`);
    }
    const data = await res.json();
    if (!data?.data?.[0]?.embedding) {
      if (attempt < retries) {
        console.warn(`Embedding attempt ${attempt + 1} returned unexpected shape, retrying...`);
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw new Error(`OpenRouter embeddings returned unexpected shape: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return data.data[0].embedding;
  }
  throw new Error("Unreachable");
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
- "sentiment": one of "positive", "negative", "neutral", "mixed"
Only extract what's explicitly there.`,
        },
        { role: "user", content: text },
      ],
      temperature: 0,
    }),
  });
  if (!res.ok) {
    console.error(`Metadata extraction failed: ${res.status}`);
    return { type: "observation", topics: ["uncategorized"], people: [], action_items: [] };
  }
  const data = await res.json();
  try {
    return JSON.parse(data.choices[0].message.content);
  } catch {
    console.error("Metadata parse failed, raw response:", JSON.stringify(data).slice(0, 300));
    return { type: "observation", topics: ["uncategorized"], people: [], action_items: [] };
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
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

  const key = req.headers.get("x-ingest-key") || "";
  if (key !== INGEST_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const { content, source, parent_id, chunk_index, extra_metadata, full_text } = await req.json();

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return new Response(JSON.stringify({ error: "content is required" }), { status: 400 });
    }

    // text-embedding-3-small handles ~8k tokens; cap at 8000 chars for safety
    const embeddingInput = content.length > 8000 ? content.slice(0, 8000) : content;
    const [embedding, metadata] = await Promise.all([
      generateEmbedding(embeddingInput),
      extractMetadata(embeddingInput),
    ]);

    const enrichedMetadata = {
      ...metadata,
      source: source || "discord",
      ...(extra_metadata && typeof extra_metadata === "object" ? extra_metadata : {}),
    };

    const { data, error } = await supabase.rpc("insert_thought", {
      p_content: content.trim(),
      p_embedding: embedding,
      p_metadata: enrichedMetadata,
      p_parent_id: parent_id || null,
      p_chunk_index: chunk_index ?? null,
      p_full_text: (full_text && typeof full_text === "string") ? full_text.trim() : null,
    });

    if (error) {
      console.error("Supabase insert error:", error);
      return new Response(JSON.stringify({ error: `Failed to store thought: ${error.message}` }), { status: 500 });
    }

    const thoughtId = data;

    return new Response(
      JSON.stringify({
        ok: true,
        id: thoughtId,
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
