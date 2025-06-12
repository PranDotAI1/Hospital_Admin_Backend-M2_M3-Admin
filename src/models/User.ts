import { Document, Schema, model } from 'mongoose';

export interface IUser extends Document {
    f_name: string;
    m_name?: string;
    l_name?: string;
    adhaar: string;
    reg_no: string;
    mobile: string;
    specialize: any;
    hospital: any;
    permissions: any;
    address: any;
    email: string;
    password: string;
    created_by?: string;
    deleted_by?: string;
    updated_by?: string;
    status?: number;
    reset_otp?: number;
    role_id?: number;
    is_active?: boolean;
}

const SpecializeReferenceSchema = new Schema({
    id: { type: Schema.Types.ObjectId, ref: 'Specialize' },
    name: { type: String },
}, { _id: false });

const HospitalReferenceSchema = new Schema({
    id: { type: Schema.Types.ObjectId, ref: 'Hospital' },
    name: { type: String },
}, { _id: false });

const AddressReferenceSchema = new Schema({
    id: { type: Schema.Types.ObjectId, ref: 'Address' },
    add1: { type: String },
    city: { type: String },
    state: { type: String },
    pincode: { type: Number }

}, { _id: false });

const PermissionReferenceSchema = new Schema({
    id: { type: Schema.Types.ObjectId, ref: 'Permission' },
    name: { type: String },
}, { _id: false });

const UserSchema = new Schema<IUser>({
    f_name: {
        type: String,
        required: true,
        trim: true
    },
    m_name: {
        type: String,
        required: false,
        trim: true
    },
    l_name: {
        type: String,
        required: false,
        trim: true
    },
    adhaar: {
        type: String,
        required: true,
        trim: true
    },
    reg_no: {
        type: String,
        required: true,
        trim: true
    },
    mobile: {
        type: String,
        required: true,
        trim: true,
        max: 12,
        min: 10
    },
    specialize: {
        type: [SpecializeReferenceSchema],
        required: true
    },

    hospital: {
        type: [HospitalReferenceSchema],
        required: true,
        trim: true
    },
    address: {
        type: [AddressReferenceSchema],
        required: false,
    },
    permissions:{
        type:[PermissionReferenceSchema],
        required:false
    },
    is_active: {
        type: Boolean,
        required: true,
        default: true
    },
    password: {
        type: String,
        required: true,
        minlength: 6
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please fill a valid email address']
    },
    status: {
        type: Number,
        default: 1
    },
    reset_otp: {
        type: Number,
        required:false,
        default:null
    },
    role_id: {
        type: Number,
        default: 2
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
    deleted_by:{
        type: String,
        required: false,
        trim: true
    }
}, {
    timestamps: true,
    collection: 'users'
});

// UserSchema.index({ email: 1 });
UserSchema.index({ status: 1 ,email:1,role_id:1});
// UserSchema.index({ role_id: 1 });

export const UserModel = model<IUser>('User', UserSchema);