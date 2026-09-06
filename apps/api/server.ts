import { createApp } from './app';

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT должен быть целым числом от 1 до 65535.');
const app = createApp({
  databasePath: process.env.DATABASE_PATH,
  serveStatic: true,
  secureCookies: process.env.SECURE_COOKIES === 'true',
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
try {
  const address = await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
  console.log(`Калькулятор: ${address}`);
} catch (error) {
  console.error(error);
  await app.close();
  process.exitCode = 1;
}
