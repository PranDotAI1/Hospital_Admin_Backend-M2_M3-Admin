import { IUser } from "../models/User";

export interface AuthPayload {
  sub: string;
  email: string;
  role: number;
  is_active: boolean;
  iat?: number;
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: IUser;
      auth?: AuthPayload;
    }
  }
}
