require("dotenv").config();

module.exports = {
  port: process.env.PORT || 5000,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "http://localhost:5000",

  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  },

  plumtrips: {
    baseUrl: process.env.PLUMTRIPS_BASE_URL || "https://api.plumtrips.com/api/v1",
    apiKey: process.env.PLUMTRIPS_API_KEY,
  },

  unsplash: {
    accessKey: process.env.UNSPLASH_ACCESS_KEY,
  },

  company: {
    name: process.env.COMPANY_NAME || "Plumtrips.com",
    subtitle: process.env.COMPANY_SUBTITLE || "",
    address: process.env.COMPANY_ADDRESS || "",
    phone: process.env.COMPANY_PHONE || "",
    email: process.env.COMPANY_EMAIL || "",
    logoUrl: process.env.COMPANY_LOGO_URL || "",
  },
};
