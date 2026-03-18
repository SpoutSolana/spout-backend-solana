import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS with explicit configuration
  app.enableCors({
    origin: '*',
    methods: '*',
    allowedHeaders: '*',
    credentials: false,
  });

  // Swagger setup
  const config = new DocumentBuilder()
    .setTitle('Spout Backend Solana')
    .setDescription('Backend service for Spout Finance on Solana')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // Listen on all interfaces (0.0.0.0)
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
