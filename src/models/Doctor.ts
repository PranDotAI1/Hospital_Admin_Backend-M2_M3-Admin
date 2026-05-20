import { Schema, model, Types } from 'mongoose';

export interface IDoctor {
    _id?: Types.ObjectId;
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    specialization?: string;
    department?: Types.ObjectId;
    licenseNumber?: string;
    experience?: number;
    qualification?: string;
    consultationFee?: number;
    isActive: boolean;
    createdAt?: Date;
    updatedAt?: Date;
}

const DoctorSchema = new Schema({
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: false, trim: true },
    phone: { type: String, required: false, trim: true },
    specialization: { type: String, required: false, trim: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department', required: false },
    licenseNumber: { type: String, required: false, trim: true },
    experience: { type: Number, required: false },
    qualification: { type: String, required: false, trim: true },
    consultationFee: { type: Number, required: false },
    availableSlots: [{
        day: { type: String, required: true },
        startTime: { type: String, required: true },
        endTime: { type: String, required: true }
    }],
    isActive: { type: Boolean, default: true },
}, { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtual field for Full Name to maintain backward compatibility in some responses
DoctorSchema.virtual('name').get(function() {
    return `${this.firstName} ${this.lastName}`;
});

export const DoctorModel = model<IDoctor>('Doctor', DoctorSchema, 'doctors');
