import axios from "axios";

let token: string | null = null;

/**
 * Set token once after login
 */
export function setCheapToken(jwt: string) {
  token = jwt;
}

/**
 * Read token
 */
export function getCheapToken(): string {
  if (!token) {
    throw new Error("Cheap API token not available");
  }

  return token;
}

/**
 * Axios instance
 */
export const cheapHttp = axios.create({
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

cheapHttp.interceptors.request.use((config) => {
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});