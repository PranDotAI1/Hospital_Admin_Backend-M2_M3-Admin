import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
const SALT_ROUNDS = 10;
const SECRET_KEY = process.env.JWT_SECRET || '12345678'; // Use an environment variable


export const hashPassword = async (password: string): Promise<string> => {
    return bcrypt.hash(password, SALT_ROUNDS);
};

export const comparePassword = async (password: string, hash: string): Promise<boolean> => {
    return bcrypt.compare(password, hash);
};

export const apiResponse = (res: any, data: any, code: number, msg?: string | "Success") => {
    return res.status(code).json({ "data": data, "msg": msg, "code": code })
}


export const generateToken = (payload: object): string => {
    return jwt.sign(payload, SECRET_KEY, { expiresIn: '24h' });
};

// A simple in-memory store for blacklisted tokens (use a database in production)
const tokenBlacklist = new Set<string>();

export const expiredToken = (token: string) => {
    try {
        const decoded = jwt.verify(token, SECRET_KEY);

        tokenBlacklist.add(token);

        return true;
    } catch (error) {
        // Token is invalid or expired
        return false;
    }
};


export const decodeToken = (token: string) => {
    // Decode without verification
    const decoded = jwt.decode(token);
    if (decoded && typeof decoded === 'object') {
        ['iat', 'exp', 'password', "_id"].forEach(key => {
            delete decoded[key];
        });
        return decoded;
    }
    else {
        return null;
    }
};

export const verifyToken = (token: string) => {
    try {
        return jwt.verify(token, SECRET_KEY);
    } catch (error) {
        console.error('Invalid token:', (error as Error).message);
        return null;
    }
};