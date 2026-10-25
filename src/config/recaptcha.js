export const RECAPTCHA_SITE_KEY = import.meta.env.DEV
  ? import.meta.env.VITE_RECAPTCHA_SITE_KEY?.trim() || ""
  : "6Ldtzv8tAAAAAF6W4uv2mo-iUidrvUvsRvSQEXM8";

let recaptchaScriptPromise;

function loadRecaptchaScript() {
  if (window.grecaptcha?.execute) return Promise.resolve(window.grecaptcha);
  if (recaptchaScriptPromise) return recaptchaScriptPromise;

  recaptchaScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(RECAPTCHA_SITE_KEY)}`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (!window.grecaptcha?.ready || !window.grecaptcha?.execute) {
        reject(new Error("Google reCAPTCHA did not initialize."));
        return;
      }
      resolve(window.grecaptcha);
    };
    script.onerror = () => reject(new Error("Google reCAPTCHA could not load."));
    document.head.appendChild(script);
  }).catch((error) => {
    recaptchaScriptPromise = null;
    throw error;
  });

  return recaptchaScriptPromise;
}

export async function executeRecaptcha(action) {
  if (!RECAPTCHA_SITE_KEY) {
    throw new Error("CAPTCHA is not configured for this environment.");
  }

  const grecaptcha = await loadRecaptchaScript();
  await new Promise((resolve) => grecaptcha.ready(resolve));
  const token = await grecaptcha.execute(RECAPTCHA_SITE_KEY, { action });
  if (!token) throw new Error("Google reCAPTCHA returned an empty token.");
  return token;
}
