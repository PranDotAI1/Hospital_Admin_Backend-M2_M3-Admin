import { Schema, model, Document } from 'mongoose';

export interface IDepartment extends Document {
    name: string;
    type: number;
    description: string;
    status: boolean;
}

const DepartmentSchema = new Schema<IDepartment>({
    name: {
        type: String,
        required: true,
        trim: true,
        unique: true
    },
    type: {
        type: Number,
        required: true,
        trim: true
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