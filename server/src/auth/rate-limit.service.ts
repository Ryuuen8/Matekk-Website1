import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class RateLimitService {
    constructor(private prisma: PrismaService) { }

    /** Counts one hit per key and throws 429 if any key is over the limit. */
    async consume(keys: string[], limit: number, windowMs: number) {
        const now = new Date();
        const windowStart = new Date(now.getTime() - windowMs);

        // drop counters whose window has expired so they start fresh
        await this.prisma.authLoginAttempt.deleteMany({
            where: { key: { in: keys }, windowStartedAt: { lt: windowStart } },
        });

        const results = await this.prisma.$transaction(
            keys.map((key) =>
                this.prisma.authLoginAttempt.upsert({
                    where: { key },
                    create: { key, windowStartedAt: now, attempts: 1 },
                    update: { attempts: { increment: 1 } },
                    select: { attempts: true },
                }),
            ),
            { maxWait: 10000, timeout: 15000 },
        );

        if (results.some((r) => r.attempts > limit)) {
            throw new HttpException('Too many requests. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
        }
    }
}