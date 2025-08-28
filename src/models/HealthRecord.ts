import { Schema, model, Document } from 'mongoose';

export interface HealthRecord extends Document {
    hidn_number: string;
    hid_address: string;
    is_active?: boolean;
    abha_details?: any;
    last_request_id?: string;
    status: string;
    facility_id: string;
    facility_name: string;
    token_link?: string;
    transaction_id?: string;
    consent_id?: string;
    encrypted_data?: any;
    created_by?: string;
    updated_by?: string;
    patient_name?: string,
    access_token?: string
    notify_callback_response: any,
    version_m2?: any,
    version_m3?: any,
}

const HealthSchema = new Schema<HealthRecord>(
    {
        hidn_number: {
            type: String,
            required: true,
            trim: true,
        },
        patient_name: {
            type: String,
            required: false,
            trim: false,
        },
        hid_address: {
            type: String,
            required: true,
            trim: true,
        },
        abha_details: {
            type: Schema.Types.Mixed,
            required: false,
        },
        last_request_id: {
            type: String,
            required: false,
            trim: true,
        },
        facility_id: {
            type: String,
            required: true,
            trim: true,
        },
        facility_name: {
            type: String,
            required: true,
            trim: true,
        },
        token_link: {
            type: String,
            trim: true,
        },
        consent_id: {
            type: String,
            trim: true,
        },
        encrypted_data: {
            type: Schema.Types.Mixed,
        },
        transaction_id: {
            type: String,
            trim: true,
        },
        created_by: {
            type: String,
            trim: true,
        },
        updated_by: {
            type: String,
            trim: true,
        },
        status: {
            type: String,
            required: true,
            trim: true,
            default: "Pending"
        },
        is_active: {
            type: Boolean,
            default: true,
        },
        access_token: {
            type: String,
            required: false
        },
        notify_callback_response: {
            type: Object,
            required: false
        },
        version_m2: {
            type: Object,
            required: false
        },
        version_m3: {
            type: Object,
            required: false
        }
    },
    {
        timestamps: true,
        collection: 'healthRecords',
    }
);

// Removed invalid index
HealthSchema.index({ hidn_number: 1, token_link: 1, transaction_id: 1, updated_by: 1 });

export const HealthRecordModel = model<HealthRecord>('HealthRecord', HealthSchema);
