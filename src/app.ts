import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import logger from 'morgan';

import indexRouter from './routes/index';
import usersRouter from './routes/users';
import { connectDB } from './config/db';

const app = express();

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

app.use('/api', indexRouter);
app.use('/users', usersRouter);

app.use((req: Request, res: Response, next: NextFunction) => {
  const err = new Error('Not Found');
  res.status(404).send(err.message);
});

export default app;
