import { Document, Schema, model } from 'mongoose';

export interface IUser extends Document {
    // Existing fields
    f_name?: string;
    m_name?: string;
    l_name?: string;
    firstName?: string;
    middleName?: string;
    lastName?: string;
    name?: string;

    // ABDM specific
    token?: string;
    expiresIn?: number;
    refreshToken?: string;
    refreshExpiresIn?: number;
    hprIdNumber?: string;
    hprId?: string;
    gender?: string;
    yearOfBirth?: string;
    monthOfBirth?: string;
    dayOfBirth?: string;
    stateCode?: string;
    districtCode?: string;
    stateName?: string;
    districtName?: string;
    kycPhoto?: string;
    categoryId?: number;
    subCategoryId?: number;
    authMethods?: string[];
    new?: boolean;
    categories?: Record<string, any>;

    // Your existing system fields
    aadhaar?: string;
    reg_no?: string;
    mobile?: string;
    specialize?: any;
    hospital?: any;
    permissions?: any;
    address: any;
    email: string;
    password?: string;
    created_by?: string;
    deleted_by?: string;
    updated_by?: string;
    status?: number;
    reset_otp?: number;
    role_id?: number;
    is_active?: boolean;
    version_m4?: any;
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
    // ✅ Existing
    f_name: { type: String, trim: false },
    m_name: { type: String, trim: false },
    l_name: { type: String, trim: false },
    firstName: { type: String, trim: false },
    middleName: { type: String, trim: false },
    lastName: { type: String, trim: false },
    name: { type: String, trim: false },

    // ✅ ABDM specific
    token: { type: String },
    expiresIn: { type: Number },
    refreshToken: { type: String },
    refreshExpiresIn: { type: Number },
    hprIdNumber: { type: String },
    hprId: { type: String },
    gender: { type: String },
    yearOfBirth: { type: String },
    monthOfBirth: { type: String },
    dayOfBirth: { type: String },
    stateCode: { type: String },
    districtCode: { type: String },
    stateName: { type: String },
    districtName: { type: String },
    kycPhoto: { type: String },
    categoryId: { type: Number },
    subCategoryId: { type: Number },
    authMethods: { type: [String] },
    new: { type: Boolean },
    categories: { type: Object },

    // ✅ Your system fields
    aadhaar: { type: String, required: false, trim: true },
    reg_no: { type: String, trim: false },
    mobile: { type: String, trim: false, max: 12, min: 10 },
    specialize: { type: [SpecializeReferenceSchema] },
    hospital: { type: [HospitalReferenceSchema] },
    address: { type: [AddressReferenceSchema] },
    permissions: { type: [PermissionReferenceSchema] },
    is_active: { type: Boolean, default: true },
    password: { type: String, minlength: 6 },
    email: {
        type: String,
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please fill a valid email address']
    },
    status: { type: Number, default: 1 },
    version_m4: { type: Object },
    reset_otp: { type: Number, default: null },
    role_id: { type: Number, default: 2 },
    created_by: { type: String, trim: true },
    updated_by: { type: String, trim: true },
    deleted_by: { type: String, trim: true }
}, {
    timestamps: true,
    collection: 'users'
});


// UserSchema.index({ email: 1 });
UserSchema.index({ status: 1, email: 1, role_id: 1 });
// UserSchema.index({ role_id: 1 });

export const UserModel = model<IUser>('User', UserSchema);