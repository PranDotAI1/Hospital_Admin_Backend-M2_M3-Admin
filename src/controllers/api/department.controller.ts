import { DepartmentModel } from "../../models/Department";
import { RoleModel } from "../../models/Role"
import { apiResponse } from "../../utils/common";
import { STATUS_CODE } from "../../utils/constant";

export const deptlisting = async (req:any,res:any)=>{
    try{
        const data = await DepartmentModel.find();
        return apiResponse(res,data, STATUS_CODE.SUCCESS, "Department Fetched");
    }catch(error: any){
    }
}
    