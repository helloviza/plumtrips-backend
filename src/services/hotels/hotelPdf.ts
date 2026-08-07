import puppeteer from 'puppeteer';
import { generateHotelVoucherHtml } from './hotelVoucherHtml.js';

export async function generateHotelPdf(booking: Record<string, any>): Promise<Buffer> {
  // 1. Generate the HTML using our updated template
  const htmlContent = generateHotelVoucherHtml(booking);

  // 2. Launch Puppeteer
  // We use headless: 'new' and no-sandbox for better server compatibility
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    
    // 3. Set the HTML content
    // waitUntil: 'load' ensures basic images load before printing.
    await page.setContent(htmlContent, { waitUntil: 'load' });

    // 4. Generate the PDF as a single continuous page (perfect for vouchers)
    const pdfBuffer = await page.pdf({
      width: '560px',  // Match exactly the table width
      height: '920px', // Large enough to fit the entire voucher natively on 1 page
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 }
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
