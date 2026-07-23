import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

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
