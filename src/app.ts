import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import logger from 'morgan';
import path from 'path';
import 'tsconfig-paths/register';
import dotenv from 'dotenv';

dotenv.config();

import { connectDB } from './config/db';
import indexRouter from './routes/index';
import usersRouter from './routes/users';
import V2router from './routes/v2';
import v3router from './routes/v3';
import webook from './routes/webhook';
import V4router from './routes/v4';

const app = express();

// CORS Configuration - Simple and robust
app.use(cors({
  origin: true, // Reflect the request origin
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200,
  maxAge: 86400 // 24 hours
}));

// Explicit CORS headers as fallback
app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  // Always set CORS headers
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

app.set('views', path.join(__dirname, '../views'));
app.set('view engine', 'jade');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

connectDB().then(() => {
  console.log('Database connected successfully vie app');
}).catch((error) => {
  console.error('Database connection failed:', error.message);
});

// URL FOR RECEVIED THE DATA
app.use('/', webook);

// Use the v3 router for version 3 API routes
app.use("/api/v3", v3router)

// Use the v2 router for version 2 API routes
app.use("/api/v2", V2router)


// Use the v4 router for version 2 API routes
app.use("/api/v4", V4router)

// ALL OTHERS ROUTES
app.use('/api', indexRouter);
app.use('/api/users', usersRouter);

app.use((req: Request, res: Response, next: NextFunction) => {
  const err = new Error('Not Found');
  res.status(404).send(err.message);
});

export default app;
