// Defaults de entorno para tests (CI no tiene .env — jest los carga ANTES de
// cualquier import, que es cuando ConfigModule.forRoot valida).
process.env.DATABASE_URL ??= "postgresql://sellpoint:sellpoint@localhost:5432/sellpoint_dev";
process.env.REDIS_URL ??= "redis://localhost:6379";
