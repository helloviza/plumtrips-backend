const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer");
const { buildItineraryHtml } = require("../templates/itineraryTemplate");

const OUTPUT_DIR = path.join(__dirname, "..", "public", "generated");

async function generateItineraryPdf({ slots, flight, hotel, combo, itinerary, heroImageUrl, sessionId }) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const html = buildItineraryHtml({ slots, flight, hotel, combo, itinerary, heroImageUrl });

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const fileName = `itinerary-${sessionId}-${Date.now()}.pdf`;
    const filePath = path.join(OUTPUT_DIR, fileName);

    await page.pdf({
      path: filePath,
      format: "A4",
      printBackground: true,
      margin: { top: "0px", bottom: "0px", left: "0px", right: "0px" },
    });

    return { filePath, fileName };
  } finally {
    await browser.close();
  }
}

module.exports = { generateItineraryPdf };
