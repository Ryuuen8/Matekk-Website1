const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
const defaultApiUrl = import.meta.env.DEV
  ? "/api"
  : "https://matekk-website1.vercel.app";

const API_URL = (configuredApiUrl || defaultApiUrl).replace(/\/+$/, "");

export default API_URL; 