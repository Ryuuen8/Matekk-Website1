import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service.js';
import { ACCESS_TOKEN_COOKIE } from '../auth-cookie.js';
import type { Request } from 'express';

interface JwtPayload {
  sub: number;
  username: string;
  sessionVersion: number;
}

function isJwtPayload(payload: unknown): payload is JwtPayload {
  if (
    payload === null ||
    typeof payload !== 'object' ||
    !('sub' in payload) ||
    !('username' in payload) ||
    !('sessionVersion' in payload)
  ) {
    return false;
  }

  return (
    typeof payload.sub === 'number' &&
    Number.isSafeInteger(payload.sub) &&
    payload.sub > 0 &&
    typeof payload.username === 'string' &&
    Boolean(payload.username.trim()) &&
    typeof payload.sessionVersion === 'number' &&
    Number.isSafeInteger(payload.sessionVersion) &&
    payload.sessionVersion >= 0
  );
}

function extractAccessTokenFromCookie(request: Request): string | null {
  const cookie = request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ACCESS_TOKEN_COOKIE}=`));

  return cookie ? cookie.slice(ACCESS_TOKEN_COOKIE.length + 1) : null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private readonly usersService: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([extractAccessTokenFromCookie]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: unknown) {
    if (!isJwtPayload(payload)) {
      throw new UnauthorizedException('Invalid token payload.');
    }

    const user = await this.usersService.findAuthUserById(payload.sub);
    if (
      !user ||
      user.username !== payload.username ||
      user.sessionVersion !== payload.sessionVersion
    ) {
      throw new UnauthorizedException('Invalid token subject.');
    }

    if (
      user.role.trim().toLowerCase() !== 'admin' &&
      user.expiration_date != null &&
      user.expiration_date.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Account has expired.');
    }

    return user;
  }
}