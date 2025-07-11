import { Schema, model, Document } from 'mongoose';
import { HEALTH_RISK } from '../utils/constant';

export interface IPatient extends Document {
    uhid: string;
    insurance: object;
    f_name: string;
    m_name?: string;
    l_name?: string;
    adhaar: string;
    mobile: string;
    dob: string;
    hospital: object;
    address: object;
    email: string;
    password: string;
    status?: number;
    risk_id?: number;
    is_active?: boolean;
}

const PatientSchema = new Schema<IPatient>({
    uhid: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    insurance: {
        type: Object,
        required: false,
        trim: true
    },
    f_name: {
        type: String,
        required: true,
        trim: true
    },
    m_name: {
        type: String,
        required: false,
        trim: true
    },
    l_name: {
        type: String,
        required: false,
        trim: true
    },
    adhaar: {
        type: String,
        required: true,
        trim: true
    },
    mobile: {
        type: String,
        required: true,
        trim: true,
        max: 12,
        min: 10
    },
    dob: {
        type: String,
        required: true,
        trim: true
    },
    hospital: {
        type: Object,
        required: true,
        trim: true
    },
    address: {
        type: Object,
        required: false,
    },
    is_active: {
        type: Boolean,
        required: true,
        default: true
    },
    password: {
        type: String,
        required: true,
        minlength: 6
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please fill a valid email address']
    },
    status: {
        type: Number,
        default: 1
    },
    risk_id: {
        type: Number,
        default: HEALTH_RISK.NORMAL
    },
}, {
    timestamps: true,
    collection: 'patients'
});

PatientSchema.index({ email: 1 });

export const PatientModel = model<IPatient>('Patient', PatientSchema);