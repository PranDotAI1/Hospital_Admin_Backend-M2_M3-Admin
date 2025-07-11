import { Schema, model, Document, Types } from 'mongoose';
export interface IDepartmentPatient extends Document {
    patient_id: Types.ObjectId;
    department_id: Types.ObjectId;
    remark: string;
    rating?: string;
    is_active: boolean;
    created_by?: string;
    updated_by?: string;
}

const DepartmentPatientSchema = new Schema<IDepartmentPatient>({
    patient_id: {
        type: Schema.Types.ObjectId,
        ref: "users",
        required: true,
    },
    department_id: {
        type: Schema.Types.ObjectId,
        ref: "departments",
        required: true,
    },
    remark: {
        type: String,
        required: false,
        trim: true,
        default: null
    },
    rating: {
        type: Number,
        required: false,
        default: 0
    },
    is_active: {
        type: Boolean,
        required: true,
        default: true
    },
    created_by: {
        type: String,
        required: false,
        trim: true
    },
    updated_by: {
        type: String,
        required: false,
        trim: true
    },
}, {
    timestamps: true,
    collection: 'departmentPatients'
});
DepartmentPatientSchema.index({ is_active: 1, patient_id: 1, department_id: 1 });

export const DepartmentPatientModel = model<IDepartmentPatient>('departmenntPatient', DepartmentPatientSchema);