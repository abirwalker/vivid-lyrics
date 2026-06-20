const API_HOST = "https://api.spicylyrics.org";
const VERSION = "5.22.3";

export type QueryInput = {
  operation: string;
  variables?: Record<string, any>;
};

export type QueryResult = {
  data: any;
  httpStatus: number;
};

export async function query(
  queries: QueryInput[],
  headers: Record<string, string> = {}
): Promise<Map<string, QueryResult>> {
  const body = JSON.stringify({
    queries,
    client: { version: VERSION },
  });

  console.log("[VividLyrics] query:", API_HOST, body);

  const res = await fetch(`${API_HOST}/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "SpicyLyrics-Version": VERSION,
      ...headers,
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Query failed: ${res.status}`);
  }

  const data = await res.json();
  const results = new Map<string, QueryResult>();
  for (const job of data.queries) {
    results.set(job.operationId, job.result);
  }
  return results;
}
