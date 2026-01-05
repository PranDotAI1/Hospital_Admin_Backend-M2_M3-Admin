import { Schema, model, Document } from 'mongoose';

export interface IRole extends Document {
    name: string;
    status?: boolean;
    role_id:number,
    permissions?:any
}

const RoleSchema = new Schema<IRole>({
    role_id:{
        type:Number,
        required:true,
        default:1
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    status: {
        type: Boolean,
        required: true,
        default: true
    },
    permissions:{
        type:Object,
        required:false,
    }
}, {
    timestamps: true,
    collection: 'roles'
});

RoleSchema.index({ name: 1 });

export const RoleModel = model<IRole>('Role', RoleSchema);