import mongoose from "mongoose";

export async function connectMongo(uri: string) {
  try {
    await mongoose.connect(uri, {
      autoIndex: false,
      serverSelectionTimeoutMS: 8000,
      maxPoolSize: 50,
    });
    console.log("✅ MongoDB connected successfully");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
  }
}
