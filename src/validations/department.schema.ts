import { z } from "zod";
import { cleanStringSchema, optionalCleanStringSchema } from "./common.schema";

/**
 * Schema for Add Department: POST /department
 *
 * Previously: raw req.body went directly into DepartmentModel.create(input)
 * — an attacker could write arbitrary fields (status, department_id, etc.).
 */
export const addDepartmentSchema = z.object({
  name: cleanStringSchema(200),
  description: optionalCleanStringSchema(500),
  status: z.boolean().optional(),
});

export type AddDepartmentInput = z.infer<typeof addDepartmentSchema>;

/**
 * Schema for Update Department: PUT /department/:id
 *
 * Previously: raw req.body went directly into DepartmentModel.updateOne()
 * — an attacker could overwrite _id, department_id, or any other field.
 */
export const updateDepartmentSchema = z.object({
  name: optionalCleanStringSchema(200),
  description: optionalCleanStringSchema(500),
  status: z.boolean().optional(),
});

export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
