import { z } from "zod";
import { cleanStringSchema, optionalCleanStringSchema } from "./common.schema";

/**
 * Schema for Add Hospital: POST /hospital
 *
 * Previously: raw req.body went directly into HospitalModel.create(input)
 * — an attacker could write arbitrary fields.
 * Fields match the Hospital model: name (required), add1, add2, city, state, pincode, country.
 */
export const addHospitalSchema = z.object({
  name: cleanStringSchema(200),
  add1: cleanStringSchema(500),
  add2: optionalCleanStringSchema(500),
  city: cleanStringSchema(100),
  state: cleanStringSchema(100),
  pincode: z.union([
    z.number().int().min(100000).max(999999),
    z.string().regex(/^\d{6}$/, { message: "Pincode must be exactly 6 digits" }),
  ]),
  country: optionalCleanStringSchema(100),
  is_active: z.boolean().optional(),
});

export type AddHospitalInput = z.infer<typeof addHospitalSchema>;

/**
 * Schema for Update Hospital: PUT /hospital/:id
 *
 * Matches the ALLOWED_FIELDS allowlist in hospital.controller.ts:
 * name, address, phone, email, is_active, city, state, pincode
 */
export const updateHospitalSchema = z.object({
  name: optionalCleanStringSchema(200),
  add1: optionalCleanStringSchema(500),
  add2: optionalCleanStringSchema(500),
  address: optionalCleanStringSchema(500),
  phone: optionalCleanStringSchema(20),
  email: z
    .string()
    .email({ message: "Invalid email format" })
    .optional(),
  city: optionalCleanStringSchema(100),
  state: optionalCleanStringSchema(100),
  pincode: z
    .union([
      z.number().int().min(100000).max(999999),
      z.string().regex(/^\d{6}$/, { message: "Pincode must be exactly 6 digits" }),
    ])
    .optional(),
  country: optionalCleanStringSchema(100),
  is_active: z.boolean().optional(),
});

export type UpdateHospitalInput = z.infer<typeof updateHospitalSchema>;
