import { Test, TestingModule } from '@nestjs/testing';
import { QuestionsService } from './questions.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { GradebookService } from '../gradebook/gradebook.service.js';

function examQuestionBank(questionCount: number) {
  const matchingCount = questionCount / 10;
  const singleQuestions = Array.from({ length: questionCount - matchingCount }, (_, index) => ({
    id: index + 1,
    module: 'CCNA',
    topic: 'Routing',
    difficulty: 'Easy',
    question_text: `Question ${index + 1}`,
    choices: JSON.stringify(['Correct', 'Wrong A', 'Wrong B']),
    correct_answer: '0',
    explanation: 'Because it is correct.',
    question_type: 'single',
    match_items: null,
  }));
  const matchQuestions = Array.from({ length: matchingCount }, (_, index) => ({
    id: questionCount - matchingCount + index + 1,
    module: 'CCNA',
    topic: 'Addressing',
    difficulty: 'Medium',
    question_text: `Match question ${index + 1}`,
    choices: JSON.stringify(['Answer A', 'Answer B']),
    correct_answer: '[0,1]',
    explanation: 'Each item maps to its corresponding answer.',
    question_type: 'match',
    match_items: ['Item A', 'Item B'],
  }));
  return [...singleQuestions, ...matchQuestions];
}

describe('QuestionsService', () => {
  let service: QuestionsService;
  let gradebookMock: { recordAssessment: ReturnType<typeof vi.fn> };
  let storageMock: { createSignedQuestionImageUrls: ReturnType<typeof vi.fn> };
  let prismaMock: {
    questions: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    examAttempt: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(async () => {
    gradebookMock = { recordAssessment: vi.fn().mockResolvedValue(null) };
    storageMock = {
      createSignedQuestionImageUrls: vi.fn().mockResolvedValue(new Map()),
    };
    prismaMock = {
      questions: {
        create: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      examAttempt: {
        create: vi.fn(({ data }) => Promise.resolve(data)),
        findUnique: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionsService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: StorageService,
          useValue: storageMock,
        },
        {
          provide: GradebookService,
          useValue: gradebookMock,
        },
      ],
    }).compile();

    service = module.get<QuestionsService>(QuestionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('rejects a correct answer that is not one of the available choices', () => {
    expect(() => service.create({
      module: 'CCNA',
      topic: 'Routing',
      difficulty: 'Easy',
      question_text: 'Which protocol is used?',
      choices: ['A', 'B'],
      correct_answer: 'C',
      explanation: 'Explanation',
    })).toThrow('The correct answer must be one of the question choices.');
  });

  it('stores a matching question and its answer key as matching metadata', async () => {
    await service.create({
      module: 'CCNA',
      topic: 'IPv6',
      difficulty: 'Easy',
      question_text: 'Match these prefixes.',
      question_type: 'match',
      choices: ['Global unicast', 'Multicast'],
      match_items: ['2000::/3', 'FF00::/8'],
      match_answer: [0, 1],
      explanation: 'The prefixes identify the address type.',
    });

    expect(prismaMock.questions.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        question_type: 'match',
        choices: JSON.stringify(['Global unicast', 'Multicast']),
        match_items: ['2000::/3', 'FF00::/8'],
        correct_answer: '[0,1]',
      }),
    });
  });

  it('accepts zero-based numeric answer keys when building an exam', async () => {
    const databaseQuestions = examQuestionBank(50);
    prismaMock.questions.findMany.mockResolvedValue(databaseQuestions);

    const attempt = await service.startExam('short', 7);

    expect(attempt.questions).toHaveLength(50);
    expect(prismaMock.examAttempt.create).toHaveBeenCalledOnce();
  });

  it('starts randomized database exams without returning answer keys', async () => {
    const databaseQuestions = examQuestionBank(50);
    prismaMock.questions.findMany.mockResolvedValue(databaseQuestions);

    const attempt = await service.startExam('short', 7);

    expect(attempt.questions).toHaveLength(50);
    expect(attempt.questions.filter((question) => question.type === 'match')).toHaveLength(5);
    expect(attempt.questions.every((question) =>
      !('correct_answer' in question) && !('answer' in question),
    )).toBe(true);
    expect(attempt.questions.find((question) => question.type === 'single')).toMatchObject({
      id: expect.any(Number),
      prompt: expect.any(String),
      options: expect.arrayContaining(['Correct', 'Wrong A', 'Wrong B']),
    });
    expect(attempt.questions.find((question) => question.type === 'match')).toMatchObject({
      type: 'match',
      items: ['Item A', 'Item B'],
      choices: expect.arrayContaining(['Answer A', 'Answer B']),
    });
    expect(prismaMock.examAttempt.create).toHaveBeenCalledOnce();
    expect(prismaMock.examAttempt.create.mock.calls[0][0].data.userId).toBe(7);
  });

  it('returns signed database image URLs with exam questions', async () => {
    const imagePath = 'questions/ccna-exhibit.webp';
    const signedUrl = 'https://storage.example/questions/ccna-exhibit.webp?token=signed';
    const bank = examQuestionBank(50).map((question) =>
      question.id === 1 ? { ...question, imageUrl: imagePath } : question,
    );
    prismaMock.questions.findMany.mockResolvedValue(bank);
    storageMock.createSignedQuestionImageUrls.mockResolvedValue(new Map([[imagePath, signedUrl]]));

    const attempt = await service.startExam('short', 7);

    expect(attempt.questions.find((question) => question.id === 1)?.imageUrl).toBe(signedUrl);
    expect(storageMock.createSignedQuestionImageUrls).toHaveBeenCalledWith([imagePath]);
    expect(prismaMock.examAttempt.create.mock.calls[0][0].data.questionSet)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: 1, imageUrl: imagePath })]));
  });

  it('grades database exam answers and returns answer review after submission', async () => {
    const databaseQuestions = Array.from({ length: 50 }, (_, index) => ({
      id: index + 1,
      module: 'CCNA',
      topic: 'Routing',
      difficulty: 'Easy',
      question_text: `Question ${index + 1}`,
      choices: JSON.stringify(['Correct', 'Wrong A', 'Wrong B']),
      correct_answer: 'Correct',
      explanation: 'Because it is correct.',
    }));
    const questionSet = databaseQuestions.map((question) => ({
      id: question.id,
      prompt: question.question_text,
      options: ['Wrong A', 'Correct', 'Wrong B'],
      module: question.module,
      topic: question.topic,
    }));
    prismaMock.examAttempt.findUnique.mockResolvedValue({
      id: 'attempt-id',
      userId: 7,
      examKey: 'short',
      questionSet,
      durationSeconds: 2700,
      deadline: new Date(Date.now() + 2700000),
      score: null,
      review: null,
      submittedAt: null,
    });
    prismaMock.questions.findMany.mockResolvedValue(databaseQuestions);

    const result = await service.submitExam(
      'short',
      'attempt-id',
      7,
      [{ questionId: 1, selectedAnswer: 'Correct' }],
    );

    expect(result.score).toBe(1);
    expect(result.isSubmitted).toBe(true);
    expect(result.review).toHaveLength(50);
    expect(result.review[0]).toMatchObject({
      id: 1,
      selectedAnswer: 'Correct',
      correctAnswer: 'Correct',
      isCorrect: true,
    });
    expect(prismaMock.examAttempt.updateMany).toHaveBeenCalledOnce();
    expect(gradebookMock.recordAssessment).toHaveBeenCalledWith(
      7,
      'ccna',
      {
        id: 'attempt-id',
        type: 'exam',
        programKey: 'ccna',
        title: 'Short Exam',
        score: 1,
        maxScore: 50,
        submittedAt: expect.any(Number),
      },
    );
  });

  it('uses only the Questions table to create an exam', async () => {
    const databaseQuestions = examQuestionBank(50);
    prismaMock.questions.findMany.mockResolvedValue(databaseQuestions);

    await service.startExam('short', 7);

    expect(prismaMock.questions.findMany).toHaveBeenCalledOnce();
  });

  it.each([
    [50, 'short'],
    [100, 'medium'],
    [150, 'long'],
  ] as const)('includes exactly five matching questions per 50-question block in the %s exam', async (count, examKey) => {
    prismaMock.questions.findMany.mockResolvedValue(examQuestionBank(count));

    const attempt = await service.startExam(examKey, 7);

    expect(attempt.questions).toHaveLength(count);
    for (let offset = 0; offset < count; offset += 50) {
      expect(
        attempt.questions.slice(offset, offset + 50).filter((question) => question.type === 'match'),
      ).toHaveLength(5);
    }
  });

  it('grades matching answers against the saved shuffled choices', async () => {
    const questionSet = [{
      id: 1,
      prompt: 'Match each item.',
      type: 'match',
      items: ['Item A', 'Item B'],
      choices: ['Answer B', 'Answer A'],
      module: 'CCNA',
      topic: 'Addressing',
    }];
    prismaMock.examAttempt.findUnique.mockResolvedValue({
      id: 'attempt-id',
      userId: 7,
      examKey: 'short',
      questionSet,
      durationSeconds: 2700,
      deadline: new Date(Date.now() + 2700000),
      score: null,
      review: null,
      submittedAt: null,
    });
    prismaMock.questions.findMany.mockResolvedValue([{
      id: 1,
      module: 'CCNA',
      topic: 'Addressing',
      difficulty: 'Easy',
      question_text: 'Match each item.',
      choices: JSON.stringify(['Answer A', 'Answer B']),
      correct_answer: '[0,1]',
      explanation: 'Match each item to its answer.',
      question_type: 'match',
      match_items: ['Item A', 'Item B'],
    }]);

    const result = await service.submitExam('short', 'attempt-id', 7, [
      { questionId: 1, selectedMatches: [1, 0] },
    ]);

    expect(result.score).toBe(1);
    expect(result.review[0]).toMatchObject({
      type: 'match',
      selectedAnswer: [1, 0],
      correctAnswer: [1, 0],
      isCorrect: true,
    });
  });

  it('rejects an exam attempt owned by a different student', async () => {
    prismaMock.examAttempt.findUnique.mockResolvedValue({
      id: 'attempt-id',
      userId: 8,
      examKey: 'short',
      questionSet: [],
      durationSeconds: 2700,
      deadline: new Date(),
      score: null,
      review: null,
      submittedAt: null,
    });

    await expect(service.resumeExam('short', 'attempt-id', 7)).rejects.toThrow('Exam attempt not found.');
  });

  it('repairs the gradebook when resuming an already submitted attempt', async () => {
    const submittedAt = new Date();
    prismaMock.examAttempt.findUnique.mockResolvedValue({
      id: 'attempt-id',
      userId: 7,
      examKey: 'short',
      questionSet: [{
        id: 1,
        prompt: 'Question',
        options: ['A', 'B'],
        module: 'CCNA',
        topic: 'Routing',
      }],
      durationSeconds: 2700,
      deadline: new Date(Date.now() + 2700000),
      score: 1,
      review: [],
      submittedAt,
    });

    const result = await service.resumeExam('short', 'attempt-id', 7);

    expect(result.isSubmitted).toBe(true);
    expect(gradebookMock.recordAssessment).toHaveBeenCalledWith(7, 'ccna', {
      id: 'attempt-id',
      type: 'exam',
      programKey: 'ccna',
      title: 'Short Exam',
      score: 1,
      maxScore: 1,
      submittedAt: submittedAt.getTime(),
    });
  });

  it('returns signed URLs for private question images', async () => {
    const row = {
      id: 1,
      module: 'CCNA Part 5',
      topic: 'Security',
      difficulty: 'Medium',
      question_text: 'Refer to the exhibit.',
      choices: '{}',
      correct_answer: 'A',
      explanation: '',
      question_type: 'single',
      match_items: null,
      imageUrl: 'questions/ccna-question-1.png',
    };
    const signedUrl = 'https://example.supabase.co/storage/v1/object/sign/question-images/questions/ccna-question-1.png?token=test';
    const prisma = {
      questions: { findMany: vi.fn().mockResolvedValue([row]) },
    };
    const storage = {
      createSignedQuestionImageUrls: vi.fn().mockResolvedValue(new Map([[row.imageUrl, signedUrl]])),
    };
    const module = await Test.createTestingModule({
      providers: [
        QuestionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        {
          provide: GradebookService,
          useValue: { recordAssessment: vi.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    const questionsService = module.get<QuestionsService>(QuestionsService);

    const result = await questionsService.findBank();

    expect(result).toEqual([{
      id: row.id,
      module: row.module,
      topic: row.topic,
      difficulty: row.difficulty,
      question_text: row.question_text,
      choices: row.choices,
      question_type: row.question_type,
      match_items: row.match_items,
      imageUrl: signedUrl,
    }]);
    expect(result[0]).not.toHaveProperty('correct_answer');
    expect(result[0]).not.toHaveProperty('explanation');
    expect(storage.createSignedQuestionImageUrls).toHaveBeenCalledWith([row.imageUrl]);
  });
});
