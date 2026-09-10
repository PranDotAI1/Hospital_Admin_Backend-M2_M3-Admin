import { Schema, model, Document } from 'mongoose';

export interface IRole extends Document {
    name: string;
    status?: boolean;
    role_id: number;
    description?: string;
    permissions?: string[];
    data_scope?: string;
}

const RoleSchema = new Schema<IRole>({
    role_id: {
        type: Number,
        required: true,
        unique: true,
        default: 1
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        required: false,
        trim: true,
        default: ''
    },
    status: {
        type: Boolean,
        required: true,
        default: true
    },
    permissions: {
        type: [String],
        required: false,
        default: []
    },
    data_scope: {
        type: String,
        enum: ['department', 'hospital'],
        default: 'hospital'
    }
}, {
    timestamps: true,
    collection: 'roles'
});

RoleSchema.index({ name: 1 });

export const RoleModel = model<IRole>('Role', RoleSchema);