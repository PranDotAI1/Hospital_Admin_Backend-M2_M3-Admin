import mongoose from 'mongoose';

let isConnected = false;

export const connectDB = async (): Promise<mongoose.Connection> => {
    if (isConnected) {
        console.log('Using existing MongoDB connection');
        return mongoose.connection;
    }
    try {
        const mongoURI = process.env.MONGO_URI;
        if (!mongoURI) {
            throw new Error('MONGO_URI environment variable is not defined');
        }
        const connection = await mongoose.connect(mongoURI, {
          maxPoolSize: 10,
          minPoolSize: 2,
          serverSelectionTimeoutMS: 8000,
          socketTimeoutMS: 45000,
          connectTimeoutMS: 10000,
        });

        isConnected = true;
        console.log('MongoDB connected successfully');
        return connection.connection;
    } catch (error) {
        console.error('MongoDB connection error:', (error as Error).message);
        process.exit(1);
    }
};
