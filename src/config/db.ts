import mongoose from 'mongoose';

let isConnected = false;

export const connectDB = async (): Promise<mongoose.Connection> => {
    if (isConnected) {
        console.log('Using existing MongoDB connection');
        return mongoose.connection;
    }
    try {
        const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/pran_ai';
        const connection = await mongoose.connect(mongoURI);
        isConnected = true;
        console.log('MongoDB connected successfully');
        return connection.connection;
    } catch (error) {
        console.error('MongoDB connection error:', (error as Error).message);
        process.exit(1);
    }
};
