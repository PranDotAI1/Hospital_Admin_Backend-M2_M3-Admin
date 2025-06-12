import { Schema, model, Document } from 'mongoose';

export interface IPermission extends Document {
    name: string;
    is_active?: boolean;
}

const PermissionSchema = new Schema<IPermission>({
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
    collection: 'permissions'
});

PermissionSchema.index({ name: 1 });

export const PermissionModel = model<IPermission>('Permission', PermissionSchema);