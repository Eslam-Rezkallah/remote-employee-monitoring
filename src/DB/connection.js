import mongoose from "mongoose";

const connectDB = async () => {
  // Idempotent: if something already opened the connection (test setup
  // typically connects to mongo-memory-server first, then calls
  // bootstrap → connectDB), don't dial again. readyState 1 = connected,
  // 2 = connecting (treated as "in progress, leave it alone").
  if ([1, 2].includes(mongoose.connection.readyState)) {
    return;
  }

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

    // eslint-disable-next-line no-console
    console.log("Database connected successfully");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log("Error connecting to database:", err);
  }
};

export default connectDB;
