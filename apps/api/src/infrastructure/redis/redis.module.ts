import { Global, Inject, Module, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";
import { Env } from "../../config/env.schema";

export const REDIS_CLIENT = "REDIS_CLIENT";

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (configService: ConfigService<Env, true>) =>
        new Redis(configService.get("REDIS_URL", { infer: true })),
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  // Sin esto, el proceso (y el harness e2e de f1-auth, U1-13) nunca cierra
  // limpio: ioredis mantiene el socket abierto indefinidamente si nadie
  // llama a quit()/disconnect().
  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
