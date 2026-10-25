import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsersService } from './users.service.js';
import { EmailService } from '../email/email.service.js';

describe('UsersService', () => {
  let service: UsersService;
  const updateMany = vi.fn();
  const findMany = vi.fn();
  const findFirst = vi.fn();
  const findUnique = vi.fn();
  const sendUserStatusEmail = vi.fn();

  beforeEach(async () => {
    updateMany.mockReset();
    findMany.mockReset();
    findFirst.mockReset();
    findUnique.mockReset();
    sendUserStatusEmail.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: { users: { updateMany, findMany, findFirst, findUnique } },
        },
        {
          provide: EmailService,
          useValue: { sendUserStatusEmail },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns an approval status derived from the active flag', async () => {
    findMany.mockResolvedValue([
      {
        id: 42,
        username: 'waiting-user',
        email: 'waiting@example.com',
        role: 'Student',
        active_status: false,
        programs_enrolled: null,
        enrollments: [],
      },
    ]);

    await expect(service.findAll()).resolves.toEqual([
      {
        userId: 42,
        username: 'waiting-user',
        email: 'waiting@example.com',
        role: 'Student',
        active_status: false,
        expiration_date: null,
        pending_status: 'Pending',
        module_enrolled: undefined,
      },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        active_status: true,
        expiration_date: true,
        programs_enrolled: true,
        enrollments: {
          select: {
            program: {
              select: {
                name: true,
                parentId: true,
                modules: { select: { name: true } },
              },
            },
          },
        },
      },
    });
  });

  it('returns enrolled program names from enrollment relations', async () => {
    findMany.mockResolvedValue([
      {
        id: 43,
        username: 'enrolled-user',
        email: 'enrolled@example.com',
        role: 'Student',
        active_status: false,
        programs_enrolled: '',
        enrollments: [
          {
            program: {
              name: 'CCNA',
              parentId: null,
              modules: [{ name: 'CCNA Cybersecurity' }, { name: 'CCNA Automation' }],
            },
          },
          {
            program: {
              name: 'CCNA',
              parentId: null,
              modules: [{ name: 'CCNA Cybersecurity' }, { name: 'CCNA Automation' }],
            },
          },
          { program: { name: 'Security+', parentId: 1, modules: [] } },
        ],
      },
    ]);

    await expect(service.findAll()).resolves.toEqual([
      {
        userId: 43,
        username: 'enrolled-user',
        email: 'enrolled@example.com',
        role: 'Student',
        active_status: false,
        expiration_date: null,
        pending_status: 'Pending',
        module_enrolled: 'CCNA, CCNA Cybersecurity, CCNA Automation, Security+',
      },
    ]);
  });

  it('includes legacy program categories alongside normalized enrollments', async () => {
    findMany.mockResolvedValue([
      {
        id: 48,
        username: 'mixed-enrollment-user',
        email: 'mixed@example.com',
        role: 'Student',
        active_status: true,
        programs_enrolled: 'Cisco, Palo Alto, CompTIA, Cisco',
        enrollments: [
          {
            program: {
              name: 'CCNA',
              parentId: null,
              modules: [{ name: 'CCNA Automation' }],
            },
          },
          {
            program: {
              name: 'Network+',
              parentId: 2,
              modules: [],
            },
          },
        ],
      },
    ]);

    const [result] = await service.findAll();
    expect(result.module_enrolled).toBe(
      'CCNA, CCNA Automation, Network+, Cisco, Palo Alto, CompTIA',
    );
  });

  it('uses the legacy enrolled-program field when no enrollment relation exists', async () => {
    findMany.mockResolvedValue([
      {
        id: 44,
        username: 'legacy-user',
        email: 'legacy@example.com',
        role: 'Student',
        active_status: false,
        programs_enrolled: 'CCNA',
        enrollments: [],
      },
    ]);

    const result = await service.findAll();
    expect(result[0].module_enrolled).toBe('CCNA');
  });

  it('returns an empty list when the database has no users', async () => {
    findMany.mockResolvedValue([]);

    await expect(service.findAll()).resolves.toEqual([]);
  });

  it('only finds users persisted in the database', async () => {
    findFirst.mockResolvedValue(null);

    await expect(service.findOne('test')).resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledWith({
      where: { username: { equals: 'test', mode: 'insensitive' } },
      select: {
        id: true,
        username: true,
        password: true,
        role: true,
        active_status: true,
        expiration_date: true,
        sessionVersion: true,
        email: true,
        first_name: true,
        last_name: true,
        birth_date: true,
        gender: true,
        city_province: true,
        phone_number: true,
        profile_photo: true,
        programs_enrolled: true,
        enrollments: {
          select: {
            program: {
              select: {
                name: true,
                parentId: true,
                modules: { select: { name: true } },
              },
            },
          },
        },
      },
    });
  });

  it('returns program enrollments from the profile used by the course page', async () => {
    findFirst.mockResolvedValue({
      id: 45,
      username: 'ccna-student',
      password: 'hashed',
      role: 'Student',
      active_status: true,
      sessionVersion: 0,
      email: 'ccna@example.com',
      programs_enrolled: '',
      enrollments: [{
        program: {
          name: 'CCNA',
          parentId: null,
          modules: [{ name: 'CCNA Cybersecurity' }, { name: 'CCNA Automation' }],
        },
      }],
    });

    await expect(service.findOne('ccna-student')).resolves.toEqual({
      userId: 45,
      username: 'ccna-student',
      password: 'hashed',
      role: 'Student',
      active_status: true,
      sessionVersion: 0,
      expiration_date: null,
      pending_status: 'Active',
      email: 'ccna@example.com',
      module_enrolled: 'CCNA, CCNA Cybersecurity, CCNA Automation',
    });
  });

  it('returns only the selected module when enrollment is not for the whole program', async () => {
    findFirst.mockResolvedValue({
      id: 46,
      username: 'module-student',
      password: 'hashed',
      role: 'Student',
      active_status: true,
      email: 'module@example.com',
      programs_enrolled: '',
      enrollments: [{
        program: {
          name: 'CCNA Automation',
          parentId: 4,
          modules: [],
        },
      }],
    });

    const result = await service.findOne('module-student');
    expect(result?.module_enrolled).toBe('CCNA Automation');
  });

  it('loads the active session version when validating an authenticated user', async () => {
    findUnique.mockResolvedValue({
      id: 42,
      username: 'student',
      active_status: true,
      sessionVersion: 7,
      expiration_date: null,
      role: 'Student',
    });

    await expect(service.findAuthUserById(42)).resolves.toEqual({
      userId: 42,
      username: 'student',
      active_status: true,
      sessionVersion: 7,
      expiration_date: null,
      role: 'Student',
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 42 },
      select: {
        id: true,
        username: true,
        active_status: true,
        sessionVersion: true,
        expiration_date: true,
        role: true,
      },
    });
  });

  it('loads a complete profile by user id', async () => {
    const birthDate = new Date('2000-01-02T00:00:00.000Z');
    findUnique.mockResolvedValue({
      id: 47,
      username: 'profile-user',
      password: 'hashed',
      role: 'Student',
      active_status: true,
      sessionVersion: 3,
      email: 'profile@example.com',
      first_name: 'Profile',
      last_name: 'User',
      birth_date: birthDate,
      gender: 'Female',
      city_province: 'Rizal',
      phone_number: '555-1234',
      profile_photo: null,
      programs_enrolled: '',
      enrollments: [],
    });

    await expect(service.findById(47)).resolves.toMatchObject({
      userId: 47,
      username: 'profile-user',
      email: 'profile@example.com',
      first_name: 'Profile',
      last_name: 'User',
      birth_date: birthDate,
      gender: 'Female',
      city_province: 'Rizal',
      phone_number: '555-1234',
      profile_photo: null,
    });
  });

  it('approves an existing user', async () => {
    findUnique.mockResolvedValue({
      active_status: false,
      expiration_date: null,
      role: 'Student',
      email: 'waiting@example.com',
      first_name: 'Waiting',
      last_name: 'User',
      username: 'waiting-user',
    });
    updateMany.mockResolvedValue({ count: 1 });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-31T12:00:00.000Z'));
    await expect(service.approve(42)).resolves.toEqual({
      userId: 42,
      active_status: true,
      expiration_date: new Date('2026-04-30T12:00:00.000Z'),
    });
    vi.useRealTimers();
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 42 },
      select: {
        active_status: true,
        expiration_date: true,
        role: true,
        role: true,
        email: true,
        first_name: true,
        last_name: true,
        username: true,
      },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 42, active_status: false },
      data: {
        active_status: true,
        expiration_date: new Date('2026-04-30T12:00:00.000Z'),
      },
    });
    expect(sendUserStatusEmail).toHaveBeenCalledWith(
      { name: 'Waiting User', email: 'waiting@example.com' },
      'accepted',
    );
  });

  it('reports when the user does not exist', async () => {
    findUnique.mockResolvedValue(null);

    await expect(service.approve(404)).rejects.toThrow('User not found.');
    expect(sendUserStatusEmail).not.toHaveBeenCalled();
  });

  it('does not resend an approval email when the user is already active', async () => {
    const expirationDate = new Date('2026-12-31T00:00:00.000Z');
    findUnique.mockResolvedValue({
      active_status: true,
      expiration_date: expirationDate,
      role: 'Student',
      email: 'active@example.com',
      first_name: 'Active',
      last_name: 'User',
      username: 'active-user',
    });

    await expect(service.approve(42)).resolves.toEqual({
      userId: 42,
      active_status: true,
      expiration_date: expirationDate,
    });
    expect(sendUserStatusEmail).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('does not set an expiration date when approving an admin account', async () => {
    findUnique.mockResolvedValue({
      active_status: false,
      expiration_date: null,
      role: ' Admin ',
      email: 'admin@example.com',
      first_name: 'Admin',
      last_name: 'User',
      username: 'admin-user',
    });
    updateMany.mockResolvedValue({ count: 1 });

    await expect(service.approve(99)).resolves.toEqual({
      userId: 99,
      active_status: true,
      expiration_date: null,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 99, active_status: false },
      data: { active_status: true, expiration_date: null },
    });
  });
});
