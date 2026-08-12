import { Global, Module } from "@nestjs/common";
import { RedisThrottlerStorage } from "./redis-throttler.storage";

// @Global (mismo criterio que ClockModule/CryptoModule, design §2): la
// storage la consume tanto AppModule (throttler `default` global vía
// ThrottlerModule.forRootAsync) como AuthModule (AuthEmailThrottlerGuard,
// auth-ip/auth-email) — transversal, no de un dominio en particular.
@Global()
@Module({
  providers: [RedisThrottlerStorage],
  exports: [RedisThrottlerStorage],
})
export class ThrottleModule {}
