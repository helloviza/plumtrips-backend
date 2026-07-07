import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import { buildItineraryHtml } from "../../templates/plumml/itineraryTemplate.js";

const OUTPUT_DIR = path.join(process.cwd(), "public", "generated");

export type PdfPayload = {
  slots: Record<string, unknown>;
  outboundFlight: Record<string, unknown>;
  returnFlight: Record<string, unknown>;
  hotel: Record<string, unknown>;
  combo: Record<string, unknown>;
  itinerary: Record<string, unknown>;
  heroImageUrl?: string;
  sessionId: string;
};

export async function generateItineraryPdf(payload: PdfPayload): Promise<{ filePath: string; fileName: string }> {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const html = buildItineraryHtml(payload);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded"  });
    await page.evaluate(async () => {
  const selectors = Array.from(document.images);
  await Promise.all(
    selectors.map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise((resolve) => {
        img.addEventListener("load", resolve);
        img.addEventListener("error", resolve); // don't hang forever on a broken image
      });
    })
  );
});  


    const fileName = `itinerary-${payload.sessionId}-${Date.now()}.pdf`;
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
