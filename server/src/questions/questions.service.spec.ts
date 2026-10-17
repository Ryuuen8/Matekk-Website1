import { Test, TestingModule } from '@nestjs/testing';
import { QuestionsService } from './questions.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { GradebookService } from '../gradebook/gradebook.service.js';
import { ProgramAccessService } from '../users/program-access.service.js';

function examQuestionBank(questionCount: number) {
  return Array.from({ length: questionCount / 50 }, (_, blockIndex) => {
    const firstId = blockIndex * 50 + 1;
    const singleQuestions = Array.from({ length: 40 }, (_, index) => ({
      id: firstId + index,
      module: 'CCNA',
      topic: 'Routing',
      difficulty: 'Easy',
      question_text: `Question ${firstId + index}`,
      choices: JSON.stringify(['Correct', 'Wrong A', 'Wrong B']),
      correct_answer: '0',
      explanation: 'Because it is correct.',
      question_type: 'single',
      match_items: null,
      imageUrl: null,
    }));
    const matchQuestions = Array.from({ length: 5 }, (_, index) => ({
      id: firstId + 40 + index,
      module: 'CCNA',
      topic: 'Addressing',
      difficulty: 'Medium',
      question_text: `Connect-the-dots question ${firstId + 40 + index}`,
      choices: JSON.stringify(['Answer A', 'Answer B']),
      correct_answer: '[0,1]',
      explanation: 'Each item maps to its corresponding answer.',
      question_type: 'match',
      match_items: ['Item A', 'Item B'],
      imageUrl: null,
    }));
    const dragDropQuestions = Array.from({ length: 3 }, (_, index) => ({
      id: firstId + 45 + index,
      module: 'CCNA',
      topic: 'Addressing',
      difficulty: 'Medium',
      question_text: `Drag-and-drop question ${firstId + 45 + index}`,
      choices: JSON.stringify(['Answer A', 'Answer B']),
      correct_answer: '[0,1]',
      explanation: 'Each item maps to its corresponding answer.',
      question_type: 'drag_drop',
      match_items: ['Item A', 'Item B'],
      imageUrl: null,
    }));
    const clickBoxesQuestion = {
      id: firstId + 48,
      module: 'CCNA',
      topic: 'Addressing',
      difficulty: 'Medium',
      question_text: `Click-the-boxes question ${firstId + 48}`,
      choices: JSON.stringify(['Answer A', 'Answer B']),
      correct_answer: '[0,1]',
      explanation: 'Each answer is used once.',
      question_type: 'click_boxes',
      match_items: ['Item A', 'Item B'],
      imageUrl: null,
    };
    const imageQuestion = {
      id: firstId + 49,
      module: 'CCNA',
      topic: 'Addressing',
      difficulty: 'Medium',
      question_text: `Image question ${firstId + 49}`,
      choices: JSON.stringify(['Network', 'Host', 'Broadcast']),
      correct_answer: '[0,1,0,2]',
      explanation: 'Classify each item using the image.',
      question_type: 'image',
      match_items: ['Item A', 'Item B', 'Item C', 'Item D'],
      imageUrl: `questions/image-question-${firstId + 49}.png`,
    };
    return [...singleQuestions, ...matchQuestions, ...dragDropQuestions, clickBoxesQuestion, imageQuestion];
  }).flat();
}

describe('QuestionsService', () => {
  let service: QuestionsService;
  let gradebookMock: { recordAssessment: ReturnType<typeof vi.fn> };
  let programAccessMock: { assertQuestionModuleEnrollment: ReturnType<typeof vi.fn> };
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
    programAccessMock = { assertQuestionModuleEnrollment: vi.fn().mockResolvedValue(undefined) };
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
        {
          provide: ProgramAccessService,
          useValue: programAccessMock,
        },
      ],
    }).compile();

    service = module.get<QuestionsService>(QuestionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('filters usable questions by module and normalizes Supabase multiple-choice records', async () => {
    prismaMock.questions.findMany.mockResolvedValue([
      {
        id: 1955,
        module: 'CompTIA Network+',
        topic: '',
        question_text: 'Which option is correct?',
        choices: JSON.stringify([
          { id: 'A', text: 'First option' },
          { id: 'B', text: 'Second option' },
          { id: 'C', text: 'Third option' },
          { id: 'D', text: 'Fourth option' },
        ]),
        correct_answer: 'C',
        explanation: 'The third option is correct.',
        question_type: 'multiple_choice',
        match_items: null,
        imageUrl: null,
      },
      {
        id: 1956,
        module: 'CompTIA Network+',
        topic: '',
        question_text: 'Select all correct options.',
        choices: JSON.stringify([
          { id: 'A', text: 'First option' },
          { id: 'B', text: 'Second option' },
        ]),
        correct_answer: 'A,B',
        explanation: 'This is a multiple-select question.',
        question_type: 'multiple_select',
        match_items: null,
        imageUrl: null,
      },
    ]);

    const { questions, skippedCount } = await service.findUsableBank('  comptia network+  ');

    expect(prismaMock.questions.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { module: { equals: 'comptia network+', mode: 'insensitive' } },
      orderBy: { id: 'asc' },
    }));
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      bankId: 1955,
      module: 'CompTIA Network+',
      type: 'single',
      options: ['First option', 'Second option', 'Third option', 'Fourth option'],
      answer: 2,
    });
    expect(skippedCount).toBe(1);
  });

  it('loads usable questions for new module names without a module allowlist', async () => {
    prismaMock.questions.findMany.mockResolvedValue([{
      id: 2401,
      module: 'CompTIA Security+',
      topic: 'Security Operations',
      question_text: 'Which option is correct?',
      choices: JSON.stringify(['First option', 'Second option']),
      correct_answer: 'A',
      explanation: 'The first option is correct.',
      question_type: 'MCQ',
      match_items: null,
      imageUrl: null,
    }]);

    const { questions } = await service.findUsableBank('CompTIA Security+');

    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      bankId: 2401,
      module: 'CompTIA Security+',
      type: 'single',
      answer: 0,
    });
  });

  it('rejects empty or oversized module filters instead of returning an unintended bank', async () => {
    await expect(service.findUsableBank('   ')).rejects.toThrow(
      'The module filter must contain between 1 and 120 characters.',
    );
    await expect(service.findBank('x'.repeat(121))).rejects.toThrow(
      'The module filter must contain between 1 and 120 characters.',
    );
    expect(prismaMock.questions.findMany).not.toHaveBeenCalled();
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

  it('stores click-the-boxes questions with one distinct answer for every item', async () => {
    await service.create({
      module: 'CCNA',
      topic: 'Switching',
      difficulty: 'Medium',
      question_text: 'Click the matching answer boxes.',
      question_type: 'click_boxes',
      choices: ['Answer A', 'Answer B'],
      match_items: ['Item A', 'Item B'],
      match_answer: [1, 0],
      explanation: 'Each answer is used once.',
    });

    expect(prismaMock.questions.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        question_type: 'click_boxes',
        choices: JSON.stringify(['Answer A', 'Answer B']),
        match_items: ['Item A', 'Item B'],
        correct_answer: '[1,0]',
      }),
    });
    expect(() => service.create({
      module: 'CCNA',
      topic: 'Switching',
      difficulty: 'Medium',
      question_text: 'Invalid click-box question.',
      question_type: 'click_boxes',
      choices: ['Answer A', 'Answer B'],
      match_items: ['Item A', 'Item B'],
      match_answer: [0, 0],
      explanation: 'Each answer should be unique.',
    })).toThrow('Click-the-boxes questions must use each answer choice exactly once.');
  });

  it('stores image-based questions with their exhibit and grouped answer key', async () => {
    await service.create({
      module: 'CCNA',
      topic: 'Addressing',
      difficulty: 'Easy',
      question_text: 'Use the exhibit to classify each address.',
      question_type: 'image',
      imageUrl: 'questions/addressing.png',
      choices: ['Network', 'Host', 'Broadcast'],
      match_items: ['Address A', 'Address B', 'Address C', 'Address D'],
      match_answer: [0, 1, 0, 2],
      explanation: 'Classify each address using its network portion.',
    });

    expect(prismaMock.questions.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        question_type: 'image',
        imageUrl: 'questions/addressing.png',
        match_items: ['Address A', 'Address B', 'Address C', 'Address D'],
        choices: JSON.stringify(['Network', 'Host', 'Broadcast']),
        correct_answer: '[0,1,0,2]',
      }),
    });
  });

  it('requires image questions to include an exhibit image', () => {
    expect(() => service.create({
      module: 'CCNA',
      topic: 'Addressing',
      difficulty: 'Easy',
      question_text: 'Use the exhibit to classify each address.',
      question_type: 'image',
      choices: ['Network', 'Host'],
      match_items: ['Address A', 'Address B'],
      match_answer: [0, 1],
      explanation: 'Classify each address.',
    })).toThrow('An image question must include an image URL.');
  });

  it('accepts zero-based numeric answer keys when building an exam', async () => {
    const databaseQuestions = examQuestionBank(50);
    prismaMock.questions.findMany.mockResolvedValue(databaseQuestions);

    const attempt = await service.startExam('short', 7);

    expect(attempt.questions).toHaveLength(50);
    expect(attempt.questions.every((question) => !('correctAnswer' in question))).toBe(true);
    expect(prismaMock.examAttempt.create).toHaveBeenCalledOnce();
  });

  it('starts randomized database exams without returning answer keys', async () => {
    const databaseQuestions = examQuestionBank(50);
    prismaMock.questions.findMany.mockResolvedValue(databaseQuestions);

    const attempt = await service.startExam('short', 7);

    expect(attempt.questions).toHaveLength(50);
    expect(attempt.questions.filter((question) => question.type === 'match')).toHaveLength(5);
    expect(attempt.questions.filter((question) => question.type === 'drag_drop')).toHaveLength(3);
    expect(attempt.questions.filter((question) => question.type === 'click_boxes')).toHaveLength(1);
    expect(attempt.questions.filter((question) => question.type === 'image')).toHaveLength(1);
    expect(attempt.questions.every((question) =>
      !('correct_answer' in question) && !('answer' in question),
    )).toBe(true);
    expect(attempt.questions.find((question) => question.type === 'single')).toMatchObject({
      id: expect.any(Number),
      prompt: expect.any(String),
      options: expect.arrayContaining(['Correct', 'Wrong A', 'Wrong B']),
    });
    expect(attempt.questions.find((question) => question.type === 'drag_drop')).toMatchObject({
      type: 'drag_drop',
      items: ['Item A', 'Item B'],
      choices: expect.arrayContaining(['Answer A', 'Answer B']),
    });
    expect(attempt.questions.find((question) => question.type === 'image')).toMatchObject({
      type: 'image',
      groupSizes: expect.arrayContaining([2, 1, 1]),
      imageUrl: expect.stringContaining('image-question'),
    });
    expect(prismaMock.examAttempt.create).toHaveBeenCalledOnce();
    expect(prismaMock.examAttempt.create.mock.calls[0][0].data.userId).toBe(7);
  });

  it('keeps questions from other modules out of the CCNA exam bank', async () => {
    const ccnaQuestions = examQuestionBank(50);
    prismaMock.questions.findMany.mockResolvedValue([
      ...ccnaQuestions,
      {
        ...ccnaQuestions[0],
        id: 1001,
        module: 'CompTIA Network+',
        question_text: 'CompTIA question that must not be used.',
      },
      {
        ...ccnaQuestions[1],
        id: 1002,
        module: 'CCNA Automation',
        question_text: 'Automation question that must not be used.',
      },
      {
        ...ccnaQuestions[2],
        id: 1003,
        module: 'CCNA Part 5',
        question_text: 'Legacy CCNA module question.',
      },
    ]);

    const attempt = await service.startExam('short', 7);

    expect(prismaMock.questions.findMany).toHaveBeenCalledWith({
      where: { module: { startsWith: 'CCNA', mode: 'insensitive' } },
    });
    expect(attempt.questions).toHaveLength(50);
    expect(attempt.questions.map((question) => question.id)).not.toContain(1001);
    expect(attempt.questions.map((question) => question.id)).not.toContain(1002);
  });

  it('starts, grades, and records a randomized module exam in its program gradebook', async () => {
    const moduleQuestions = examQuestionBank(50).map((question) => ({
      ...question,
      module: 'CompTIA Network+',
    }));
    prismaMock.questions.findMany.mockResolvedValue(moduleQuestions);

    const attempt = await service.startExam(
      'short',
      7,
      'CompTIA Network+',
      'comptia-network-plus',
    );
    const answers = attempt.questions.map((question) => {
      const source = moduleQuestions.find((candidate) => candidate.id === question.id);
      if (!source) throw new Error('The exam selected a question outside its requested module.');
      const sourceChoices = JSON.parse(source.choices ?? '[]') as string[];
      if (question.type === 'single') {
        return { questionId: question.id, selectedAnswer: sourceChoices[0] };
      }
      const correctIndexes = JSON.parse(source.correct_answer ?? '[]') as number[];
      return {
        questionId: question.id,
        selectedMatches: correctIndexes.map((index) => question.choices.indexOf(sourceChoices[index])),
      };
    });
    prismaMock.examAttempt.findUnique.mockResolvedValue({
      ...prismaMock.examAttempt.create.mock.calls[0][0].data,
      score: null,
      review: null,
      submittedAt: null,
    });
    const result = await service.submitExam('short', attempt.attemptId, 7, answers);

    expect(programAccessMock.assertQuestionModuleEnrollment).toHaveBeenCalledWith(
      7,
      'comptia-network-plus',
      'CompTIA Network+',
    );
    expect(prismaMock.questions.findMany).toHaveBeenCalledWith({
      where: { module: { equals: 'CompTIA Network+', mode: 'insensitive' } },
    });
    expect(attempt.questions).toHaveLength(50);
    expect(prismaMock.examAttempt.create.mock.calls[0][0].data).toMatchObject({
      examKey: 'short',
      programKey: 'comptia-network-plus',
      module: 'CompTIA Network+',
    });
    expect(result.score).toBe(50);
    expect(gradebookMock.recordAssessment).toHaveBeenCalledWith(
      7,
      'comptia-network-plus',
      expect.objectContaining({
        id: attempt.attemptId,
        type: 'exam',
        programKey: 'comptia-network-plus',
        examFormat: 'short',
        title: 'Short Exam · CompTIA Network+',
        score: 50,
        maxScore: 50,
      }),
    );
  });

  it('requires the module and program scope to be provided together', async () => {
    await expect(service.startExam('short', 7, 'CompTIA Network+')).rejects.toThrow(
      'Both module and programKey are required for a module exam.',
    );
    expect(prismaMock.questions.findMany).not.toHaveBeenCalled();
  });

  it('uses an extra one-to-one drag-and-drop question for the click-the-boxes interaction when needed', async () => {
    const databaseQuestions = examQuestionBank(50).map((question) =>
      question.question_type === 'click_boxes'
        ? { ...question, question_type: 'drag_drop' }
        : question,
    );
    prismaMock.questions.findMany.mockResolvedValue(databaseQuestions);

    const attempt = await service.startExam('short', 7);

    expect(attempt.questions.filter((question) => question.type === 'drag_drop')).toHaveLength(3);
    expect(attempt.questions.filter((question) => question.type === 'click_boxes')).toHaveLength(1);
  });

  it('returns shuffled group sizes for grouped matching questions without exposing their answer keys', async () => {
    const databaseQuestions = examQuestionBank(50).map((question) =>
      question.id === 50
        ? {
            ...question,
            choices: JSON.stringify(['Network', 'Host', 'Broadcast']),
            correct_answer: '[0,0,1,0]',
            match_items: ['Address A', 'Address B', 'Address C', 'Address D'],
          }
        : question,
    );
    prismaMock.questions.findMany.mockResolvedValue(databaseQuestions);

    const attempt = await service.startExam('short', 7);
    const groupedQuestion = attempt.questions.find((question) => question.id === 50);

    expect(groupedQuestion).toMatchObject({
      type: 'image',
      groupSizes: expect.any(Array),
    });
    if (groupedQuestion?.type !== 'image') throw new Error('Expected an image question.');
    expect(groupedQuestion.groupSizes).toHaveLength(groupedQuestion.choices.length);
    expect(groupedQuestion.groupSizes?.reduce((total, size) => total + size, 0)).toBe(4);
    expect(Object.fromEntries(groupedQuestion.choices.map((choice, index) => [
      choice,
      groupedQuestion.groupSizes?.[index],
    ]))).toEqual({ Network: 3, Host: 1, Broadcast: 0 });
    expect(groupedQuestion).not.toHaveProperty('answer');
    expect(groupedQuestion).not.toHaveProperty('correct_answer');
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
    expect(storageMock.createSignedQuestionImageUrls).toHaveBeenCalledWith(
      expect.arrayContaining([imagePath, 'questions/image-question-50.png']),
    );
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
        examFormat: 'short',
        title: 'Short Exam',
        score: 1,
        maxScore: 50,
        submittedAt: expect.any(Number),
      },
    );
  });

  it('submits single, connect-the-dots, drag-and-drop, click-the-boxes, and image answers together', async () => {
    const questionSet = [
      {
        id: 1,
        prompt: 'Choose the protocol.',
        options: ['OSPF', 'EIGRP'],
        module: 'CCNA',
        topic: 'Routing',
      },
      {
        id: 2,
        prompt: 'Connect each item.',
        type: 'match',
        items: ['Blue', 'Red'],
        choices: ['Stop sign', 'Sky'],
        module: 'CCNA',
        topic: 'Addressing',
      },
      {
        id: 3,
        prompt: 'Place each command.',
        type: 'drag_drop',
        items: ['First', 'Second'],
        choices: ['configure terminal', 'show ip route'],
        module: 'CCNA',
        topic: 'Switching',
      },
      {
        id: 4,
        prompt: 'Click the matching boxes.',
        type: 'click_boxes',
        items: ['Item A', 'Item B'],
        choices: ['Choice A', 'Choice B'],
        module: 'CCNA',
        topic: 'Addressing',
      },
      {
        id: 5,
        prompt: 'Classify each address.',
        type: 'image',
        imageUrl: 'questions/addressing.png',
        items: ['Address A', 'Address B', 'Address C', 'Address D'],
        choices: ['Host', 'Broadcast', 'Network'],
        groupSizes: [1, 1, 2],
        module: 'CCNA',
        topic: 'Addressing',
      },
    ];
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
    prismaMock.questions.findMany.mockResolvedValue([
      {
        id: 1,
        question_text: 'Choose the protocol.',
        choices: JSON.stringify(['EIGRP', 'OSPF']),
        correct_answer: 'OSPF',
        explanation: 'OSPF is correct.',
        question_type: 'single',
      },
      {
        id: 2,
        question_text: 'Connect each item.',
        choices: JSON.stringify(['Sky', 'Stop sign']),
        correct_answer: '[0,1]',
        explanation: 'Match by association.',
        question_type: 'match',
        match_items: ['Blue', 'Red'],
      },
      {
        id: 3,
        question_text: 'Place each command.',
        choices: JSON.stringify(['show ip route', 'configure terminal']),
        correct_answer: '[0,1]',
        explanation: 'Use the correct order.',
        question_type: 'drag_drop',
        match_items: ['First', 'Second'],
      },
      {
        id: 4,
        question_text: 'Click the matching boxes.',
        choices: JSON.stringify(['Choice A', 'Choice B']),
        correct_answer: '[0,1]',
        explanation: 'Each answer is used once.',
        question_type: 'click_boxes',
        match_items: ['Item A', 'Item B'],
      },
      {
        id: 5,
        question_text: 'Classify each address.',
        choices: JSON.stringify(['Network', 'Host', 'Broadcast']),
        correct_answer: '[0,1,0,2]',
        explanation: 'Classify based on the prefix.',
        question_type: 'image',
        match_items: ['Address A', 'Address B', 'Address C', 'Address D'],
        imageUrl: 'questions/addressing.png',
      },
    ]);

    const result = await service.submitExam('short', 'attempt-id', 7, [
      { questionId: 1, selectedAnswer: 'OSPF' },
      { questionId: 2, selectedMatches: [1, 0] },
      { questionId: 3, selectedMatches: [1, 0] },
      { questionId: 4, selectedMatches: [0, 1] },
      { questionId: 5, selectedMatches: [2, 0, 2, 1] },
    ]);

    expect(result.score).toBe(5);
    expect(result.review).toHaveLength(5);
    expect(result.review.map((question) => question.type ?? 'single')).toEqual([
      'single',
      'match',
      'drag_drop',
      'click_boxes',
      'image',
    ]);
    expect(result.review.every((question) => question.isCorrect)).toBe(true);
    expect(prismaMock.examAttempt.updateMany).toHaveBeenCalledOnce();
    expect(gradebookMock.recordAssessment).toHaveBeenCalledOnce();
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
  ] as const)('includes five connect-the-dots, three drag-and-drop, one click-the-boxes, and one image question per 50-question block in the %s exam', async (count, examKey) => {
    prismaMock.questions.findMany.mockResolvedValue(examQuestionBank(count));

    const attempt = await service.startExam(examKey, 7);

    expect(attempt.questions).toHaveLength(count);
    for (let offset = 0; offset < count; offset += 50) {
      const block = attempt.questions.slice(offset, offset + 50);
      expect(block.filter((question) => question.type === 'match')).toHaveLength(5);
      expect(block.filter((question) => question.type === 'drag_drop')).toHaveLength(3);
      expect(block.filter((question) => question.type === 'click_boxes')).toHaveLength(1);
      expect(block.filter((question) => question.type === 'image')).toHaveLength(1);
      expect(block.filter((question) => question.type === 'single')).toHaveLength(40);
    }
  });

  it('grades matching answers against the saved shuffled choices', async () => {
    const questionSet = [{
      id: 1,
      prompt: 'Match each item.',
      type: 'drag_drop',
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
      type: 'drag_drop',
      selectedAnswer: [1, 0],
      correctAnswer: [1, 0],
      isCorrect: true,
    });
  });

  it('records a module exam result against its persisted program gradebook scope', async () => {
    const submittedAt = new Date();
    prismaMock.examAttempt.findUnique.mockResolvedValue({
      id: 'network-attempt',
      userId: 7,
      examKey: 'short',
      programKey: 'comptia-network-plus',
      module: 'CompTIA Network+',
      questionSet: [{
        id: 1,
        prompt: 'Question',
        options: ['A', 'B'],
        module: 'CompTIA Network+',
        topic: 'Network Operations',
      }],
      durationSeconds: 2700,
      deadline: new Date(Date.now() + 2700000),
      score: 1,
      review: [],
      submittedAt,
    });

    const result = await service.resumeExam('short', 'network-attempt', 7);

    expect(result.isSubmitted).toBe(true);
    expect(gradebookMock.recordAssessment).toHaveBeenCalledWith(7, 'comptia-network-plus', {
      id: 'network-attempt',
      type: 'exam',
      programKey: 'comptia-network-plus',
      examFormat: 'short',
      title: 'Short Exam · CompTIA Network+',
      score: 1,
      maxScore: 1,
      submittedAt: submittedAt.getTime(),
    });
  });

  it('grades image question number-entry answers using the saved shuffled choices', async () => {
    prismaMock.examAttempt.findUnique.mockResolvedValue({
      id: 'attempt-id',
      userId: 7,
      examKey: 'short',
      questionSet: [{
        id: 1,
        prompt: 'Use the exhibit to classify each address.',
        type: 'image',
        imageUrl: 'questions/addressing.png',
        items: ['Address A', 'Address B', 'Address C', 'Address D'],
        choices: ['Host', 'Broadcast', 'Network'],
        groupSizes: [1, 1, 2],
        module: 'CCNA',
        topic: 'Addressing',
      }],
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
      question_text: 'Use the exhibit to classify each address.',
      choices: JSON.stringify(['Network', 'Host', 'Broadcast']),
      correct_answer: '[0,1,0,2]',
      explanation: 'Classify each address using its network portion.',
      question_type: 'image',
      match_items: ['Address A', 'Address B', 'Address C', 'Address D'],
      imageUrl: 'questions/addressing.png',
    }]);

    const result = await service.submitExam('short', 'attempt-id', 7, [
      { questionId: 1, selectedMatches: [2, 0, 2, 1] },
    ]);

    expect(result.score).toBe(1);
    expect(result.review[0]).toMatchObject({
      type: 'image',
      selectedAnswer: [2, 0, 2, 1],
      correctAnswer: [2, 0, 2, 1],
      isCorrect: true,
    });
  });

  it('grades legacy drag-and-drop answers whose choices are stored in the answer text', async () => {
    prismaMock.examAttempt.findUnique.mockResolvedValue({
      id: 'attempt-id',
      userId: 7,
      examKey: 'short',
      questionSet: [{
        id: 1,
        prompt: 'Match each device to its role.',
        type: 'match',
        items: ['R1', 'SW1'],
        choices: ['Switch', 'Router'],
        module: 'CCNA',
        topic: 'Network Devices',
      }],
      durationSeconds: 2700,
      deadline: new Date(Date.now() + 2700000),
      score: null,
      review: null,
      submittedAt: null,
    });
    prismaMock.questions.findMany.mockResolvedValue([{
      id: 1,
      module: 'CCNA',
      topic: 'Network Devices',
      difficulty: 'Easy',
      question_text: 'Match each device to its role.',
      choices: '',
      correct_answer: 'Router:\n+ R1\nSwitch:\n+ SW1',
      explanation: 'Routers route traffic; switches connect local devices.',
      question_type: 'single',
      match_items: null,
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
      examFormat: 'short',
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
        {
          provide: ProgramAccessService,
          useValue: { assertQuestionModuleEnrollment: vi.fn().mockResolvedValue(undefined) },
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

  it('returns normalized usable bank questions and counts skipped rows', async () => {
    prismaMock.questions.findMany.mockResolvedValue([
      {
        id: 1,
        module: 'CCNA',
        topic: 'Routing',
        question_text: 'Which option is correct?',
        choices: JSON.stringify(['Wrong', 'Correct']),
        correct_answer: 'Correct',
        explanation: 'The second option is correct.',
        question_type: 'single',
        match_items: null,
        imageUrl: null,
      },
      {
        id: 2,
        module: 'CCNA',
        topic: 'Addressing',
        question_text: 'Match each item.',
        choices: JSON.stringify(['Blue', 'Red']),
        correct_answer: '[0,1]',
        explanation: '',
        question_type: 'match',
        match_items: ['Sky', 'Stop sign'],
        imageUrl: null,
      },
      {
        id: 3,
        module: 'CCNA',
        topic: 'Switching',
        question_text: 'Classify each technology.',
        choices: null,
        correct_answer: 'Routers:\n+ OSPF\n+ EIGRP\nSwitches:\n+ VLAN\n+ STP',
        explanation: '',
        question_type: 'single',
        match_items: null,
        imageUrl: null,
      },
      {
        id: 4,
        module: 'CCNA',
        topic: 'Routing',
        question_text: 'Invalid question',
        choices: null,
        correct_answer: null,
        explanation: '',
        question_type: 'single',
        match_items: null,
        imageUrl: null,
      },
      {
        id: 5,
        module: 'CCNA',
        topic: 'Switching',
        question_text: 'Place each command in order.',
        choices: JSON.stringify(['show ip route', 'configure terminal']),
        correct_answer: '[0,1]',
        explanation: '',
        question_type: 'drag_drop',
        match_items: ['First', 'Second'],
        imageUrl: null,
      },
    ]);

    const result = await service.findUsableBank();

    expect(result).toEqual({
      questions: [
        {
          id: 1,
          prompt: 'Which option is correct?',
          imageUrl: null,
          type: 'single',
          options: ['Wrong', 'Correct'],
          module: 'CCNA',
          topic: 'Routing',
          bankId: 1,
          answer: 1,
          explanation: 'The second option is correct.',
          source: 'question-bank',
        },
        {
          id: 2,
          prompt: 'Match each item.',
          imageUrl: null,
          type: 'match',
          items: ['Sky', 'Stop sign'],
          choices: ['Blue', 'Red'],
          module: 'CCNA',
          topic: 'Addressing',
          bankId: 2,
          answer: [0, 1],
          explanation: '',
          source: 'question-bank',
        },
        {
          id: 3,
          prompt: 'Classify each technology.',
          imageUrl: null,
          type: 'match',
          items: ['EIGRP', 'STP', 'OSPF', 'VLAN'],
          choices: ['Routers', 'Switches'],
          groupSizes: [2, 2],
          module: 'CCNA',
          topic: 'Switching',
          bankId: 3,
          answer: [0, 1, 0, 1],
          explanation: '',
          source: 'question-bank',
        },
        {
          id: 5,
          prompt: 'Place each command in order.',
          imageUrl: null,
          type: 'drag_drop',
          items: ['First', 'Second'],
          choices: ['show ip route', 'configure terminal'],
          module: 'CCNA',
          topic: 'Switching',
          bankId: 5,
          answer: [0, 1],
          explanation: '',
          source: 'question-bank',
        },
      ],
      skippedCount: 1,
    });
  });
});
