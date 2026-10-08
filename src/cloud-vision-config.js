// Direct browser calls cannot hide this key. Use only a browser API key restricted
// to your GitHub Pages referrer and the Cloud Vision API.
// Set VITE_CLOUD_VISION_API_KEY at build time, or replace this empty value locally.
export const CLOUD_VISION_API_KEY =
  import.meta.env.VITE_CLOUD_VISION_API_KEY ||
  (typeof window !== 'undefined' ? window.__CLOUD_VISION_API_KEY__ : '') ||
  '';
