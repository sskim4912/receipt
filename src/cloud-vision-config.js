// Browser keys are public. Restrict the key by referrer and API in Google Cloud.
export const CLOUD_VISION_API_KEY =
  (typeof document !== 'undefined'
    ? document.querySelector('meta[name="google-cloud-vision-api-key"]')?.content?.trim()
    : '') ||
  (typeof window !== 'undefined' ? window.__CLOUD_VISION_API_KEY__ : '') ||
  '';
