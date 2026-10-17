import { UnauthorizedException } from '@nestjs/common';
import { vi } from 'vitest';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsersService, type User } from '../users/users.service.js';
import { EmailService } from '../email/email.service.js';
import { OtpService } from './otp/otp.service.js';

describe('AuthService', () => {
  const user: User = {
    userId: 12,
    username: 'student',
    email: 'student@example.com',
    password: 'plain-password',
    role: 'Student',
    active_status: false,
    sessionVersion: 0,
  };

  function createService(options: {
    foundUser?: User;
    hash?: string;
    verify?: boolean;
    needsRehash?: boolean;
  } = {}) {
    const findOne = vi.fn(async () => options.foundUser ?? user);
    const signAsync = vi.fn(async () => 'access-token');
    const hash = vi.fn(async () => options.hash ?? '$argon2id$hashed-password');
    const verify = vi.fn(async () => options.verify ?? true);
    const needsRehash = vi.fn(() => options.needsRehash ?? false);
    const findFirst = vi.fn(async () => null);
    const create = vi.fn(async () => user);
    const update = vi.fn(async () => ({ sessionVersion: 1 }));
    const findUnique = vi.fn(async () => user);
    const findById = vi.fn(async () => options.foundUser ?? user);
    const enrollmentFindMany = vi.fn(async () => []);
    const programFindUnique = vi.fn(async () => null);
    const inquiryFindFirst = vi.fn(async () => null);
    const inquiryCreate = vi.fn(async () => ({ id: 42 }));
    const sendUserStatusEmail = vi.fn(async () => undefined);
    const sendAdminNotification = vi.fn(async () => undefined);
    const request = vi.fn(async () => true);
    const verifyEmail = vi.fn(async () => ({ verificationToken: 'v'.repeat(43) }));
    const consumeVerification = vi.fn(async () => undefined);
    const service = new AuthService(
      { findOne, findById } as unknown as UsersService,
      { signAsync } as unknown as import('@nestjs/jwt').JwtService,
      { hash, verify, needsRehash } as unknown as PasswordService,
      {
        users: { findFirst, findUnique, create, update },
        enrollment: { findMany: enrollmentFindMany },
        program: { findUnique: programFindUnique },
        inquires: { findFirst: inquiryFindFirst, create: inquiryCreate },
      } as unknown as PrismaService,
      { sendUserStatusEmail, sendAdminNotification } as unknown as EmailService,
      { request, verify: verifyEmail, consumeVerification } as unknown as OtpService,
    );

    return {
      service, findOne, findById, signAsync, hash, verify, needsRehash, findFirst,
      findUnique, create, update, enrollmentFindMany,
      programFindUnique, inquiryFindFirst, inquiryCreate,
      sendUserStatusEmail, sendAdminNotification, request, verifyEmail, consumeVerification,
    };
  }

  it('stores a hashed password and selected full-program enrollment at registration', async () => {
    const mocks = createService({ hash: '$argon2id$registration-hash' });

    await expect(mocks.service.register({
      username: 'student',
      email: 'student@example.com',
      verificationToken: 'v'.repeat(43),
      password: 'plain-password',
      programId: 4,
      firstName: 'Sample',
      lastName: 'Student',
      birthdate: '2000-01-02',
      gender: 'Female',
      city: 'Rizal',
    })).resolves.toEqual({ message: 'Registration submitted. Please wait for approval.' });

    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        username: 'student',
        email: 'student@example.com',
        password: '$argon2id$registration-hash',
        role: 'Student',
        programs_enrolled: '',
        first_name: 'Sample',
        last_name: 'Student',
        birth_date: new Date('2000-01-02'),
        gender: 'Female',
        city_province: 'Rizal',
        active_status: false,
        pending_status: 'Pending',
        enrollments: { create: { programId: 4 } },
      },
    });

    expect(mocks.consumeVerification).toHaveBeenCalledWith(
      'student@example.com',
      'REGISTRATION',
      'v'.repeat(43),
    );
    expect(mocks.create.mock.calls[0][0].data.enrollments).toEqual({
      create: { programId: 4 },
    });
    expect(mocks.sendUserStatusEmail).toHaveBeenCalledWith(
      { name: 'Sample Student', email: 'student@example.com' },
      'pending',
    );
    expect(mocks.sendAdminNotification).toHaveBeenCalledWith({
      name: 'Sample Student',
      email: 'student@example.com',
    });
  });

  it('creates a pending enrollment inquiry for the selected program', async () => {
    const mocks = createService();
    mocks.findUnique.mockResolvedValue({
      ...user,
      first_name: 'Sample',
      last_name: 'Student',
    });
    mocks.programFindUnique.mockResolvedValue({
      id: 4,
      name: 'Network+',
      parentId: null,
      training: { name: 'CompTIA' },
      parent: null,
    });

    await expect(mocks.service.createEnrollmentRequest(12, {
      programId: 4,
      email: ' Student@Example.com ',
      phone: ' 09171234567 ',
    })).resolves.toEqual({
      message: 'Enrollment request submitted for administrator review.',
    });

    expect(mocks.inquiryFindFirst).toHaveBeenCalledWith({
      where: {
        inquiry_type: 'Enrollment Request',
        project_desc: 'Account ID: 12; Program ID: 4',
        status: true,
      },
      select: { id: true },
    });
    expect(mocks.inquiryCreate).toHaveBeenCalledWith({
      data: {
        inquiry_type: 'Enrollment Request',
        name: 'Sample Student',
        email: 'student@example.com',
        phone: '09171234567',
        subject: 'Enrollment request: Network+',
        course: 'Network+',
        message: 'Sample Student requested enrollment in Network+.',
        project_desc: 'Account ID: 12; Program ID: 4',
      },
    });
  });

  it('stores the selected module id rather than its parent when registering for one module', async () => {
    const mocks = createService();

    await mocks.service.register({
      username: 'module-student',
      email: 'module@example.com',
      verificationToken: 'v'.repeat(43),
      password: 'plain-password',
      programId: 9,
      firstName: 'Module',
      lastName: 'Student',
    });

    expect(mocks.create.mock.calls[0][0].data.enrollments).toEqual({
      create: { programId: 9 },
    });
  });

  it('does not create an account when the email verification proof is invalid', async () => {
    const mocks = createService();
    mocks.consumeVerification.mockRejectedValue(new UnauthorizedException());

    await expect(mocks.service.register({
      username: 'student',
      email: 'student@example.com',
      verificationToken: 'v'.repeat(43),
      password: 'plain-password',
      programId: 4,
      firstName: 'Sample',
      lastName: 'Student',
    })).rejects.toBeInstanceOf(UnauthorizedException);

    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('verifies Argon2 credentials and sends a sign-in OTP', async () => {
    const hashedUser = { ...user, password: '$argon2id$stored-hash' };
    const mocks = createService({ foundUser: hashedUser });

    await expect(mocks.service.signIn('student', 'plain-password'))
      .resolves.toEqual({ requiresOtp: true, maskedEmail: 's******@example.com', emailSent: true });

    expect(mocks.verify).toHaveBeenCalledWith(hashedUser.password, 'plain-password');
    expect(mocks.request).toHaveBeenCalledWith('student@example.com', 'LOGIN');
    expect(mocks.signAsync).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('issues a session only after consuming a valid sign-in OTP', async () => {
    const mocks = createService();

    await expect(mocks.service.verifySignInOtp('student', '123456'))
      .resolves.toEqual({ access_token: 'access-token' });

    expect(mocks.verifyEmail).toHaveBeenCalledWith(
      'student@example.com',
      'LOGIN',
      '123456',
    );
    expect(mocks.consumeVerification).toHaveBeenCalledWith(
      'student@example.com',
      'LOGIN',
      'v'.repeat(43),
    );
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: user.userId },
      data: { sessionVersion: { increment: 1 } },
      select: { sessionVersion: true },
    });
    expect(mocks.signAsync).toHaveBeenCalledWith({
      username: user.username,
      sub: user.userId,
      sessionVersion: 1,
    });
  });

  it('does not issue a session when the sign-in OTP is invalid', async () => {
    const mocks = createService();
    mocks.verifyEmail.mockRejectedValue(new UnauthorizedException());

    await expect(mocks.service.verifySignInOtp('student', '000000'))
      .rejects.toBeInstanceOf(UnauthorizedException);

    expect(mocks.consumeVerification).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.signAsync).not.toHaveBeenCalled();
  });

  it('rehashes a valid legacy plaintext password before sending the OTP', async () => {
    const mocks = createService({ hash: '$argon2id$migrated-hash' });

    await expect(mocks.service.signIn('student', 'plain-password'))
      .resolves.toMatchObject({ requiresOtp: true });

    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: user.userId },
      data: { password: '$argon2id$migrated-hash' },
    });
    expect(mocks.request).toHaveBeenCalledWith('student@example.com', 'LOGIN');
  });

  it('reports when an existing sign-in code was reused instead of sending another email', async () => {
    const mocks = createService();
    mocks.request.mockResolvedValue(false);

    await expect(mocks.service.signIn('student', 'plain-password'))
      .resolves.toMatchObject({ requiresOtp: true, emailSent: false });
  });

  it('rejects an incorrect password without changing the saved password', async () => {
    const hashedUser = { ...user, password: '$argon2id$stored-hash' };
    const mocks = createService({ foundUser: hashedUser, verify: false });

    await expect(mocks.service.signIn('student', 'incorrect'))
      .rejects.toBeInstanceOf(UnauthorizedException);

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.signAsync).not.toHaveBeenCalled();
  });

  it('invalidates the active session when logging out', async () => {
    const mocks = createService();

    await expect(mocks.service.invalidateSession(user.userId)).resolves.toBeUndefined();

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: user.userId },
      data: { sessionVersion: { increment: 1 } },
      select: { id: true },
    });
  });

  it('updates profile details and returns the sanitized profile', async () => {
    const mocks = createService();

    await expect(mocks.service.updateProfile(user.userId, {
      first_name: ' Sample ',
      phone_number: ' 555-1234 ',
    })).resolves.toMatchObject({
      userId: user.userId,
      username: user.username,
      email: user.email,
    });

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: user.userId },
      data: { first_name: 'Sample', phone_number: '555-1234' },
    });
    expect(mocks.findById).toHaveBeenCalledWith(user.userId);
  });

  it('stores only a correctly signed JPEG profile photo within the size limit', async () => {
    const mocks = createService();
    const image = Buffer.from([0xff, 0xd8, 0xff]).toString('base64');
    const photoDataUrl = `data:image/jpeg;base64,${image}`;

    await expect(mocks.service.updateProfilePhoto(user.userId, { photoDataUrl }))
      .resolves.toEqual({ message: 'Profile photo updated successfully.' });

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: user.userId },
      data: { profile_photo: photoDataUrl },
      select: { id: true },
    });
  });

  it('rejects non-image profile photo data without writing it', async () => {
    const mocks = createService();
    const photoDataUrl = `data:image/jpeg;base64,${Buffer.from('not an image').toString('base64')}`;

    await expect(mocks.service.updateProfilePhoto(user.userId, { photoDataUrl }))
      .rejects.toThrow('Profile photo must be a valid JPG or PNG');

    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('requires the current password and invalidates active sessions on password change', async () => {
    const mocks = createService();

    await expect(mocks.service.changePassword(user.userId, {
      currentPassword: 'plain-password',
      newPassword: 'new-password-123',
    })).resolves.toEqual({ message: 'Password updated successfully.' });

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: user.userId },
      data: {
        password: '$argon2id$hashed-password',
        sessionVersion: { increment: 1 },
      },
    });
  });

  it('returns learning history for only the requested user', async () => {
    const mocks = createService();

    await expect(mocks.service.getLearningHistory(user.userId)).resolves.toEqual([]);
    expect(mocks.enrollmentFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: user.userId },
      orderBy: { enrolledAt: 'desc' },
    }));
  });
});
