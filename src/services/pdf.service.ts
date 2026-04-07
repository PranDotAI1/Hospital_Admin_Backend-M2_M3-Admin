import puppeteer, { Browser } from "puppeteer";

export const generatePdfFromHtml = async (
  html: string,
  existingBrowser?: Browser,
): Promise<Buffer> => {
  let browser = existingBrowser;
  let ownBrowser = false;

  try {
    if (!browser) {
      browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      ownBrowser = true;
    }

    const page = await browser.newPage();

    // Set content; use domcontentloaded to avoid long timeouts (networkidle0 can hang on external resources)
    await page.setContent(html, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "0",
        bottom: "0",
        left: "0",
        right: "0",
      },
    });

    await page.close();

    if (ownBrowser && browser) {
      await browser.close();
    }

    return Buffer.from(pdfBuffer);
  } catch (error) {
    console.error("Error generating PDF:", error);
    if (ownBrowser && browser) {
      await browser
        .close()
        .catch((e) => console.error("Error closing browser:", e));
    }
    throw new Error("Failed to generate PDF document");
  }
};

export const generateMultiplePdfs = async (
  htmls: string[],
  existingBrowser?: Browser,
): Promise<Buffer[]> => {
  if (htmls.length === 0) return [];

  let browser = existingBrowser;
  let ownBrowser = false;

  try {
    if (!browser) {
      browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      ownBrowser = true;
    }

    // Process all pages in parallel
    const pdfBuffers = await Promise.all(
      htmls.map(async (html) => {
        const page = await browser!.newPage();
        try {
          await page.setContent(html, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          });
          const buffer = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: "0", bottom: "0", left: "0", right: "0" },
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

    if (ownBrowser && browser) {
      await browser.close();
    }
    return pdfBuffers;
  } catch (error) {
    console.error("Error generating multiple PDFs:", error);
    if (ownBrowser && browser) {
      await browser
        .close()
        .catch((e) => console.error("Error closing browser:", e));
    }
    throw new Error("Failed to batch generate PDF documents");
  }
};
