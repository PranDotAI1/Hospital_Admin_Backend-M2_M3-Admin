import { Schema, model, Document } from 'mongoose';

export interface ISpecialize extends Document {
    name: string;
    is_active?: boolean;
}

const SpecializeSchema = new Schema<ISpecialize>({
    name: {
        type: String,
        required: true,
        trim: true
    },
    is_active: {
        type: Boolean,
        required: true,
        default: true
    }
}, {
    timestamps: true,
    collection: 'specializations'
});

SpecializeSchema.index({ name: 1 });

export const SpecializeModel = model<ISpecialize>('Specialize', SpecializeSchema);