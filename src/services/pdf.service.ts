import puppeteer, { Browser } from "puppeteer";

export const generatePdfFromHtml = async (html: string): Promise<Buffer> => {
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"], // Required for some server environments
    });
    const page = await browser.newPage();

    // Set content and wait for network idle to ensure styles/fonts load if any (though we use embedded styles)
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true, // Print background colors/images
      margin: {
        top: "1cm",
        bottom: "1cm",
        left: "1cm",
        right: "1cm",
      },
    });

    await browser.close();

    return Buffer.from(pdfBuffer);
  } catch (error) {
    console.error("Error generating PDF:", error);
    throw new Error("Failed to generate PDF document");
  }
};

export const generateMultiplePdfs = async (
  htmls: string[],
): Promise<Buffer[]> => {
  if (htmls.length === 0) return [];

  let browser: Browser | undefined;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    // Process all pages in parallel
    const pdfBuffers = await Promise.all(
      htmls.map(async (html) => {
        const page = await browser!.newPage();
        try {
          await page.setContent(html, { waitUntil: "networkidle0" });
          const buffer = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: {
              top: "1cm",
              bottom: "1cm",
              left: "1cm",
              right: "1cm",
            },
          });
          return Buffer.from(buffer);
        } catch (pageError) {
          console.error("Error generating single PDF in batch:", pageError);
          // Return empty buffer or throw? Let's return null and filter later or throw to handle upstream
          throw pageError;
        } finally {
          if (page && !page.isClosed()) await page.close();
        }
      }),
    );

    await browser.close();
    return pdfBuffers;
  } catch (error) {
    console.error("Error generating multiple PDFs:", error);
    if (browser) await browser.close();
    throw new Error("Failed to batch generate PDF documents");
  }
};
