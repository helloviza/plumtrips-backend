import axios from "axios";
import { plannerConfig } from "../../config/planner.js";

const FALLBACK_IMAGE =
  "https://images.unsplash.com/photo-1503220317375-aaad61436b1b?w=1200&q=80";

export async function getImageForQuery(query: string): Promise<string> {
  if (!plannerConfig.unsplash.accessKey) return FALLBACK_IMAGE;

  try {
    const { data } = await axios.get("https://api.unsplash.com/search/photos", {
      params: { query, per_page: 1, orientation: "landscape" },
      headers: { Authorization: `Client-ID ${plannerConfig.unsplash.accessKey}` },
      timeout: 10000,
    });

    return data?.results?.[0]?.urls?.regular || FALLBACK_IMAGE;
  } catch (err) {
    return FALLBACK_IMAGE;
  }
}
