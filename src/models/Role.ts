import { Schema, model, Document } from 'mongoose';

export interface IRole extends Document {
    name: string;
    is_active?: boolean;
}

const RoleSchema = new Schema<IRole>({
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
    collection: 'roles'
});

RoleSchema.index({ name: 1 });

export const RoleModel = model<IRole>('Role', RoleSchema);