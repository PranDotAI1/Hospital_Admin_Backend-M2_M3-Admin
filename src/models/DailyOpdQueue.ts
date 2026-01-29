import { Schema, model, Document } from 'mongoose';

export interface IDailyOpdQueue extends Document {
    date: string; // Format: "YYYY-MM-DD"
    counterId: string; 
    lastIssuedToken: number; 
    currentServingToken: number; 
    avgServiceTime: number; 
}

const DailyOpdQueueSchema = new Schema<IDailyOpdQueue>({
    date: {
        type: String,
        required: true,
        match: [/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'],
        index: true
    },
    counterId: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    lastIssuedToken: {
        type: Number,
        required: true,
        default: 0,
        min: 0
    },
    currentServingToken: {
        type: Number,
        required: true,
        default: 0,
        min: 0
    },
    avgServiceTime: {
        type: Number,
        required: true,
        default: 10, 
        min: 0
    }
}, {
    timestamps: true,
    collection: 'daily_opd_queue'
});

DailyOpdQueueSchema.index({ date: 1, counterId: 1 }, { unique: true });

export const DailyOpdQueueModel = model<IDailyOpdQueue>('DailyOpdQueue', DailyOpdQueueSchema);
