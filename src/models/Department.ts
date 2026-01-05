import { Schema, model, Document } from 'mongoose';

export interface IDepartment extends Document {
    name: string;
    description: string;
    status: boolean;
    department_id:number
}

const DepartmentSchema = new Schema<IDepartment>({
    department_id:{
        type:Number,
        required: true,
        default:1
    },
    name: {
        type: String,
        required: true,
        trim: true,
        unique: true
    },
    description: {
        type: String,
        required: false,
        trim: true
    },
    status: {
        type: Boolean,
        required: true,
        default: true
    }
}, {
    timestamps: true,
    collection: 'departments'
});

DepartmentSchema.index({ status: 1 });

export const DepartmentModel = model<IDepartment>('Department', DepartmentSchema);