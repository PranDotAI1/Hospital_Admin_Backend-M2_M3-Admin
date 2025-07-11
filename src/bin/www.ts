import http from 'http'; // Ensure you import the 'http' module
import app from '../app';
import dotenv from 'dotenv';

dotenv.config();

const PORT: string | number = process.env.PORT || 3000;

const port = normalizePort(PORT);
app.set('port', port);

const server = http.createServer(app);

server.listen(port);
server.on('error', onError);
server.on('listening', onListening);

function normalizePort(val: string | number): number | string | boolean {
  const port = typeof val === 'string' ? parseInt(val, 10) : val;
  if (isNaN(port)) return val; // Named pipe
  if (port >= 0) return port; // Port number
  return false;
}

function onError(error: NodeJS.ErrnoException): void {
  if (error.syscall !== 'listen') throw error;

  const bind = typeof port === 'string' ? `Pipe ${port}` : `Port ${port}`;

  switch (error.code) {
    case 'EACCES':
      console.error(`${bind} requires elevated privileges`);
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(`${bind} is already in use`);
      process.exit(1);
      break;
    default:
      throw error;
  }
}

function onListening(): void {
  const addr = server.address();
  if (!addr) {
    console.error('Failed to retrieve server address');
    return;
  }
  const bind = typeof addr === 'string' ? `pipe ${addr}` : `port ${addr.port}`;
  console.log(`Listening on ${bind}`);
}
