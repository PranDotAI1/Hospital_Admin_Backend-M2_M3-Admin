import { Schema, model, Document, Types } from 'mongoose';

export interface INotifiyResponse extends Document {
    health_record_id: Types.ObjectId
    notification: any;
    hiTypes?: string[];
    dataEraseAt?: Date;
}

const NotifiyResponseSchema = new Schema<INotifiyResponse>({
    health_record_id: {
        type: Schema.Types.ObjectId,
        ref: 'healthRecords',
        required: true,
    },
    notification: {
        type: Object,
        required: false,
        trim: true
    },
    hiTypes: {
        type: [String],
        required: true,
        default: true
    },
    dataEraseAt: {
        type: Date,
        required: false,
    }
}, {
    timestamps: true,
    collection: 'notifiyResponses',
});

NotifiyResponseSchema.index({ health_record_id: 1 });

export const NotifiyResponseModel = model<INotifiyResponse>('NotifiyResponse', NotifiyResponseSchema);