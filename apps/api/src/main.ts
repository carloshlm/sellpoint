import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { Env } from "./config/env.schema";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const configService = app.get(ConfigService<Env, true>);
  app.use(helmet());
  // f1-auth U4: la cookie de refresh (httpOnly, AD-5) llega en el header
  // Cookie de cada request — sin este middleware, POST /auth/refresh y
  // /auth/logout no tienen forma de leerla vía req.cookies.
  app.use(cookieParser());
  app.enableCors({
    origin: configService.get("CORS_ORIGINS", { infer: true }),
    // credentials: la SPA (f1-web-auth) necesita mandar/recibir la cookie
    // sp_refresh en requests same-site a /api/auth/* (design AD-5).
    credentials: true,
  });

  const openApiConfig = new DocumentBuilder()
    .setTitle("SellPoint API")
    .setDescription("API de control de inventario y punto de venta")
    .setVersion("0.0.1")
    .build();
  const document = SwaggerModule.createDocument(app, openApiConfig);
  SwaggerModule.setup("docs", app, document, {
    jsonDocumentUrl: "openapi.json",
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
