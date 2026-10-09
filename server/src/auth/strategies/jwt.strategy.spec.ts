import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service.js';
import { JwtStrategy } from './jwt.strategy.js';

describe('JwtStrategy', () => {
  const activeUser = {
    userId: 12,
    username: 'student',
    active_status: true,
    sessionVersion: 3,
    expiration_date: null,
    role: 'Student',
  };
  const findAuthUserById = vi.fn();

  function createStrategy() {
    return new JwtStrategy(
      { getOrThrow: () => 'test-secret-with-at-least-32-characters' } as unknown as ConfigService,
      { findAuthUserById } as unknown as UsersService,
    );
  }

  beforeEach(() => {
    findAuthUserById.mockReset();
  });

  it('resolves the current account and returns its current approval status', async () => {
    findAuthUserById.mockResolvedValue({ ...activeUser, active_status: false });
    const strategy = createStrategy();

    await expect(strategy.validate({
      sub: 12,
      username: 'student',
      sessionVersion: 3,
    })).resolves.toEqual({
      ...activeUser,
      active_status: false,
    });
    expect(findAuthUserById).toHaveBeenCalledWith(12);
  });

  it('rejects tokens whose subject no longer identifies the same user', async () => {
    findAuthUserById.mockResolvedValue({ ...activeUser, username: 'renamed-user' });
    const strategy = createStrategy();

    await expect(strategy.validate({
      sub: 12,
      username: 'student',
      sessionVersion: 3,
    }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects tokens for deleted accounts', async () => {
    findAuthUserById.mockResolvedValue(undefined);
    const strategy = createStrategy();

    await expect(strategy.validate({
      sub: 12,
      username: 'student',
      sessionVersion: 3,
    }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects tokens from an earlier login session', async () => {
    findAuthUserById.mockResolvedValue(activeUser);
    const strategy = createStrategy();

    await expect(strategy.validate({
      sub: 12,
      username: 'student',
      sessionVersion: 2,
    })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects tokens after the account expiration date', async () => {
    findAuthUserById.mockResolvedValue({
      ...activeUser,
      expiration_date: new Date(Date.now() - 1),
    });
    const strategy = createStrategy();

    await expect(strategy.validate({
      sub: 12,
      username: 'student',
      sessionVersion: 3,
    })).rejects.toThrow('Account has expired.');
  });

  it('allows admins to access the system after their expiration date', async () => {
    findAuthUserById.mockResolvedValue({
      ...activeUser,
      role: 'Admin',
      expiration_date: new Date(Date.now() - 1),
    });
    const strategy = createStrategy();

    await expect(strategy.validate({
      sub: 12,
      username: 'student',
      sessionVersion: 3,
    })).resolves.toMatchObject({ role: 'Admin' });
  });

  it('rejects malformed token claims', async () => {
    const strategy = createStrategy();

    await expect(strategy.validate(null)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findAuthUserById).not.toHaveBeenCalled();
  });
});
