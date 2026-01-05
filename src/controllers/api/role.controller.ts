import { RoleModel } from "../../models/Role"
import { apiResponse } from "../../utils/common";
import { STATUS_CODE } from "../../utils/constant";

export const listing = async (req:any,res:any)=>{
    try{
        const roles = await RoleModel.find();
        return apiResponse(res,roles, STATUS_CODE.SUCCESS, "Role Fetched");
    }catch(error: any){
        console.log("error",error);
    }
}
    