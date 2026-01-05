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
    userPermissions?: Object;

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
    email?: string;
    password?: string;
    created_by?: string;
    deleted_by?: string;
    updated_by?: string;
    status?: number;
    reset_otp?: number;
    role_id?: number;
    is_active?: boolean;
    version_m4?: any;
    previous_passwords?:[];
    age:number;
    contact: string;
    pan: string;
    shift: string;
    department_id?:any,
    is_super_admin?: boolean;
    hospital_id?:any
}


const SpecializeReferenceSchema = new Schema({
    id: { type: Schema.Types.ObjectId, ref: 'Specialize' },
    name: { type: String },
}, { _id: false });

const HospitalReferenceSchema = new Schema({
    id: { type: Schema.Types.ObjectId, ref: 'Hospital' },
    name: { type: String },
}, { _id: false });
const DepartmentReferenceSchema = new Schema({
    id: { type: Schema.Types.ObjectId, ref: 'Department' },
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
    f_name: { type: String, trim: false, required: false },
    m_name: { type: String, trim: false, required: false },
    l_name: { type: String, trim: false, required: false },
    firstName: { type: String, trim: false, required: false },
    middleName: { type: String, trim: false, required: false },
    lastName: { type: String, trim: false, required: false },
    name: { type: String, trim: false, required: false },
    age:{ type: Number, required: false },
    contact: { type: String, trim: false, required: false },
    pan: { type: String, trim: false, required: false },
    shift: { type: String, trim: false, required: false },
    department_id: { type: Schema.Types.ObjectId, ref: 'Department', required: false },
    hospital_id: { type: Schema.Types.ObjectId, ref: 'Hospital', required: false },
    is_super_admin: { type: Boolean, default: false, required: false },

    // ✅ ABDM specific
    token: { type: String, required: false },
    expiresIn: { type: Number, required: false },
    refreshToken: { type: String, required: false },
    refreshExpiresIn: { type: Number, required: false },
    hprIdNumber: { type: String, required: false },
    hprId: { type: String, required: false },
    gender: { type: String, required: false },
    yearOfBirth: { type: String, required: false },
    monthOfBirth: { type: String, required: false },
    dayOfBirth: { type: String, required: false },
    stateCode: { type: String, required: false },
    districtCode: { type: String, required: false },
    stateName: { type: String, required: false },
    districtName: { type: String, required: false },
    kycPhoto: { type: String, required: false },
    categoryId: { type: Number, required: false },
    subCategoryId: { type: Number, required: false },
    authMethods: { type: [String], required: false },
    new: { type: Boolean },
    categories: { type: Object, required: false },
    userPermissions: { type: Object, required: false },

    // ✅ Your system fields
    aadhaar: { type: String, required: false, trim: true },
    reg_no: { type: String, trim: false, required: false },
    mobile: { type: String, trim: false, max: 12, min: 10, required: false },
    specialize: { type: [SpecializeReferenceSchema], required: false },
    hospital: { type: [HospitalReferenceSchema], required: false },
    address: { type: [AddressReferenceSchema], required: false },
    permissions: { type: [PermissionReferenceSchema], required: false },
    is_active: { type: Boolean, default: true, required: false },
    password: { type: String, minlength: 6, required: false },
    email: {
        type: String,
        required: false,
        default: ""
    },
    status: { type: Number, default: 1, required: false, },
    version_m4: { type: Object, required: false, },
    previous_passwords: { type: [], required: false },
    reset_otp: { type: Number, default: null, required: false },
    role_id: { type: Number, default: 2, required: false },
    created_by: { type: String, trim: true, required: false },
    updated_by: { type: String, trim: true, required: false },
    deleted_by: { type: String, trim: true, required: false }
}, {
    timestamps: true,
    collection: 'users'
});


// UserSchema.index({ email: 1 });
UserSchema.index({ status: 1, role_id: 1 });
UserSchema.index({ email: 1 }, { unique: true, sparse: true });
// UserSchema.index({ role_id: 1 });

export const UserModel = model<IUser>('User', UserSchema);