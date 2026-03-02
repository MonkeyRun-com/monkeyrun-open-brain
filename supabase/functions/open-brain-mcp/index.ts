import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY") || "";

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

function createServer(): McpServer {
  const server = new McpServer({
    name: "open-brain",
    version: "1.0.0",
  });

  // Semantic search
  server.tool(
    "search_thoughts",
    {
      query: z.string().describe("What to search for — natural language"),
      threshold: z.number().optional().default(0.4).describe("Similarity threshold 0-1"),
      limit: z.number().optional().default(10).describe("Max results"),
    },
    async ({ query, threshold, limit }) => {
      const embedding = await generateEmbedding(query);
      const { data, error } = await supabase.rpc("match_thoughts", {
        query_embedding: embedding,
        match_threshold: threshold ?? 0.4,
        match_count: limit ?? 10,
      });

      if (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
      }

      if (!data || data.length === 0) {
        return { content: [{ type: "text" as const, text: "No matching thoughts found." }] };
      }

      const results = data.map((t: any, i: number) => {
        const meta = t.metadata || {};
        return `**${i + 1}.** (${(t.similarity * 100).toFixed(1)}% match)\n${t.content}\n_Type: ${meta.type || "unknown"} | Topics: ${(meta.topics || []).join(", ")} | People: ${(meta.people || []).join(", ")}_\n_Captured: ${new Date(t.created_at).toLocaleDateString()}_`;
      });

      return { content: [{ type: "text" as const, text: results.join("\n\n") }] };
    }
  );

  // Browse recent
  server.tool(
    "recent_thoughts",
    {
      limit: z.number().optional().default(20).describe("Number of recent thoughts"),
      type: z.string().optional().describe("Filter by type (decision, person_note, insight, etc.)"),
    },
    async ({ limit, type }) => {
      let query = supabase
        .from("thoughts")
        .select("id, content, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(limit ?? 20);

      if (type) {
        query = query.eq("metadata->>type", type);
      }

      const { data, error } = await query;

      if (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
      }

      if (!data || data.length === 0) {
        return { content: [{ type: "text" as const, text: "No thoughts found." }] };
      }

      const results = data.map((t: any, i: number) => {
        const meta = t.metadata || {};
        return `**${i + 1}.** ${t.content}\n_Type: ${meta.type || "unknown"} | Topics: ${(meta.topics || []).join(", ")} | ${new Date(t.created_at).toLocaleDateString()}_`;
      });

      return { content: [{ type: "text" as const, text: results.join("\n\n") }] };
    }
  );

  // Stats
  server.tool(
    "brain_stats",
    {},
    async () => {
      const { count } = await supabase
        .from("thoughts")
        .select("*", { count: "exact", head: true });

      const { data: recent } = await supabase
        .from("thoughts")
        .select("metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(100);

      const types: Record<string, number> = {};
      const people: Record<string, number> = {};
      (recent || []).forEach((t: any) => {
        const meta = t.metadata || {};
        const tp = meta.type || "unknown";
        types[tp] = (types[tp] || 0) + 1;
        (meta.people || []).forEach((p: string) => {
          people[p] = (people[p] || 0) + 1;
        });
      });

      const typeStr = Object.entries(types)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");

      const peopleStr = Object.entries(people)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");

      const text = `**Open Brain Stats**\nTotal thoughts: ${count || 0}\n\nTypes (last 100): ${typeStr || "none"}\nTop people (last 100): ${peopleStr || "none"}`;

      return { content: [{ type: "text" as const, text }] };
    }
  );

  // Save thought
  server.tool(
    "save_thought",
    {
      content: z.string().describe("The thought to save"),
      source: z.string().optional().default("mcp").describe("Where this came from"),
    },
    async ({ content, source }) => {
      const [embedding, metadataRes] = await Promise.all([
        generateEmbedding(content),
        fetch("https://openrouter.ai/api/v1/chat/completions", {
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
              { role: "user", content },
            ],
            temperature: 0,
          }),
        }).then((r) => r.json()),
      ]);

      let metadata;
      try {
        metadata = JSON.parse(metadataRes.choices[0].message.content);
      } catch {
        metadata = { type: "observation", topics: [], people: [], action_items: [] };
      }
      metadata.source = source || "mcp";

      const { data, error } = await supabase
        .from("thoughts")
        .insert({ content: content.trim(), embedding, metadata })
        .select("id")
        .single();

      if (error) {
        return { content: [{ type: "text" as const, text: `Error saving: ${error.message}` }] };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Saved as ${metadata.type} | Topics: ${(metadata.topics || []).join(", ")} | People: ${(metadata.people || []).join(", ")}`,
          },
        ],
      };
    }
  );

  return server;
}

const app = new Hono().basePath("/open-brain-mcp");

// Auth middleware
app.use("*", async (c, next) => {
  if (MCP_ACCESS_KEY) {
    const key = c.req.header("x-brain-key") || c.req.query("key") || "";
    if (key !== MCP_ACCESS_KEY) {
      return c.json({ error: "Unauthorized" }, 401);
    }
  }
  await next();
});

app.all("*", async (c) => {
  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport();
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

Deno.serve(app.fetch);
