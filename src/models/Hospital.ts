import { Schema, model, Document } from 'mongoose';

export interface IHospital extends Document {
    name: string;
    add1: string;
    add2?: string;
    city: string;
    state: string;
    pincode: number;
    country: string;
    is_active: boolean;
}

const HospitalSchema = new Schema<IHospital>({
    name: {
        type: String,
        required: true,
        trim: true,
        unique: true
    },
    add1: {
        type: String,
        required: true,
        trim: true
    },
    add2: {
        type: String,
        required: false,
        trim: true
    },
    city: {
        type: String,
        required: true,
        trim: true
    },
    state: {
        type: String,
        required: true,
        trim: true
    },
    pincode: {
        type: Number,
        required: true,
        trim: true
    },
    country: {
        type: String,
        required: true,
        trim: true,
        default: "india"
    },
    is_active: {
        type: Boolean,
        required: true,
        default: true
    }
}, {
    timestamps: true,
    collection: 'hospitals'
});

// HospitalSchema.index({ name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
HospitalSchema.index({ is_active: 1 });

export const HospitalModel = model<IHospital>('Hospital', HospitalSchema);