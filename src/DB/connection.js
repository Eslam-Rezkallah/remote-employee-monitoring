import mongoose from "mongoose";

const connectDB = async () => {
  const uri = process.env.DB_URI;

  mongoose.set("strictQuery", true);

  // In production, prefer disabling autoIndex (build indexes manually)
  const isProd = process.env.MOOD === "PROD";
  mongoose.set("autoIndex", !isProd);

  try {
    await mongoose.connect(uri, {
      // ✅ Pooling
      maxPoolSize: 20,          // increase if needed
      minPoolSize: 5,

      // ✅ Timeouts
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,

      // ✅ Stability
      retryWrites: true,
    });

    console.log("Database connected successfully");
  } catch (err) {
    console.log("Error connecting to database:", err);
  }
};

export default connectDB;
