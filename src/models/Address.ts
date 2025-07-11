import { Schema, model, Document } from 'mongoose';
import { ADDRESS_TYPE } from '../utils/constant';
export interface IAddress extends Document {
    user_id: number;
    type: number;
    add1: string;
    add2?: string;
    city: string;
    state: string;
    pincode: number;
    country: string;
    is_active: boolean;
}

const AddressSchema = new Schema<IAddress>({
    user_id: {
        type: Number,
        required: true,
        trim: true
    },
    type: {
        type: Number,
        required: true,
        default: ADDRESS_TYPE.PATIENT//1->pateints, 2->user @to do will add constant file
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
    collection: 'addresses'
});

AddressSchema.index({ name: 1 });

export const AddressModel = model<IAddress>('Address', AddressSchema);