import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import { CreateQuestionDto, ExamAnswerDto } from './dto/questions.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { StorageService } from '../storage/storage.service.js';
import { GradebookService } from '../gradebook/gradebook.service.js';

const EXAM_CONFIG = {
  short: { questionCount: 50, durationSeconds: 45 * 60, title: 'Short Exam' },
  medium: { questionCount: 100, durationSeconds: 90 * 60, title: 'Medium Exam' },
  long: { questionCount: 150, durationSeconds: 120 * 60, title: 'Long Exam' },
} as const;

type ExamKey = keyof typeof EXAM_CONFIG;
type ExamQuestionBase = {
  id: number;
  prompt: string;
  imageUrl?: string | null;
  options: string[];
  module: string | null;
  topic: string | null;
};
type SingleExamQuestion = ExamQuestionBase & { type: 'single' };
type MatchExamQuestion = Omit<ExamQuestionBase, 'options'> & {
  type: 'match';
  items: string[];
  choices: string[];
};
type ExamQuestion = SingleExamQuestion | MatchExamQuestion;

@Injectable()
export class QuestionsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private gradebook: GradebookService,
  ) {}

  create(data: CreateQuestionDto) {
    const questionType = data.question_type ?? 'single';
    let correctAnswer: string;
    if (questionType === 'match') {
      if (
        !data.match_items ||
        !data.match_answer ||
        data.match_items.length !== data.match_answer.length ||
        data.choices.some((choice) => !choice.trim()) ||
        new Set(data.choices).size !== data.choices.length ||
        data.match_items.some((item) => !item.trim()) ||
        data.match_answer.some((answer) =>
          !Number.isInteger(answer) || answer < 0 || answer >= data.choices.length,
        )
      ) {
        throw new BadRequestException('Each matching item must have a valid answer choice.');
      }
      correctAnswer = JSON.stringify(data.match_answer);
    } else if (!data.correct_answer || !data.choices.includes(data.correct_answer)) {
      throw new BadRequestException('The correct answer must be one of the question choices.');
    } else {
      correctAnswer = data.correct_answer;
    }

    return this.prisma.questions.create({
      data: {
        module: data.module,
        topic: data.topic,
        difficulty: data.difficulty,
        question_text: data.question_text,
        choices: JSON.stringify(data.choices),
        correct_answer: correctAnswer,
        explanation: data.explanation,
        question_type: questionType,
        ...(questionType === 'match' ? { match_items: data.match_items } : {}),
      },
    });
  }

  findAll() {
    return this.prisma.questions.findMany();
  }

  async startExam(examKey: string, userId: number) {
    const config = this.getExamConfig(examKey);
    const bank = await this.prisma.questions.findMany();
    const seenPrompts = new Set<string>();
    const usableQuestions = bank.flatMap((record) => {
      const question = this.readQuestion(record);
      return question ? [question] : [];
    }).filter((question) => {
      const promptKey = question.prompt.replace(/\s+/g, ' ').trim().toLowerCase();
      if (seenPrompts.has(promptKey)) return false;
      seenPrompts.add(promptKey);
      return true;
    });

    if (usableQuestions.length < config.questionCount) {
      throw new BadRequestException(
        bank.length === 0
          ? `This exam requires ${config.questionCount} questions, but the Questions table is empty.`
          : `This exam requires ${config.questionCount} valid questions. The Questions table has ${bank.length} rows, but only ${usableQuestions.length} have a readable prompt, choices, and matching correct answer.`,
      );
    }

    // Persist each randomized set so a resumed attempt keeps the same questions and option order.
    const questionBlocks = config.questionCount / 50;
    const matchingCount = questionBlocks * 5;
    const matchingQuestions = usableQuestions.filter((question) => question.type === 'match');
    const singleQuestions = usableQuestions.filter((question) => question.type === 'single');
    if (matchingQuestions.length < matchingCount || singleQuestions.length < config.questionCount - matchingCount) {
      throw new BadRequestException(
        `This exam requires ${matchingCount} matching questions and ${config.questionCount - matchingCount} multiple-choice questions. ` +
        `The Questions table has ${matchingQuestions.length} valid matching questions and ${singleQuestions.length} valid multiple-choice questions.`,
      );
    }

    const randomizedMatches = this.shuffle(matchingQuestions);
    const randomizedSingles = this.shuffle(singleQuestions);
    const selectedQuestions = Array.from({ length: questionBlocks }, (_, blockIndex) => [
      ...randomizedMatches.slice(blockIndex * 5, (blockIndex + 1) * 5),
      ...randomizedSingles.slice(blockIndex * 45, (blockIndex + 1) * 45),
    ]).flatMap((block) => this.shuffle(block));
    const questionSet = selectedQuestions.map((question) =>
      question.type === 'match'
        ? { ...question, choices: this.shuffle(question.choices) }
        : { ...question, options: this.shuffle(question.options) },
    );
    const startedAt = new Date();
    const deadline = new Date(startedAt.getTime() + config.durationSeconds * 1000);
    const attempt = await this.prisma.examAttempt.create({
      data: {
        id: randomUUID(),
        userId,
        examKey,
        questionSet: questionSet satisfies Prisma.InputJsonValue,
        durationSeconds: config.durationSeconds,
        deadline,
      },
    });

    return this.toAttemptResponse(attempt, questionSet);
  }

  async resumeExam(examKey: string, attemptId: string, userId: number) {
    this.getExamConfig(examKey);
    const attempt = await this.prisma.examAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.userId !== userId || attempt.examKey !== examKey) {
      throw new NotFoundException('Exam attempt not found.');
    }

    const questionSet = this.parseQuestionSet(attempt.questionSet);
    if (attempt.submittedAt) {
      await this.recordGradebookResult(attempt, examKey, userId);
    }
    return this.toAttemptResponse(attempt, questionSet);
  }

  async submitExam(
    examKey: string,
    attemptId: string,
    userId: number,
    answers: ExamAnswerDto[],
  ) {
    this.getExamConfig(examKey);
    const attempt = await this.prisma.examAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.userId !== userId || attempt.examKey !== examKey) {
      throw new NotFoundException('Exam attempt not found.');
    }
    // Return the original result for retries instead of grading or recording a second submission.
    if (attempt.submittedAt) {
      await this.recordGradebookResult(attempt, examKey, userId);
      return this.toAttemptResponse(attempt, this.parseQuestionSet(attempt.questionSet));
    }

    const questionSet = this.parseQuestionSet(attempt.questionSet);
    const questionIds = new Set(questionSet.map(({ id }) => id));
    const submittedIds = new Set(answers.map(({ questionId }) => questionId));
    if (
      submittedIds.size !== answers.length ||
      answers.some(({ questionId }) => !questionIds.has(questionId))
    ) {
      throw new BadRequestException('Submitted answers do not match this exam attempt.');
    }

    const answerById = new Map(answers.map(({ questionId, selectedAnswer, selectedMatches }) => [
      questionId,
      selectedMatches ?? selectedAnswer ?? null,
    ]));
    const databaseQuestions = await this.prisma.questions.findMany({
      where: { id: { in: questionSet.map(({ id }) => id) } },
    });
    const sourceById = new Map(databaseQuestions.map((question) => [question.id, question]));
    const review = questionSet.map((question) => {
      const source = sourceById.get(question.id);
      const selectedAnswer = answerById.get(question.id) ?? null;
      if (!source || !source.correct_answer) {
        throw new InternalServerErrorException('A question in this exam is no longer available for grading.');
      }

      if (question.type === 'match') {
        const originalChoices = this.parseChoices(source.choices);
        if (!originalChoices) {
          throw new InternalServerErrorException('A matching question has invalid choices.');
        }
        const correctIndexes = this.parseMatchAnswer(source.correct_answer, question.items.length, originalChoices.length);
        const correctAnswer = correctIndexes.map((index) => question.choices.indexOf(originalChoices[index]));
        if (correctAnswer.some((index) => index < 0)) {
          throw new InternalServerErrorException('A matching answer is no longer available for grading.');
        }
        if (
          selectedAnswer !== null &&
          (!Array.isArray(selectedAnswer) ||
            selectedAnswer.length !== question.items.length ||
            selectedAnswer.some((index) =>
              index !== null &&
              (!Number.isInteger(index) || index < 0 || index >= question.choices.length),
            ))
        ) {
          throw new BadRequestException('A matching answer is not one of the choices for this exam.');
        }
        const selectedMatches = Array.isArray(selectedAnswer) ? selectedAnswer : null;
        const isCorrect = selectedMatches !== null &&
          correctAnswer.every((answer, index) => selectedMatches[index] === answer);
        return {
          id: question.id,
          prompt: question.prompt,
          imageUrl: question.imageUrl,
          type: question.type,
          items: question.items,
          choices: question.choices,
          selectedAnswer: selectedMatches,
          correctAnswer,
          module: question.module,
          topic: question.topic,
          explanation: source.explanation ?? '',
          isCorrect,
        };
      }

      const correctAnswer = this.findCorrectOption(question.options, source.correct_answer);
      if (!correctAnswer) {
        throw new InternalServerErrorException('A question in this exam is no longer available for grading.');
      }
      if (selectedAnswer !== null && (typeof selectedAnswer !== 'string' || !question.options.includes(selectedAnswer))) {
        throw new BadRequestException('An answer is not one of the choices for this exam.');
      }
      const selectedOption = typeof selectedAnswer === 'string' ? selectedAnswer : null;
      return {
        id: question.id,
        prompt: question.prompt,
        imageUrl: question.imageUrl,
        type: question.type,
        options: question.options,
        module: question.module,
        topic: question.topic,
        selectedAnswer: selectedOption,
        correctAnswer: correctAnswer,
        explanation: source.explanation ?? '',
        isCorrect: selectedOption === correctAnswer,
      };
    });
    const score = review.reduce((total, question) => total + Number(question.isCorrect), 0);
    const submittedAt = new Date();
    // Conditional update ensures only one concurrent request can finalize this attempt.
    const saved = await this.prisma.examAttempt.updateMany({
      where: { id: attemptId, userId, submittedAt: null },
      data: { score, review, submittedAt },
    });

    if (saved.count === 0) {
      const alreadySubmitted = await this.prisma.examAttempt.findUnique({ where: { id: attemptId } });
      if (!alreadySubmitted) throw new NotFoundException('Exam attempt not found.');
      await this.recordGradebookResult(alreadySubmitted, examKey, userId);
      return this.toAttemptResponse(alreadySubmitted, this.parseQuestionSet(alreadySubmitted.questionSet));
    }

    const submittedAttempt = { ...attempt, score, review, submittedAt };
    await this.recordGradebookResult(submittedAttempt, examKey, userId);
    return this.toAttemptResponse(
      submittedAttempt,
      questionSet,
    );
  }

  private async recordGradebookResult(
    attempt: {
      id: string;
      score: number | null;
      submittedAt: Date | null;
      questionSet: Prisma.JsonValue;
    },
    examKey: string,
    userId: number,
  ) {
    if (attempt.score === null || !attempt.submittedAt) {
      throw new InternalServerErrorException('The submitted exam result is incomplete.');
    }
    const config = this.getExamConfig(examKey);
    const questionSet = this.parseQuestionSet(attempt.questionSet);
    await this.gradebook.recordAssessment(userId, 'ccna', {
      id: attempt.id,
      type: 'exam',
      programKey: 'ccna',
      title: config.title,
      score: attempt.score,
      maxScore: questionSet.length,
      submittedAt: attempt.submittedAt.getTime(),
    });
  }

  private getExamConfig(examKey: string) {
    if (!Object.hasOwn(EXAM_CONFIG, examKey)) {
      throw new BadRequestException('Choose a valid exam format.');
    }
    return EXAM_CONFIG[examKey as ExamKey];
  }

  private readQuestion(record: {
    id: number;
    question_text: string | null;
    choices: string | null;
    question_type?: string | null;
    match_items?: Prisma.JsonValue | null;
    module: string | null;
    topic: string | null;
    correct_answer: string | null;
    imageUrl?: string | null;
  }): ExamQuestion | null {
    // Ignore malformed bank rows so only questions that can be safely rendered and graded are selected.
    if (!record.question_text?.trim() || !record.choices || !record.correct_answer) return null;

    const options = this.parseChoices(record.choices);
    if (record.question_type === 'match') {
      const items = record.match_items;
      const matchItems = Array.isArray(items)
        ? items.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [];
      if (
        !options ||
        options.length < 2 ||
        options.length > 8 ||
        !options.every((option) => option.trim().length > 0) ||
        new Set(options).size !== options.length ||
        !Array.isArray(items) ||
        matchItems.length !== items.length ||
        matchItems.length < 2 ||
        matchItems.length > 8 ||
        new Set(matchItems).size !== matchItems.length
      ) {
        return null;
      }
      try {
        this.parseMatchAnswer(record.correct_answer, matchItems.length, options.length);
      } catch {
        return null;
      }
      return {
        id: record.id,
        prompt: record.question_text.trim(),
        imageUrl: record.imageUrl ?? null,
        type: 'match',
        items: matchItems,
        choices: options,
        module: record.module,
        topic: record.topic,
      };
    }
    if (record.question_type && record.question_type !== 'single') return null;
    if (
      !Array.isArray(options) ||
      options.length < 2 ||
      options.length > 8 ||
      !options.every((option): option is string => typeof option === 'string' && option.trim().length > 0) ||
      !this.findCorrectOption(options, record.correct_answer)
    ) {
      return null;
    }

    return {
      id: record.id,
      prompt: record.question_text.trim(),
      imageUrl: record.imageUrl ?? null,
      type: 'single',
      options,
      module: record.module,
      topic: record.topic,
    };
  }

  private parseChoices(value: string | null): string[] | null {
    if (!value) return null;
    try {
      const parsed: unknown = JSON.parse(value);
      const choices = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object'
          ? Object.values(parsed)
          : null;
      return Array.isArray(choices) &&
        choices.every((choice): choice is string => typeof choice === 'string')
        ? choices
        : null;
    } catch {
      return null;
    }
  }

  private parseMatchAnswer(answer: string, itemCount: number, choiceCount: number): number[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(answer);
    } catch {
      throw new Error('The matching answer key is invalid.');
    }
    if (
      !Array.isArray(parsed) ||
      parsed.length !== itemCount ||
      !parsed.every((index) => Number.isInteger(index) && index >= 0 && index < choiceCount)
    ) {
      throw new Error('The matching answer key is invalid.');
    }
    return parsed;
  }

  private findCorrectOption(options: string[], answer: string): string | null {
    const normalizedAnswer = answer.trim();
    const exactMatch = options.find((option) => option.trim().toLocaleLowerCase() === normalizedAnswer.toLocaleLowerCase());
    if (exactMatch) return exactMatch;

    const letterMatch = normalizedAnswer.match(/^\(?([a-h])\)?(?:[.)])?$/i);
    if (letterMatch) {
      const letter = letterMatch[1].toLocaleUpperCase();
      const labeledOption = options.find((option) =>
        new RegExp(`^\\s*\\(?${letter}\\)?[.)\\s:-]+`, 'i').test(option),
      );
      if (labeledOption) return labeledOption;
      const index = letter.charCodeAt(0) - 'A'.charCodeAt(0);
      if (index >= 0 && index < options.length) return options[index];
    }

    const indexMatch = normalizedAnswer.match(/^\(?(-?\d+)\)?(?:[.)])?$/);
    if (indexMatch) {
      const numericIndex = Number(indexMatch[1]);
      if (Number.isInteger(numericIndex)) {
        if (numericIndex >= 1 && numericIndex <= options.length) return options[numericIndex - 1];
        if (numericIndex >= 0 && numericIndex < options.length) return options[numericIndex];
      }
    }

    return null;
  }

  private parseQuestionSet(value: Prisma.JsonValue): ExamQuestion[] {
    if (!Array.isArray(value)) {
      throw new InternalServerErrorException('The saved exam attempt has invalid questions.');
    }
    return value.map((item) => {
      if (
        !item ||
        typeof item !== 'object' ||
        !('id' in item) ||
        !('prompt' in item) ||
        typeof item.id !== 'number' ||
        typeof item.prompt !== 'string' ||
        !('module' in item) ||
        !(typeof item.module === 'string' || item.module === null) ||
        !('topic' in item) ||
        !(typeof item.topic === 'string' || item.topic === null)
      ) {
        throw new InternalServerErrorException('The saved exam attempt has invalid questions.');
      }
      const type = 'type' in item && item.type === 'match' ? 'match' : 'single';
      if (type === 'match') {
        if (
          !('items' in item) ||
          !Array.isArray(item.items) ||
          !item.items.every((matchItem): matchItem is string => typeof matchItem === 'string') ||
          !item.items.length ||
          item.items.length > 8 ||
          !('choices' in item) ||
          !Array.isArray(item.choices) ||
          item.choices.length < 2 ||
          item.choices.length > 8 ||
          !item.choices.every((choice): choice is string => typeof choice === 'string')
        ) {
          throw new InternalServerErrorException('The saved exam attempt has invalid questions.');
        }
        return {
          id: item.id,
          prompt: item.prompt,
          imageUrl: 'imageUrl' in item && (typeof item.imageUrl === 'string' || item.imageUrl === null)
            ? item.imageUrl
            : null,
          type: 'match',
          items: item.items,
          choices: item.choices,
          module: item.module,
          topic: item.topic,
        };
      }
      if (
        !('options' in item) ||
        !Array.isArray(item.options) ||
        item.options.length < 2 ||
        item.options.length > 8 ||
        !item.options.every((option): option is string => typeof option === 'string')
      ) {
        throw new InternalServerErrorException('The saved exam attempt has invalid questions.');
      }
      return {
        id: item.id,
        prompt: item.prompt,
        imageUrl: 'imageUrl' in item && (typeof item.imageUrl === 'string' || item.imageUrl === null)
          ? item.imageUrl
          : null,
        type: 'single',
        options: item.options,
        module: item.module,
        topic: item.topic,
      };
    });
  }

  private async toAttemptResponse(
    attempt: {
      id: string;
      examKey: string;
      durationSeconds: number;
      deadline: Date;
      score: number | null;
      review: Prisma.JsonValue | null;
      submittedAt: Date | null;
    },
    questions: ExamQuestion[],
  ) {
    const imagePaths = [...new Set(questions.flatMap((question) =>
      question.imageUrl && !/^https?:\/\//i.test(question.imageUrl) ? [question.imageUrl] : [],
    ))];
    const signedImageUrls = await this.storage.createSignedQuestionImageUrls(imagePaths);
    const signedQuestions = questions.map((question) => ({
      ...question,
      imageUrl: question.imageUrl && !/^https?:\/\//i.test(question.imageUrl)
        ? signedImageUrls.get(question.imageUrl) ?? question.imageUrl
        : question.imageUrl ?? null,
    }));
    const signedImageByQuestionId = new Map(
      signedQuestions.map((question) => [question.id, question.imageUrl]),
    );
    const review = Array.isArray(attempt.review)
      ? attempt.review.map((entry) => {
        if (entry === null || Array.isArray(entry) || typeof entry !== 'object') return entry;
        const questionId = entry.id;
        if (typeof questionId !== 'number') return entry;
        const imageUrl = signedImageByQuestionId.get(questionId);
        return imageUrl ? { ...entry, imageUrl } : entry;
      })
      : attempt.review;

    // Keep correct answers out of start/resume responses; include them only in the post-submit review.
    return {
      attemptId: attempt.id,
      examKey: attempt.examKey,
      durationSeconds: attempt.durationSeconds,
      deadline: attempt.deadline.getTime(),
      score: attempt.score,
      review,
      submittedAt: attempt.submittedAt?.getTime() ?? null,
      isSubmitted: attempt.submittedAt !== null,
      questions: signedQuestions.map((question) =>
        question.type === 'match'
          ? {
              id: question.id,
              prompt: question.prompt,
              imageUrl: question.imageUrl,
              type: question.type,
              items: question.items,
              choices: question.choices,
              module: question.module,
              topic: question.topic,
            }
          : {
              id: question.id,
              prompt: question.prompt,
              imageUrl: question.imageUrl,
              type: question.type,
              options: question.options,
              module: question.module,
              topic: question.topic,
            },
      ),
    };
  }

  private shuffle<T>(items: T[]): T[] {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const nextIndex = randomInt(index + 1);
      [shuffled[index], shuffled[nextIndex]] = [shuffled[nextIndex], shuffled[index]];
    }
    return shuffled;
  }

  async findBank() {
    const rows = await this.prisma.questions.findMany({
      select: {
        id: true,
        module: true,
        topic: true,
        difficulty: true,
        question_text: true,
        choices: true,
        question_type: true,
        match_items: true,
        imageUrl: true,
      },
      orderBy: { id: 'asc' },
    });
    const imagePaths = [...new Set(rows.flatMap((row) => {
      const imageUrl = row.imageUrl;
      return imageUrl && !/^https?:\/\//i.test(imageUrl) ? [imageUrl] : [];
    }))];
    const signedUrls = await this.storage.createSignedQuestionImageUrls(imagePaths);

    return rows.map((row) => ({
      id: row.id,
      module: row.module,
      topic: row.topic,
      difficulty: row.difficulty,
      question_text: row.question_text,
      choices: row.choices,
      question_type: row.question_type,
      match_items: row.match_items,
      imageUrl: row.imageUrl ? signedUrls.get(row.imageUrl) ?? row.imageUrl : null,
    }));
  }
}
