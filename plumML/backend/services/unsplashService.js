const axios = require("axios");
const config = require("../config/config");

const FALLBACK_IMAGE = "https://images.unsplash.com/photo-1503220317375-aaad61436b1b?w=1200&q=80"; // generic travel shot

/**
 * Returns a single best-match photo URL for a search query.
 * Falls back to a generic travel image if Unsplash key is missing or the call fails,
 * so PDF generation never breaks because of a missing image.
 */
async function getImageForQuery(query) {
  if (!config.unsplash.accessKey) return FALLBACK_IMAGE;

  try {
    const { data } = await axios.get("https://api.unsplash.com/search/photos", {
      params: { query, per_page: 1, orientation: "landscape" },
      headers: { Authorization: `Client-ID ${config.unsplash.accessKey}` },
      timeout: 10000,
    });
    return data?.results?.[0]?.urls?.regular || FALLBACK_IMAGE;
  } catch (err) {
    return FALLBACK_IMAGE;
  }
}

/**
 * Batch helper: resolves an image URL for every activity across every day,
 * mutating and returning the itinerary object with `imageUrl` added.
 */
async function attachItineraryImages(itinerary, destinationCity) {
  for (const day of itinerary.days) {
    for (const activity of day.activities) {
      const query = activity.imageQuery || `${destinationCity} travel`;
      activity.imageUrl = await getImageForQuery(`${query} ${destinationCity}`);
    }
  }
  return itinerary;
}

module.exports = { getImageForQuery, attachItineraryImages };
