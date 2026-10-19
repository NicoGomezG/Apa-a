// Punto de entrada de la API en Vercel (Vercel Function de Node).
// vercel.json reescribe /api/* hacia acá; Fastify recibe la URL original y enruta.
// El código vive en backend/ y se compila a backend/dist en el build.
import { handleVercelRequest } from '../backend/dist/vercel.js';

export default handleVercelRequest;
