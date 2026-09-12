/**
 * ERD Export Worker
 * 
 * This worker handles the computationally expensive process of:
 * 1. Serializing SVG to PNG (via a simulated canvas)
 * 2. Generating PDF binary data
 * 
 * Note: Since the worker doesn't have access to the DOM, we pass the 
 * XML string of the SVG and the theme colors.
 */

self.onmessage = async (e) => {
  const { type, payload } = e.data;

  try {
    if (type === "EXPORT_PNG") {
      const { svgXml, width, height, scale, themeMode } = payload;
      
      // Since OffscreenCanvas is available in modern browsers:
      const canvas = new OffscreenCanvas(width * scale, height * scale);
      const ctx = canvas.getContext("2d");
      
      if (!ctx) throw new Error("Could not get 2D context from OffscreenCanvas");

      // Background
      ctx.fillStyle = themeMode === "light" ? "#ffffff" : "#0b0c0e";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // To render SVG to canvas in a worker, we normally need to use an ImageBitmap
      // since we can't use `document.createElement('img')`.
      // We create a Blob from the SVG XML.
      const svgBlob = new Blob([svgXml], { type: "image/svg+xml;charset=utf-8" });
      const imgBitmap = await createImageBitmap(svgBlob);
      
      ctx.drawImage(imgBitmap, 0, 0, canvas.width, canvas.height);
      
      const blob = await canvas.convertToBlob({ type: "image/png" });
      self.postMessage({ type: "PNG_RESULT", payload: blob });
    } else if (type === "EXPORT_PDF") {
      // PDF generation usually requires a library like jsPDF.
      // Since we cannot easily import jsPDF into a worker without a bundler 
      // config that supports it, we will handle the PDF wrapping on the main thread
      // after the worker provides the optimized PNG blob.
      self.postMessage({ type: "PDF_REQUEST_PNG_FIRST" });
    }
  } catch (error) {
    self.postMessage({ type: "ERROR", payload: error.message });
  }
};
